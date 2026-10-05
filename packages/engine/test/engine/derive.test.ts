import { expect, test } from 'vitest'
import {
  deleteBlock,
  deriveChange,
  fieldOf,
  type StepContext,
  stepLabels,
  stepRisk,
  WRITABLE,
  writeBlock,
} from '../../src/engine/derive.js'
import type { UnitClass, UnitResult } from '../../src/plan/classify.js'
import type { PlanChange, PlanStep } from '../../src/plan/types.js'

const unit = (cls: UnitClass, name = 'label'): UnitResult => ({ unit: name, class: cls, desired: 'a', observed: 'b' })

// class, drift policy, taken: disposition, reverts-ui-edit.
test.each([
  ['converged', 'hold', false, 'none', false],
  ['converged', 'overwrite', true, 'none', false],
  ['config-change', 'hold', false, 'write', false],
  ['add', 'hold', false, 'write', false],
  ['remove', 'hold', false, 'write', false],
  ['keep', 'hold', false, 'note', false],
  ['keep', 'overwrite', true, 'note', false],
  ['drift', 'hold', false, 'hold', false],
  ['drift', 'hold', true, 'write', true],
  ['drift', 'overwrite', false, 'write', true],
  ['conflict', 'hold', false, 'hold', false],
  ['conflict', 'hold', true, 'write', true],
  ['conflict', 'overwrite', false, 'write', true],
  // No base: drift overwrite has nothing to overwrite, only a person's take or adopt: 'overwrite' writes it.
  ['diverged', 'hold', false, 'hold', false],
  ['diverged', 'overwrite', false, 'hold', false],
  ['diverged', 'hold', true, 'write', true],
] as const)('deriveChange: %s under %s, taken %s, is %s (reverts %s)', (cls, drift, taken, disposition, reverts) => {
  expect(deriveChange(unit(cls), { drift }, taken)).toEqual({ class: cls, disposition, reverts })
})

test("deriveChange: adopt: 'overwrite' writes a diverged unit, and nothing else it would hold", () => {
  const policy = { drift: 'hold', adopt: 'overwrite' } as const
  expect(deriveChange(unit('diverged'), policy, false)).toEqual({
    class: 'diverged',
    disposition: 'write',
    reverts: true,
  })
  expect(deriveChange(unit('drift'), policy, false)).toMatchObject({ disposition: 'hold' })
  expect(deriveChange(unit('conflict'), policy, false)).toMatchObject({ disposition: 'hold' })
})

function step(action: PlanStep['action'], changes: Partial<PlanChange>[] = [], risk: PlanStep['risk'] = 'safe') {
  return {
    id: 's1',
    address: 'property:companies/yield_tier',
    action,
    risk,
    transport: 'public-api',
    title: 'a title the derivation never reads',
    expect: {},
    changes: changes.map((c) => ({ unit: 'label', class: 'config-change', op: 'set', before: 'a', after: 'b', ...c })),
  } as PlanStep
}

const hold: StepContext = { drift: 'hold' }
const overwrite: StepContext = { drift: 'overwrite' }
const created: StepContext = { drift: 'hold', owner: { origin: 'created' } }
const adopted: StepContext = { drift: 'hold', owner: { origin: 'adopted' } }

