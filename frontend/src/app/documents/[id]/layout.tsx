import { PageShell } from "@/components/shared/page-shell"

export default function DocumentLayout({
  children,
}: LayoutProps<"/documents/[id]">) {
  return <PageShell>{children}</PageShell>
}
