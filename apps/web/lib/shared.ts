import { createGetUrl } from 'fumadocs-core/source'

export const appName = 'kalup'
export const siteUrl = 'https://kalup.dev'
export const ogImage = { url: '/og.png', width: 1280, height: 640, alt: 'Kalup: configuration as code for HubSpot' }
export const docsRoute = '/docs'
export const docsImageRoute = '/og/docs'
export const docsContentRoute = '/llms.mdx/docs'

export const gitConfig = {
  user: 'scopiousdigital',
  repo: 'kalup',
  branch: 'main',
}

const getContentUrl = createGetUrl(docsContentRoute)

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'content.md']

  return { segments, url: getContentUrl(segments, page.locale) }
}

const getImageUrl = createGetUrl(docsImageRoute)

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, 'image.png']

  return { segments, url: getImageUrl(segments, page.locale) }
}
