import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { baseOptions } from '@/lib/layout.shared'
import { source } from '@/lib/source'

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      sidebar={{
        footer: (
          <p className="mt-3 text-xs leading-snug text-fd-muted-foreground">
            Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by,
            or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.
          </p>
        ),
      }}
    >
      {children}
    </DocsLayout>
  )
}
