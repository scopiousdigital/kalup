import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Writer tests start biome on the written files; shared CI runners are slower than a laptop.
    testTimeout: 30_000,
  },
})
