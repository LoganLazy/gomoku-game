# 部署检查清单

## 📋 部署前准备

### 1. 生成真实图标（可选但推荐）
```bash
npm install canvas
node generate-icons.js
```
或手动创建 192x192 和 512x512 的 PNG 图标

### 2. 检查依赖
```bash
npm install
```

### 3. 测试本地运行
```bash
npm start
# 访问 http://localhost:3000
```

---

## 🚀 服务器部署步骤

### 方案一：PM2（推荐）

```bash
# 1. 上传项目到服务器
scp -r wuziqi user@server:/path/to/

# 2. 服务器上安装依赖
cd /path/to/wuziqi
npm install --production

# 3. 安装 PM2
npm install -g pm2

# 4. 启动服务
pm2 start server.js --name wuziqi

# 5. 设置开机自启
pm2 save
pm2 startup

# 6. 查看日志
pm2 logs wuziqi
```

### 方案二：Systemd

创建 `/etc/systemd/system/wuziqi.service`:
```ini
[Unit]
Description=Wuziqi Game Server
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/path/to/wuziqi
ExecStart=/usr/bin/node server.js
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

启动：
```bash
systemctl enable wuziqi
systemctl start wuziqi
systemctl status wuziqi
```

---

## 🌐 Nginx 反向代理

### HTTP 配置
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        
        # WebSocket 支持（必需）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # 其他头部
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 超时设置
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### HTTPS 配置（推荐）

1. 安装 Certbot
```bash
apt install certbot python3-certbot-nginx
```

2. 获取证书
```bash
certbot --nginx -d yourdomain.com
```

3. 自动更新配置后的 nginx 配置：
```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

4. 重启 Nginx
```bash
nginx -t
systemctl reload nginx
```

---

## 🔒 安全配置

### 1. 防火墙
```bash
# 仅开放必要端口
ufw allow 22    # SSH
ufw allow 80    # HTTP
ufw allow 443   # HTTPS
ufw enable

# 关闭 Node.js 端口外部访问
ufw deny 3000
```

### 2. 限制并发连接（可选）

编辑 `server.js`，在 `wss.on('connection')` 前添加：
```javascript
let activeConnections = 0;
const MAX_CONNECTIONS = 200;

wss.on('connection', (ws) => {
  if (activeConnections >= MAX_CONNECTIONS) {
    ws.close(1008, 'Server full');
    return;
  }
  activeConnections++;
  
  ws.on('close', () => {
    activeConnections--;
  });
  
  // 原有代码...
});
```

### 3. 环境变量

创建 `.env` 文件（不提交到 Git）：
```env
PORT=3000
NODE_ENV=production
```

修改 `server.js`:
```javascript
require('dotenv').config();
const PORT = process.env.PORT || 3000;
```

---

## 📊 监控与日志

### PM2 监控
```bash
pm2 monit              # 实时监控
pm2 logs wuziqi --lines 100   # 查看日志
pm2 restart wuziqi     # 重启
pm2 stop wuziqi        # 停止
```

### 日志文件（Systemd）
```bash
journalctl -u wuziqi -f
```

### 性能监控（可选）
```bash
# 安装 PM2 Web UI
pm2 install pm2-server-monit
```

---

## ✅ 部署后验证

### 1. 检查服务状态
```bash
# PM2
pm2 status

# Systemd
systemctl status wuziqi

# 端口监听
netstat -tulpn | grep 3000
```

### 2. 测试 HTTP 访问
```bash
curl -I http://yourdomain.com
# 应返回 200 OK
```

### 3. 测试 WebSocket
```bash
# 安装 wscat
npm install -g wscat

# 测试连接
wscat -c ws://yourdomain.com
# 或 HTTPS
wscat -c wss://yourdomain.com
```

### 4. 浏览器测试
- 打开 https://yourdomain.com
- 检查控制台无错误
- 测试随机匹配（需两个设备）
- 测试单机 AI
- 查看 PWA 提示（添加到主屏幕）
- F12 → Application → Service Workers（应显示已激活）

### 5. 移动端测试
- 手机浏览器访问
- 添加到主屏幕
- 关闭网络测试离线缓存
- 测试震动和音效

---

## 🔧 常见问题排查

### WebSocket 连接失败
1. 检查 Nginx 配置是否包含 Upgrade 头
2. 检查防火墙是否阻止 WebSocket
3. 确认使用 wss://（HTTPS）而非 ws://

### Service Worker 不生效
1. 必须使用 HTTPS 或 localhost
2. 检查 manifest.json 路径是否正确
3. 清除浏览器缓存重试

### 图标不显示
1. 确认 icon-192.png 和 icon-512.png 存在
2. 检查 manifest.json 中路径正确
3. 使用真实 PNG 替代 SVG 占位符

### PM2 启动失败
```bash
# 查看详细错误
pm2 logs wuziqi --err --lines 50

# 手动启动测试
cd /path/to/wuziqi
node server.js
```

---

## 📱 PWA 安装指南

### iOS (Safari)
1. 打开网站
2. 点击底部"分享"按钮
3. 选择"添加到主屏幕"
4. 自定义名称，点击"添加"

### Android (Chrome)
1. 打开网站
2. 点击右上角菜单
3. 选择"添加到主屏幕"
4. 确认添加

### 桌面 (Chrome/Edge)
1. 地址栏右侧出现"安装"图标
2. 点击安装
3. 应用出现在任务栏/开始菜单

---

## 🎯 性能优化（可选）

### 1. Gzip 压缩（Nginx）
```nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
gzip_min_length 1000;
```

### 2. 静态资源缓存
```nginx
location ~* \.(js|css|png|jpg|svg|ico)$ {
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

### 3. CDN 加速（可选）
将 `public/` 文件夹上传到 CDN，修改 HTML 引用路径

---

## 📈 扩展方案

### 多服务器负载均衡

需要共享 Session，推荐使用 Redis：
```bash
npm install redis
```

修改 `server.js` 使用 Redis 存储房间信息

### Docker 部署

创建 `Dockerfile`:
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

构建运行：
```bash
docker build -t wuziqi .
docker run -d -p 3000:3000 --name wuziqi wuziqi
```

---

## ✅ 最终检查清单

- [ ] 服务器正常启动（PM2/Systemd）
- [ ] Nginx 反向代理配置正确
- [ ] HTTPS 证书有效
- [ ] WebSocket 连接成功
- [ ] 防火墙规则设置
- [ ] PWA 可以安装
- [ ] Service Worker 激活
- [ ] 图标正常显示
- [ ] 移动端适配良好
- [ ] 音效震动生效
- [ ] 随机匹配功能正常
- [ ] AI 模式可用
- [ ] 数据统计保存
- [ ] 历史记录可查看
- [ ] 主题切换生效
- [ ] 监控日志正常

---

**部署完成后，记得分享链接让朋友测试！** 🎉
