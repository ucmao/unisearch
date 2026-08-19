import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[60px] w-full rounded-md border border-cyber-border-DEFAULT bg-cyber-bg-tertiary px-3 py-2 text-sm text-cyber-text-primary ring-offset-background placeholder:text-cyber-text-muted focus-visible:outline-none focus-visible:border-cyber-neon-cyan focus-visible:shadow-[0_0_10px_rgb(var(--cyber-neon-cyan)/0.2)] disabled:cursor-not-allowed disabled:opacity-50 transition-all',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = 'Textarea'

export { Textarea }
