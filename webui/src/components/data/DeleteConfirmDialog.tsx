import { useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface DeleteConfirmDialogProps {
  trigger: ReactNode
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => Promise<unknown> | unknown
  children?: ReactNode
}

export function DeleteConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = '确认删除',
  onConfirm,
  children,
}: DeleteConfirmDialogProps) {
  const [open, setOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const confirm = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
      setOpen(false)
    } catch {
      // The caller owns error reporting; keep the dialog open for retry.
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !isDeleting && setOpen(value)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-md">
        <div className="mx-auto h-16 w-16 overflow-hidden rounded-full border border-cyber-neon-cyan/20 bg-cyber-bg-tertiary shadow-[0_0_24px_rgba(34,211,238,0.12)]" aria-hidden="true">
          <img src="/icon-circle.png" alt="" className="h-full w-full object-cover" />
        </div>
        <DialogHeader className="text-center sm:text-center">
          <DialogTitle className="text-cyber-neon-pink">{title}</DialogTitle>
          <DialogDescription className="pt-2 leading-6">{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>取消</Button>
          <Button variant="destructive" onClick={confirm} disabled={isDeleting}>
            {isDeleting ? <Loader2 className="animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
