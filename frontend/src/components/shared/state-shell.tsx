import type { LucideIcon } from "lucide-react"

export function StateShell({
  icon: Icon,
  title,
  message,
  children,
}: {
  icon: LucideIcon
  title: string
  message: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center pt-14 pb-6 text-center">
      <span className="grid size-12 place-items-center rounded-xl border border-border bg-card text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h2 className="mt-5 text-xl font-semibold tracking-tight text-balance text-foreground">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-pretty text-muted-foreground">
        {message}
      </p>
      {children}
    </div>
  )
}
