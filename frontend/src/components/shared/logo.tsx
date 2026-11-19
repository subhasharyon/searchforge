import { Search } from "lucide-react"
import Link from "next/link"
import { cn } from "cn"

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      aria-label="SearchForge home"
      className={cn(
        "inline-flex items-center gap-2 rounded-md outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className
      )}
    >
      <span className="grid size-6.5 shrink-0 place-items-center rounded-md bg-brand text-brand-foreground shadow-xs">
        <Search className="size-3.5" strokeWidth={2.5} aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        Search<span className="text-muted-foreground">Forge</span>
      </span>
    </Link>
  )
}
