import {
  Atom,
  Braces,
  Cog,
  Container,
  Database,
  Layers,
  Ship,
  Wind,
} from "lucide-react"
import Link from "next/link"

import { FadeIn } from "@/components/shared/fade-in"
import { SearchBox } from "@/components/shared/search-box"
import { SiteFooter } from "@/components/shared/site-footer"
import { SiteHeader } from "@/components/shared/site-header"

const suggestedSearches = [
  "react server actions",
  "postgres jsonb indexing",
  "docker layer caching",
  "kubernetes readiness probe",
]

const technologies = [
  { name: "React", icon: Atom },
  { name: "TypeScript", icon: Braces },
  { name: "Next.js", icon: Layers },
  { name: "Tailwind CSS", icon: Wind },
  { name: "PostgreSQL", icon: Database },
  { name: "Kubernetes", icon: Ship },
  { name: "Docker", icon: Container },
  { name: "Rust", icon: Cog },
]

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="relative flex flex-1 flex-col">
        <div
          aria-hidden
          className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-105"
        />
        <section className="relative mx-auto flex w-full max-w-3xl flex-col items-center px-4 pt-24 pb-20 text-center sm:px-6 sm:pt-32 sm:pb-24">
          <FadeIn>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden />
              Technical search, reimagined
            </span>
          </FadeIn>
          <FadeIn delay={0.06} className="mt-6">
            <h1 className="text-4xl font-semibold tracking-tighter text-balance text-foreground sm:text-5xl md:text-6xl">
              Every technical answer, <span className="text-brand">one search away.</span>
            </h1>
          </FadeIn>
          <FadeIn delay={0.12} className="mt-5">
            <p className="max-w-xl text-base leading-7 text-pretty text-muted-foreground sm:text-lg sm:leading-8">
              SearchForge indexes documentation, engineering guides, and
              developer resources — so you find precise answers, not a wall of
              links.
            </p>
          </FadeIn>
          <FadeIn delay={0.18} className="mt-9 w-full max-w-2xl">
            <SearchBox />
          </FadeIn>
          <FadeIn delay={0.24} className="mt-5">
            <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
              <span className="text-muted-foreground">Try:</span>
              {suggestedSearches.map((query) => (
                <Link
                  key={query}
                  href={`/search?q=${encodeURIComponent(query)}`}
                  className="rounded-full border border-border/60 bg-card/60 px-3 py-1 text-muted-foreground transition-colors outline-none hover:border-border hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {query}
                </Link>
              ))}
            </div>
          </FadeIn>
        </section>
        <section className="relative border-t border-border/60">
          <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6">
            <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
              Popular technologies
            </p>
            <ul className="mt-5 flex flex-wrap gap-2.5">
              {technologies.map(({ name, icon: Icon }) => (
                <li key={name}>
                  <Link
                    href={`/search?q=${encodeURIComponent(name.toLowerCase())}`}
                    className="group inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground/80 transition-colors outline-none hover:border-brand/40 hover:bg-accent hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <Icon
                      className="size-4 text-muted-foreground transition-colors group-hover:text-brand"
                      aria-hidden
                    />
                    {name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
