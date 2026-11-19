import { Logo } from "@/components/shared/logo"

export function SiteFooter() {
  return (
    <footer className="border-t border-border/60">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-sm text-muted-foreground">
            Technical search for engineering teams
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          &copy; 2026 SearchForge. All rights reserved.
        </p>
      </div>
    </footer>
  )
}
