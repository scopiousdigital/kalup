import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The live journeys run only under vitest.live.config.ts (pnpm test:live).
    exclude: [...configDefaults.exclude, '**/*.live.test.ts'],
    // Every test file gets its own portal lock directory, so no test takes a lock under ~/.kalup and files that run at
    // once never see each other's locks.
    setupFiles: ['test/support/locks.ts'],
    // Many tests start the built binary, biome or tsc; shared CI runners are slower than a laptop.
    testTimeout: 30_000,
  },
})
