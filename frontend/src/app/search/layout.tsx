import { PageShell } from "@/components/shared/page-shell"

export default function SearchLayout({ children }: LayoutProps<"/search">) {
  return <PageShell>{children}</PageShell>
}
