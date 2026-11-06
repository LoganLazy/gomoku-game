// State
let ws, myIndex, currentRound = 0, isMyTurn = false, gameOver = false, currentQuestion = '';
let aiMode = false, moveHistory = [], timerInterval, timeLeft = 60, isPrivateRoom = false;
let roomSettings = { timer: 60, nsfw: false };
let settings = {
  sound: true,
  vibrate: true
};

// Storage
const storage = {
  get(key, def) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : def;
    } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }
};

// Stats
let stats = storage.get('stats', { wins: 0, total: 0, streak: 0, maxStreak: 0 });

// Utils
const $ = id => document.getElementById(id);
const screens = document.querySelectorAll('.screen');

function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}

function playSound(freq = 440, duration = 50) {
  if (!settings.sound) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(ctx.destination);
    osc.start();
    setTimeout(() => osc.stop(), duration);
  } catch {}
}

function vibrate(pattern = 50) {
  if (settings.vibrate && navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

function updateStats() {
  $('stat-wins').textContent = `胜: ${stats.wins}`;
  $('stat-total').textContent = `总: ${stats.total}`;
  $('stat-streak').textContent = `连胜: ${stats.streak}`;
}

function saveHistory(question, answer, isWin) {
  const history = storage.get('history', []);
  history.unshift({
    date: new Date().toLocaleString('zh-CN'),
    question,
    answer,
    result: isWin ? '胜' : '负'
  });
  storage.set('history', history.slice(0, 50));
}

function startTimer() {
  stopTimer();
  timeLeft = roomSettings.timer;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 10) {
      $('game-timer').classList.add('warning');
      if (timeLeft <= 5) playSound(800, 30);
    }
    if (timeLeft <= 0) {
      stopTimer();
      if (aiMode) {
        // 单机模式没有服务端判定，超时只重置本回合计时
        timeLeft = roomSettings.timer;
        updateTimerDisplay();
        startTimer();
        return;
      }
      // 联机模式只做展示：判负由服务端执行，随后会收到 win 消息
      $('game-status').textContent = '时间到，等待服务端判定';
    }
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  $('game-timer').classList.remove('warning');
}

function updateTimerDisplay() {
  $('game-timer').textContent = timeLeft + 's';
}

// WebSocket
function connect() {
  if (aiMode) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onmessage = (e) => handleMsg(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
}

function handleMsg(msg) {
  switch (msg.type) {
    case 'online_count':
      if ($('stat-online')) {
        $('stat-online').textContent = `在线: ${msg.count}`;
      }
      break;
    case 'waiting':
      showScreen('screen-waiting');
      $('waiting-text').textContent = '正在匹配对手...';
      $('room-code').textContent = '';
      break;
    case 'created':
      if (msg.settings) {
        roomSettings = msg.settings;
      }
      showScreen('screen-waiting');
      $('waiting-text').textContent = '等待对方加入';
      $('room-code').textContent = msg.roomId;
      break;
    case 'start':
      isPrivateRoom = msg.isPrivate;
      if (msg.settings) {
        roomSettings = msg.settings;
      }
      showScreen('screen-game');
      gameOver = false;
      moveHistory = [];
      updateUndoButton();
      break;
    case 'role':
      myIndex = msg.index;
      isMyTurn = myIndex === 1;
      updateStatus();
      drawBoard();
      if (isMyTurn) startTimer();
      break;
    case 'move':
      board[msg.row][msg.col] = msg.piece;
      moveHistory.push({ row: msg.row, col: msg.col, piece: msg.piece });
      drawBoard();
      playSound(600, 40);
      vibrate(30);
      isMyTurn = msg.piece !== myIndex;
      updateStatus();
      stopTimer();
      if (isMyTurn) startTimer();
      break;
    case 'win':
      stopTimer();
      gameOver = true;
      const iWon = msg.winner === myIndex;
      stats.total++;
      if (iWon) {
        stats.wins++;
        stats.streak++;
        stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      } else {
        stats.streak = 0;
      }
      storage.set('stats', stats);
      updateStats();
      currentQuestion = msg.question;
      showTruth(msg.winner, msg.loser, msg.round, msg.question);
      break;
    case 'again_request':
      $('btn-again').textContent = '对方想再来一局，点击同意';
      $('btn-again').classList.remove('hidden');
      break;
    case 'restart':
      currentRound = msg.round;
      board = Array.from({length:15}, ()=>Array(15).fill(0));
      moveHistory = [];
      isMyTurn = myIndex === 1;
      gameOver = false;
      $('truth-input').value = '';
      showScreen('screen-game');
      updateStatus();
      drawBoard();
      updateUndoButton();
      if (isMyTurn) startTimer();
      break;
    case 'truth_answer':
      if (msg.from !== myIndex) {
        $('truth-wait').classList.add('hidden');
        $('truth-result').classList.remove('hidden');
        $('truth-answer-text').textContent = msg.answer;
        $('btn-again').textContent = '再来一局';
        $('btn-again').classList.remove('hidden');
      }
      break;
    case 'chat':
      addChatMessage(msg.text, msg.from === myIndex);
      break;
    case 'undo_request':
      if (confirm('对方请求悔棋，是否同意？')) {
        ws.send(JSON.stringify({ type: 'undo_accept' }));
      } else {
        ws.send(JSON.stringify({ type: 'undo_reject' }));
      }
      break;
    case 'undo_accept':
      // 以服务端为准：按服务端给出的落子清单清子、按服务端 turn 恢复轮次
      if (msg.moves) {
        for (const m of msg.moves) {
          board[m.row][m.col] = 0;
          moveHistory = moveHistory.filter(
            h => !(h.row === m.row && h.col === m.col));
        }
        isMyTurn = msg.turn === myIndex;
        drawBoard();
        updateStatus();
        playSound(400, 50);
      }
      break;
    case 'undo_reject':
      alert('对方拒绝了悔棋');
      break;
    case 'opponent_left':
      stopTimer();
      alert('对方已离开');
      showScreen('screen-lobby');
      break;
    case 'error':
      alert(msg.msg);
      break;
  }
}

function updateUndoButton() {
  const btn = $('btn-undo');
  if (isPrivateRoom) {
    btn.disabled = false;
    btn.style.opacity = '1';
  } else {
    btn.disabled = true;
    btn.style.opacity = '0.3';
  }
}

function updateStatus() {
  if (gameOver) return;
  $('game-status').textContent = isMyTurn ? '轮到你了' : '等待对方落子';
  $('game-status').style.color = isMyTurn ? '#e94560' : '#aaa';
  $('score-info').textContent = `第 ${currentRound + 1} 局 · 你是${myIndex===1?'⚫黑棋':'⚪白棋'}`;
}

function showTruth(winner, loser, round, question) {
  showScreen('screen-truth');
  const iAmLoser = myIndex === loser;
  const q = question || '等待问题...';
  $('truth-question').textContent = q;

  if (iAmLoser) {
    $('truth-title').textContent = '你输了，回答真心话';
    $('truth-input-area').classList.remove('hidden');
    $('truth-wait').classList.add('hidden');
    $('truth-result').classList.add('hidden');
  } else {
    $('truth-title').textContent = '你赢了！';
    $('truth-input-area').classList.add('hidden');
    $('truth-wait').classList.remove('hidden');
    $('truth-result').classList.add('hidden');
  }
  $('btn-again').classList.add('hidden');
  $('btn-again').textContent = '再来一局';
}

function addChatMessage(text, isMe) {
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (isMe ? ' me' : '');
  msg.textContent = text;
  $('chat-messages').appendChild(msg);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}

// AI Logic (终极版 - 极大极小搜索)
function aiMove() {
  if (!aiMode || gameOver) return;

  // 1. 必胜检查
  const winMove = findWinningMove(2);
  if (winMove) {
    placeAIPiece(winMove.row, winMove.col);
    return;
  }

  // 2. 必须防守
  const blockWin = findWinningMove(1);
  if (blockWin) {
    placeAIPiece(blockWin.row, blockWin.col);
    return;
  }

  // 3. 双活三必胜（连续冲四）
  const doubleThreat = findDoubleThreat(2);
  if (doubleThreat) {
    placeAIPiece(doubleThreat.row, doubleThreat.col);
    return;
  }

  // 4. 阻挡对手双活三
  const blockDouble = findDoubleThreat(1);
  if (blockDouble) {
    placeAIPiece(blockDouble.row, blockDouble.col);
    return;
  }

  // 5. 极大极小搜索（深度 2）
  const best = minimax(2, -Infinity, Infinity, true);
  if (best.move) {
    placeAIPiece(best.move.row, best.move.col);
    return;
  }

  // 6. 应急方案：评分最高位置
  const moves = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c]) continue;
      if (!hasNeighbor(r, c, 2)) continue;
      const score = evaluatePosition(r, c, 2) * 1.5 + evaluatePosition(r, c, 1);
      moves.push({ row: r, col: c, score });
    }
  }

  // 开局策略
  if (moveHistory.length === 1) {
    placeAIPiece(7, 7);
    return;
  }

  moves.sort((a, b) => b.score - a.score);
  if (moves.length > 0) {
    placeAIPiece(moves[0].row, moves[0].col);
  }
}

