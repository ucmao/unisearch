import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useThemeStore } from '@/store/themeStore'

export interface CodexPetProps {
  isComposerFocused?: boolean
  hasInput?: boolean
  className?: string
  onInteract?: () => void
}

type PetState =
  | 'greeting'
  | 'idle'
  | 'sleep'
  | 'thinking'
  | 'walk'
  | 'cool'
  | 'celebrate'
  | 'cool-walk'

const GREETING_QUOTES_BY_PERIOD = {
  morning: [
    '早！今天也要元气满满 ( •̀ ω •́ )y',
    '早上好！随时准备干活～ (*ﾟｰﾟ*)',
    '早呀！来杯咖啡，准备开始探索！',
  ],
  noon: [
    '中午好！饱饭后灵感更容易爆发～',
    '午间巡检中... 算力充沛！',
    '午休时间到，今天吃点什么好吃的？',
  ],
  afternoon: [
    '下午好！打起精神攻克难题 (ง •̀_•́)ง',
    '下午犯困了？想查的尽管交给我～',
    '午后灵感雷达在线... 随时叫我！',
  ],
  evening: [
    '晚上好！夜间探索模式已就绪 (｡•̀ᴗ-)✧',
    '今晚想研究点什么？算力不打烊！',
    '夜深了，一起搞定今天最后一个目标！',
  ],
  midnight: [
    '发际线警告！查完早点休息哦 (つд⊂)',
    '夜深了，喝口水再继续吧 (*ﾟｰﾟ*)',
    '居然还在卷！算力今晚全程陪你 ⚡',
    '夜猫子出没！今晚的灵感我包了 (。-ω-)',
    '太拼了！明天记得对自己好一点哦～',
  ],
}

const getDynamicGreeting = (): string => {
  const hour = new Date().getHours()
  let list = GREETING_QUOTES_BY_PERIOD.midnight
  if (hour >= 5 && hour < 11) list = GREETING_QUOTES_BY_PERIOD.morning
  else if (hour >= 11 && hour < 14) list = GREETING_QUOTES_BY_PERIOD.noon
  else if (hour >= 14 && hour < 18) list = GREETING_QUOTES_BY_PERIOD.afternoon
  else if (hour >= 18 && hour < 23) list = GREETING_QUOTES_BY_PERIOD.evening

  return list[Math.floor(Math.random() * list.length)]
}

const CELEBRATE_QUOTES = [
  '( •̀ ω •́ )y 随时待命，今天搜点大的！',
  '戳我干嘛，遇到难题没灵感了？(｡・ω・｡)',
  '没事就戳我，是打算摸鱼唠嗑吗？( ´ー`)',
  '别戳啦，再戳电量都要被你点光啦！',
  '小技巧：输入 @ 可以呼出专属技能哦！',
  '快给我派活！算力已经按捺不住了 (๑•̀ㅂ•́)و',
  '按 Enter 发送，Shift+Enter 换行哦～',
  '(ﾟДﾟ*) 哇！你的手速突破了我的采样率！',
  '被你戳得电量 +100%！(ง •̀_•́)ง',
  '正在调集全网节点，随时听候差遣 ⚡',
  '深度洞察还是快速采集？我都能搞定～',
  '没在摸鱼！我正在后台疯狂计算中...',
]

const EASTER_EGG_QUOTES = [
  '(⌐■_■) 别摸啦，墨镜都要被点歪啦！',
  '(⌐■_■) 纯帅！颜值与算力双超频～',
  '⚡ 哎呀，被你点出隐藏形态了～',
  '(⌐■_■) 别看啦，这个姿势我练了很久！',
  '✨ 极客形态全开！硬核任务尽管砸过来！',
]

const WAKEUP_QUOTES = [
  '(ﾟДﾟ)！我没睡！只是在闭目检索数据！',
  '唔... (つд⊂) 伸个懒腰，准备干活！',
  '休眠模式解除！随时听候差遣 (•̀ᴗ•́)و',
]

