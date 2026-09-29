import { stamp } from '@kalup/tsconfig/stamp'
import { defineConfig } from 'tsdown'

export default defineConfig({
  // index: the executable. config: the library entry, which never loads the CLI or oclif. commands: the module
  // oclif's explicit discovery imports. host: the runner, imported by the contract tests without the executable.
  entry: {
    index: 'src/index.ts',
    config: 'src/config.ts',
    commands: 'src/host/commands.ts',
    host: 'src/host/host.ts',
  },
  format: 'esm',
  // No source maps: the package ships no src/ for a map to point at, and the bundles are not minified, so a stack
  // trace in dist reads as it is. tsconfig's declarationMap would otherwise emit .d.mts.map files.
  dts: { sourcemap: false },
  // The contract tests run dist, and refuse one that was not built from the sources on disk. testing.ts is their
  // helper, never bundled, so editing it needs no rebuild.
  hooks: stamp(['src', '!src/commands/testing.ts', 'tsdown.config.ts']),
})
