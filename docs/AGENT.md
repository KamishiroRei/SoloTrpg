# TrpgRecode — AI驱动的通用单人TRPG平台

> 接入AI后让AI自己部署一套TRPG基类：动态解析任意TRPG规则书→自动生成配套角色卡与工具（插件）→AI作为GM带团。
> 核心追求：TRPG的自由 + 电脑游戏的精准。AI以结构化标记输出判定与状态，系统渲染精美界面；游戏数据以变量精确管理，AI可读可写，前端实时联动。

## 开发铁律

- 本地快速调试不逐步上传；`SoloTrpg.exe` 是发布包，本地调试用 `start.bat`。
- 不使用 Git 回档；回档以 `AI任务/<任务名>/backup/` 备份为准。
- 修改前在 `AI任务/<任务名>/backup/` 备份直接相关文件。
- 根目录不放AI临时产物；AI产物写入 `AI任务/`，稳定知识写入 `知识库/`。
- 用户体验优先：BUG修复不得丢失已有健全功能；数据兼容性不可破坏（版本升级自动解析并继承旧存档）；默认空框架，不预设角色/规则/模组。
- 大部分游戏数据由AI读取规则书后动态生成；存档存AI生成结果；规则书更新后AI识别差异增量更新；模组级自定义通过 override.json 覆盖。

## 架构

| 部分 | 说明 |
|------|------|
| `app/` | 前端（index.html、character-create.html、sheet.html、rule-tree.html、view.html；js/：ui.js、ai.js、plugins.js、dice.js、map.js、network.js、rulesearch.js、templates.js、compressor.js、app.js；css/style.css） |
| `server/server.js` | 唯一后端入口（AI代理、规则扫描、插件执行、存档、模组搜索、联机） |
| `Ruler/<系统名>/` | 规则书任务区（source/原始、compressed/查表、original/、plugins/插件、assets/、tasks/、_index.json） |
| `Ruler/_shared_tools/` | 通用工具与参考材料（含 reference/DND2024角色卡标杆/） |
| `AI任务/` | AI任务产物（任务手册、backup、report、ref、scripts、AI任务索引.md） |
| `知识库/` | 稳定知识（工作规范/AI协作手册.md 等） |
| `docs/` | 长期开发文档（本文件、character-sheet-api.md、AI_MODULE_FIXES.md） |
| `Logs/` | 运行日志（latest.log、debug-*.log、launcher.log） |
| `config.json` | 配置（AI端点/模型、上下文限制等） |

## 运行

```bash
start.bat        # 源码调试入口（检查Node、语法检查、启动并写日志）
# 浏览器打开 http://localhost:3000
```

## 系统频道（AI自主迭代入口）

- 前端"系统频道"授予AI规则系统管理权：可读写 `Ruler/<系统>/plugins/` 插件、检查宿主渲染文件。
- AI工作方法、插件编写规范、GM带团协议由 skill 工具按需加载（agent-guide / plugin-authoring / gm-protocol / gm-standard）。
- 详细协议见 `server/server.js` 中 GM_PROTOCOL_SKILL / PLUGIN_AUTHORING_SKILL / AGENT_GUIDE_SKILL / GM_STANDARD 常量。

## AI调用与token

- 系统频道：无轮数上限、不硬编码maxTokens、reasoningEffort由配置驱动、思考与正文完整推送、工具结果完整保留、历史超预算自动LLM压缩（compact）、空转分级提醒。
- DeepSeek上下文缓存自动生效（命中按1/10计费）；历史中仅保留最近2轮assistant完整思考，更早思考置空（省token）。
- 玩家频道：GM带团标准（GM_STANDARD）固定注入一次，不重复注入。
