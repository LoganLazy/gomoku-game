const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();
let waitingPlayer = null;

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

function getQuestion(round) {
  const level = Math.min(Math.floor(round / 2), questions.length - 1);
  const pool = questions[level];
  return pool[Math.floor(Math.random() * pool.length)];
}

function genRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
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

function createRoom(id) {
  return { id, players: [], board: Array.from({length:15}, ()=>Array(15).fill(0)), turn: 1, round: 0 };
}

function resetBoard(room) {
  room.board = Array.from({length:15}, ()=>Array(15).fill(0));
  room.turn = 1;
  room.round++;
}

wss.on('connection', (ws) => {
  let player = { ws, room: null, index: 0 };

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'match': {
        if (waitingPlayer && waitingPlayer.ws.readyState === 1) {
          const room = createRoom(genRoomId());
          waitingPlayer.room = room;
          waitingPlayer.index = 1;
          player.room = room;
          player.index = 2;
          room.players = [waitingPlayer, player];
          rooms.set(room.id, room);
          waitingPlayer = null;
          broadcast(room, { type: 'start', roomId: room.id });
          room.players[0].ws.send(JSON.stringify({ type: 'role', index: 1 }));
          room.players[1].ws.send(JSON.stringify({ type: 'role', index: 2 }));
        } else {
          waitingPlayer = player;
          ws.send(JSON.stringify({ type: 'waiting' }));
        }
        break;
      }
      case 'create': {
        const room = createRoom(genRoomId());
        player.room = room;
        player.index = 1;
        room.players = [player];
        rooms.set(room.id, room);
        ws.send(JSON.stringify({ type: 'created', roomId: room.id }));
        break;
      }
      case 'join': {
        const room = rooms.get(msg.roomId?.toUpperCase());
        if (!room) { ws.send(JSON.stringify({ type: 'error', msg: '房间不存在' })); break; }
        if (room.players.length >= 2) { ws.send(JSON.stringify({ type: 'error', msg: '房间已满' })); break; }
        player.room = room;
        player.index = 2;
        room.players.push(player);
        broadcast(room, { type: 'start', roomId: room.id });
        room.players[0].ws.send(JSON.stringify({ type: 'role', index: 1 }));
        room.players[1].ws.send(JSON.stringify({ type: 'role', index: 2 }));
        break;
      }
      case 'move': {
        const room = player.room;
        if (!room || room.turn !== player.index) break;
        const { row, col } = msg;
        if (row<0||row>14||col<0||col>14||room.board[row][col]) break;
        room.board[row][col] = player.index;
        broadcast(room, { type: 'move', row, col, piece: player.index });
        if (checkWin(room.board, row, col)) {
          const loser = player.index === 1 ? 2 : 1;
          const question = getQuestion(room.round);
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
        broadcast(room, { type: 'truth_answer', from: player.index, answer: msg.answer });
        break;
      }
      case 'chat': {
        const room = player.room;
        if (!room || !msg.text) break;
        broadcast(room, { type: 'chat', from: player.index, text: msg.text });
        break;
      }
      case 'undo_request': {
        const room = player.room;
        if (!room) break;
        const other = room.players.find(p => p.index !== player.index);
        if (other) other.ws.send(JSON.stringify({ type: 'undo_request' }));
        break;
      }
      case 'undo_accept': {
        const room = player.room;
        if (!room) break;
        broadcast(room, { type: 'undo_accept' });
        break;
      }
      case 'undo_reject': {
        const room = player.room;
        if (!room) break;
        const other = room.players.find(p => p.index !== player.index);
        if (other) other.ws.send(JSON.stringify({ type: 'undo_reject' }));
        break;
      }
    }
  });

  ws.on('close', () => {
    if (waitingPlayer === player) waitingPlayer = null;
    const room = player.room;
    if (room) {
      broadcast(room, { type: 'opponent_left' });
      rooms.delete(room.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`服务器运行在 http://0.0.0.0:${PORT}`);
});
