// server.js 单测 + WebSocket 集成测试
// 运行：npm test（node --test test/server.test.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');
const {
  checkWin,
  getQuestion,
  createRoom,
  genRoomId,
  sanitizeSettings,
  applyUndo,
  handleTimeout,
  questions,
  startServer,
  rooms
} = require('../server.js');

function emptyBoard() {
  return Array.from({ length: 15 }, () => Array(15).fill(0));
}

// ---------- 纯函数单测 ----------

test('checkWin：横/竖/斜五连获胜，四连不获胜', () => {
  const b = emptyBoard();
  for (let c = 3; c <= 7; c++) b[5][c] = 1;
  assert.equal(checkWin(b, 5, 7), true);
  assert.equal(checkWin(b, 5, 3), true);

  const v = emptyBoard();
  for (let r = 0; r < 5; r++) v[r][9] = 2;
  assert.equal(checkWin(v, 4, 9), true);

  const d = emptyBoard();
  for (let i = 0; i < 5; i++) d[2 + i][2 + i] = 1;
  assert.equal(checkWin(d, 6, 6), true);

  const a = emptyBoard();
  for (let i = 0; i < 5; i++) a[10 - i][i] = 2;
  assert.equal(checkWin(a, 6, 4), true);

  const four = emptyBoard();
  for (let c = 0; c < 4; c++) four[0][c] = 1;
  assert.equal(checkWin(four, 0, 3), false);
  assert.equal(checkWin(emptyBoard(), 7, 7), false);
});

test('getQuestion：按局数升级，nsfw 关闭时最高到第 5 级', () => {
  assert.ok(questions[0].includes(getQuestion(0)));
  assert.ok(questions[0].includes(getQuestion(1)));
  assert.ok(questions[1].includes(getQuestion(2)));
  assert.ok(questions[1].includes(getQuestion(3)));
  assert.ok(questions[5].includes(getQuestion(10, true)));
  assert.ok(questions[5].includes(getQuestion(20, true)));
  // nsfw 关闭：第 11 局起也只到第 5 级（下标 4），不出 18+ 题目
  assert.ok(questions[4].includes(getQuestion(10, false)));
  assert.ok(questions[4].includes(getQuestion(20, false)));
  assert.ok(!questions[5].includes(getQuestion(20, false)));
});

test('sanitizeSettings：timer 只接受 30/60/120，nsfw 默认关闭', () => {
  assert.deepEqual(sanitizeSettings({}), { timer: 60, nsfw: false });
  assert.deepEqual(sanitizeSettings({ timer: 30, nsfw: true }), { timer: 30, nsfw: true });
  assert.deepEqual(sanitizeSettings({ timer: 120, nsfw: false }), { timer: 120, nsfw: false });
  assert.deepEqual(sanitizeSettings({ timer: 999 }), { timer: 60, nsfw: false });
  assert.deepEqual(sanitizeSettings({ timer: '60' }), { timer: 60, nsfw: false });
  assert.deepEqual(sanitizeSettings({ nsfw: 'yes' }), { timer: 60, nsfw: false });
});

test('createRoom：默认 60 秒、18+ 关闭、带 moveHistory', () => {
  const room = createRoom('ABCDEF', true);
  assert.equal(room.settings.timer, 60);
  assert.equal(room.settings.nsfw, false);
  assert.deepEqual(room.moveHistory, []);
  assert.equal(room.gameOver, false);
  assert.equal(room.turn, 1);
});

test('genRoomId：6 位加密随机大写字符，不重复', () => {
  const ids = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = genRoomId();
    assert.match(id, /^[0-9A-F]{6}$/);
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});

test('applyUndo：删掉最后两子，轮次指回先下那一方', () => {
  const room = createRoom('ABCDEF', true);
  const put = (row, col, piece) => {
    room.board[row][col] = piece;
    room.moveHistory.push({ row, col, piece });
  };
  put(7, 7, 1);
  put(7, 8, 2);
  put(8, 8, 1);
  room.turn = 2;
  const before = Date.now();
  const removed = applyUndo(room);
  assert.equal(removed.length, 2);
  assert.deepEqual(removed[0], { row: 7, col: 8, piece: 2 });
  assert.deepEqual(removed[1], { row: 8, col: 8, piece: 1 });
  assert.equal(room.board[7][8], 0);
  assert.equal(room.board[8][8], 0);
  assert.equal(room.board[7][7], 1);
  assert.equal(room.moveHistory.length, 1);
  assert.equal(room.turn, 2); // 撤销后轮到先下那一方（第 2 手的棋手）
  assert.ok(room.turnStartTime >= before);
});