// 极大极小搜索
function minimax(depth, alpha, beta, isMaximizing) {
  if (depth === 0) {
    return { score: evaluateBoard() };
  }

  const moves = getCandidateMoves();
  if (moves.length === 0) return { score: 0 };

  let bestMove = null;

  if (isMaximizing) {
    let maxScore = -Infinity;
    for (const move of moves) {
      board[move.row][move.col] = 2;
      const result = minimax(depth - 1, alpha, beta, false);
      board[move.row][move.col] = 0;

      if (result.score > maxScore) {
        maxScore = result.score;
        bestMove = move;
      }

      alpha = Math.max(alpha, result.score);
      if (beta <= alpha) break; // α-β 剪枝
    }
    return { score: maxScore, move: bestMove };
  } else {
    let minScore = Infinity;
    for (const move of moves) {
      board[move.row][move.col] = 1;
      const result = minimax(depth - 1, alpha, beta, true);
      board[move.row][move.col] = 0;

      if (result.score < minScore) {
        minScore = result.score;
        bestMove = move;
      }

      beta = Math.min(beta, result.score);
      if (beta <= alpha) break; // α-β 剪枝
    }
    return { score: minScore, move: bestMove };
  }
}

// 评估整个棋盘
function evaluateBoard() {
  let score = 0;
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c] === 2) {
        score += evaluatePosition(r, c, 2);
      } else if (board[r][c] === 1) {
        score -= evaluatePosition(r, c, 1);
      }
    }
  }
  return score;
}

