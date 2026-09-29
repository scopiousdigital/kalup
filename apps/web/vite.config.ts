import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { cdnAdapter } from '@vinext/cloudflare/cache/cdn-adapter'
import { kvDataAdapter } from '@vinext/cloudflare/cache/kv-data-adapter'
import { imagesOptimizer } from '@vinext/cloudflare/images/images-optimizer'
import { fumadocsMdx } from 'fumadocs-mdx/vite'
import vinext from 'vinext'
import { defineConfig } from 'vite'

// The vinext build for Cloudflare Workers. `next dev` and `next build` keep using next.config.mjs.
export default defineConfig({
  // Tailwind runs as a Vite plugin here; postcss.config.mjs stays for the Next build only.
  css: { postcss: {} },
  plugins: [
    // compiles content/docs and the `fumadocs-mdx/macro` call in lib/source.ts, like createMDX does for Next
    fumadocsMdx(),
    tailwindcss(),
    vinext({
      prerender: { routes: '*' },
      // the llms.txt, .mdx and OG image routes are cached forever (revalidate = false)
      cache: {
        cdn: cdnAdapter(),
        data: kvDataAdapter(),
      },
      images: {
        optimizer: imagesOptimizer(),
      },
    }),
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
})
