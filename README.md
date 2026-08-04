# SoloTrpg

AI驱动的通用单人TRPG跑团平台。点开即玩。

因为自己的团鸽了好像一个月于是忍不住捣鼓了这么个东西。

## 启动

- **最简单**：双击 `start.bat`（需要安装Node.js）
- **直接玩**：浏览器打开 `start.html`（基础功能，无需服务器）

## 打包为 EXE

```bash
npm i -g pkg
cd server && npm run build
# 生成 ../SoloTrpg.exe，可独立分发
```

## 目录

```
start.html          # 游戏入口
start.bat           # 一键启动
server/             # 后端服务
js/                 # 前端模块
css/                # 样式
Ruler/              # 规则书（AI自动创建）
Module/             # 模组
Archive/            # 会话存档
docs/               # 文档
```
