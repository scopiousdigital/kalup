import { stamp } from '@kalup/tsconfig/stamp'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  // No source maps: nothing ships this dist on its own. The kalup CLI bundles it, and the bundles are not minified, so a
  // stack trace reads as it is. tsconfig's declarationMap would otherwise emit .d.mts.map files.
  dts: { sourcemap: false },
  // The CLI bundles this dist and its contract tests refuse one that was not built from the sources on disk. The
  // validators inline the JSON Schemas, so schemas/ is an input.
  hooks: stamp(['src', 'schemas', 'tsdown.config.ts']),
})
