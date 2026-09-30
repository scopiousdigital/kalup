// The AGENTS.md block init writes: the apply rules an agent needs, and the website quotes it word for word.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { agentsBlock } from '../../../src/lib/templates/agents.js'

const pages = fileURLToPath(new URL('../../../../../apps/web/content/docs/', import.meta.url))
const BLOCK = /^<!-- kalup:start v1 -->\n[\s\S]*?^<!-- kalup:end -->\n/m

function rule(n: number): string {
  return (
    agentsBlock('hubspot')
      .split('\n')
      .find((line) => line.startsWith(`${n}. `)) ?? ''
  )
}

test('rule 3 lets an agent pass --yes only after the user said yes to the plan, and never --approve', () => {
  expect(rule(3)).toContain('Pass `--yes` only after')
  expect(rule(3)).toContain('read the plan and said yes')
  expect(rule(3)).toContain('Never pass `--approve`')
  expect(rule(3)).toContain('exits 4, stop')
})

test('rule 4 tells an agent that exit 5 means plan again and never apply again on its own', () => {
  expect(rule(4)).toContain('Exit 5')
  expect(rule(4)).toContain('`npx --no-install kalup plan --json`')
  expect(rule(4)).toContain('never apply again')
})

// --approve refuses a target with no credentials.write of its own, so a one-key project's key may live in .env.
test('rule 6 keeps only a key named in credentials.write out of this machine, not every write key', () => {
  expect(rule(6)).toContain('`credentials.write`')
  expect(rule(6)).toContain("only in the target's CI environment")
  expect(rule(6)).not.toContain("a target's write key belongs only in its CI environment")
})

test('the website pages that quote the block quote it word for word', () => {
  for (const page of ['commands/init.mdx', 'guides/working-with-agents.mdx']) {
    expect(readFileSync(`${pages}${page}`, 'utf8').match(BLOCK)?.[0], page).toBe(agentsBlock('hubspot'))
  }
})