// 获取候选位置（剪枝优化）
function getCandidateMoves() {
  const moves = [];
  const checked = new Set();

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (!board[r][c]) continue;

      // 检查周围空位
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= 15 || nc < 0 || nc >= 15) continue;
          if (board[nr][nc]) continue;

          const key = `${nr},${nc}`;
          if (checked.has(key)) continue;
          checked.add(key);

          const score = evaluatePosition(nr, nc, 2) + evaluatePosition(nr, nc, 1);
          moves.push({ row: nr, col: nc, score });
        }
      }
    }
  }

  // 排序，只取前 10 个最优位置
  moves.sort((a, b) => b.score - a.score);
  return moves.slice(0, 10);
}

// 查找双活三（必胜点）
function findDoubleThreat(piece) {
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c]) continue;

      board[r][c] = piece;
      let threatCount = 0;

      // 检查四个方向是否形成活三
      const directions = [[1,0], [0,1], [1,1], [1,-1]];
      for (const [dr, dc] of directions) {
        if (isLive3(r, c, dr, dc, piece)) {
          threatCount++;
        }
      }

      board[r][c] = 0;

      // 两个或以上活三 = 必胜
      if (threatCount >= 2) {
        return { row: r, col: c };
      }
    }
  }
  return null;
}

// 判断是否为活三
function isLive3(row, col, dr, dc, piece) {
  const line = getLine(row, col, dr, dc, piece);
  const str = line.join('');
  // 活三模式：_XXX_ 或 _XX_X_ 或 _X_XX_
  return /0.*[^0]{3}.*0/.test(str) && !/[^0]{4}/.test(str);
}

