import { Logo } from "@/components/shared/logo"
import { ThemeToggle } from "@/components/shared/theme-toggle"

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <main className="relative flex flex-1 flex-col">
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <ThemeToggle />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        {/* Logo already renders a home link — don't wrap it in another. */}
        <Logo />
        <div className="mt-8 w-full max-w-sm">{children}</div>
      </div>
    </main>
  )
}
