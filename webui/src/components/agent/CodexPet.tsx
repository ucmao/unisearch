import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useThemeStore } from '@/store/themeStore'
import { getPetById } from '@/lib/pets'

export interface CodexPetProps {
  isComposerFocused?: boolean
  className?: string
  onInteract?: () => void
}

type PetState =
  | 'idle'
  | 'running-right'
  | 'running-left'
  | 'waving'
  | 'jumping'
  | 'failed'
  | 'waiting'
  | 'running'
  | 'review'

const GREETING_QUOTES_BY_PERIOD = {
  morning: [
    '早！今天也要元气满满 ( •̀ ω •́ )y',
    '早上好！随时准备干活～ (*ﾟｰﾟ*)',
    '早呀！来杯咖啡，准备开始探索！',
    '太阳晒屁股啦，算力已全部就绪 ☀️',
    '早安！今天想搜点什么新线索？',
    '清晨第一缕阳光，配上全网最快数据！',
    '叮！今日份探索能量已充满 (๑•̀ㅂ•́)و',
    '新的一天，让灵感在搜索里碰撞吧！',
  ],
  noon: [
    '中午好！饱饭后灵感更容易爆发～',
    '午间巡检中... 算力充沛！',
    '午休时间到，今天吃点什么好吃的？',
    '碳水拉满，大脑超频！下午继续冲～',
    '吃饱了才有力气挖高价值数据 (*ﾟ∀ﾟ*)',
    '午间雷达静默扫描中，一切平稳～',
    '饭后小憩一下，待会找数据更快哦！',
    '中午好呀！记得离开工位伸个懒腰 ₍ᐢ..ᐢ₎',
  ],
  afternoon: [
    '下午好！打起精神攻克难题 (ง •̀_•́)ง',
    '下午犯困了？想查的尽管交给我～',
    '午后灵感雷达在线... 随时叫我！',
    '困意退散！给你注入一剂数据强心针 ⚡',
    '喝口下午茶，剩下的复杂搜索交给我～',
    '下午效率巅峰期，今天目标必拿下！',
    '坐久了动一动，别让脖子抗议啦 (｡・ω・｡)',
    '正在为你过滤全网无用噪音，专注当下！',
  ],
  evening: [
    '晚上好！夜间探索模式已就绪 (｡•̀ᴗ-)✧',
    '今晚想研究点什么？算力不打烊！',
    '夜深了，一起搞定今天最后一个目标！',
    '披星戴月，你的研究搭子一直都在 ✨',
    '收工倒计时，让我们做最后的数据汇总～',
    '晚风很舒服，今天的探索收获满满吗？',
    '夜间安静，最适合深度洞察与思考啦 (´▽`)',
    '查完这一批，今天就早点休息吧！',
  ],
  midnight: [
    '发际线警告！查完早点休息哦 (つд⊂)',
    '夜深了，喝口水再继续吧 (*ﾟｰﾟ*)',
    '居然还在卷！算力今晚全程陪你 ⚡',
    '夜猫子出没！今晚的灵感我包了 (。-ω-)',
    '太拼了！明天记得对自己好一点哦～',
    '凌晨三点的赛博世界，只有你在闪闪发光 ✨',
    '算力随时在线，但你的身体更重要哦～',
    '乖，存个草稿，明早起来再继续！(｡•́︿•̀｡)',
  ],
}

const SPECIAL_DAY_GREETINGS = {
  monday: ['周一打工人，今天也要把数据挖穿 (๑•̀ㅂ•́)و'],
  friday: [
    '周五啦！算力已提前进入周末节能状态 (´▽`)',
    '疯狂周五！搞定这个查询就下班！🎉',
  ],
  weekend: [
    '周末加班辛苦啦，今天查点轻松好玩的吧～',
    '周末快乐！即使放假我也在后台随时待命 🎮',
  ],
}