// step, context: risk, labels.
test.each([
  ['a create', step('create'), hold, 'safe', []],
  ['a create of what state owns: a take recreates it', step('create'), created, 'risky', ['reverts-ui-edit']],
  ['a delete of a created resource', step('delete'), created, 'destructive', []],
  ['a delete of an adopted resource', step('delete'), adopted, 'destructive', ['existed-before-kalup']],
  ['a release', step('release'), adopted, 'safe', []],
  ['a blocked step', step('delete', [], 'blocked'), adopted, 'blocked', []],
  ['an adopt with nothing written', step('adopt'), hold, 'safe', []],
  ['an update setting a label', step('update', [{}]), hold, 'safe', []],
  ['an update adding an option', step('update', [{ class: 'add', op: 'add', unit: 'options[x]' }]), hold, 'safe', []],
  [
    'an update removing an option',
    step('update', [{ class: 'remove', op: 'remove', unit: 'options[x]' }]),
    hold,
    'risky',
    [],
  ],
  ['an update setting fieldType', step('update', [{ unit: 'fieldType' }]), hold, 'risky', []],
  ['a taken drift', step('update', [{ class: 'drift' }]), hold, 'risky', ['reverts-ui-edit']],
  ['a taken conflict', step('update', [{ class: 'conflict' }]), hold, 'risky', ['reverts-ui-edit']],
  ['a taken diverged unit on an adopt', step('adopt', [{ class: 'diverged' }]), hold, 'risky', ['overwrites-portal']],
  [
    'an overwritten drift keeps its own risk',
    step('update', [{ class: 'drift' }]),
    overwrite,
    'safe',
    ['reverts-ui-edit'],
  ],
  [
    'an overwritten conflict keeps its own risk',
    step('update', [{ class: 'conflict' }]),
    overwrite,
    'safe',
    ['reverts-ui-edit'],
  ],
  [
    'an overwritten drift that removes an option is risky for the remove',
    step('update', [{ class: 'drift' }, { class: 'remove', op: 'remove', unit: 'options[x]' }]),
    overwrite,
    'risky',
    ['reverts-ui-edit'],
  ],
  [
    'a diverged unit under overwrite is a take',
    step('update', [{ class: 'diverged' }]),
    overwrite,
    'risky',
    ['overwrites-portal'],
  ],
  [
    'a drift and a diverged unit written together',
    step('update', [{ class: 'drift' }, { class: 'diverged', unit: 'description' }]),
    hold,
    'risky',
    ['reverts-ui-edit', 'overwrites-portal'],
  ],
  [
    'an option takeover removes is destructive',
    step('update', [{ class: 'remove', op: 'remove', unit: 'options[x]' }]),
    { drift: 'hold', takeoverUnits: new Set(['options[x]']) },
    'destructive',
    ['takeover'],
  ],
  [
    'an option removedOptions removes under takeover stays risky',
    step('update', [{ class: 'remove', op: 'remove', unit: 'options[x]' }]),
    { drift: 'hold', takeoverUnits: new Set(['options[y]']) },
    'risky',
    [],
  ],
  [
    'a formula change is risky, as a fieldType change is',
    step('update', [{ class: 'config-change', unit: 'calculationFormula' }]),
    hold,
    'risky',
    [],
  ],
  [
    'display and order changes are safe',
    step('update', [
      { class: 'config-change', unit: 'numberDisplayHint' },
      { class: 'config-change', unit: 'displayOrder' },
      { class: 'config-change', unit: 'hidden' },
    ]),
    hold,
    'safe',
    [],
  ],
  ['a takeover archive', step('delete'), { drift: 'hold', takeover: true }, 'destructive', ['takeover']],
  [
    'a takeover archive of an adopted resource',
    step('delete'),
    { ...adopted, takeover: true },
    'destructive',
    ['takeover', 'existed-before-kalup'],
  ],
] as const)('stepRisk and stepLabels: %s', (_, s, context, risk, labels) => {
  expect(stepRisk(s, context)).toBe(risk)
  expect(stepLabels(s, context)).toEqual(labels)
})

test('stepRisk and stepLabels trust the classes they are given over the classes a plan file states', () => {
  const stated = step('update', [{ class: 'config-change' }])
  const trusted: StepContext = { drift: 'hold', classes: { label: 'drift' } }
  expect(stepRisk(stated, hold)).toBe('safe')
  expect(stepRisk(stated, trusted)).toBe('risky')
  expect(stepLabels(stated, trusted)).toEqual(['reverts-ui-edit'])
})

test.each([
  ['label', 'label'],
  ['options[low]', 'options'],
  ['options[low].label', 'options'],
  ['options.order', 'options'],
  ['group', 'group'],
])('fieldOf(%s) is %s', (name, field) => {
  expect(fieldOf(name)).toBe(field)
})

test('the write matrix: a property every field HubSpot updates; a group its label; an object all but its name', () => {
  expect([...WRITABLE.property].sort()).toEqual([
    'calculationFormula',
    'currencyPropertyName',
    'description',
    'displayOrder',
    'fieldType',
    'formField',
    'group',
    'hidden',
    'label',
    'numberDisplayHint',
    'options',
    'showCurrencySymbol',
    'textDisplayHint',
  ])
  expect([...WRITABLE.group]).toEqual(['label'])
  expect([...WRITABLE.object]).toEqual([
    'labels',
    'description',
    'primaryDisplayProperty',
    'requiredProperties',
    'searchableProperties',
    'secondaryDisplayProperties',
  ])
})

const migration =
  'change the builder to match the portal, or migrate: create a new property, copy the values over, point what uses this one at the new one, then run kalup rm on this one'

