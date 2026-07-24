import { skillDefinitionSchema, type SkillDefinition } from '../core/skills/types';

export class SkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  register(value: SkillDefinition): void {
    const skill = skillDefinitionSchema.parse(value);
    if (this.skills.has(skill.id)) throw new Error(`Skill already registered: ${skill.id}`);
    this.skills.set(skill.id, skill);
  }

  get(id: string): SkillDefinition {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Unknown Skill: ${id}`);
    return skill;
  }

  list(): SkillDefinition[] {
    return [...this.skills.values()];
  }
}

export const skillRegistry = new SkillRegistry();

skillRegistry.register({
  id: 'multi-source-research',
  version: '1.0.0',
  name: '多来源资料采集',
  description: '从一个或多个 Connector 获取资料，并统一归一化为 Document。',
  inputs: [
    { key: 'platforms', required: true, description: '目标 Connector 列表' },
    { key: 'keywords', required: false, description: '关键词列表' },
    { key: 'targets', required: false, description: '详情、主体或 URL 目标' },
    { key: 'capability', required: true, description: 'Connector Capability' },
  ],
  workflow: {
    connectorCapabilities: ['keyword_search', 'content_detail', 'creator_profile', 'comments', 'url_resolve'],
    itemProcessors: ['metadata.normalize', 'document.clean_markdown'],
    analyzers: ['knowledge.index', 'extractive.summary'],
    exporters: ['markdown', 'json', 'obsidian', 'ima'],
    outputs: ['documents'],
  },
});

skillRegistry.register({
  id: 'media-to-knowledge',
  version: '1.0.0',
  name: '媒体转知识文档',
  description: '下载媒体、提取音轨、语音转写并建立知识索引。',
  inputs: [
    { key: 'documentIds', required: true, description: '待处理 Document ID 列表' },
  ],
  workflow: {
    connectorCapabilities: [],
    itemProcessors: ['asset.download', 'ffmpeg.extract_audio', 'whisper.transcribe'],
    analyzers: ['knowledge.index'],
    exporters: ['markdown', 'obsidian', 'ima'],
    outputs: ['documents', 'transcripts', 'knowledge_chunks'],
  },
});
