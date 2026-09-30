import type { Metadata } from 'next'
import { SiteFooter, SiteHeader } from '@/components/site/chrome'
import { MissingPage } from './_components/missing-page'

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This page is not on kalup.dev. Go to the home page or the docs.',
}

// Catches notFound() from the docs, outside the (site) group, so it brings the site header and footer itself.
export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <MissingPage />
      </main>
      <SiteFooter />
    </>
  )
}
