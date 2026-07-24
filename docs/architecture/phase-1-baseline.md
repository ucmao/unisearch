# UniSearch 第一阶段重构基线

## 范围

第一阶段只建立 Connector 数据边界和结构化 Worker 通信，不修改 Electron、Fastify、React、SQLite 选型，不重写平台采集逻辑，也不引入 Processor、RAG 或向量数据库。

## 当前 Connector 清单

当前注册 21 个 Connector：

- 社交平台：小红书、抖音、快手、哔哩哔哩、微博、贴吧、知乎
- 搜索引擎：百度、必应、360 搜索、搜狗
- AI 网页问答：DeepSeek、Kimi、豆包、通义千问、腾讯元宝、纳米 AI、文心一言
- 垂直来源：智联招聘、黑猫投诉
- 工具：综合媒体解析

Manifest 是能力目录的事实来源；平台实现仍保留原有搜索、详情、主体、评论和 URL 解析行为。

## 重构前数据流

```text
Platform Crawler
  -> DatabaseStore.storeXxx()
  -> 平台原始表
  -> normalizeAndIngest()
  -> content_records
```

## 第一阶段目标数据流

```text
Platform Connector
  -> connectorOutput
  -> RawItem（schemaVersion=1）
  -> CompositeOutputSink
       -> SqliteOutputSink（兼容现有平台表和 content_records）
       -> IpcOutputSink（结构化运行事件）
```

## 兼容性约束

- 现有平台表暂不删除或迁移。
- `content_records` 的归一化行为暂时保持不变。
- Connector 不允许直接导入 `src/crawler/store` 或 `src/database`。
- `RawItem.payload` 保存原始平台对象，`hints` 只包含跨平台常用字段。
- 所有新契约必须携带 `schemaVersion`。

## 验收标准

- 21 个 Connector 的实现不再直接引用 `dbStore`。
- Connector 可使用 `MemoryOutputSink` 在无数据库环境下测试。
- SQLite 仍通过兼容 Sink 写入原有数据结构。
- Worker 通过带 runId、sequence、timestamp 的结构化 IPC 上报数据和状态。
- 后端构建与完整测试集通过。
