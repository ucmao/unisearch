import { Monitor, Moon, Settings2, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useThemeStore } from '@/store/themeStore'

type Theme = 'light' | 'dark' | 'system'

const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '跟随系统', icon: Monitor },
]

export function SettingsDialog({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useThemeStore()

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`h-10 w-full text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary ${compact ? 'justify-center px-0' : 'justify-start gap-3 px-3'}`}
          title="设置"
        >
          <Settings2 className="h-4 w-4" />
          {!compact && <span className="text-sm">设置</span>}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
          <DialogDescription>调整应用的外观与使用偏好。</DialogDescription>
        </DialogHeader>

        <div className="mt-2 flex items-center justify-between gap-6 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/60 p-4">
          <div>
            <div className="text-sm font-medium text-cyber-text-primary">外观主题</div>
            <div className="mt-1 text-xs text-cyber-text-muted">选择界面的明暗显示方式</div>
          </div>
          <Select value={theme} onValueChange={(value: Theme) => setTheme(value)}>
            <SelectTrigger className="h-9 w-32 shrink-0 border-cyber-border-subtle bg-cyber-bg-tertiary/50 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themes.map(({ value, label, icon: Icon }) => (
                <SelectItem key={value} value={value} className="text-xs">
                  <div className="flex items-center gap-2">
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </DialogContent>
    </Dialog>
  )
}
