import { generateOGImage } from 'fumadocs-ui/og'
import { notFound } from 'next/navigation'
import { getPageImageUrl } from '@/lib/shared'
import { source } from '@/lib/source'

export const revalidate = false

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params
  const page = source.getPage(slug.slice(0, -1))
  if (!page) notFound()

  return generateOGImage({
    title: page.data.title,
    description: page.data.description,
    site: 'kalup.dev',
    // Kalup's molten orange and the logo, in place of Fumadocs' purple and book
    primaryColor: 'rgba(255,128,0,0.35)',
    primaryTextColor: 'rgb(255,128,0)',
    icon: (
      <svg width="56" height="56" viewBox="0 0 26 26" aria-hidden="true">
        <rect x="1.5" y="1.5" width="23" height="23" fill="none" stroke="#f0f0eb" strokeWidth="2.4" />
        <rect x="6" y="13" width="14" height="7" fill="#ff8000" />
      </svg>
    ),
  })
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }))
}
