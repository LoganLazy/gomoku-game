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

  class MockAudioContext {
    createOscillator() {
      return { frequency: { value: 0 }, connect() {}, start() {}, stop() {} };
    }
    get destination() { return {}; }
  }

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
