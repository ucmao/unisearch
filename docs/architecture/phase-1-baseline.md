# UniSearch 第一阶段：Connector 契约

## 目标

第一阶段建立 Connector 的唯一数据边界。平台采集实现只负责获取来源数据，不感知 SQLite、Document 或业务流程。

## Connector 清单

当前注册 21 个 Connector：

- 社交平台：小红书、抖音、快手、哔哩哔哩、微博、贴吧、知乎
- 搜索引擎：百度、必应、360 搜索、搜狗
- AI 网页问答：DeepSeek、Kimi、豆包、通义千问、腾讯元宝、纳米 AI、文心一言
- 垂直来源：智联招聘、黑猫投诉
- 工具：综合媒体解析

Manifest 是 Connector 能力目录的事实来源。

## 数据流

```text
Platform Connector
  -> connectorOutput.emitXxx()
  -> RawItem（schemaVersion=1）
  -> OutputSink
       -> SqliteOutputSink -> Document Engine
       -> IpcOutputSink -> 结构化运行事件
```

## 边界规则

- Connector 不导入数据库模块，不执行 SQL。
- Connector 不决定数据如何保存、分析或导出。
- `RawItem.payload` 保存来源原始对象，`hints` 只包含跨平台通用字段。
- 所有跨模块契约都携带 `schemaVersion`。
- 不存在平台专属表或 `content_records` 双写路径。

## 验收标准

- 21 个 Connector 均通过 `connectorOutput` 发出 `RawItem`。
- Connector 可使用 `MemoryOutputSink` 在无数据库环境下测试。
- SQLite Sink 只调用 Document Engine。
- Worker 通过带 runId、sequence、timestamp 的结构化 IPC 上报事件。