// 放置 AI 棋子
function placeAIPiece(row, col) {
  board[row][col] = 2;
  moveHistory.push({ row, col, piece: 2 });
  drawBoard();
  playSound(600, 40);
  vibrate(30);

  if (checkWin(board, row, col)) {
    stopTimer();
    gameOver = true;
    stats.total++;
    stats.streak = 0;
    storage.set('stats', stats);
    updateStats();
    alert('AI 赢了！');
    showScreen('screen-lobby');
    return;
  }

  isMyTurn = true;
  updateStatus();
  startTimer();
}

// 查找必胜点
function findWinningMove(piece) {
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c]) continue;
      board[r][c] = piece;
      const win = checkWin(board, r, c);
      board[r][c] = 0;
      if (win) return { row: r, col: c };
    }
  }
  return null;
}

// 查找符合特定棋型的位置
function findPatternMove(piece, patterns) {
  const directions = [[1,0], [0,1], [1,1], [1,-1]];

  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c]) continue;

      for (const [dr, dc] of directions) {
        const line = getLine(r, c, dr, dc, piece);
        const str = line.join('');

        for (const pattern of patterns) {
          if (pattern.test(str)) {
            return { row: r, col: c };
          }
        }
      }
    }
  }
  return null;
}

// 检查位置周围是否有棋子
function hasNeighbor(row, col, distance) {
  for (let dr = -distance; dr <= distance; dr++) {
    for (let dc = -distance; dc <= distance; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r >= 0 && r < 15 && c >= 0 && c < 15 && board[r][c]) {
        return true;
      }
    }
  }
  return false;
}

// 评估某个位置对指定棋子的价值
function evaluatePosition(row, col, piece) {
  let score = 0;
  const directions = [[1,0], [0,1], [1,1], [1,-1]];

  for (const [dr, dc] of directions) {
    const line = getLine(row, col, dr, dc, piece);
    score += evaluateLine(line, piece);
  }

  return score;
}

// 获取某个方向上的棋型
function getLine(row, col, dr, dc, piece) {
  const line = [piece]; // 假设在这个位置下了一子

  // 向前扫描
  for (let i = 1; i < 5; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || r >= 15 || c < 0 || c >= 15) break;
    if (board[r][c] === piece) line.push(piece);
    else if (board[r][c] === 0) line.push(0);
    else break;
  }

  // 向后扫描
  for (let i = 1; i < 5; i++) {
    const r = row - dr * i;
    const c = col - dc * i;
    if (r < 0 || r >= 15 || c < 0 || c >= 15) break;
    if (board[r][c] === piece) line.unshift(piece);
    else if (board[r][c] === 0) line.unshift(0);
    else break;
  }

  return line;
}

// 评估棋型价值（按棋子参数化：双方棋型都按同一套棋型评分，
// 原版把棋子写死成 '2'，对手棋型永远评 0 分，minimax 看不见对手威胁）
function evaluateLine(line, piece) {
  const str = line.join('');
  const p = String(piece);
  const has = (pattern) => new RegExp(pattern.replaceAll('2', p)).test(str);

  // 五连：必胜
  if (has('22222')) return 100000;

  // 活四：下一步必胜
  if (has('022220')) return 10000;

  // 冲四：需要再下一子形成五连
  if (has('22220|02222')) return 5000;

  // 活三：可以形成活四
  if (has('022200|002220|020220')) return 3000;

  // 眠三：需要两步形成五连
  if (has('22200|02220|22020|20220')) return 1000;

  // 活二
  if (has('02200|00220|02020')) return 500;

  // 眠二
  if (has('22000|02200|20200')) return 100;

  // 活一
  if (has('02000|00200|00020')) return 10;

  return 0;
}

function checkWin(b, row, col) {
  const piece = b[row][col];
  if (!piece) return false;
  const dirs = [[1,0],[0,1],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const r = row + dr*i, c = col + dc*i;
      if (r<0||r>14||c<0||c>14||b[r][c]!==piece) break;
      count++;
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr*i, c = col - dc*i;
      if (r<0||r>14||c<0||c>14||b[r][c]!==piece) break;
      count++;
    }
    if (count >= 5) return true;
  }
  return false;
}

