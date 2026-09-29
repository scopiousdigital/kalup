import { expect, test } from 'vitest'
import { parseState, type TargetState, validateState } from '../../src/ir/state.js'
import type { KalupError } from '../../src/lib/errors.js'
import { fixture } from './fixture.js'

// Untyped: test documents are broken on purpose, one field at a time.
type Doc = Record<string, any>

function state(): Doc {
  return fixture<Doc>('state-example.json')
}

test('the state example conforms: an owned property with a partial base, options, order and a rewrite', () => {
  expect(validateState(fixture<TargetState>('state-example.json'))).toEqual([])
})

const cases: [string, (doc: Doc) => void, string, RegExp][] = [
  [
    'a field the schema does not name',
    (doc) => {
      doc.token = 'kalup-test-secret-9f2c'
    },
    'token',
    /unexpected field "token"/,
  ],
  [
    'the old format name',
    (doc) => {
      doc.format = 'hubschema.state/1'
    },
    'format',
    /expected "kalup.state\/1"/,
  ],
  [
    'a target name, which state no longer holds',
    (doc) => {
      doc.target = { name: 'production', portalId: 2_222_222 }
    },
    'target',
    /unexpected field "target"/,
  ],
  [
    'a lineage that is not 16 lowercase hex characters',
    (doc) => {
      doc.lineage = 'b0a1c6e2'
    },
    'lineage',
    /does not match/,
  ],
  [
    'a negative serial',
    (doc) => {
      doc.serial = -1
    },
    'serial',
    /expected at least 0/,
  ],
  [
    'no portalId',
    (doc) => {
      doc.portalId = undefined
    },
    'portalId',
    /missing required field "portalId"/,
  ],
  [
    'a lastApply without its outcome',
    (doc) => {
      doc.lastApply.outcome = undefined
    },
    'lastApply.outcome',
    /missing required field "outcome"/,
  ],
  [
    'a lastApply outcome outside the vocabulary',
    (doc) => {
      doc.lastApply.outcome = 'failed'
    },
    'lastApply.outcome',
    /expected one of "running", "done", "partial", "uncertain"/,
  ],
  [
    'a lastApply that still carries the commit',
    (doc) => {
      doc.lastApply.commit = '9c1e4d2'
    },
    'lastApply.commit',
    /unexpected field "commit"/,
  ],
  [
    'an origin outside the vocabulary',
    (doc) => {
      doc.resources['team:sales_emea'].origin = 'owned'
    },
    'resources.team:sales_emea.origin',
    /expected one of "created", "adopted", "reference"/,
  ],
  [
    'a base option member with a field other than label, hidden and description',
    (doc) => {
      doc.resources['property:companies/billing_status'].base.options.active.displayOrder = 1
    },
    'resources.property:companies/billing_status.base.options.active.displayOrder',
    /unexpected field "displayOrder"/,
  ],
  [
    'a base order that is not a list of values',
    (doc) => {
      doc.resources['property:companies/billing_status'].base.optionsOrder = 'active'
    },
    'resources.property:companies/billing_status.base.optionsOrder',
    /expected array, got string/,
  ],
  [
    'a rewrite without the value HubSpot stored',
    (doc) => {
      doc.resources['property:companies/billing_status'].rewrites.description.stored = undefined
    },
    'resources.property:companies/billing_status.rewrites.description.stored',
    /missing required field "stored"/,
  ],
]

for (const [name, change, configPath, message] of cases) {
  test(`rejects ${name}`, () => {
    const doc = state()
    change(doc)
    // JSON text drops a field a case sets to undefined.
    const issues = validateState(JSON.parse(JSON.stringify(doc)))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'E_STATE_SCHEMA', configPath })
    expect(issues[0]?.message).toMatch(message)
  })
}

test('a base keeps any scalar unit, since the units a type owns are its fields', () => {
  const doc = state()
  doc.resources['group:companies/billing'].base = { label: 'Billing', displayOrder: 3 }
  expect(validateState(doc)).toEqual([])
})

test('a document that is not an object is one issue with no path', () => {
  expect(validateState([])).toEqual([{ code: 'E_STATE_SCHEMA', message: 'expected object, got array' }])
})

function refusal(text: string, file: string, portalId: number): KalupError {
  try {
    parseState(text, file, portalId, 'sandbox')
  } catch (error) {
    return error as KalupError
  }
  throw new Error('parseState accepted the text')
}

test('parseState reads the text of a conforming file for its own portal', () => {
  const doc = state()
  expect(parseState(JSON.stringify(doc), 'portal-1.json', doc.portalId)).toEqual(doc)
})

const WINDOWS_FILE = 'C:\\project\\.kalup\\state\\portal-1.json'
const BAK_FIX = /^rename portal-1\.json\.bak, .* state rebuild --target sandbox$/
const refused: [string, (doc: Doc) => [string, number], RegExp][] = [
  ['not JSON', (doc) => ['{', doc.portalId], /is not JSON\.$/],
  [
    'not the schema',
    (doc) => [JSON.stringify({ ...doc, serial: -1 }), doc.portalId],
    /does not match kalup\.state\/1 at /,
  ],
  ['another portal', (doc) => [JSON.stringify(doc), doc.portalId + 1], /describes portal \d+, not portal \d+\.$/],
]

for (const [name, input, message] of refused) {
  test(`parseState refuses text that is ${name}, naming the file, with the .bak fix`, () => {
    const [text, portalId] = input(state())
    const [issue] = refusal(text, WINDOWS_FILE, portalId).issues
    expect(issue).toMatchObject({ code: 'E_STATE_INVALID', file: WINDOWS_FILE })
    expect(issue?.message).toMatch(message)
    expect(issue?.fix).toMatch(BAK_FIX)
  })
}

test('parseState refuses another state format and names the one this version reads', () => {
  const [issue] = refusal(JSON.stringify({ format: 'kalup.state/2' }), 'portal-1.json', 1).issues
  expect(issue?.message).toBe('portal-1.json is kalup.state/2, and this version of kalup reads kalup.state/1.')
})