test('applyUndo：只有一子时只撤销这一子', () => {
  const room = createRoom('ABCDEF', true);
  room.board[7][7] = 1;
  room.moveHistory.push({ row: 7, col: 7, piece: 1 });
  const removed = applyUndo(room);
  assert.equal(removed.length, 1);
  assert.equal(room.board[7][7], 0);
  assert.equal(room.turn, 1);
  assert.equal(applyUndo(room), null);
});

test('handleTimeout：超时一方判负，对手获胜；未超时/已结束不触发', () => {
  const sent = [];
  const mockWs = { readyState: 1, send: (s) => sent.push(JSON.parse(s)) };
  const room = createRoom('ABCDEF', false, { timer: 60, nsfw: false });
  room.players = [{ ws: mockWs, index: 1 }, { ws: mockWs, index: 2 }];
  room.turn = 1;
  room.turnStartTime = Date.now() - 61 * 1000;
  assert.equal(handleTimeout(room), true);
  assert.equal(room.gameOver, true);
  const win = sent.find(m => m.type === 'win');
  assert.ok(win);
  assert.equal(win.winner, 2);
  assert.equal(win.loser, 1);
  assert.equal(win.reason, 'timeout');
  assert.ok(typeof win.question === 'string' && win.question.length > 0);

  // 已结束不再重复判负
  assert.equal(handleTimeout(room), false);

  const room2 = createRoom('ABCDEF', false, { timer: 60 });
  room2.players = [{ ws: mockWs, index: 1 }, { ws: mockWs, index: 2 }];
  room2.turn = 1;
  room2.turnStartTime = Date.now();
  assert.equal(handleTimeout(room2), false);
});

// ---------- WebSocket 集成测试 ----------

let srv;
let port;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

// 跟踪一个连接收到的所有消息；waitFor 按类型顺序消费，不会漏掉
// 在监听挂上之前就到达的消息（单连接多消息并发时常见）
function track(ws) {
  const all = [];
  const queues = new Map(); // type -> 未消费的消息
  const waiters = []; // { type, resolve, timer }
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    all.push(msg);
    const q = queues.get(msg.type) || [];
    q.push(msg);
    queues.set(msg.type, q);
    for (let i = 0; i < waiters.length; i++) {
      if (waiters[i].type === msg.type) {
        const w = waiters.splice(i, 1)[0];
        clearTimeout(w.timer);
        queues.get(msg.type).shift();
        w.resolve(msg);
        break;
      }
    }
  });
  return {
    all,
    has: (type) => all.some((m) => m.type === type),
    waitFor(type, timeout = 3000) {
      const q = queues.get(type);
      if (q && q.length > 0) return Promise.resolve(q.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === resolve);
          if (idx !== -1) waiters.splice(idx, 1);
          reject(new Error(`timeout waiting for ${type}`));
        }, timeout);
        waiters.push({ type, resolve, timer });
      });
    }
  };
}

const send = (ws, obj) => ws.send(JSON.stringify(obj));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  srv = startServer(0);
  await new Promise((resolve) => srv.server.once('listening', resolve));
  port = srv.server.address().port;
});

test.after(async () => {
  await srv.close();
});

test('集成：建房+加入+落子，悔棋后在撤销格落子成功且对局继续', async () => {
  const p1 = await connect();
  const p2 = await connect();
  try {
    const t1 = track(p1);
    const t2 = track(p2);
    send(p1, { type: 'create', settings: { timer: 60, nsfw: false } });
    const created = await t1.waitFor('created');
    assert.equal(created.settings.nsfw, false);
    send(p2, { type: 'join', roomId: created.roomId });
    await t2.waitFor('start');
    await t1.waitFor('role');
    await t2.waitFor('role');

    // 注意：落子会广播给双方，两边的消息队列都要消费，否则旧消息会干扰后面的断言
    send(p1, { type: 'move', row: 7, col: 7 });
    await t2.waitFor('move');
    await t1.waitFor('move');
    send(p2, { type: 'move', row: 7, col: 8 });
    await t1.waitFor('move');
    await t2.waitFor('move');

    // 悔棋：p2 请求，p1 同意
    send(p2, { type: 'undo_request' });
    await t1.waitFor('undo_request');
    send(p1, { type: 'undo_accept' });
    const undo = await t2.waitFor('undo_accept');
    await t1.waitFor('undo_accept');
    assert.equal(undo.moves.length, 2);
    assert.equal(undo.turn, 1); // 两子都撤销后棋盘回到开局，轮到先手 p1

    // 在被撤销的格子落子必须成功（服务端 board 已同步清空）
    send(p1, { type: 'move', row: 7, col: 7 });
    const replay = await t2.waitFor('move');
    await t1.waitFor('move');
    assert.deepEqual([replay.row, replay.col, replay.piece], [7, 7, 1]);
    // 对局继续：轮到 p2，落子成功
    send(p2, { type: 'move', row: 8, col: 8 });
    const next = await t1.waitFor('move');
    await t2.waitFor('move');
    assert.deepEqual([next.row, next.col, next.piece], [8, 8, 2]);
    assert.ok(!t1.has('error'));
    assert.ok(!t2.has('error'));
  } finally {
    p1.close();
    p2.close();
  }
});