function makeMove(row, col) {
  if (!isMyTurn || gameOver || board[row][col]) return;

  board[row][col] = myIndex;
  moveHistory.push({ row, col, piece: myIndex });
  drawBoard();
  playSound(600, 40);
  vibrate(30);

  if (aiMode) {
    if (checkWin(board, row, col)) {
      stopTimer();
      gameOver = true;
      stats.total++;
      stats.wins++;
      stats.streak++;
      stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
      storage.set('stats', stats);
      updateStats();
      alert('你赢了！');
      showScreen('screen-lobby');
      return;
    }
    isMyTurn = false;
    updateStatus();
    setTimeout(() => aiMove(), 500);
  } else {
    ws.send(JSON.stringify({ type: 'move', row, col }));
    stopTimer();
  }
}
const canvas = $('board');
const ctx = canvas.getContext('2d');
let board = Array.from({length:15}, ()=>Array(15).fill(0));
function resizeCanvas() {
  const w = Math.min(window.innerWidth - 40, 380);
  canvas.style.width = w + 'px';
  canvas.style.height = w + 'px';
  canvas.width = w * 2;
  canvas.height = w * 2;
  drawBoard();
}

function drawBoard() {
  const w = canvas.width;
  const cell = w / 16;
  const pad = cell;

  // 木纹棋盘背景
  ctx.fillStyle = '#daa520';
  ctx.fillRect(0, 0, w, w);

  // 绘制网格线
  ctx.strokeStyle = '#8b4513';
  ctx.lineWidth = 2;
  for (let i = 0; i < 15; i++) {
    const pos = pad + i * cell;
    ctx.beginPath(); ctx.moveTo(pad, pos); ctx.lineTo(pad + 14*cell, pos); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pos, pad); ctx.lineTo(pos, pad + 14*cell); ctx.stroke();
  }

  // Star points (天元和星位)
  const stars = [[3,3],[3,11],[7,7],[11,3],[11,11]];
  ctx.fillStyle = '#8b4513';
  stars.forEach(([r,c]) => {
    ctx.beginPath();
    ctx.arc(pad + c*cell, pad + r*cell, 4, 0, Math.PI*2);
    ctx.fill();
  });

  // Pieces
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (!board[r][c]) continue;
      const x = pad + c * cell;
      const y = pad + r * cell;
      const radius = cell * 0.4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI*2);
      if (board[r][c] === 1) {
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.stroke();
      } else {
        ctx.fillStyle = '#eee';
        ctx.fill();
        ctx.strokeStyle = '#ccc';
        ctx.stroke();
      }
    }
  }

  // Highlight last move
  if (moveHistory.length > 0) {
    const last = moveHistory[moveHistory.length - 1];
    const x = pad + last.col * cell;
    const y = pad + last.row * cell;
    ctx.strokeStyle = '#e94560';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.3, 0, Math.PI*2);
    ctx.stroke();
  }
}

canvas.addEventListener('click', (e) => {
  if (!isMyTurn || gameOver) return;
  const rect = canvas.getBoundingClientRect();
  const scale = canvas.width / rect.width;
  const x = (e.clientX - rect.left) * scale;
  const y = (e.clientY - rect.top) * scale;
  const cell = canvas.width / 16;
  const pad = cell;
  const col = Math.round((x - pad) / cell);
  const row = Math.round((y - pad) / cell);
  if (row<0||row>14||col<0||col>14) return;
  if (board[row][col]) return;
  makeMove(row, col);
});

// Event listeners
$('btn-cancel-wait').onclick = () => {
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'cancel' }));
  }
  showScreen('screen-lobby');
};

$('btn-match').onclick = () => {
  aiMode = false;
  if (!ws || ws.readyState !== 1) connect();
  setTimeout(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'match' }));
  }, 100);
};

$('btn-join').onclick = () => {
  aiMode = false;
  const id = $('input-room').value.trim();
  if (!id) return;
  if (!ws || ws.readyState !== 1) connect();
  setTimeout(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'join', roomId: id }));
  }, 100);
};
$('btn-ai').onclick = () => {
  aiMode = true;
  myIndex = 1;
  isMyTurn = true;
  gameOver = false;
  board = Array.from({length:15}, ()=>Array(15).fill(0));
  moveHistory = [];
  currentRound = 0;
  showScreen('screen-game');
  updateStatus();
  drawBoard();
  startTimer();
};

