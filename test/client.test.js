// public/game.js 客户端单测：在 vm 沙箱里加载真实前端脚本，
// 用桩 WebSocket / DOM 驱动消息，验证开局状态重置。
// 运行：npm test（node --test test/server.test.js test/client.test.js）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeCtxStub() {
  return new Proxy({}, {
    get: (t, p) => {
      if (!(p in t)) t[p] = () => {};
      return t[p];
    },
    set: (t, p, v) => { t[p] = v; return true; },
  });
}

class MockAudioContext {
  createOscillator() {
    return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
  }
  get destination() { return {}; }
}

function makeEl(id) {
  const listeners = {};
  const el = {
    id,
    textContent: '',
    innerHTML: '',
    value: '',
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    appendChild() {},
    getContext() { return makeCtxStub(); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 380, height: 380 }; },
    _listeners: listeners,
  };
  return el;
}

function createHarness() {
  const sockets = [];
  class MockWS {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      this.sent = [];
      sockets.push(this);
    }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; }
  }

  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };
  const document = {
    getElementById: getEl,
    querySelectorAll: () => [],
    createElement: () => makeEl(''),
    body: makeEl('body'),
  };

  const sandbox = {
    console,
    // 定时器桩成空操作：测试不需要真实走时
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    WebSocket: MockWS,
    localStorage,
    document,
    navigator: {},
    location: { protocol: 'http:', host: '127.0.0.1:3000' },
    window: {
      innerWidth: 400,
      innerHeight: 800,
      addEventListener() {},
      AudioContext: MockAudioContext,
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'game.js'), 'utf8');
  vm.runInContext(src, ctx);
  // 脚本末尾 connect() 应已创建一个 MockWS
  assert.equal(sockets.length, 1, '加载脚本后应建立一条 WebSocket 连接');
  const ws = sockets[0];
  const emit = (msg) => ws.onmessage({ data: JSON.stringify(msg) });
  const evalIn = (expr) => vm.runInContext(expr, ctx);
  return { ws, emit, evalIn, getEl };
}

function startGame(h, index = 1) {
  h.emit({ type: 'start', isPrivate: true, settings: { timer: 60, nsfw: false } });
  h.emit({ type: 'role', index });
}

test('新开一局时棋盘清空：上一局的棋子不残留，局数归零', () => {
  const h = createHarness();
  // 第一局：下两子后分出胜负
  startGame(h, 1);
  h.emit({ type: 'move', row: 7, col: 7, piece: 1 });
  h.emit({ type: 'move', row: 7, col: 8, piece: 2 });
  assert.equal(h.evalIn('board[7][7]'), 1);
  assert.equal(h.evalIn('board[7][8]'), 2);
  h.emit({ type: 'win', winner: 2, loser: 1, round: 0, question: 'test?' });
  assert.equal(h.evalIn('gameOver'), true);

  // 第二局：同一页面、同一连接进新房间（start + role）
  startGame(h, 1);
  assert.equal(
    h.evalIn('board.flat().every(v => v === 0)'),
    true,
    '新开局后棋盘必须全空，否则会显示上一把的棋盘',
  );
  assert.equal(h.evalIn('moveHistory.length'), 0);
  assert.equal(h.evalIn('currentRound'), 0);
  assert.equal(h.evalIn('gameOver'), false);
});

test('新开局后，上一局占过的格子可以正常落子', () => {
  const h = createHarness();
  startGame(h, 1);
  h.emit({ type: 'move', row: 7, col: 7, piece: 1 });
  h.emit({ type: 'win', winner: 2, loser: 1, round: 0, question: 'test?' });

  startGame(h, 1);
  // 画布 720px（resizeCanvas 按 innerWidth 400 算出 w=360，x2），
  // cell=45，pad=45；(7,7) 的画布坐标是 360，rect 宽 380，clientX=190
  const canvas = h.getEl('board');
  const click = canvas._listeners.click[0];
  assert.ok(click, '棋盘应注册 click 处理');
  click({ clientX: 190, clientY: 190 });
  assert.equal(h.evalIn('moveHistory.length'), 1, '落子应记入新局的 moveHistory');
  assert.equal(
    h.evalIn('moveHistory[0].row === 7 && moveHistory[0].col === 7 && moveHistory[0].piece === 1'),
    true,
  );
  assert.equal(h.evalIn('board[7][7]'), 1, '上一局占过的格子在新局里应能落子');
  const sent = h.ws.sent.map((s) => JSON.parse(s));
  assert.ok(
    sent.some((m) => m.type === 'move' && m.row === 7 && m.col === 7),
    '落子后应把 move 发给服务端',
  );
});

