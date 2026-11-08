const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const rooms = new Map();
const waitingQueue = [];
const ROOM_EXPIRE_TIME = 10 * 60 * 1000; // 10分钟未满人自动清理
const MAX_MESSAGES_PER_SECOND = 20;
const MAX_PAYLOAD = 64 * 1024; // 64KB

// 题库（与客户端同步）
const questions = [
  // Level 1 - 破冰
  ["你的择偶标准前三是什么？","你最近一次心动是什么时候？","你觉得自己最吸引人的地方是？",
   "你手机里最舍不得删的一张照片是什么内容？","你最喜欢被夸什么？","你理想中的约会是怎样的？",
   "你最近在循环的一首歌是？","你觉得暧昧期最甜的瞬间是什么？","你现在是单身吗？多久了？"],
  // Level 2 - 暧昧
  ["你有没有偷偷关注过一个人很久？","你会因为什么瞬间喜欢上一个人？",
   "你谈过几段恋爱？最长的多久？","你最想被另一半怎么宠？","你有没有说过违心的分手？",
   "你最怕恋爱中遇到什么？","深夜最容易想起谁？","你觉得网聊能聊出真感情吗？"],
  // Level 3 - 走心
  ["你上一段感情为什么结束？","你做过最疯狂的追人举动是什么？","你有没有为一个人改变过自己？",
   "你觉得爱情里最不能忍的是什么？","你现在对感情是什么态度？","你有没有喜欢过不该喜欢的人？",
   "你最想对前任说的一句话是？","你觉得自己值得被爱吗？","你会为了喜欢的人主动到什么程度？"],
  // Level 4 - 入骨
  ["你最敏感的身体部位是哪里？","你喜欢主动的还是被撩的？","你能接受暧昧期多久不确定关系？",
   "你对亲密接触的底线在哪？","你最受不了被什么方式撩？","你觉得接吻最重要的是技巧还是感觉？",
   "你会在什么情况下主动吻一个人？","你有没有只是因为寂寞而找过人？",
   "你最想和喜欢的人一起做的事是什么？不许说正经的。","你有没有被撩到过心跳加速？对方做了什么？"],
  // Level 5 - 致命
  ["你最大胆的一次经历是什么？","你有什么不为人知的癖好？","你洗完澡第一件事是什么？",
   "你有没有在不该心动的时候心动过？后来怎样了？","你最想在什么场景下和喜欢的人独处？",
   "你半夜睡不着的时候一般在想什么？","你有没有因为太想一个人而失眠？在想什么？",
   "说一句你从来没对别人说过的心里话。","你做过最出格的梦是什么内容？"],
  // Level 6 - 18+
  ["你最享受的一次是什么体验？细说。","你有什么特殊的性癖好是没告诉过别人的？",
   "你最想尝试但还没试过的姿势或玩法是什么？","你最受不了对方在床上做什么？",
   "你有没有在不该有感觉的场合突然有了反应？","你最持久的一次多久？什么情况下？",
   "你对dirty talk什么感觉？会说什么？","你有没有自己解决过？频率多少？",
   "你穿着方面有什么能让你瞬间来感觉的？","你最想在什么地方做一次？"]
];

function getQuestion(round, nsfw = true) {
  const maxLevel = nsfw ? questions.length - 1 : questions.length - 2;
  const level = Math.min(Math.floor(round / 2), maxLevel);
  const pool = questions[level];
  return pool[Math.floor(Math.random() * pool.length)];
}

// 房间号改用加密随机数生成，不可预测
function genRoomId() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// 房间设置校验：timer 只接受 30/60/120，nsfw 必须是布尔值（默认关闭）
function sanitizeSettings(settings = {}) {
  const timer = [30, 60, 120].includes(settings.timer) ? settings.timer : 60;
  const nsfw = typeof settings.nsfw === 'boolean' ? settings.nsfw : false;
  return { timer, nsfw };
}

function broadcast(room, data) {
  room.players.forEach(p => {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(data));
  });
}

