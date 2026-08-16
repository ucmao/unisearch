export interface PetDefinition {
  id: string
  name: string
  displayName: string
  tagline: string
  description: string
  spritesheetUrl: string
}

export const PETS_REGISTRY: PetDefinition[] = [
  {
    id: 'unisearch-bot',
    name: 'UniSearch Bot',
    displayName: '探索精灵',
    tagline: 'UniSearch 默认探索机器人伙伴',
    description: '陪伴你完成全网深度采集、图谱分析与灵感探索的专属像素助手。',
    spritesheetUrl: '/assets/pets/unisearch-bot/spritesheet.webp',
  },
  {
    id: 'warhorn',
    name: 'Warhorn',
    displayName: '战角',
    tagline: '坚毅沉稳的迷你牛头人战士',
    description: '头顶威武巨角与紫纹战甲，充满战斗意志与突破困境的探索力。',
    spritesheetUrl: '/assets/pets/warhorn/spritesheet.webp',
  },
  {
    id: 'han-li',
    name: 'Han Li',
    displayName: '韩立',
    tagline: '仙风道骨的求索修真道友',
    description: '青衫束发、手持青竹小剑，沉着冷静，一步一个脚印探寻真理。',
    spritesheetUrl: '/assets/pets/han-li/spritesheet.webp',
  },
  {
    id: 'sakura',
    name: 'Sakura',
    displayName: '樱花',
    tagline: '灵动优雅的汉服樱花小公主',
    description: '粉发罗裙、持花饰油纸伞，轻盈跃动，为枯燥的数据搜索带来春意。',
    spritesheetUrl: '/assets/pets/sakura/spritesheet.webp',
  },
  {
    id: 'fortune-koi',
    name: 'Fortune Koi',
    displayName: '福运锦鲤',
    tagline: '红袍金元宝，锦鲤随行福气满满',
    description: '身披喜庆红袍、骑乘福气橙色锦鲤，每次检索都能收获锦囊好运。',
    spritesheetUrl: '/assets/pets/fortune-koi/spritesheet.webp',
  },
  {
    id: 'bajie',
    name: 'Bajie',
    displayName: '八戒',
    tagline: '憨态可掬的青袍小猪战士',
    description: '身穿青色道袍，手持精巧小九齿钉耙，呆萌乐天，摸鱼工作两相宜。',
    spritesheetUrl: '/assets/pets/bajie/spritesheet.webp',
  },
  {
    id: 'anubis',
    name: 'Anubis',
    displayName: '阿努比斯',
    tagline: '黄金法老冠冕的埃及守护神',
    description: '身披黄金法老战铠与锁链重腕，神圣威严，时刻守护你的知识库。',
    spritesheetUrl: '/assets/pets/anubis/spritesheet.webp',
  },
  {
    id: 'shadebird',
    name: 'Shadebird',
    displayName: '墨镜鸟',
    tagline: '酷感十足的超大黑超墨镜蓝鸟',
    description: '戴着冷酷黑超墨镜的蓝色小鸟，神态从容，雷达全开敏锐锁定线索。',
    spritesheetUrl: '/assets/pets/shadebird/spritesheet.webp',
  },
]

export const DEFAULT_PET_ID = 'unisearch-bot'

export function getPetById(id?: string): PetDefinition {
  if (!id) return PETS_REGISTRY[0]
  return PETS_REGISTRY.find((pet) => pet.id === id) || PETS_REGISTRY[0]
}