// ---------- 真连接测试：真实定时器 + 真实 WebSocket ----------
// 旧 harness 把定时器桩成空操作，测不了心跳/重连/排队；这里用真实
// 定时器和真实 ws 客户端，对着一个可配置的桩服务端跑。
const http = require('node:http');
const { WebSocketServer, WebSocket: WSClient } = require('ws');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 桩服务端：可延迟握手（模拟慢速隧道），可选择回不回应用层 pong
function startStubServer({ handshakeDelayMs = 0, replyPong = true, onMessage = null } = {}) {
  const httpServer = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  const connections = [];
  const received = [];
  httpServer.on('upgrade', (req, socket, head) => {
    setTimeout(() => {
      wss.handleUpgrade(req, socket, head, (ws) => {
        connections.push(ws);
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          received.push(msg);
          if (msg.type === 'ping' && replyPong) {
            ws.send(JSON.stringify({ type: 'pong' }));
          }
          if (onMessage) onMessage(ws, msg);
        });
      });
    }, handshakeDelayMs);
  });
  return {
    connections,
    received,
    listen: () => new Promise((r) => httpServer.listen(0, '127.0.0.1', r))
      .then(() => httpServer.address().port),
    close: async () => {
      connections.forEach((c) => { try { c.terminate(); } catch { /* ignore */ } });
      await new Promise((r) => httpServer.close(r));
    },
  };
}

function createLiveHarness(port) {
  const store = new Map();
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };

  const elements = new Map();
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeEl(id));
    return elements.get(id);
  };
  const document = {
    getElementById: getEl,
    querySelectorAll: () => [],
    createElement: () => makeEl(''),
    body: makeEl('body'),
  };

  const sandbox = {
    console,
    // 真实定时器：心跳、重连退避、pong 超时都要真的走时
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    WebSocket: WSClient,
    localStorage,
    document,
    navigator: {},
    location: { protocol: 'http:', host: `127.0.0.1:${port}` },
    window: {
      innerWidth: 400,
      innerHeight: 800,
      addEventListener() {},
      AudioContext: MockAudioContext,
    },
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'game.js'), 'utf8');
  vm.runInContext(src, ctx);
  const evalIn = (expr) => vm.runInContext(expr, ctx);
  // 同步覆盖心跳/重连常量：open 事件要到下一个 tick 才触发，此刻改还来得及
  evalIn('HEARTBEAT_INTERVAL_MS = 100; PONG_WAIT_MS = 150; RECONNECT_BASE_MS = 50; RECONNECT_MAX_MS = 200;');
  const destroy = () => {
    // 先关重连再关连接，避免清理后又自发重连导致测试进程挂起
    evalIn('aiMode = true; stopHeartbeat(); if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null; } if (ws) { try { ws.close(); } catch {} }');
  };
  return { evalIn, getEl, destroy };
}

test('客户端：connect() 反复调用只建一条连接', async () => {
  const stub = startStubServer();
  const port = await stub.listen();
  const h = createLiveHarness(port);
  try {
    h.evalIn('connect()');
    h.evalIn('connect()');
    h.evalIn('connect()');
    await sleep(300);
    assert.equal(stub.connections.length, 1, '三次 connect() 应只产生一条服务端连接');
    const hellos = stub.received.filter((m) => m.type === 'hello');
    assert.equal(hellos.length, 1, '只应发送一次 hello');
    assert.equal(typeof hellos[0].clientId, 'string');
    assert.ok(hellos[0].clientId.length > 0);
  } finally {
    h.destroy();
    await stub.close();
  }
});

test('客户端：慢握手时点的匹配不丢失，连接建立后自动发出', async () => {
  const stub = startStubServer({ handshakeDelayMs: 300 });
  const port = await stub.listen();
  const h = createLiveHarness(port);
  try {
    // 脚本加载时 connect() 已发起，握手还被拖着（300ms）；此刻点匹配
    h.getEl('btn-match').onclick();
    assert.equal(h.evalIn('sendQueue.length'), 1, '握手未完成时匹配消息应进队列');
    assert.equal(stub.received.length, 0, '握手未完成时服务端不应收到任何消息');
    await sleep(800);
    const matches = stub.received.filter((m) => m.type === 'match');
    assert.equal(matches.length, 1, '连接建立后排队的匹配应发出，且只发一次');
    assert.equal(stub.received.filter((m) => m.type === 'hello').length, 1);
  } finally {
    h.destroy();
    await stub.close();
  }
});

