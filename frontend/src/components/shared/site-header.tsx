import Link from "next/link"

import { Logo } from "@/components/shared/logo"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { Button } from "@/components/ui/button"
import { logoutAction } from "@/lib/actions/auth"
import { getSession } from "@/lib/session"

export async function SiteHeader() {
  const session = await getSession()
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
          {session ? (
            <>
              <span className="hidden max-w-40 truncate px-1 text-sm text-muted-foreground sm:inline">
                {session.user.name}
              </span>
              <form action={logoutAction}>
                <Button
                  type="submit"
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                >
                  Sign out
                </Button>
              </form>
            </>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href="/login" />}
              className="text-muted-foreground"
            >
              Sign in
            </Button>
          )}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  )
}
