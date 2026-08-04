# SoloTrpg

AI驱动的通用单人TRPG跑团平台。

因为自己的团鸽了好像一个月于是忍不住捣鼓了这么个东西。接入AI后让AI自己捣鼓并部署一套TRPG基类。暂时没考虑联机。

## 功能

- 地图画布：方形网格、平移缩放、角色标记、法术范围显示
- 通用骰子：d4~d100，表达式 `2d6+3`、`4d6k3`、优劣势
- AI游戏主持：多模型支持，自动读取规则书并主持游戏
- 规则书任务区：上传PDF/CHM → AI压缩为标准查表格式 → 模糊检索
- 动态角色卡：AI读取规则书后自动生成字段配置，不预设任何规则系统
- Token优化：压缩运行+原文存档，按需检索不全文注入

## 快速开始

```bash
# 安装依赖
npm install

# 启动后端（AI功能需要）
node server.js

# 打开界面
# 浏览器访问 http://localhost:3000
# 或直接打开 index.html（基础功能，无需后端）
```

## 使用流程

1. 配置AI：在设置面板填入API端点和Key（不启动后端则跳过）
2. 上传规则书：在规则面板上传PDF/CHM，AI自动压缩缓存
3. AI接管：AI自动扫描规则书任务区，建立压缩索引
4. 开始游戏：创建角色，在AI面板描述行动，AI主持游戏

## 规则书目录结构

```
Ruler/{系统名}/
├── source/        # 原始文本存档
├── compressed/    # AI压缩的标准查表格式
└── _index.json    # 压缩索引（自动生成）
```

直接将PDF/CHM放入对应系统目录，或在界面中上传。

## 文件清单

| 文件 | 作用 |
|------|------|
| `index.html` | 前端入口 |
| `server.js` | 后端服务（AI代理、规则扫描、压缩管道） |
| `js/dice.js` | 骰子系统 |
| `js/map.js` | 地图引擎 |
| `js/compressor.js` | 文本压缩器 |
| `js/rulesearch.js` | 规则搜索引擎 |
| `js/templates.js` | 模板渲染器 |
| `js/ai.js` | AI集成 |
| `js/ui.js` | UI管理 |
| `js/app.js` | 主控制器 |

## 技术栈

前端：HTML/CSS/JS（无框架，无构建工具）  
后端：Node.js + Express  
AI：兼容 OpenAI API 格式的任意模型
