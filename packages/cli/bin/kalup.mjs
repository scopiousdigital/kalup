#!/usr/bin/env node
// The bin that npm and pnpm link. It is committed, so pnpm links it at install time in a fresh clone, before dist
// exists, and it runs the built CLI.
import { existsSync } from 'node:fs'

const entry = new URL('../dist/index.mjs', import.meta.url)

if (existsSync(entry)) {
  await import(entry.href)
} else {
  process.stderr.write('kalup is not built: run pnpm build first\n')
  process.exitCode = 1
}