// kind, units, written, flags: the block, or undefined.
test.each([
  ['nothing written', 'property', [unit('converged')], [], undefined, undefined],
  [
    'a type difference, held or not',
    'property',
    [{ unit: 'type', class: 'diverged', desired: 'number', observed: 'string' }],
    [],
    undefined,
    { short: 'type differs', detail: 'config has type "number" and the portal "string"', fix: migration },
  ],
  [
    'type and hasUniqueValue',
    'property',
    [
      { unit: 'hasUniqueValue', class: 'config-change', desired: true, observed: false },
      { unit: 'type', class: 'drift', desired: 'number', observed: 'string' },
    ],
    ['hasUniqueValue'],
    undefined,
    {
      short: 'hasUniqueValue and type differ',
      detail: expect.stringMatching(
        /hasUniqueValue true and the portal false; .*type "number" and the portal "string"/,
      ),
      fix: migration,
    },
  ],
  [
    'a dataSensitivity difference, which HubSpot keeps whatever a PATCH says',
    'property',
    [{ unit: 'dataSensitivity', class: 'config-change', desired: 'sensitive', observed: 'non_sensitive' }],
    ['dataSensitivity'],
    undefined,
    {
      short: 'dataSensitivity differs',
      detail: 'config has dataSensitivity "sensitive" and the portal "non_sensitive"',
      fix: migration,
    },
  ],
  [
    'a p.owner config over an enumeration HubSpot does not fill',
    'property',
    [
      { unit: 'externalOptions', class: 'diverged', desired: true, observed: null },
      { unit: 'referencedObjectType', class: 'diverged', desired: 'OWNER', observed: null },
    ],
    [],
    undefined,
    { short: 'externalOptions and referencedObjectType differ', detail: expect.any(String), fix: migration },
  ],
  ['a group writing its label', 'group', [unit('config-change')], ['label'], undefined, undefined],
  [
    'a group writing anything else',
    'group',
    [unit('config-change', 'displayOrder')],
    ['displayOrder'],
    undefined,
    {
      short: 'no update for it',
      detail: 'HubSpot has no update for displayOrder',
      fix: 'change config to match the portal',
    },
  ],
  [
    'a read-only definition and a label write',
    'property',
    [unit('config-change')],
    ['label'],
    { readOnlyDefinition: true },
    {
      short: 'read-only definition',
      detail: expect.stringContaining('label cannot be written'),
      fix: 'change config to match the portal',
    },
  ],
  [
    'a read-only definition and an option add',
    'property',
    [unit('add', 'options[x]')],
    ['options[x]'],
    { readOnlyDefinition: true },
    undefined,
  ],
  [
    'read-only options and an option add',
    'property',
    [unit('add', 'options[x]')],
    ['options[x]', 'options.order'],
    { readOnlyOptions: true },
    {
      short: 'read-only options',
      detail: expect.stringContaining('options[x], options.order cannot be written'),
      fix: 'change config to match the portal',
    },
  ],
  [
    'read-only options and a label write',
    'property',
    [unit('config-change')],
    ['label'],
    { readOnlyOptions: true },
    undefined,
  ],
  ['read-only flags and nothing written', 'property', [unit('drift')], [], { readOnlyDefinition: true }, undefined],
] as const)('writeBlock: %s', (_, kind, units, written, flags, block) => {
  const meta = flags === undefined ? undefined : { sensitivity: 'non_sensitive' as const, modificationMetadata: flags }
  expect(writeBlock(kind, [...units] as UnitResult[], [...written], meta)).toEqual(block)
})

test('writeBlock: turning showCurrencySymbol off is blocked once the portal held any currencyPropertyName, empty included', () => {
  const off: UnitResult = { unit: 'showCurrencySymbol', class: 'config-change', desired: false, observed: true }
  const held = (currencyPropertyName?: string) => ({ sensitivity: 'non_sensitive' as const, currencyPropertyName })
  expect(writeBlock('property', [off], ['showCurrencySymbol'], held('grove_currency'))).toMatchObject({
    short: 'currency property set',
    detail: expect.stringContaining('this one holds "grove_currency"'),
    fix: expect.stringContaining('migrate: create a new property under another name'),
  })
  expect(writeBlock('property', [off], ['showCurrencySymbol'], held(''))).toMatchObject({
    detail: expect.stringContaining('this one holds ""'),
  })
  expect(writeBlock('property', [off], ['showCurrencySymbol'], held())).toBeUndefined()
  // Turning it on, or writing another field, is never blocked by the currency property.
  const on: UnitResult = { unit: 'showCurrencySymbol', class: 'config-change', desired: true, observed: false }
  expect(writeBlock('property', [on], ['showCurrencySymbol'], held('grove_currency'))).toBeUndefined()
})

test('deleteBlock: not archivable, and a group an active property still names, but not those deleted first', () => {
  const meta = (archivable: boolean) => ({
    sensitivity: 'non_sensitive' as const,
    modificationMetadata: { archivable },
  })
  expect(deleteBlock(meta(true))).toBeUndefined()
  expect(deleteBlock(undefined)).toBeUndefined()
  const none = new Set<string>()
  expect(deleteBlock(undefined, { active: [], deleted: none })).toBeUndefined()
  expect(deleteBlock(undefined, { active: ['plot_count'], deleted: new Set(['plot_count']) })).toBeUndefined()
  const blocks = [
    deleteBlock(meta(false)),
    deleteBlock(undefined, { active: ['plot_count', 'row_span'], deleted: none }),
    deleteBlock(undefined, { active: ['plot_count', 'row_span'], deleted: new Set(['plot_count']) }),
  ]
  expect(blocks).toMatchInlineSnapshot(`
    [
      {
        "detail": "HubSpot marks this property as not archivable",
        "fix": "keep it in HubSpot: set its tombstone's action to release in removed.ts",
        "short": "not archivable",
      },
      {
        "detail": "properties in HubSpot still name this group: plot_count, row_span",
        "fix": "move them to another group or delete them first; HubSpot archives a group only once every property in it is archived",
        "short": "group still holds properties",
      },
      {
        "detail": "properties in HubSpot still name this group: row_span",
        "fix": "move them to another group or delete them first; HubSpot archives a group only once every property in it is archived",
        "short": "group still holds properties",
      },
    ]
  `)
})
