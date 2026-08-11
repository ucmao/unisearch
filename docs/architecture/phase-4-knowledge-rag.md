# UniSearch 第四阶段：Processor、Analyzer、Exporter 与 RAG

## 完整知识链路

```text
Connector
  -> RawItem
  -> Document Engine
  -> Document Version
  -> Processor Worker
  -> Chunk
  -> SQLite FTS + Remote Embedding API
  -> Hybrid Retrieval
  -> Citation RAG
  -> Analyzer / Exporter
```

## 本地 Processor

已注册：

- `asset.download`：下载远程 Asset，保存本地路径和 MIME 信息。
- `pandoc.convert`：文档转 GitHub Flavored Markdown。
- `ffmpeg.extract_audio`：视频提取 16kHz 单声道 WAV。
- `whisper.transcribe`：生成 Transcript Artifact。

FFmpeg、Pandoc 和 Whisper 使用系统命令，`GET /api/processors` 返回真实可用状态和命令路径。
缺少二进制时调用会明确失败，不会伪造处理结果。Processor 仍在独立 Worker 中执行。

## Document 版本

`document_versions` 按 `document_id + content_hash` 保存不可变版本。相同内容不会重复创建版本，
来源再次采集到变化内容时会保留新旧正文。

## 知识索引

- 文本按最长 800 字符、120 字符重叠切分。
- `document_chunks_fts` 提供 SQLite FTS5 全文检索。
- `document_chunk_embeddings` 以 Float32 BLOB 缓存远程 Embedding API 返回的向量。
- 默认预设为硅基流动 `BAAI/bge-m3`，也支持自定义兼容 Embedding API。
- 混合检索通过倒数排名融合合并全文与向量结果，可选调用 Reranker API 精排。
- 每个研究 Workflow 在 Document 处理结束后自动执行索引步骤。

项目不再包含本地哈希 Embedding。文档、Chunk、FTS 和向量缓存仍保存在本地 SQLite，只有向量计算
和可选重排发送到用户配置的 API。未配置 API 或远程调用失败时自动降级为 FTS5 关键词检索，并向
用户显示检索提示；采集、文档入库和分析流程不会因此被阻断。

设置页的“知识检索”支持配置 Provider、API Base URL、API Key、Embedding 模型，以及独立开关的
Reranker Base URL 和模型。Embedding Provider、Base URL 或模型变化时直接清空向量缓存，后续自动
重建，不保留旧向量兼容逻辑。

## RAG

`POST /api/knowledge/rag` 返回：

- 带 `[S1]`、`[S2]` 标记的回答。
- Document ID、来源平台、原始 URL、摘录和相关度。
- 未配置模型 API Key 时返回最相关片段，不假装生成 AI 答案。

`POST /api/knowledge/rag` 只提供通用知识库问答，不承担任务分析报告生成。

快速分析不再把单次 Top-K 片段直接交给模型。`EvidenceSelector` 根据数据集规模动态选择 12–30 个
独立文档，将分析目标拆为多条查询，合并混合检索结果后按 Document 去重，并结合目标内容类型、
平台代表性和内容类型代表性选取证据。`QuickReportGenerator` 将全量 Dataset Profile 与这些代表性
证据分别交给模型，最后由程序统一拼接数据边界、统计覆盖和引用元数据。

## 前端分析覆盖范围

快速报告在正文前展示独立的分析覆盖卡片，分别呈现：

- 数字统计覆盖：参与全量确定性统计的文档数、总文档数和覆盖率。
- 定性阅读覆盖：模型实际阅读的独立文档数、总文档数和覆盖率。
- 证据使用情况：代表文档数、证据片段数和正文实际引用文档数。
- 任务状态：采集进行中时明确标为阶段性分析，提醒结果可能继续变化。

覆盖卡片直接使用 `analysis_coverage` 当前结构，不读取旧字段或旧检索类型。

## Analyzer

Analyzer Registry 当前提供 `dataset.profile@1.0.0`，对 Workflow 的全部去重文档执行确定性统计，
生成平台、内容类型、关键词、主体类型、时间范围、字段覆盖率、数值指标和数据质量概况；
结果持久化到 `analysis_reports`，并作为快速分析报告的全量数字依据。
最终快速报告也以 `quick.report@1.0.0` 持久化，并记录 Profile 报告 ID、证据选择策略和引用来源。

## Exporter

Exporter Registry 当前提供：

- `markdown`
- `json`
- `obsidian`
- `ima`

Obsidian 输出 Vault、索引和 Frontmatter；IMA 输出 Markdown Sources 与 `manifest.json`。
导出记录保存在 `export_runs`。

用户在 Agent 中提出“导出 Obsidian / IMA / JSON / Markdown”时会直接选择对应 Exporter；
未指定格式时继续沿用现有 CSV 下载。

## API

- `GET /api/processors`
- `POST /api/documents/:document_id/process`
- `GET /api/documents/:document_id/versions`
- `GET /api/knowledge/retrieval-profile`
- `PUT /api/knowledge/retrieval-profile`
- `POST /api/knowledge/retrieval-profile/test`
- `POST /api/knowledge/rebuild`
- `GET /api/knowledge/search`
- `POST /api/knowledge/rag`
- `GET /api/analyzers`
- `POST /api/analyze`
- `GET /api/exporters`
- `POST /api/export`

## Schema

数据库 schema version 为 12。继续采用断代策略，不包含旧库迁移代码；旧版本数据库在打开时直接重建。
