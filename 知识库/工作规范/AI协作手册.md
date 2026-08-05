# AI协作手册

## 本地调试与发布边界

- `start.bat` 是源码调试入口：检查 Node.js、安装依赖、检查 `server/server.js` 语法、前台启动后端、持久显示窗口、写入本地日志。
- `SoloTrpg.exe` 只用于对外发布：包含后端、前端和内置运行内容，首次运行自动创建 `config.json`、`Ruler/`、`data/uploads/`。
- 本地快速调试不逐步上传；EXE 不上传。只有用户明确说版本完成并要求上传时，才执行上传相关操作。

## AI任务区

```text
AI任务/
├── AI任务索引.md
└── <任务名>/
    ├── 任务手册.md
    ├── backup/
    ├── report/
    ├── ref/
    └── scripts/
```

- 修改前备份直接相关文件到 `AI任务/<任务名>/backup/vNNN/`。
- 任务记录、诊断结果、临时脚本写入当前任务目录，不写入项目根目录。
- 回档以用户当前文件和任务区备份为准，不使用 Git 回档。

## 日志

- `Logs/latest.log`：最近一次 `start.bat` 启动和 Node 调试日志。
- `Logs/debug-年月日-时分秒.log`：单次后端会话日志。
- `Logs/launcher.log`：历次启动器检查、依赖安装和语法检查记录。

AI 排查启动问题时优先读取 `Logs/latest.log`，再读取 `Logs/launcher.log` 和最新 `Logs/debug-*.log`。
