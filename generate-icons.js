// 简化版图标生成（浏览器端）
// 在浏览器控制台运行以下代码：

function generateIcon(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // 背景
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);

  // 棋盘网格
  const grid = 5;
  const cellSize = size / grid;
  ctx.strokeStyle = '#16213e';
  ctx.lineWidth = size / 100;

  for (let i = 0; i <= grid; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cellSize, 0);
    ctx.lineTo(i * cellSize, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i * cellSize);
    ctx.lineTo(size, i * cellSize);
    ctx.stroke();
  }

  // 黑白棋子
  const r = cellSize * 0.35;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.arc(cellSize * 1.5, cellSize * 2.5, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(cellSize * 3.5, cellSize * 2.5, r, 0, Math.PI * 2);
  ctx.fill();

  // 下载
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `icon-${size}.png`;
    a.click();
  });
}

// 使用方法：在浏览器控制台依次运行
// generateIcon(192);
// generateIcon(512);
