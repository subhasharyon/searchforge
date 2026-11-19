import Link from "next/link"

import { Logo } from "@/components/shared/logo"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { Button } from "@/components/ui/button"

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <nav aria-label="Main" className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href="/search" />}
            className="text-muted-foreground"
          >
            Search
          </Button>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}
