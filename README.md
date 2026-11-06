# 五子棋 · 真心话

> 一个 H5 双人对战小游戏。陌生人匹配下五子棋，输的人回答真心话，问题越聊越深。

⚠️ **内容提示**：本项目包含成人内容（18+ 题库），仅限成年用户使用。18+ 题库默认关闭，需房主在游戏设置中主动开启。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## ✨ 特性

### 核心玩法
- 🎲 **随机匹配** - 陌生人速配
- 🏠 **房间系统** - 6 位房间号邀请好友
- 🤖 **单机 AI** - 没人陪玩时练手
- 💬 **真心话** - 输了回答问题，6 级递进（破冰→暧昧→走心→入骨→致命→18+）

### 游戏功能
- ⏱️ **倒计时** - 每步限时，可调（30/60/120秒）
- ↩️ **悔棋** - 房间模式双方同意后撤销（匹配模式禁用）
- 💬 **实时聊天** - 对局内自由交流
- 🎵 **音效 + 震动** - 落子清脆音，手机震动反馈

### PWA 支持
- 📱 添加到主屏幕，像原生 App
- 💾 离线缓存
- 🔔 iOS/Android 兼容

### 界面
- 🎨 **4 套主题** - 浅色/深邃/樱花/森林
- 📊 **数据统计** - 胜率、总局数、连胜（本地存储）
- 📜 **历史记录** - 保存最近 50 条真心话答案
- 🌐 **在线人数** - 实时显示

## 🚀 快速开始

### 本地运行

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000`

**局域网测试**：两台手机连同一 WiFi，访问 `http://电脑IP:3000`

```bash
# Windows 查看 IP
ipconfig

# Mac/Linux
ifconfig
```

### Docker 部署（推荐）

```bash
# 使用 Docker Compose
docker-compose up -d

# 查看日志
docker logs -f wuziqi

# 停止服务
docker-compose down
```

**使用 Docker**：

```bash
docker build -t wuziqi .
docker run -d -p 3000:3000 --name wuziqi --restart unless-stopped wuziqi
```

### 服务器部署（PM2）

```bash
npm install --production
npm install -g pm2
pm2 start server.js --name wuziqi
pm2 save
pm2 startup
```

#### Nginx 反代（支持 WebSocket）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

HTTPS 建议用 Certbot 自动签发。

## 📁 项目结构

```
wuziqi/
├── server.js              # WebSocket 服务端
├── package.json
├── Dockerfile             # Docker 镜像构建
├── docker-compose.yml     # Docker Compose 配置
└── public/
    ├── index.html         # 单页应用
    ├── style.css          # 样式 + 4 套主题
    ├── game.js            # 游戏逻辑 + AI
    ├── service-worker.js  # PWA 缓存
    ├── manifest.json      # PWA 配置
    └── icon-*.png         # PWA 图标
```

## 🎯 题库定制

题库在 `server.js` 顶部 `questions` 数组，6 个级别：

| 级别 | 触发局数 | 风格 |
|------|---------|------|
| 1 破冰 | 1-2 局 | 轻松了解 |
| 2 暧昧 | 3-4 局 | 试探心动 |
| 3 走心 | 5-6 局 | 感情经历 |
| 4 入骨 | 7-8 局 | 亲密边界 |
| 5 致命 | 9-10 局 | 心底秘密 |
| 6 18+ | 11 局起 | 成人话题 |

**修改题库**：编辑 `server.js` 中的 `questions` 数组。

**18+ 开关**（默认关闭）：
- 房主在游戏设置中主动开启后才生效
- 或删除 `questions` 数组最后一项可彻底移除

## 🎮 玩法说明

1. **大厅**选择随机匹配、创建房间或单机 AI
2. **15×15 棋盘**，黑棋先行，五连胜
3. **输的一方**打字回答真心话问题，提交后双方都能看到
4. 双方点"**再来一局**"重开，问题难度逐级递增

### 房间设置（创建房间前配置）
- **倒计时**：30/60/120 秒
- **18+ 题库**：默认关闭，房主主动开启
- **音效/震动**：各自本地设置

## ⚙️ 技术栈

- **后端**：Node.js + Express + ws (WebSocket)
- **前端**：原生 HTML/CSS/JS + Canvas
- **PWA**：Service Worker + Manifest
- **部署**：Docker / PM2 + Nginx

## 📝 协议说明

WebSocket 消息类型：

| 类型 | 说明 |
|------|------|
| `match` | 请求随机匹配 |
| `create` / `join` | 创建/加入房间 |
| `move` | 落子坐标 |
| `win` | 胜负判定 + 题目 |
| `truth_answer` | 真心话回答 |
| `again` | 请求重开 |
| `chat` | 聊天消息 |
| `undo_request` / `undo_accept` / `undo_reject` | 悔棋流程（服务端权威执行，广播撤销的落子和轮次） |
| `cancel` | 取消匹配等待 / 取消未满人的房间 |
| `online_count` | 在线人数 |

## ⚠️ 注意

- 服务端不存储任何聊天内容，所有真心话答案随对局结束消失
- 数据统计和历史记录存储在浏览器本地（LocalStorage）
- 公网部署建议用 HTTPS（移动端对 ws:// 限制较多）
- AI 模式为单机玩法，不触发真心话环节
- 匹配模式禁止悔棋，房间模式需双方同意
- 倒计时超时由服务端判负；房间号为加密随机生成，加入失败不区分“不存在 / 已满”

## 📄 许可证

[MIT License](LICENSE)

## 🔗 更新日志

**v2.3.0** (2026-11-06)
- ✅ 修复悔棋脱节：服务端权威执行悔棋，同步棋盘与轮次
- ✅ 修复自己和自己匹配：重复 match/create/join 请求会被忽略
- ✅ 倒计时真正执行：服务端每秒检查，超时判负
- ✅ AI 评估函数改为按棋子参数化，双方棋型都评分
- ✅ 服务端输入校验与限流：坐标/聊天/回答长度校验，64KB 消息上限，每秒 20 条限速
- ✅ 房间号改用加密随机生成，加入失败不再区分“不存在 / 已满”
- ✅ 18+ 题库默认关闭，需房主主动开启，设置页增加提示
- ✅ 删掉观战死按钮、重复代码与 AI 题库死代码；修复历史记录重复存空白答案
- ✅ 等待界面增加取消按钮
- ✅ Service Worker 缓存升到 v2，图标纳入缓存，安装后立即接管
- ✅ 新增单测 + WebSocket 集成测试与 GitHub Actions CI
- ✅ Dockerfile 换 Node 20、非 root 运行、加 HEALTHCHECK

**v2.2** (2026-06-11)
- ✅ 房间设置同步（倒计时/18+）
- ✅ 匹配队列优化，支持多人排队
- ✅ 匹配模式禁止悔棋
- ✅ 在线人数显示
- ✅ 题库统一管理
- ✅ 4 套主题（浅色默认）
- ✅ Docker 部署支持

**v2.0** (2026-06-08)
- ✅ PWA 支持
- ✅ 单机 AI 模式
- ✅ 倒计时功能
- ✅ 悔棋功能
- ✅ 实时聊天
- ✅ 音效 + 震动反馈
- ✅ 数据统计和历史记录
