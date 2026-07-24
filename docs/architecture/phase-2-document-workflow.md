# UniSearch 第二阶段：Document、Workflow、Processor 与 Skill

## 唯一执行与数据链路

```text
用户自然语言
  -> Agent 选择 Skill
  -> Workflow Run / Workflow Steps
  -> Connector Worker
  -> RawItem
  -> Document Engine
       -> metadata.normalize
       -> document.clean_markdown
       -> Document / Source / Asset / Artifact
```

系统不再维护 Agent Plan 与 Workflow 两套状态。界面和旧 API 中的 `plan_id` 只是
`workflow_id` 的展示别名，不对应独立数据库表或同步层。

## Document Engine

Document Engine 是采集数据的唯一持久化入口：

- 使用来源 URL 或平台内容 ID 生成稳定 canonical key。
- 统一标题、正文、作者、发布时间和媒体资源。
- 清洗 Markdown，生成内容哈希。
- 按 canonical key 去重，同时在 `document_sources` 保留每次采集证据。
- 保存 Asset、Artifact 和评论父子关系。

`documents` 是 Analyzer、Exporter 和 RAG 的唯一读取入口；来源原始 payload 保存在
`document_sources`。

## Processor

Processor 使用统一接口：

```ts
interface Processor<Input, Output> {
  id: string;
  version: string;
  resourceClass: 'io' | 'cpu' | 'gpu';
  process(input: Input, context: ProcessorContext): Promise<Output>;
}
```

当前内置：

- `metadata.normalize@1.0.0`
- `document.clean_markdown@1.0.0`

FFmpeg、Whisper、Pandoc 和下载器后续按相同接口接入，输出写入 Artifact。

## Skill 与 Workflow

内置 `multi-source-research@1.0.0` 声明 Connector Capability、Processor 和输出类型。
Agent 只负责选择 Skill 和提交 Workflow，不承载采集、清洗或状态同步逻辑。

Workflow 持久化在 `workflow_runs` 和 `workflow_steps`：

- 每个任务轮次就是一个 Workflow Run。
- Connector、Processor、Analyzer、Exporter 都是原子 Step。
- 支持依赖图校验、循环检测、步骤领取、超时、取消、重试和中断恢复。
- `crawl_runs.workflow_id` 直接归属 Workflow，不经过 Plan 兼容表。

## 数据库断代策略

数据库 schema version 由后续阶段统一维护。检测到旧版本时，应用直接删除旧 schema 并创建新表，
不迁移旧平台表、`content_records`、`agent_plans` 或 `agent_plan_steps`。

## 暂未包含

- FFmpeg、Whisper、Pandoc 二进制和模型管理
- 全文检索、Chunk、Embedding 和向量数据库
- Analyzer 与 Exporter 插件
- Workflow 可视化编辑器
- Document 管理 UI