// Translucent pastel celebration palette (subtle, colorful, non-intrusive)
const PASTEL_CONFETTI_COLORS = [
  '#38bdf8', // Sky Cyan
  '#f472b6', // Pastel Rose Pink
  '#fbbf24', // Champagne Amber
  '#34d399', // Mint Emerald
  '#a78bfa', // Soft Lavender
  '#fb7185', // Coral Peach
  '#67e8f9', // Electric Ice Cyan
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
  hasInput = false,
  className = '',
  onInteract,
}) => {
  const petMode = useThemeStore((state) => state.petMode)

  const [petState, setPetState] = useState<PetState>('idle')
  const [bubbleText, setBubbleText] = useState<string | null>(null)
  const [isEasterEggBubble, setIsEasterEggBubble] = useState(false)
  const [showGlowAura, setShowGlowAura] = useState(false)
  const [isEasterEggRunning, setIsEasterEggRunning] = useState(false)
  const [walkOffset, setWalkOffset] = useState<number>(0)
  const [walkFacingLeft, setWalkFacingLeft] = useState<boolean>(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<SubtleConfettiParticle[]>([])
  const animFrameRef = useRef<number | null>(null)

  const idleTimerRef = useRef<number | null>(null)
  const actionTimerRef = useRef<number | null>(null)
  const bubbleTimerRef = useRef<number | null>(null)
  const pacingIntervalRef = useRef<number | null>(null)
  const auraTimerRef = useRef<number | null>(null)
  const confettiWaveTimerRef = useRef<number | null>(null)
  const clickCountRef = useRef<number>(0)
  const clickResetTimerRef = useRef<number | null>(null)
  const isEasterEggLockedRef = useRef<boolean>(false)

  // Show a temporary speech bubble (only in dynamic mode)
  const showBubble = useCallback(
    (text: string, durationMs = 2600, isEaster = false) => {
      if (petMode !== 'dynamic') {
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

    // 26 subtle, compact, translucent micro-confetti flakes & sparkles
    for (let i = 0; i < 26; i++) {
      const angle = (Math.PI * 2 * i) / 26 + (Math.random() - 0.5) * 0.35
      const speed = 1.2 + Math.random() * 2.6
      const shapes: ('rect' | 'circle' | 'sparkle')[] = ['rect', 'circle', 'sparkle']
      const shape = shapes[i % shapes.length]

      particles.push({
        x: centerX + (Math.random() - 0.5) * 24,
        y: centerY + (Math.random() - 0.5) * 18,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.9, // Gentle float upwards
        width: 2.2 + Math.random() * 2.8,
        height: 2.6 + Math.random() * 3.2,
        color: PASTEL_CONFETTI_COLORS[Math.floor(Math.random() * PASTEL_CONFETTI_COLORS.length)],
        alpha: 0.6 + Math.random() * 0.15, // Translucent and soft
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
          // Delicate 4-point sparkle star
          ctx.beginPath()
          const r = p.width * 1.2
          ctx.moveTo(0, -r)
          ctx.quadraticCurveTo(0, 0, r, 0)
          ctx.quadraticCurveTo(0, 0, 0, r)
          ctx.quadraticCurveTo(0, 0, -r, 0)
          ctx.quadraticCurveTo(0, 0, 0, -r)
          ctx.fill()
        } else if (p.shape === 'circle') {
          ctx.beginPath()
          ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          // Micro confetti flake
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

  // Reset the 30-second idle-to-sleep timer (only in dynamic mode)
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
    if (petMode !== 'dynamic') return

    idleTimerRef.current = window.setTimeout(() => {
      setPetState((prev) => {
        if (prev === 'idle') {
          return 'sleep'
        }
        return prev
      })
    }, 30000)
  }, [petMode])

  // Wake up if sleeping or reset idle state
  const wakeUp = useCallback(() => {
    if (petMode !== 'dynamic' || isEasterEggLockedRef.current) return
    setPetState((prev) => {
      if (prev === 'sleep') {
        const quote = WAKEUP_QUOTES[Math.floor(Math.random() * WAKEUP_QUOTES.length)]
        showBubble(quote, 2000)
        return 'idle'
      }
      return prev
    })
    resetIdleTimer()
  }, [petMode, resetIdleTimer, showBubble])

  // Lifecycle: Greeting on mount (0.6s smile preparation -> 1 gentle complete wave cycle of 2.4s + bubble for 2.4s -> total 3.0s)
  useEffect(() => {
    if (petMode !== 'dynamic') {
      setPetState('idle')
      setBubbleText(null)
      return
    }

    setPetState('idle')
    // After 0.6s (600ms) initial smile preparation: start 1 single gentle wave cycle (2.4s) and pop bubble for 2.4s
    const greetingStartTimer = window.setTimeout(() => {
      setPetState('greeting')
      showBubble(getDynamicGreeting(), 2400)

      actionTimerRef.current = window.setTimeout(() => {
        setPetState((prev) => (prev === 'greeting' ? 'idle' : prev))
        resetIdleTimer()
      }, 2400)
    }, 600)

    return () => {
      window.clearTimeout(greetingStartTimer)
      if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
      if (bubbleTimerRef.current) window.clearTimeout(bubbleTimerRef.current)
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current)
      if (auraTimerRef.current) window.clearTimeout(auraTimerRef.current)
      if (confettiWaveTimerRef.current) window.clearTimeout(confettiWaveTimerRef.current)
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    }
  }, [petMode, resetIdleTimer, showBubble])

  // Periodic random stroll / pacing in idle state (only in dynamic mode)
  useEffect(() => {
    if (petMode !== 'dynamic') {
      setWalkOffset(0)
      setWalkFacingLeft(false)
      return
    }

    pacingIntervalRef.current = window.setInterval(() => {
      setPetState((current) => {
        if (current === 'idle' && !isEasterEggLockedRef.current) {
          const direction = Math.random() > 0.5 ? 1 : -1
          const distance = direction * (12 + Math.floor(Math.random() * 10))
          setWalkFacingLeft(direction < 0)
          setWalkOffset(distance)

          if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)
          actionTimerRef.current = window.setTimeout(() => {
            setWalkOffset(0)
            setWalkFacingLeft(false)
            setPetState('idle')
            resetIdleTimer()
          }, 3000)

          return 'walk'
        }
        return current
      })
    }, 22000)

    return () => {
      if (pacingIntervalRef.current) window.clearInterval(pacingIntervalRef.current)
    }
  }, [petMode, resetIdleTimer])

  // Handle composer focus / input changes
  useEffect(() => {
    if (isComposerFocused || hasInput) {
      wakeUp()
      setPetState((prev) => {
        if (prev === 'celebrate' || prev === 'cool-walk' || isEasterEggLockedRef.current || (prev === 'greeting' && petMode === 'dynamic')) {
          return prev
        }
        return 'thinking'
      })
    } else {
      setPetState((prev) => {
        if (prev === 'thinking' && !isEasterEggLockedRef.current) {
          resetIdleTimer()
          return 'idle'
        }
        return prev
      })
    }
  }, [isComposerFocused, hasInput, petMode, wakeUp, resetIdleTimer])

  // If pet is disabled entirely, render nothing
  if (petMode === 'off') {
    return null
  }

  // Handle clicking on pet
  const handleClick = () => {
    // If Easter Egg animation is currently in progress, clicks are locked
    if (isEasterEggLockedRef.current) {
      return
    }

    wakeUp()
    onInteract?.()

    // Multi-click / easter egg detection
    clickCountRef.current += 1
    if (clickResetTimerRef.current) window.clearTimeout(clickResetTimerRef.current)
    clickResetTimerRef.current = window.setTimeout(() => {
      clickCountRef.current = 0
    }, 900)

    if (actionTimerRef.current) window.clearTimeout(actionTimerRef.current)

    if (clickCountRef.current >= 3 && petMode === 'dynamic') {
      // Trigger Easter Egg: Lock clicks until cycle completes (3.2s)
      clickCountRef.current = 0
      isEasterEggLockedRef.current = true
      setIsEasterEggRunning(true)
      setPetState('cool-walk')
      setShowGlowAura(true)
      fireSubtleCelebration()

      // Second gentle wave of micro-confetti sparkles at 1.4s
      if (confettiWaveTimerRef.current) window.clearTimeout(confettiWaveTimerRef.current)
      confettiWaveTimerRef.current = window.setTimeout(() => {
        if (isEasterEggLockedRef.current) {
          fireSubtleCelebration()
        }
      }, 1400)

      const easterEggQuote =
        EASTER_EGG_QUOTES[Math.floor(Math.random() * EASTER_EGG_QUOTES.length)]
      showBubble(easterEggQuote, 3200, true)

      if (auraTimerRef.current) window.clearTimeout(auraTimerRef.current)
      auraTimerRef.current = window.setTimeout(() => {
        setShowGlowAura(false)
      }, 3200)

      actionTimerRef.current = window.setTimeout(() => {
        isEasterEggLockedRef.current = false
        setIsEasterEggRunning(false)
        setPetState(isComposerFocused || hasInput ? 'thinking' : 'idle')
        resetIdleTimer()
      }, 3200)
    } else {
      // Normal click: Celebrate jump
      setPetState('celebrate')
      if (petMode === 'dynamic') {
        const quote = CELEBRATE_QUOTES[Math.floor(Math.random() * CELEBRATE_QUOTES.length)]
        showBubble(quote, 2000)
      }
      actionTimerRef.current = window.setTimeout(() => {
        setPetState(isComposerFocused || hasInput ? 'thinking' : 'idle')
        resetIdleTimer()
      }, 800)
    }
  }

  // Get state modifier CSS class
  const getStateClass = () => {
    switch (petState) {
      case 'greeting':
        return 'codex-pet--greeting'
      case 'sleep':
        return 'codex-pet--sleep'
      case 'thinking':
        return 'codex-pet--thinking'
      case 'walk':
        return 'codex-pet--walk'
      case 'cool':
        return 'codex-pet--cool'
      case 'celebrate':
        return 'codex-pet--celebrate'
      case 'cool-walk':
        return 'codex-pet--cool-walk'
      default:
        return ''
    }
  }

  return (
    <div
      className={`codex-pet-container ${className}`}
      onMouseMove={wakeUp}
      onMouseEnter={wakeUp}
    >
      {/* Subtle Ambient Glow Aura (Easter Egg) */}
      {showGlowAura && <div className="codex-pet-glow-aura" />}

      {/* Subtle Translucent Confetti & Sparkles Canvas */}
      {petMode === 'dynamic' && (
        <canvas ref={canvasRef} className="codex-pet-canvas" width={320} height={240} />
      )}

      {/* Speech Bubble / Thought Banner */}
      {petMode === 'dynamic' && bubbleText && (
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

      {/* Floating zZ animation when asleep (only in dynamic mode) */}
      {petMode === 'dynamic' && petState === 'sleep' && (
        <div className="codex-pet-zzz select-none" aria-hidden="true">
          zZ
        </div>
      )}

      {/* Pet Character Sprite Button */}
      <button
        type="button"
        className={`codex-pet ${getStateClass()} ${isEasterEggRunning ? 'cursor-default' : ''}`}
        onClick={handleClick}
        disabled={isEasterEggRunning}
        style={{
          transform: `translateX(${walkOffset}px) scaleX(${walkFacingLeft ? -1 : 1})`,
        }}
        aria-label="UniSearch 智能宠物伴侣"
        title={
          isEasterEggRunning
            ? '宠物彩蛋触发中 🕶️'
            : petState === 'sleep'
            ? '小宠物正在打瞌睡，点击唤醒'
            : petState === 'thinking'
            ? '正在构思您的搜索与分析...'
            : '摸摸我 (连续点击有惊喜)'
        }
      />

      {/* Ground Shadow */}
      <div
        className="codex-pet-shadow"
        style={{
          transform: `translateX(${walkOffset}px)`,
        }}
      />
    </div>
  )
}
