# 五子棋 · 真心话

> 一个 H5 双人对战小游戏。陌生人匹配下五子棋，输的人回答真心话，问题越聊越深。

⚠️ **内容提示**：本项目包含成人内容（18+ 题库），仅限成年用户使用。可在游戏设置中关闭。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 🎮 特性

### 核心玩法
- 🎲 **随机匹配** - 陌生人速配，每局都是新故事
- 🏠 **房间系统** - 6 位房间号邀请好友
- 🤖 **单机 AI** - 没人陪玩时练手
- 💬 **真心话** - 输了回答问题，6 级递进（破冰→暧昧→走心→入骨→致命→18+）

### 游戏功能
- ⏱️ **倒计时** - 每步 60 秒限时，可调（10-300 秒）
- ↩️ **悔棋** - 双方同意后撤销
- 💬 **实时聊天** - 对局内自由交流
- 🎵 **音效 + 震动** - 落子清脆音，手机震动反馈

### PWA 支持
- 📱 添加到主屏幕，像原生 App
- 💾 离线缓存
- 🔔 iOS/Android 兼容

### 界面
- 🎨 **4 套主题** - 默认/浅色/樱花/森林
- 📊 **数据统计** - 胜率、总局数、连胜
- 📜 **历史记录** - 保存最近 50 条真心话答案

## 🚀 快速开始

### 本地运行

```bash
npm install
npm start
```

浏览器打开 `http://localhost:3000`

**局域网测试**：两台手机连同一 WiFi，访问 `http://电脑IP:3000`

Windows 查看 IP：
```bash
ipconfig
```

### 服务器部署

```bash
npm install
npm install -g pm2
pm2 start server.js --name wuziqi
pm2 save
pm2 startup
```

#### Nginx 反代配置

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
└── public/
    ├── index.html         # 单页应用
    ├── style.css          # 样式 + 主题
    ├── game.js            # 游戏逻辑 + 题库 + AI
    ├── service-worker.js  # PWA 缓存
    ├── manifest.json      # PWA 配置
    └── icon-*.png         # PWA 图标
```

## 🎯 题库定制

题库在 `public/game.js` 和 `server.js` 顶部 `questions` 数组，6 个级别：

| 级别 | 触发局数 | 风格 |
|------|---------|------|
| 1 破冰 | 1-2 局 | 轻松了解 |
| 2 暧昧 | 3-4 局 | 试探心动 |
| 3 走心 | 5-6 局 | 感情经历 |
| 4 入骨 | 7-8 局 | 亲密边界 |
| 5 致命 | 9-10 局 | 心底秘密 |
| 6 18+ | 11 局起 | 成人话题 |

**修改题库**：同步修改前后端两个 `questions` 数组即可。

**关闭 18+**：在游戏设置中关闭，或直接删除数组最后一项。

## ⚙️ 技术栈

- **后端**：Node.js + Express + ws (WebSocket)
- **前端**：原生 HTML/CSS/JS + Canvas
- **PWA**：Service Worker + Manifest

## 📝 协议

| 消息类型 | 说明 |
|---------|------|
| `match` | 请求随机匹配 |
| `create` / `join` | 创建/加入房间 |
| `move` | 落子坐标 |
| `win` | 胜负判定 |
| `truth_answer` | 真心话回答 |
| `again` | 请求重开 |
| `chat` | 聊天消息 |
| `undo_request` / `undo_accept` / `undo_reject` | 悔棋流程 |

## ⚠️ 注意

- 服务端不存储任何聊天内容
- 公网部署建议用 HTTPS（移动端对 ws:// 限制较多）
- AI 模式为单机玩法，不触发真心话环节

## 📄 许可证

[MIT License](LICENSE)

## 🔗 相关文档

- [部署指南](DEPLOY.md) - 详细部署步骤
- [快速开始](QUICKSTART.md) - 新手入门
- [升级日志](UPGRADE_REPORT.md) - v2.0 更新内容