function checkWin(board, row, col) {
  const piece = board[row][col];
  if (!piece) return false;
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const r = row + dr*i, c = col + dc*i;
      if (r<0||r>14||c<0||c>14||board[r][c]!==piece) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr*i, c = col - dc*i;
      if (r<0||r>14||c<0||c>14||board[r][c]!==piece) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

function createRoom(id, isPrivate = false, settings = {}) {
  return {
    id,
    players: [],
    board: Array.from({length:15}, ()=>Array(15).fill(0)),
    moveHistory: [],
    turn: 1,
    round: 0,
    isPrivate,
    gameOver: false,
    createdAt: Date.now(),
    turnStartTime: null,
    undoPending: null,
    settings: sanitizeSettings(settings)
  };
}

function resetBoard(room) {
  room.board = Array.from({length:15}, ()=>Array(15).fill(0));
  room.moveHistory = [];
  room.turn = 1;
  room.round++;
  room.gameOver = false;
  room.undoPending = null;
  room.turnStartTime = Date.now();
}

// 服务端权威悔棋：从 board 删掉最后两颗子，轮次指回先下那一方
// 返回被撤销的落子（按时间顺序），不足两子时撤销全部已有落子
function applyUndo(room) {
  const removed = room.moveHistory.splice(-2);
  if (removed.length === 0) return null;
  for (const m of removed) {
    room.board[m.row][m.col] = 0;
  }
  room.turn = removed[0].piece;
  room.turnStartTime = Date.now();
  room.undoPending = null;
  return removed;
}

// 超时判负：轮到的一方超时，对手获胜并进入真心话环节
function handleTimeout(room, now = Date.now()) {
  if (room.players.length !== 2 || room.gameOver) return false;
  if (room.turnStartTime === null) return false;
  if (now - room.turnStartTime <= room.settings.timer * 1000) return false;
  const loser = room.turn;
  const winner = loser === 1 ? 2 : 1;
  room.gameOver = true;
  room.turnStartTime = null;
  const question = getQuestion(room.round, room.settings.nsfw);
  broadcast(room, { type: 'win', winner, loser, round: room.round, question, reason: 'timeout' });
  return true;
}

function checkTimeouts(now = Date.now()) {
  rooms.forEach(room => handleTimeout(room, now));
}

// 该连接是否正处于对局/排队中（已结束的对局不算，可重新匹配）
function isBusy(player) {
  if (waitingQueue.includes(player)) return true;
  const room = player.room;
  if (room && room.players.includes(player) && !room.gameOver) return true;
  return false;
}

// 把玩家从已结束的旧房间里摘出来，允许重新匹配/建房
function detachFromFinishedRoom(player) {
  const room = player.room;
  if (!room || !room.gameOver) return;
  const idx = room.players.indexOf(player);
  if (idx !== -1) room.players.splice(idx, 1);
  player.room = null;
  player.index = 0;
}

function startServer(port) {
  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  const server = http.createServer(app);
  // 注意：不做 Origin 校验。游戏常在局域网用电脑 IP / 手机直接访问，
  // Origin 会是各种内网 IP，白名单无法覆盖；本服务无账号与敏感操作，
  // 跨站 WebSocket 连接无实际收益，故放行。
  const wss = new WebSocketServer({ server, maxPayload: MAX_PAYLOAD });

  function broadcastOnlineCount() {
    const count = wss.clients.size;
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify({ type: 'online_count', count }));
      }
    });
  }

  wss.on('connection', (ws) => {
    let player = { ws, room: null, index: 0 };
    let msgTimes = [];
    broadcastOnlineCount();

    ws.on('message', (raw) => {
      // 简单限速：每秒超过 20 条消息则断开
      const now = Date.now();
      msgTimes = msgTimes.filter(t => now - t < 1000);
      msgTimes.push(now);
      if (msgTimes.length > MAX_MESSAGES_PER_SECOND) {
        ws.close(1008, 'rate limit');
        return;
      }

      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
      if (typeof msg.type !== 'string') return;

      switch (msg.type) {
        case 'match': {
          if (isBusy(player)) break;
          detachFromFinishedRoom(player);
          const waitingPlayer = waitingQueue.shift();
          if (waitingPlayer) {
            if (waitingPlayer.ws.readyState !== 1) {
              waitingQueue.push(player);
              ws.send(JSON.stringify({ type: 'waiting' }));
              break;
            }
            const room = createRoom(genRoomId(), false);
            waitingPlayer.room = room;
            waitingPlayer.index = 1;
            player.room = room;
            player.index = 2;
            room.players = [waitingPlayer, player];
            room.turnStartTime = Date.now();
            rooms.set(room.id, room);
            broadcast(room, { type: 'start', roomId: room.id, isPrivate: false, settings: room.settings });
            room.players[0].ws.send(JSON.stringify({ type: 'role', index: 1 }));
            room.players[1].ws.send(JSON.stringify({ type: 'role', index: 2 }));
          } else {
            waitingQueue.push(player);
            ws.send(JSON.stringify({ type: 'waiting' }));
          }
          break;
        }
        case 'create': {
          if (isBusy(player)) break;
          detachFromFinishedRoom(player);
          const room = createRoom(genRoomId(), true, msg.settings || {});
          player.room = room;
          player.index = 1;
          room.players = [player];
          rooms.set(room.id, room);
          ws.send(JSON.stringify({ type: 'created', roomId: room.id, settings: room.settings }));
          break;
        }
        case 'join': {
          if (isBusy(player)) break;
          detachFromFinishedRoom(player);
          // 房间号只接受 6 字符字符串
          if (typeof msg.roomId !== 'string' || msg.roomId.length !== 6) {
            ws.send(JSON.stringify({ type: 'error', msg: '无法加入该房间' }));
            break;
          }
          const room = rooms.get(msg.roomId.toUpperCase());
          // 不存在、已满或已空返回同一条通用错误，避免被枚举探测。
          // 已空：对局结束后双方都 detach 走了，房间仍残留在 rooms 里；
          // 若允许加入，room.players[0] 是加入者本人（index 却为 2），
          // players[1] 为 undefined 会抛错并拖垮整个服务进程。
          if (!room || room.players.length === 0 || room.players.length >= 2) {
            if (room && room.players.length === 0) rooms.delete(msg.roomId.toUpperCase());
            ws.send(JSON.stringify({ type: 'error', msg: '无法加入该房间' }));
            break;
          }
          player.room = room;
          player.index = 2;
          room.players.push(player);
          room.turnStartTime = Date.now();
          broadcast(room, { type: 'start', roomId: room.id, isPrivate: room.isPrivate, settings: room.settings });
          room.players[0].ws.send(JSON.stringify({ type: 'role', index: 1 }));
          room.players[1].ws.send(JSON.stringify({ type: 'role', index: 2 }));
          break;
        }
        case 'cancel': {
          const idx = waitingQueue.indexOf(player);
          if (idx !== -1) waitingQueue.splice(idx, 1);
          const room = player.room;
          // 未满人的空房间直接删除
          if (room && room.players.length < 2 && room.players[0] === player) {
            rooms.delete(room.id);
            player.room = null;
            player.index = 0;
          }
          break;
        }
        case 'move': {
          const room = player.room;
          if (!room || room.gameOver || room.turn !== player.index) break;
          const { row, col } = msg;
          if (!Number.isInteger(row) || !Number.isInteger(col)) break;
          if (row<0||row>14||col<0||col>14||room.board[row][col]) break;
          room.board[row][col] = player.index;
          room.moveHistory.push({ row, col, piece: player.index });
          room.turnStartTime = Date.now();
          broadcast(room, { type: 'move', row, col, piece: player.index });
          if (checkWin(room.board, row, col)) {
            room.gameOver = true;
            room.turnStartTime = null;
            const loser = player.index === 1 ? 2 : 1;
            const question = getQuestion(room.round, room.settings.nsfw);
            broadcast(room, { type: 'win', winner: player.index, loser, round: room.round, question });
          } else {
            room.turn = room.turn === 1 ? 2 : 1;
          }
          break;
        }
        case 'again': {
          const room = player.room;
          if (!room) break;
          if (!room.againVote) room.againVote = new Set();
          room.againVote.add(player.index);
          if (room.againVote.size === 2) {
            resetBoard(room);
            room.againVote = null;
            broadcast(room, { type: 'restart', round: room.round });
          } else {
            const other = room.players.find(p => p.index !== player.index);
            if (other) other.ws.send(JSON.stringify({ type: 'again_request' }));
          }
          break;
        }
        case 'truth_answer': {
          const room = player.room;
          if (!room) break;
          if (typeof msg.answer !== 'string' || msg.answer.length === 0 || msg.answer.length > 500) break;
          broadcast(room, { type: 'truth_answer', from: player.index, answer: msg.answer });
          break;
        }
        case 'chat': {
          const room = player.room;
          if (!room) break;
          if (typeof msg.text !== 'string' || msg.text.length === 0 || msg.text.length > 100) break;
          broadcast(room, { type: 'chat', from: player.index, text: msg.text });
          break;
        }
        case 'undo_request': {
          const room = player.room;
          if (!room || !room.isPrivate || room.gameOver) break;
          const other = room.players.find(p => p.index !== player.index);
          if (other) {
            room.undoPending = player.index;
            other.ws.send(JSON.stringify({ type: 'undo_request' }));
          }
          break;
        }
        case 'undo_accept': {
          const room = player.room;
          if (!room || !room.isPrivate || room.gameOver) break;
          // 只有被请求的一方能接受，且必须有待处理的请求
          if (room.undoPending === null || room.undoPending === player.index) break;
          const removed = applyUndo(room);
          if (!removed) break;
          broadcast(room, { type: 'undo_accept', moves: removed, turn: room.turn });
          break;
        }
        case 'undo_reject': {
          const room = player.room;
          if (!room || !room.isPrivate) break;
          if (room.undoPending === null || room.undoPending === player.index) break;
          room.undoPending = null;
          const other = room.players.find(p => p.index !== player.index);
          if (other) other.ws.send(JSON.stringify({ type: 'undo_reject' }));
          break;
        }
        default:
          // 未知消息类型直接忽略
          break;
      }
    });

    ws.on('close', () => {
      const idx = waitingQueue.findIndex(p => p === player);
      if (idx !== -1) waitingQueue.splice(idx, 1);

      const room = player.room;
      if (room && room.players.length === 2) {
        const other = room.players.find(p => p !== player);
        if (other && other.ws.readyState === 1) {
          other.ws.send(JSON.stringify({ type: 'opponent_left' }));
        }
      }
      if (room) rooms.delete(room.id);

      broadcastOnlineCount();
    });
  });

  server.listen(port, '0.0.0.0');

  // 每秒检查一次超时判负
  const timeoutTimer = setInterval(() => checkTimeouts(), 1000);
  // 定期清理过期房间
  const expireTimer = setInterval(() => {
    const now = Date.now();
    rooms.forEach((room, id) => {
      if (room.players.length < 2 && now - room.createdAt > ROOM_EXPIRE_TIME) {
        rooms.delete(id);
        console.log(`房间 ${id} 已过期清理`);
      }
    });
  }, 60000); // 每分钟检查一次

  return {
    server,
    wss,
    rooms,
    waitingQueue,
    close: () => new Promise(resolve => {
      clearInterval(timeoutTimer);
      clearInterval(expireTimer);
      wss.close(() => server.close(resolve));
    })
  };
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  startServer(PORT);
  console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
}

module.exports = {
  checkWin,
  getQuestion,
  createRoom,
  genRoomId,
  sanitizeSettings,
  applyUndo,
  handleTimeout,
  checkTimeouts,
  questions,
  startServer,
  rooms,
  waitingQueue
};