const getDynamicGreeting = (): string => {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay()

  if (Math.random() < 0.3) {
    if (day === 1) {
      return SPECIAL_DAY_GREETINGS.monday[
        Math.floor(Math.random() * SPECIAL_DAY_GREETINGS.monday.length)
      ]
    }
    if (day === 5) {
      return SPECIAL_DAY_GREETINGS.friday[
        Math.floor(Math.random() * SPECIAL_DAY_GREETINGS.friday.length)
      ]
    }
    if (day === 0 || day === 6) {
      return SPECIAL_DAY_GREETINGS.weekend[
        Math.floor(Math.random() * SPECIAL_DAY_GREETINGS.weekend.length)
      ]
    }
  }

  let list = GREETING_QUOTES_BY_PERIOD.midnight
  if (hour >= 5 && hour < 11) list = GREETING_QUOTES_BY_PERIOD.morning
  else if (hour >= 11 && hour < 14) list = GREETING_QUOTES_BY_PERIOD.noon
  else if (hour >= 14 && hour < 18) list = GREETING_QUOTES_BY_PERIOD.afternoon
  else if (hour >= 18 && hour < 23) list = GREETING_QUOTES_BY_PERIOD.evening

  return list[Math.floor(Math.random() * list.length)]
}

const JUMP_QUOTES = [
  '( •̀ ω •́ )y 随时待命，今天搜点大的！',
  '戳我干嘛，遇到难题没灵感了？(｡・ω・｡)',
  '没事就戳我，是打算摸鱼唠嗑吗？( ´ー`)',
  '别戳啦，再戳电量都要被你点光啦！',
  '(ﾟДﾟ*) 哇！你的手速突破了我的采样率！',
  '被你戳得电量 +100%！(ง •̀_•́)ง',
  '痒痒的～快住手，我要笑场了 (≧∇≦)',
  '摸头变聪明，摸肚皮算力翻倍～',
  '再点我，我就把你的搜索记录吃掉 (｀・ω・´)',
  '捕捉到一只正在摸鱼的主人！(｡•̀ᴗ-)✧',
  '快给我派活！算力已经按捺不住了 (๑•̀ㅂ•́)و',
  '正在调集全网节点，随时听候差遣 ⚡',
  '深度洞察还是快速采集？我都能搞定～',
  '没在摸鱼！我正在后台疯狂计算中...',
  '全网数据大海捞针，我就是那块强力磁铁 🧲',
  '神经元连接完毕，随时准备深度分析！',
  '给我一个关键词，还你一整张知识图谱 📊',
  '算法跑得飞快，只为给你最准的答案！',
  '内存已清空，CPU 处于最佳状态 🚀',
  '眼睛酸了吗？看一眼窗外绿植吧 🌿',
  '喝水打卡时间到！咕噜咕噜 🥤',
  '难题解不开？先深呼吸，我们一步步来～',
  '你负责天马行空，我负责寻找依据！',
  '今天也在为你默默加油打气哦 (ง •̀_•́)ง',
  '保持专注，你比想象中更厉害 ✨',
  '颈椎运动：左看看，右看看，再看我！',
  '累了就放空一分钟，不丢人～',
  '小技巧：输入 @ 可以呼出专属技能哦！',
  '按 Enter 发送，Shift+Enter 换行哦～',
  '找不到想要的结果？试试换个同义词检索！',
  '小贴士：善用多维度筛选，命中率直线上升 🎯',
  '支持一键导出表格，汇报整理更轻松！',
  '点击侧边栏，可以快速切换不同数据源～',
  '试试在关键词间加空格进行精准组合查询！',
  '连点我三次，触发高能彩蛋形态 ✨',
]

const EASTER_EGG_QUOTES = [
  '⚡ 连招启动：审查 ➔ 跳跃庆祝！',
  '✨ 高能彩蛋触发，探索能量超频拉满！',
  '🚀 算力全开！硬核任务尽管交给我！',
  '(๑•̀ㅂ•́)و 审查完毕，准备一起探索！',
  '全核心就绪，下一条线索马上锁定 ⚡',
  '连续互动奖励：今日探索动力 +200%！',
  '彩蛋触发！给认真研究的你撒一把星光 ✨',
  '哔——高能特技已送达，请主人继续指示！',
  '默契值提升！复杂问题也能一起拆开解决～',
  '三连击认证完成：你是今天的最佳探索搭档！',
]

const PASTEL_CONFETTI_COLORS = [
  '#38bdf8',
  '#f472b6',
  '#fbbf24',
  '#34d399',
  '#a78bfa',
  '#fb7185',
  '#67e8f9',
]

interface SubtleConfettiParticle {
  x: number
  y: number
  vx: number
  vy: number
  width: number
  height: number
  color: string
  alpha: number
  decay: number
  rotation: number
  vRot: number
  shape: 'rect' | 'circle' | 'sparkle'
}

