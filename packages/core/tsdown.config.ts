import { stamp } from '@kalup/tsconfig/stamp'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  // No source maps: the package ships no src/ for a map to point at, and the bundles are not minified, so a stack
  // trace in dist reads as it is. tsconfig's declarationMap would otherwise emit .d.mts.map files.
  dts: { sourcemap: false },
  // The CLI's contract tests import this dist and refuse one that was not built from the sources on disk. The bundle
  // inlines the IR schema, so schemas/ is an input.
  hooks: stamp(['src', 'schemas', 'tsdown.config.ts']),
})
