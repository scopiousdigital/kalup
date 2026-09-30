import { defineConfig } from 'vitest/config'

// The live journeys (*.live.test.ts), run by `pnpm test:live` and never by `pnpm test`. Against HubSpot they run one
// file at a time, to stay inside the portal's rate limit and leave each journey the portal to itself; against the
// simulator (KALUP_LIVE_BACKEND=sim) each file has its own, so they run at once.
const simulated = process.env.KALUP_LIVE_BACKEND === 'sim'
const timeout = simulated ? 60_000 : 600_000

export default defineConfig({
  test: {
    include: ['test/**/*.live.test.ts'],
    setupFiles: ['test/support/locks.ts', 'test/e2e/live-setup.ts'],
    fileParallelism: simulated,
    testTimeout: timeout,
    hookTimeout: timeout,
  },
})
