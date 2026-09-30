import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/shared'
import { source } from '@/lib/source'

const MARKETING = [
  '/',
  '/how-it-works',
  '/use-cases/agencies',
  '/use-cases/developers',
  '/use-cases/agents',
  '/compare',
  '/coverage',
  '/roadmap',
  '/open-source',
]

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = [...MARKETING, ...source.getPages().map((page) => page.url)]
  return paths.map((path) => ({ url: `${siteUrl}${path === '/' ? '' : path}` }))
}
