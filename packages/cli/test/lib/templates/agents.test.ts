// The AGENTS.md block init writes: the apply rules an agent needs, and the website quotes it word for word.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { agentsBlock } from '../../../src/lib/templates/agents.js'

const pages = fileURLToPath(new URL('../../../../../apps/web/content/docs/', import.meta.url))
const BLOCK = /^<!-- kalup:start v1 -->\n[\s\S]*?^<!-- kalup:end -->\n/m

function rule(n: number): string {
  return agentsBlock.split('\n').find((line) => line.startsWith(`${n}. `)) ?? ''
}

test('rule 3 lets an agent pass --yes only after the user said yes to the plan, and never --approve', () => {
  expect(rule(3)).toContain('Pass `--yes` only after the user has read the plan and said yes to it.')
  expect(rule(3)).toContain('Never pass `--approve`')
  expect(rule(3)).toContain('when a command exits 4, stop and show the user the command it prints')
})

test('rule 4 tells an agent that exit 5 means plan again and never apply again on its own', () => {
  expect(rule(4)).toContain(
    'Exit 5 means an apply stopped part way: run `npx --no-install kalup plan --json`, show the user what is left, and never apply again without their review.',
  )
})

// --approve refuses a target with no credentials.write of its own, so a one-key project's key may live in .env.
test('rule 6 keeps only a key named in credentials.write out of this machine, not every write key', () => {
  expect(rule(6)).toContain(
    "A key a target names in `credentials.write` satisfies `--approve` when a shell on this machine exports it, so keep that key only in the target's CI environment.",
  )
  expect(rule(6)).not.toContain("a target's write key belongs only in its CI environment")
})

test('the website pages that quote the block quote it word for word', () => {
  for (const page of ['commands/init.mdx', 'guides/working-with-agents.mdx']) {
    expect(readFileSync(`${pages}${page}`, 'utf8').match(BLOCK)?.[0], page).toBe(agentsBlock)
  }
})
