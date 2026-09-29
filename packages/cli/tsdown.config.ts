import { stamp } from '@kalup/tsconfig/stamp'
import { defineConfig } from 'tsdown'

export default defineConfig({
  // index: the executable. commands: the module oclif's explicit discovery imports. host: the runner, imported by the
  // contract tests without the executable.
  entry: {
    index: 'src/index.ts',
    commands: 'src/host/commands.ts',
    host: 'src/host/host.ts',
  },
  format: 'esm',
  // No source maps: the package ships no src/ for a map to point at, and the bundles are not minified, so a stack
  // trace in dist reads as it is. tsconfig's declarationMap would otherwise emit .d.mts.map files. Declarations come
  // from tsconfig.build.json, src alone: the tests import the engine's test support, and a program that included them
  // would write .d.ts files next to those sources.
  dts: { sourcemap: false, tsconfig: 'tsconfig.build.json' },
  // @kalup/engine is private and never published, so it is inlined: a devDependency is bundled by default. The output
  // may import only the runtime dependencies and Node's built-ins, so an engine import fails the build.
  deps: { onlyImport: ['@kalup/core', '@oclif/core'] },
  // The JSON contract schemas describe what the CLI writes, so they ship here as kalup/schemas/<file>.
  copy: [{ from: '../engine/schemas/*.json', to: 'dist/schemas' }],
  // The contract tests run dist, and refuse one that was not built from the sources on disk. testing.ts is their
  // helper, never bundled, so editing it needs no rebuild. The engine's stamp stands for the engine dist this build
  // inlines and the schemas it copies, so a rebuilt engine makes this dist stale too.
  hooks: stamp([
    'src',
    '!src/commands/testing.ts',
    'tsdown.config.ts',
    'tsconfig.build.json',
    '../engine/dist/build-stamp.json',
  ]),
})
