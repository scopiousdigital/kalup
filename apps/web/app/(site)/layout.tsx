import { SiteFooter, SiteNav } from '@/components/site/chrome'
import { Rails } from '@/components/site/primitives'

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <header className="relative z-20 bg-paper">
        <div className="wrap relative">
          <Rails marks={false} />
          <div className="relative">
            <SiteNav />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
      <SiteFooter />
    </>
  )
}
