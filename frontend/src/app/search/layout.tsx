import { SiteFooter } from "@/components/shared/site-footer"
import { SiteHeader } from "@/components/shared/site-header"

export default function SearchLayout({ children }: LayoutProps<"/search">) {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter />
    </>
  )
}
