import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Every test file gets its own portal lock directory, so no test takes a lock under ~/.kalup and files that run at
  // once never see each other's locks.
  test: { setupFiles: ['test/support/locks.ts'] },
})
