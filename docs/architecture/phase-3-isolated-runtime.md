# UniSearch 第三阶段：Workflow 执行收口与资源隔离

## 最终调用链

```text
用户自然语言
  -> Agent 选择并配置 Skill
  -> Workflow Runtime
       -> Connector Step -> Crawler Worker 子进程 -> RawItem
       -> Processor Step -> Processor Worker 子进程 -> Document / Artifact
  -> Analyzer / Exporter（后续功能）
```

Agent 不再轮询或启动具体步骤。它只负责创建、确认、停止和查询 Workflow，以及把执行结果
转换为用户可读的消息。

## Workflow Runtime

`WorkflowRuntime` 是执行层唯一入口，负责：

- 领取和启动可运行的 Connector Step。
- 根据 Crawl Run 状态回收 Connector Step。
- 调用 Workflow Engine 执行 Processor Step。
- 在完成、部分完成、失败、取消之间收敛最终状态。
- 将取消信号传播到 Connector 和 Processor 子进程。

Workflow Step 支持两种依赖策略：

- `success`：依赖步骤成功或跳过后才执行。
- `terminal`：依赖步骤只要结束就执行，适合部分来源失败后仍要运行的汇总、清洗和导出步骤。

## Processor Worker

Processor 通过独立 Node 子进程运行，主进程只传递版本化任务契约：

```ts
interface ProcessorWorkerRequest {
  schemaVersion: 1;
  jobId: string;
  processorIds: string[];
  documents: Document[];
  runId?: string;
}
```

单批最多处理 25 个 Document，避免 IPC 载荷和单次内存峰值无限增长。Worker 不访问 UI，
处理完成后返回 Document 与 Artifact，由主进程统一持久化。

## 资源调度

Processor 按 `resourceClass` 隔离并发队列：

- `io`：默认最多 4 个并发任务。
- `cpu`：默认最多 1 个并发任务。
- `gpu`：默认最多 1 个并发任务。

未来接入 Pandoc、FFmpeg、Whisper 时，只需注册 Processor 并声明资源类型，不需要修改
Agent、Skill 或 Workflow 的调度结构。

## 进程与打包

后端产物包含三个入口：

- `dist/main/index.js`
- `dist/crawler/worker.js`
- `dist/processor/worker.js`

Crawler Worker 与 Processor Worker 都作为独立文件从 Electron ASAR 中解包运行。

## 数据库策略

第三阶段 schema version 为 4，新增 Workflow Step 依赖策略。仍采用断代重建策略：
检测到其他版本时直接重建为空库，不执行历史数据迁移。

## 后续功能边界

第三阶段完成的是运行底座，不直接内置大体积二进制或模型。后续可以独立增加：

- FFmpeg、Whisper、Pandoc Processor 与按需下载。
- Chunk、Embedding、向量索引和 RAG。
- Analyzer 与 Exporter。
- Workflow 运行监控和资源队列 UI。
