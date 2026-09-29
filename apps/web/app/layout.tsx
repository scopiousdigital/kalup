import { RootProvider } from 'fumadocs-ui/provider/next'
import './global.css'
import type { Metadata } from 'next'
import { Big_Shoulders, Instrument_Sans, JetBrains_Mono } from 'next/font/google'

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
  title: { default: 'Kalup: configuration as code for HubSpot', template: '%s · Kalup' },
  description:
    'Describe HubSpot properties and objects in TypeScript. Kalup reads any portal you name, shows every change as a plan, and applies the plan you approve to properties and property groups. Not released yet: it runs from a source checkout.',
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
