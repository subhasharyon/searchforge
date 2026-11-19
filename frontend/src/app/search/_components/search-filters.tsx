import { Check } from "lucide-react"
import Link from "next/link"
import { cn } from "cn"

import { buildSearchHref, type SearchUrlParams } from "@/lib/search-url"
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CONTENT_TYPES,
} from "@/types/search"
import { TextFilter } from "./text-filter"

function FilterSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="px-2 text-xs font-medium tracking-wide text-muted-foreground/80 uppercase">
        {title}
      </h3>
      <div className="mt-1.5 space-y-0.5">{children}</div>
    </section>
  )
}

function FilterOption({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      )}
    >
      <span
        className={cn(
          "grid size-3.5 shrink-0 place-items-center rounded-[4px] border transition-colors",
          active
            ? "border-brand bg-brand text-brand-foreground"
            : "border-border group-hover:border-foreground/30"
        )}
        aria-hidden
      >
        {active ? <Check className="size-2.5" strokeWidth={3} /> : null}
      </span>
      <span className="capitalize">{label}</span>
    </Link>
  )
}

function EnumFilterSection<T extends string>({
  title,
  param,
  values,
  current,
  params,
}: {
  title: string
  param: "category" | "contentType"
  values: readonly T[]
  current: T | undefined
  params: SearchUrlParams
}) {
  return (
    <FilterSection title={title}>
      {values.map((value) => (
        <FilterOption
          key={value}
          label={value}
          active={current === value}
          href={buildSearchHref({
            ...params,
            [param]: current === value ? undefined : value,
            page: undefined,
          })}
        />
      ))}
    </FilterSection>
  )
}

export function SearchFilters({ params }: { params: SearchUrlParams }) {
  return (
    <div>
      <EnumFilterSection
        title="Category"
        param="category"
        values={DOCUMENT_CATEGORIES}
        current={params.category}
        params={params}
      />
      <EnumFilterSection
        title="Content type"
        param="contentType"
        values={DOCUMENT_CONTENT_TYPES}
        current={params.contentType}
        params={params}
      />
      <FilterSection title="Source">
        <div className="px-2">
          <TextFilter
            key={params.source ?? ""}
            name="source"
            value={params.source ?? ""}
            params={params}
            placeholder="e.g. mdn, react, docker"
          />
        </div>
      </FilterSection>
      <FilterSection title="Technology">
        <div className="px-2">
          <TextFilter
            key={params.technology ?? ""}
            name="technology"
            value={params.technology ?? ""}
            params={params}
            placeholder="e.g. react, mongodb"
          />
        </div>
      </FilterSection>
    </div>
  )
}