test('集成：同一连接发两次 match 不会和自己开局', async () => {
  const a = await connect();
  try {
    const t = track(a);
    send(a, { type: 'match' });
    await t.waitFor('waiting');
    send(a, { type: 'match' });
    // 等 700ms，期间不应收到 start
    await sleep(700);
    assert.ok(!t.has('start'));
    // 取消后队列干净：另一个人匹配应继续等待，而不是直接开局
    send(a, { type: 'cancel' });
    const b = await connect();
    try {
      const tb = track(b);
      send(b, { type: 'match' });
      await tb.waitFor('waiting');
      await sleep(500);
      assert.ok(!t.has('start'));
      assert.ok(!tb.has('start'));
    } finally {
      b.close();
    }
  } finally {
    a.close();
  }
});

test('集成：非法落子/超长聊天/超长回答被拒绝，正常聊天通过', async () => {
  const p1 = await connect();
  const p2 = await connect();
  try {
    const t1 = track(p1);
    const t2 = track(p2);
    send(p1, { type: 'create', settings: { timer: 60, nsfw: false } });
    const created = await t1.waitFor('created');
    send(p2, { type: 'join', roomId: created.roomId });
    await t2.waitFor('start');

    // 非法坐标：越界、字符串坐标、小数坐标都不应广播
    send(p1, { type: 'move', row: 99, col: 0 });
    send(p1, { type: 'move', row: '7', col: 7 });
    send(p1, { type: 'move', row: 7.5, col: 7 });
    await sleep(400);
    assert.ok(!t2.has('move'));

    // 超长聊天（101 字符）被拒，正常聊天通过
    send(p1, { type: 'chat', text: 'x'.repeat(101) });
    await sleep(300);
    assert.ok(!t2.has('chat'));
    send(p1, { type: 'chat', text: '你好' });
    const chat = await t2.waitFor('chat');
    assert.equal(chat.text, '你好');

    // 超长真心话回答（501 字符）被拒
    send(p1, { type: 'truth_answer', answer: 'y'.repeat(501) });
    await sleep(300);
    assert.ok(!t2.has('truth_answer'));

    // join 失败：不存在与已满返回同一条错误
    const p3 = await connect();
    try {
      const t3 = track(p3);
      send(p3, { type: 'join', roomId: 'ZZZZZZ' });
      const err1 = await t3.waitFor('error');
      send(p3, { type: 'join', roomId: created.roomId });
      const err2 = await t3.waitFor('error');
      assert.equal(err1.msg, err2.msg);
      assert.equal(err1.msg, '无法加入该房间');
    } finally {
      p3.close();
    }
  } finally {
    p1.close();
    p2.close();
  }
});

test('集成：超时判负走真实定时器（伪造 turnStartTime，不等 30 秒）', async () => {
  const p1 = await connect();
  const p2 = await connect();
  try {
    const t1 = track(p1);
    const t2 = track(p2);
    send(p1, { type: 'create', settings: { timer: 60, nsfw: false } });
    const created = await t1.waitFor('created');
    send(p2, { type: 'join', roomId: created.roomId });
    await t2.waitFor('start');
    // 把轮次开始时间拨到 61 秒前，服务端的每秒检查应判轮到的一方（p1）超时
    rooms.get(created.roomId).turnStartTime = Date.now() - 61 * 1000;
    const win = await t2.waitFor('win', 5000);
    assert.equal(win.reason, 'timeout');
    assert.equal(win.winner, 2);
    assert.equal(win.loser, 1);
    assert.ok(typeof win.question === 'string' && win.question.length > 0);
  } finally {
    p1.close();
    p2.close();
  }
});

test('集成：每秒超过 20 条消息被断开', async () => {
  const a = await connect();
  try {
    const closed = new Promise((resolve) => a.once('close', (code) => resolve(code)));
    for (let i = 0; i < 25; i++) {
      send(a, { type: 'chat', text: 'spam' });
    }
    const code = await Promise.race([
      closed,
      sleep(2000).then(() => null)
    ]);
    assert.equal(code, 1008);
  } finally {
    try { a.close(); } catch { /* 已断开 */ }
  }
});