export const CodexPet: React.FC<CodexPetProps> = ({
  isComposerFocused = false,
  className = '',
  onInteract,
}) => {
  const petMode = useThemeStore((state) => state.petMode)
  const selectedPetId = useThemeStore((state) => state.selectedPetId)
  const currentPet = getPetById(selectedPetId)

  const [petState, setPetState] = useState<PetState>('idle')
  const [bubbleText, setBubbleText] = useState<string | null>(null)
  const [isEasterEggBubble, setIsEasterEggBubble] = useState(false)
  const [showGlowAura, setShowGlowAura] = useState(false)
  const [isEasterEggRunning, setIsEasterEggRunning] = useState(false)
  const [travelOffset, setTravelOffset] = useState<number>(0)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<SubtleConfettiParticle[]>([])
  const animFrameRef = useRef<number | null>(null)

  const isComposerFocusedRef = useRef(isComposerFocused)
  isComposerFocusedRef.current = isComposerFocused

  const actionTimerRef = useRef<number | null>(null)
  const welcomeTimerRef = useRef<number | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const pacingIntervalRef = useRef<number | null>(null)
  const auraTimerRef = useRef<number | null>(null)
  const easterEggTimeoutsRef = useRef<number[]>([])
  const clickCountRef = useRef<number>(0)
  const clickResetTimerRef = useRef<number | null>(null)
  const isEasterEggLockedRef = useRef<boolean>(false)

  // Show a temporary speech bubble (only on explicit user click / initial welcome / easter egg)
  const showBubble = useCallback(
    (text: string, durationMs = 2600, isEaster = false) => {
      if (petMode !== 'dynamic' || isComposerFocusedRef.current) {
        setBubbleText(null)
        setIsEasterEggBubble(false)
        return
      }
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
      setBubbleText(text)
      setIsEasterEggBubble(isEaster)
      bubbleTimerRef.current = window.setTimeout(() => {
        setBubbleText(null)
        setIsEasterEggBubble(false)
      }, durationMs)
    },
    [petMode]
  )

  // Trigger Subtle Translucent Colorful Confetti & Sparkles
  const fireSubtleCelebration = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = (canvas.width = 320)
    const height = (canvas.height = 240)
    const centerX = width / 2
    const centerY = height / 2

    const particles: SubtleConfettiParticle[] = []

    for (let i = 0; i < 26; i++) {
      const angle = (Math.PI * 2 * i) / 26 + (Math.random() - 0.5) * 0.35
      const speed = 1.2 + Math.random() * 2.6
      const shapes: ('rect' | 'circle' | 'sparkle')[] = ['rect', 'circle', 'sparkle']
      const shape = shapes[i % shapes.length]

      particles.push({
        x: centerX + (Math.random() - 0.5) * 24,
        y: centerY + (Math.random() - 0.5) * 18,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.9,
        width: 2.2 + Math.random() * 2.8,
        height: 2.6 + Math.random() * 3.2,
        color: PASTEL_CONFETTI_COLORS[Math.floor(Math.random() * PASTEL_CONFETTI_COLORS.length)],
        alpha: 0.6 + Math.random() * 0.15,
        decay: 0.013 + Math.random() * 0.011,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.14,
        shape,
      })
    }

    particlesRef.current = [...particlesRef.current.filter((p) => p.alpha > 0), ...particles]

    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)

    const render = () => {
      ctx.clearRect(0, 0, width, height)
      let activeCount = 0

      for (let i = 0; i < particlesRef.current.length; i++) {
        const p = particlesRef.current[i]
        if (p.alpha <= 0) continue
        activeCount++

        p.x += p.vx
        p.y += p.vy
        p.vx *= 0.965
        p.vy *= 0.975
        p.alpha -= p.decay
        p.rotation += p.vRot

        ctx.save()
        ctx.globalAlpha = Math.max(0, p.alpha)
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rotation)
        ctx.fillStyle = p.color
        ctx.shadowBlur = 3
        ctx.shadowColor = p.color

        if (p.shape === 'sparkle') {
          ctx.beginPath()
          const r = p.width * 1.2
          ctx.moveTo(0, -r)
          ctx.quadraticCurveTo(0, 0, r, 0)
          ctx.quadraticCurveTo(0, 0, 0, r)
          ctx.quadraticCurveTo(0, 0, -r, 0)
          ctx.fill()
        } else if (p.shape === 'circle') {
          ctx.beginPath()
          ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height)
        }

        ctx.restore()
      }

      if (activeCount > 0) {
        animFrameRef.current = requestAnimationFrame(render)
      } else {
        ctx.clearRect(0, 0, width, height)
      }
    }

    animFrameRef.current = requestAnimationFrame(render)
  }, [])

  // 1. Initial Mount / Home Visit: strictly once per mount, wait 600ms buffer, then 2.4s waiting (2 full cycles) + greeting
  useEffect(() => {
    if (petMode !== 'dynamic') {
      if (welcomeTimerRef.current) window.clearTimeout(welcomeTimerRef.current)
      if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
      if (auraTimerRef.current) window.clearTimeout(auraTimerRef.current)
      if (clickResetTimerRef.current) window.clearTimeout(clickResetTimerRef.current)
      easterEggTimeoutsRef.current.forEach((t) => window.clearTimeout(t))
      easterEggTimeoutsRef.current = []
      clickCountRef.current = 0
      isEasterEggLockedRef.current = false
      setIsEasterEggRunning(false)
      setShowGlowAura(false)
      setBubbleText(null)
      setIsEasterEggBubble(false)
      setTravelOffset(0)
      setPetState('idle')
      return
    }

    setPetState('idle')
    welcomeTimerRef.current = window.setTimeout(() => {
      if (isComposerFocusedRef.current) return

      setPetState('waiting')
      showBubble(getDynamicGreeting(), 2400)

      actionTimerRef.current = window.setTimeout(() => {
        setPetState((prev) => (prev === 'waiting' ? (isComposerFocusedRef.current ? 'running' : 'idle') : prev))
      }, 2400)
    }, 600)

    return () => {
      if (welcomeTimerRef.current) window.clearTimeout(welcomeTimerRef.current)
      if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
      if (auraTimerRef.current) window.clearTimeout(auraTimerRef.current)
      if (clickResetTimerRef.current) window.clearTimeout(clickResetTimerRef.current)
      easterEggTimeoutsRef.current.forEach((t) => window.clearTimeout(t))
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [petMode, showBubble])

  // 2. Focus change: when focused -> 'running' (cancel welcome and bubbles); when blurred -> 'idle' (NEVER re-welcomes)
  useEffect(() => {
    if (isComposerFocused) {
      if (welcomeTimerRef.current) window.clearTimeout(welcomeTimerRef.current)
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
      setBubbleText(null)
      setIsEasterEggBubble(false)
    }

    if (petMode !== 'dynamic' || isEasterEggLockedRef.current) return

    setPetState(isComposerFocused ? 'running' : 'idle')
  }, [isComposerFocused, petMode])

  // 3. Periodic random stroll / pacing in idle state (quiet, no bubbles)
  useEffect(() => {
    if (petMode !== 'dynamic') {
      setTravelOffset(0)
      return
    }

    pacingIntervalRef.current = window.setInterval(() => {
      setPetState((current) => {
        if (current === 'idle' && !isEasterEggLockedRef.current && !isComposerFocusedRef.current) {
          const direction = Math.random() > 0.5 ? 1 : -1
          const distance = direction * (12 + Math.floor(Math.random() * 10))
          setTravelOffset(distance)

          if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
          actionTimerRef.current = window.setTimeout(() => {
            setTravelOffset(0)
            setPetState(isComposerFocusedRef.current ? 'running' : 'idle')
          }, 3000)

          return direction < 0 ? 'running-left' : 'running-right'
        }
        return current
      })
    }, 22000)

    return () => {
      if (pacingIntervalRef.current) window.clearInterval(pacingIntervalRef.current)
    }
  }, [petMode])

  if (petMode === 'off') {
    return null
  }

  // Handle clicking on pet
  const handleClick = () => {
    if (isEasterEggLockedRef.current) {
      return
    }

    onInteract?.()

    if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)

    // Dynamic Mode: full interactions with quotes and 3-Click Easter Egg
    if (petMode === 'dynamic') {
      clickCountRef.current += 1
      if (clickResetTimerRef.current) window.clearTimeout(clickResetTimerRef.current)
      clickResetTimerRef.current = window.setTimeout(() => {
        clickCountRef.current = 0
      }, 900)

      // 3-Click Easter Egg: review + jumping combo
      if (clickCountRef.current >= 3) {
        clickCountRef.current = 0
        isEasterEggLockedRef.current = true
        setIsEasterEggRunning(true)
        setShowGlowAura(true)
        fireSubtleCelebration()

        easterEggTimeoutsRef.current.forEach((t) => window.clearTimeout(t))
        easterEggTimeoutsRef.current = []

        const easterEggQuote =
          EASTER_EGG_QUOTES[Math.floor(Math.random() * EASTER_EGG_QUOTES.length)]
        showBubble(easterEggQuote, 2000, true)

        // Stage 1 (0.0s ~ 1.2s): review (1 完整轮次 6 帧 = 1200ms)
        setPetState('review')

        // Stage 2 (1.2s ~ 2.0s): jumping (1 完整轮次 5 帧 = 800ms，落地完满)
        const t1 = window.setTimeout(() => {
          if (!isEasterEggLockedRef.current) return
          setPetState('jumping')
          fireSubtleCelebration()
        }, 1200)

        easterEggTimeoutsRef.current.push(t1)

        if (auraTimerRef.current) window.clearTimeout(auraTimerRef.current)
        auraTimerRef.current = window.setTimeout(() => {
          setShowGlowAura(false)
        }, 2000)

        actionTimerRef.current = window.setTimeout(() => {
          isEasterEggLockedRef.current = false
          setIsEasterEggRunning(false)
          setPetState(isComposerFocusedRef.current ? 'running' : 'idle')
        }, 2000)
        return
      }

      // Normal Click in Dynamic Mode: Jumping + cheerful interactive quote bubble
      setPetState('jumping')
      if (!isComposerFocusedRef.current) {
        const quote = JUMP_QUOTES[Math.floor(Math.random() * JUMP_QUOTES.length)]
        showBubble(quote, 2000)
      }
      actionTimerRef.current = window.setTimeout(() => {
        setPetState(isComposerFocusedRef.current ? 'running' : 'idle')
      }, 800)
    } else {
      // Quiet Mode (安静克制):
      // Only 3 interaction modes: 1. 正常待机 (Idle), 2. 悬浮挥手 (Hover), 3. 点击跳跃 (Click Jumping)
      // Strictly NO multi-click easter egg, NO review combo, NO bubbles, NO confetti/aura
      setPetState('jumping')
      actionTimerRef.current = window.setTimeout(() => {
        setPetState('idle')
      }, 800)
    }
  }

  const getStateClass = () => {
    switch (petState) {
      case 'running-right':
        return 'codex-pet--running-right'
      case 'running-left':
        return 'codex-pet--running-left'
      case 'waving':
        return 'codex-pet--waving'
      case 'jumping':
        return 'codex-pet--jumping'
      case 'failed':
        return 'codex-pet--failed'
      case 'waiting':
        return 'codex-pet--waiting'
      case 'running':
        return 'codex-pet--running'
      case 'review':
        return 'codex-pet--review'
      default:
        return ''
    }
  }

  return (
    <div className={`codex-pet-container ${className}`}>
      {/* Subtle Ambient Glow Aura (Easter Egg) */}
      {showGlowAura && <div className="codex-pet-glow-aura" />}

      {/* Subtle Translucent Confetti & Sparkles Canvas */}
      {petMode === 'dynamic' && (
        <canvas ref={canvasRef} className="codex-pet-canvas" width={320} height={240} />
      )}

      {/* Speech Bubble: strictly suppressed when composer is focused */}
      {petMode === 'dynamic' && !isComposerFocused && bubbleText && (
        <div
          className={`codex-pet-bubble ${
            isEasterEggBubble
              ? 'codex-pet-bubble--easter-egg'
              : 'border border-cyber-border-default/80 bg-cyber-bg-panel/95 text-cyber-text-primary backdrop-blur-md dark:border-white/10 dark:bg-zinc-900/95 dark:text-zinc-100'
          }`}
        >
          {bubbleText}
        </div>
      )}

      {/* Pet Character Sprite Button */}
      <button
        type="button"
        className={`codex-pet ${getStateClass()} ${isEasterEggRunning ? 'codex-pet--easter-egg cursor-default' : ''}`}
        onClick={handleClick}
        disabled={isEasterEggRunning}
        style={{
          backgroundImage: `url(${currentPet.spritesheetUrl})`,
          translate: `${travelOffset}px 0`,
        }}
        aria-label={`${currentPet.displayName} 智能宠物伴侣`}
      />

      {/* Ground Shadow */}
      <div
        className="codex-pet-shadow"
        style={{
          translate: `${travelOffset}px 0`,
        }}
      />
    </div>
  )
}