$('btn-undo').onclick = () => {
  if (aiMode) {
    if (moveHistory.length >= 2) {
      for (let i = 0; i < 2; i++) {
        const last = moveHistory.pop();
        board[last.row][last.col] = 0;
      }
      drawBoard();
      playSound(400, 50);
    }
  } else if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'undo_request' }));
  }
};

$('btn-chat').onclick = () => {
  $('chat-panel').classList.toggle('hidden');
};

$('btn-send-chat').onclick = () => {
  const text = $('chat-input').value.trim();
  if (!text || !ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'chat', text }));
  addChatMessage(text, true);
  $('chat-input').value = '';
};

$('chat-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') $('btn-send-chat').click();
});

$('btn-truth-submit').onclick = () => {
  const answer = $('truth-input').value.trim();
  if (!answer) return;
  const q = $('truth-question').textContent;
  saveHistory(q, answer, false); // 提交回答的是输家

  if (aiMode) {
    $('truth-input-area').classList.add('hidden');
    $('truth-result').classList.remove('hidden');
    $('truth-answer-text').textContent = answer;
    setTimeout(() => showScreen('screen-lobby'), 2000);
  } else {
    ws.send(JSON.stringify({ type: 'truth_answer', answer }));
    $('truth-input-area').classList.add('hidden');
    $('truth-result').classList.remove('hidden');
    $('truth-answer-text').textContent = answer;
    $('btn-again').textContent = '再来一局';
    $('btn-again').classList.remove('hidden');
  }
};

$('btn-again').onclick = () => {
  if (aiMode) {
    $('btn-ai').click();
  } else {
    ws.send(JSON.stringify({ type: 'again' }));
    $('btn-again').textContent = '等待对方同意...';
    $('btn-again').disabled = true;
    setTimeout(() => { $('btn-again').disabled = false; }, 3000);
  }
};

// Modal handlers
$('btn-history').onclick = () => {
  const history = storage.get('history', []);
  const list = $('history-list');
  list.innerHTML = '';
  if (history.length === 0) {
    list.innerHTML = '<p style="text-align:center;color:#666;">暂无记录</p>';
  } else {
    history.forEach(h => {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${h.date} · ${h.result}</div>
        <div class="q">${h.question}</div>
        <div class="a">${h.answer}</div>
      `;
      list.appendChild(item);
    });
  }
  showScreen('screen-history');
};

$('btn-close-history').onclick = () => showScreen('screen-lobby');

$('btn-theme').onclick = () => {
  showScreen('screen-theme');
  const current = storage.get('theme', 'light');
  document.querySelectorAll('.theme-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === current);
  });
};

$('btn-close-theme').onclick = () => showScreen('screen-lobby');

document.querySelectorAll('.theme-item').forEach(btn => {
  btn.onclick = () => {
    const theme = btn.dataset.theme;
    storage.set('theme', theme);
    document.body.className = theme === 'light' ? '' : 'theme-' + theme;
    document.querySelectorAll('.theme-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  };
});

$('btn-settings').onclick = () => {
  showScreen('screen-settings');
  $('setting-sound').checked = settings.sound;
  $('setting-vibrate').checked = settings.vibrate;
  $('setting-timer').value = roomSettings.timer;
  $('setting-nsfw').checked = roomSettings.nsfw;
};

$('btn-close-settings').onclick = () => {
  settings.sound = $('setting-sound').checked;
  settings.vibrate = $('setting-vibrate').checked;
  roomSettings.timer = parseInt($('setting-timer').value) || 60;
  roomSettings.nsfw = $('setting-nsfw').checked;
  storage.set('settings', settings);
  storage.set('roomSettings', roomSettings);
  showScreen('screen-lobby');
};

$('btn-create').onclick = () => {
  aiMode = false;
  if (!ws || ws.readyState !== 1) connect();
  setTimeout(() => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'create', settings: roomSettings }));
  }, 100);
};

// Init
settings = storage.get('settings', settings);
roomSettings = storage.get('roomSettings', roomSettings);
const theme = storage.get('theme', 'light');
if (theme !== 'light') document.body.className = 'theme-' + theme;
updateStats();
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// PWA
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').catch(() => {});
}

connect();

