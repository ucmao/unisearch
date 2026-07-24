# UniSearch 第二阶段：Document、Workflow、Processor 与 Skill

## 已落地的数据流

```text
Agent ResearchPlan
  -> multi-source-research Skill
  -> persistent Workflow
  -> Connector Worker
  -> RawItem
  -> SqliteOutputSink
       -> 兼容平台表 / content_records
       -> Document Engine
            -> metadata.normalize
            -> document.clean_markdown
            -> Document / Source / Asset / Artifact
```

## Document Engine

Document Engine 将平台 RawItem 转换为稳定的知识文档。它负责：

- 使用来源 URL 或平台内容 ID 生成稳定 canonical key。
- 统一标题、正文、作者、发布时间和媒体资源。
- 清洗 Markdown，生成内容哈希。
- 按 canonical key 去重，同时保留每次采集的 provenance。
- 保存 Asset、Artifact 和评论父子关系。

`documents` 是后续 Analyzer、Exporter 和 RAG 的读取入口；平台原始 payload 保存在 `document_sources`，不丢失来源证据。

## Processor

Processor 使用统一的泛型接口：

```ts
interface Processor<Input, Output> {
  id: string;
  version: string;
  resourceClass: 'io' | 'cpu' | 'gpu';
  process(input: Input, context: ProcessorContext): Promise<Output>;
}
```

当前内置两个确定性 Processor：

- `metadata.normalize@1.0.0`
- `document.clean_markdown@1.0.0`

FFmpeg、Whisper、Pandoc 和下载器不属于本阶段，后续可以按同一接口接入，并将结果写为 Artifact。

## Skill

当前内置声明式 Skill：

- `multi-source-research@1.0.0`

它声明支持的 Connector Capability、逐条数据处理器以及输出类型。Agent 不直接实现采集或清洗逻辑，而是在执行 ResearchPlan 时选择 Skill 并编译 Workflow。

## Workflow Engine

Workflow 数据持久化在 `workflow_runs` 和 `workflow_steps`：

- 一个 Agent Plan 对应一个 Workflow Run。
- 每个平台生成一个原子 Connector Step。
- Document 归一化表示为依赖全部 Connector 的 Processor Step。
- Workflow 同步现有 Agent Plan 的 queued、running、completed、failed 和 cancelled 状态。
- 支持依赖图校验、循环检测、原子步骤领取、超时、取消、自动重试和失败后重置。
- 本地 Processor 步骤可以注册 Handler 后由 Workflow Engine 直接执行；Connector 步骤在兼容期由现有 Agent Plan/CrawlerManager 执行并同步状态。
- 应用重启时，遗留运行任务会被标记为 interrupted，避免永久停留在运行状态。

当前 Agent Plan 仍是 Connector 的兼容执行器；Workflow 是新的通用任务事实层。后续迁移 Processor Worker 时，可以逐步把真正的步骤执行权移入 Workflow Engine，不需要修改 Agent 或 Skill 契约。

## API

- `GET /api/skills`
- `GET /api/documents?run_id=<runId>&limit=<n>`
- `GET /api/documents/:document_id`
- `GET /api/agent/plans/:plan_id/workflow`

## 明确未包含

- FFmpeg、Whisper、Pandoc 二进制和模型管理
- 全文检索、Chunk、Embedding 和向量数据库
- Analyzer 与 Exporter 插件
- Workflow 可视化编辑器
- 新 Document 管理 UI
