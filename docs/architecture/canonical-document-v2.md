# Canonical Document v2 契约与映射矩阵

Canonical Document v2 是 Connector 与后续数据库批次之间唯一的标准化边界。Connector 仍可按平台原始字段发出 `RawItem`；所有别名必须在 mapper 中消化，查询层、UI 和知识库不得再次读取原始字段猜测业务含义。

## 固定字段分区

- 身份：`documentId`、`canonicalKey`、`kind`、`platform`、`originalPlatform`、`sourceItemId`、`parentSourceItemId`、`sourceUrl`
- 采集上下文：`keyword`、`rank`、`fetchedAt`、`provenance`
- 文本：`title`、`summary`、`markdown`、`language`
- 主体：`subject.id`、`subject.name`、`subject.type`
- 时间：`publishedAt`、`sourceUpdatedAt`
- 扩展：`metrics`、`attributes`、`assets`、`citations`

缺失指标必须省略，不能用 `0` 表示“不适用”。`raw_payload_json` 继续无损保存，但不属于 Canonical Document 的业务查询接口。

## Connector 家族映射

| 家族 / Connector | 主体类型 | 摘要规则 | metrics | attributes / 资源 |
|---|---|---|---|---|
| 社媒：xhs、douyin、kuaishou、bili、weibo | creator | 平台摘要或正文截断 | likes、saves、comments、shares、views；B站增加 coins、danmaku | 标签及媒体进入 attributes/assets |
| 贴吧：tieba | creator | 正文截断 | likes、comments 等实际存在指标 | forumName、forumUrl；贴吧不是作者主体 |
| 知乎：zhihu | creator | 正文截断 | likes/comments，赞同另存 voteups | questionId、sourceUpdatedAt |
| 搜索：baidu、bing、so360、sogou、toutiao | publisher | snippet/excerpt | 无社媒指标 | domain、rank、结果图片 |
| AI：deepseek、kimi、doubao、qwen、yuanbao、nami、wenxin | ai_platform | 最终回答截断 | 无社媒指标 | reasoningContent 暂存 attributes，citations 独立；知识批次默认排除 reasoningContent |
| 招聘：zhaopin | company | 薪资 · 城市 · 经验 · 学历 · 公司 | 无社媒指标 | salary、city、experience、education、rank |
| 投诉：heimao | merchant | 商家 · 状态 · 金额 · 诉求 | 无社媒指标 | status、amount、request、rank |
| 解析：media_parser | creator | 文案截断 | 无社媒指标 | 原平台进入 originalPlatform；视频、图片、音频进入 assets |
| 评论：所有社媒 | creator | 评论正文截断 | likes、replies 等实际存在指标 | parentId 标准化为 parentSourceItemId，后续写入关系表 |

## 关键约束

1. Manifest 描述标准化后的逻辑输出，raw alias 仅存在于 mapper。
2. `summary` 使用确定性规则生成，采集阶段不调用模型。
3. 需要筛选、排序或统计的值必须进入固定字段、`metrics` 或 `attributes`，不能只拼接到正文。
4. 媒体和引用分别进入 `assets`、`citations`，不使用逗号分隔字符串作为标准形态。
5. 数据库已一次性切换到 v2；不存在 v1 双写、旧字段回读或旧库迁移。

## v2 持久化边界

- `documents` 保存当前 Canonical Document，固定字段独立成列，扩展字段分别保存为 `metrics_json`、`attributes_json` 和 `citations_json`。
- `document_versions` 保存完整的 Canonical Document 快照；业务内容未变化时，重复采集不会制造新版本。
- `document_sources` 保存每次采集证据并绑定当时的版本，因此历史执行不会被后续指标覆盖。
- `raw_payload_json` 只用于溯源与诊断，Document Engine、Analytics API、UI 和知识库不得从中推断标准字段。
- schema version 不匹配时直接删除旧 schema 并重建，不执行迁移。

Analytics API 使用 `/api/data/analytics/documents` 和 `/api/data/analytics/summary`。查询、过滤、排序和聚合只依赖 Canonical Document；指标排序使用 `metrics.<key>`，缺失指标保持缺失。
