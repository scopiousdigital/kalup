import { RootProvider } from 'fumadocs-ui/provider/next'
import './global.css'
import type { Metadata } from 'next'
import { Big_Shoulders, Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import { ogImage, siteUrl } from '@/lib/shared'

// Variable with the optical size axis: browsers pick opsz from the font size, so big headlines get the Display cut.
const display = Big_Shoulders({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-big-shoulders',
  adjustFontFallback: false,
})
const sans = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' })

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'Kalup: configuration as code for HubSpot', template: '%s · Kalup' },
  description:
    'Keep HubSpot properties in TypeScript. Kalup shows every change as a plan, applies the plan you approve to the portal you name, and holds edits made in the UI.',
  // Each page's og:title and og:description come from its own title and description.
  openGraph: { type: 'website', siteName: 'Kalup', images: [ogImage] },
  twitter: { card: 'summary_large_image' },
}

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} font-sans`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ enabled: false }}>{children}</RootProvider>
      </body>
    </html>
  )
}
