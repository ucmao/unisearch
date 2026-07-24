# UniSearch 第四阶段：Processor、Analyzer、Exporter 与 RAG

## 完整知识链路

```text
Connector
  -> RawItem
  -> Document Engine
  -> Document Version
  -> Processor Worker
  -> Chunk
  -> SQLite FTS + Local Embedding
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
- `document_chunk_embeddings` 保存 256 维本地哈希嵌入。
- 混合检索通过倒数排名融合合并全文与向量结果。
- 每个研究 Workflow 在 Document 处理结束后自动执行索引步骤。

本地哈希嵌入不需要模型下载，适合作为离线基线。未来接入外部或 ONNX Embedding 时只需要新增
Embedding Provider，不改变 Chunk、检索或 RAG API。

## RAG

`POST /api/knowledge/rag` 返回：

- 带 `[S1]`、`[S2]` 标记的回答。
- Document ID、来源平台、原始 URL、摘录和相关度。
- 未配置模型 API Key 时返回最相关片段，不假装生成 AI 答案。

Agent 对已完成任务执行“分析这些结果”时直接使用该混合检索链路，并把来源列表写入消息元数据。

## Analyzer

Analyzer Registry 当前提供 `extractive.summary@1.0.0`，生成来源分布、高频主题和代表性资料，
结果持久化到 `analysis_reports`。

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
- `POST /api/knowledge/index/rebuild`
- `GET /api/knowledge/search`
- `POST /api/knowledge/rag`
- `GET /api/analyzers`
- `POST /api/analyze`
- `GET /api/exporters`
- `POST /api/export`

## Schema

数据库 schema version 为 5。继续采用断代策略，不包含旧库迁移代码。