test('客户端：心跳按时发送，收到 pong 不重连', async () => {
  const stub = startStubServer();
  const port = await stub.listen();
  const h = createLiveHarness(port);
  try {
    await sleep(550);
    const pings = stub.received.filter((m) => m.type === 'ping');
    assert.ok(pings.length >= 2, `550ms 内应至少发出 2 次 ping，实际 ${pings.length}`);
    assert.equal(stub.connections.length, 1, '收到 pong 时不应重连');
    assert.equal(h.getEl('stat-conn').textContent, '已连接');
  } finally {
    h.destroy();
    await stub.close();
  }
});

test('客户端：收不到 pong 时断开重连，并重新上报同一 clientId', async () => {
  const stub = startStubServer({ replyPong: false });
  const port = await stub.listen();
  const h = createLiveHarness(port);
  try {
    await sleep(1200);
    assert.ok(stub.connections.length >= 2, `应已重连，实际连接数 ${stub.connections.length}`);
    const hellos = stub.received.filter((m) => m.type === 'hello');
    assert.ok(hellos.length >= 2, '重连后应重新发送 hello');
    assert.equal(hellos[0].clientId, hellos[1].clientId, '重连前后 clientId 应保持不变');
  } finally {
    h.destroy();
    await stub.close();
  }
});

test('客户端：未确认的大厅操作在重连后补发，已确认的不再补发', async () => {
  let matchCount = 0;
  const stub = startStubServer({
    onMessage: (ws, msg) => {
      if (msg.type === 'match') {
        matchCount++;
        // 第 2 次 match 才回 waiting：第一次的回应在断线中丢了
        if (matchCount >= 2) ws.send(JSON.stringify({ type: 'waiting' }));
      }
    },
  });
  const port = await stub.listen();
  const h = createLiveHarness(port);
  try {
    await sleep(200);
    h.getEl('btn-match').onclick();
    await sleep(200);
    assert.equal(matchCount, 1);
    // 服务端侧掐断连接（模拟隧道/网络断开），客户端应重连并补发 match
    stub.connections[0].terminate();
    await sleep(900);
    assert.equal(matchCount, 2, '重连后应补发一次未确认的 match');
    assert.equal(stub.received.filter((m) => m.type === 'hello').length, 2);
    // 第二次 match 已收到 waiting 确认；再断一次，不应再补发
    stub.connections[1].terminate();
    await sleep(900);
    assert.equal(matchCount, 2, '已确认的 match 不应再次补发');
  } finally {
    h.destroy();
    await stub.close();
  }
});

test('客户端：握手被吞掉时不永久卡在连接中，超时后会换新连接重试', async () => {
  // 黑洞服务端：接受 TCP 但永远不回 101
  const blackhole = http.createServer();
  const bhSockets = new Set();
  blackhole.on('connection', (s) => { bhSockets.add(s); s.on('close', () => bhSockets.delete(s)); });
  let attempts = 0;
  blackhole.on('upgrade', () => { attempts++; /* 故意不回包 */ });
  await new Promise((r) => blackhole.listen(0, '127.0.0.1', r));
  const port = blackhole.address().port;
  const h = createLiveHarness(port);
  try {
    // 加载时 connect() 已用默认 10 秒起了握手定时器；先改常量再手动关掉
    // 第一个连接，让 50ms 后的重连用上新的超时值。
    // 注意 reconnectDelay 在加载时已取默认值 2000，onopen 又永远不触发，
    // 所以这里要直接覆盖它，否则第一次重连要等满 2 秒。
    h.evalIn('CONNECT_TIMEOUT_MS = 300; reconnectDelay = 50;');
    h.evalIn('ws.close()');
    let ok = false;
    for (let i = 0; i < 30; i++) {
      await sleep(100);
      if (attempts >= 3) { ok = true; break; }
    }
    assert.ok(ok, `握手超时后应换新连接重试，实际握手尝试 ${attempts} 次`);
  } finally {
    h.destroy();
    bhSockets.forEach((s) => { try { s.destroy(); } catch { /* ignore */ } });
    await new Promise((r) => blackhole.close(r));
  }
});
