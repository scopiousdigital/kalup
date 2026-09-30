// pnpm hooks. beforePacking runs for `pnpm pack` and `pnpm publish`: the published kalup and @kalup/core manifests
// leave out devDependencies, which name workspace packages that are never published (@kalup/engine, @kalup/tsconfig).
'use strict'

module.exports = {
  hooks: {
    beforePacking(pkg) {
      const { devDependencies: _, ...published } = pkg
      return published
    },
  },
}
