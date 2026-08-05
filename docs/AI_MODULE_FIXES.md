# AI 模块与后端统一

## 当前结构

AI、规则书、上传、存档、配置和联机功能全部位于 `server/server.js`。

`start.bat` 直接运行这份源码；`SoloTrpg.exe` 也由这份源码打包生成。旧 `launcher.py` 与 Flask 后端已经移除，因此不存在需要同步维护的第二套接口。

## AI 地址与模型发现

自定义 API 地址支持：

```text
https://api.deepseek.com
https://api.deepseek.com/v1
https://api.deepseek.com/v1/chat/completions
```

刷新模型时依次尝试对应的 `/models` 与 `/v1/models`。探测成功后，前端使用同一基础地址对应的 `/chat/completions`。

模型列表兼容 `data`、`models`、`items` 与纯数组格式，模型条目兼容 `id`、`model` 与 `name`。

## DeepSeek 思考模型

服务端会保留响应中的 `reasoning_content`，并在后续轮次将其随 assistant 历史重新提交，避免思考模型从第二轮开始拒绝上下文。

## 配置与运行目录

开发模式以项目根目录为运行目录；EXE 模式以 EXE 所在目录为运行目录。两者都使用同名结构：

```text
config.json
Ruler/
data/uploads/
```

打包后的前端资源从 EXE 快照读取，运行数据不会写入只读快照。
