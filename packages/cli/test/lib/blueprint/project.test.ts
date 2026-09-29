// Where blueprint resources land: the issues that stop an add or upgrade before anything is placed.
import type { Blueprint, Loaded } from '@kalup/core'
import { expect, test } from 'vitest'
import { refIssues } from '../../../src/lib/blueprint/project.js'
import type { Issue } from '../../../src/lib/output.js'

test('E_BLUEPRINT_REF quotes the group sanitized and capped, whatever text reaches it', () => {
  const group = `group:deals/x\u001b[31mRED\u202e${'X'.repeat(3000)}`
  const blueprint = {
    resources: { 'property:deals/renewal_date': { type: 'property', definition: { group: { $ref: group } } } },
  } as unknown as Blueprint
  const [issue] = refIssues({ ir: { resources: {} } } as unknown as Loaded, blueprint) as [Issue]
  expect(issue.code).toBe('E_BLUEPRINT_REF')
  for (const text of [issue.message, String(issue.fix)]) {
    expect(text).not.toContain('\u001b')
    expect(text).not.toContain('\u202e')
    expect(Array.from(text).length).toBeLessThanOrEqual(500)
  }
  expect(issue.message.startsWith('property:deals/renewal_date is in group group:deals/xREDXXX')).toBe(true)
})
