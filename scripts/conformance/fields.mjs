// The property definition fields beyond label, description, group, fieldType, options and hasUniqueValue, on companies:
// what a create stores, what an update changes, and what HubSpot refuses or ignores. Kalup manages each field as these
// checks find it (docs/hubspot.md, "Property definition fields"). Every property carries the run prefix, sits in the
// run's own group and is archived by the cleanup, calculations before the properties their formulas use.
import { check, groupBody, must, need, serial } from './checks.mjs'
import { paths } from './client.mjs'

const OT = 'companies'
/** HubSpot rewrites a formula's spacing (`a+1` becomes `a + 1`), so formulas compare with whitespace removed. */
const SPACE = /\s+/g
const CURRENCY_CODE = /_currency_code$/
/** The fields a comparison of a read with its create or PATCH leaves out: HubSpot's own. */
const OWN = new Set([
  'archived',
  'calculated',
  'createdAt',
  'createdUserId',
  'hubspotDefined',
  'modificationMetadata',
  'updatedAt',
  'updatedUserId',
])

const BOOLEAN_OPTIONS = [
  { label: 'Yes', value: 'true', displayOrder: 0, hidden: false },
  { label: 'No', value: 'false', displayOrder: 1, hidden: false },
]

export const FIELD_CHECKS = {
  numberDisplay: {
    id: 'write.companies.field.number-display',
    title: 'A number with numberDisplayHint, displayOrder, hidden and formField: create, update, a PATCH without them',
    gate: 'Property definition fields',
    assumption:
      'Each field reads back as created and as a PATCH sets it; a PATCH that leaves them out keeps them, and a hint sent as null changes nothing.',
  },
  currency: {
    id: 'write.companies.field.currency',
    title: 'showCurrencySymbol and currencyPropertyName on a number',
    gate: 'Property definition fields',
    assumption:
      'A create with the symbol on and a currency property stores both; a create with the name and no symbol, and a PATCH that turns the symbol off while the name is set, answer 400.',
  },
  textDisplay: {
    id: 'write.companies.field.text-display',
    title: 'textDisplayHint on a text property: create, update, the empty string',
    gate: 'Property definition fields',
    assumption: 'The hint reads back as created and as a PATCH sets it; an empty hint answers 400.',
  },
  dateDisplay: {
    id: 'write.companies.field.date-display',
    title: 'dateDisplayHint on a datetime property: create and update',
    gate: 'Property definition fields',
    assumption:
      'HubSpot ignores dateDisplayHint on create and update (it is in neither PropertyCreate nor PropertyUpdate), so Kalup does not manage it.',
  },
  kinds: {
    id: 'write.companies.field.kinds',
    title: 'A phone_number property, a rich text (html) property, and a boolean checkbox with and without its options',
    gate: 'Property definition fields',
    assumption:
      'phone_number/phonenumber and string/html round-trip; a bool without the options true and false answers 400, and with them 201.',
  },
  owner: {
    id: 'write.companies.field.owner',
    title:
      'An owner property (externalOptions with referencedObjectType OWNER): create, a create with options, an update',
    gate: 'Property definition fields',
    assumption:
      'A select with externalOptions true and referencedObjectType OWNER round-trips with no options; one sent with options answers 400; a PATCH of referencedObjectType answers 200 and changes nothing.',
  },
  calculation: {
    id: 'write.companies.field.calculation',
    title: "A calculation property whose formula uses the run's number: create and update of calculationFormula",
    gate: 'Property definition fields',
    assumption:
      'The formula reads back as sent up to spacing, HubSpot marks the property calculated, and a PATCH of the formula changes it.',
  },
  fixed: {
    id: 'write.companies.field.fixed',
    title: 'A PATCH of hasUniqueValue and dataSensitivity on an existing property',
    gate: 'Property definition fields',
    assumption: 'HubSpot answers 200 and keeps both values, so Kalup blocks a difference in either with a migration.',
  },
  sensitive: {
    id: 'write.companies.field.sensitive-create',
    title: 'A create with dataSensitivity sensitive',
    gate: 'Property definition fields',
    assumption:
      '201 and the property reads back under dataSensitivity=sensitive, or 403 when the key lacks the companies sensitive write scope: Kalup sends dataSensitivity on create and reads back under it.',
  },
}

/**
 * The create bodies of the properties the checks make, as Kalup's createBody builds them from a definition. A test holds
 * each one equal to createBody.
 */
export function fieldBodies(prefix, groupName) {
  const body = (key, label, fields) => ({ name: `${prefix}${key}`, label, groupName, ...fields })
  return {
    number: body('fnum', 'Kalup field number', {
      type: 'number',
      fieldType: 'number',
      formField: true,
      hidden: true,
      displayOrder: 3,
      numberDisplayHint: 'percentage',
    }),
    text: body('ftext', 'Kalup field text', { type: 'string', fieldType: 'text', textDisplayHint: 'domain_name' }),
    phone: body('fphone', 'Kalup field phone', { type: 'phone_number', fieldType: 'phonenumber' }),
    html: body('fhtml', 'Kalup field rich text', { type: 'string', fieldType: 'html' }),
    bool: body('fbool', 'Kalup field boolean', {
      type: 'bool',
      fieldType: 'booleancheckbox',
      options: BOOLEAN_OPTIONS,
    }),
    owner: body('fowner', 'Kalup field owner', {
      type: 'enumeration',
      fieldType: 'select',
      externalOptions: true,
      referencedObjectType: 'OWNER',
    }),
    calculation: body('fcalc', 'Kalup field calculation', {
      type: 'number',
      fieldType: 'calculation_equation',
      calculationFormula: `${prefix}fnum+1`,
    }),
  }
}

/** The field checks on companies, in the run's own group. */
export async function fieldChecks(ctx) {
  const { client, prefix } = ctx
  const group = `${prefix}fields`
  const bodies = fieldBodies(prefix, group)
  const property = (name, extra = {}) => ({ type: 'property', objectType: OT, name, ...extra })
  const read = async (name, query) => {
    const seen = await ctx.poll(async () => {
      const answer = await client.read(paths.property(OT, name), query ? { query } : {})
      return answer.status === 200 && answer.body
    })
    return must(seen.value, `${name} did not read back within the deadline`)
  }
  const create = (body, extra) => client.create(property(body.name, extra), paths.properties(OT), body)
  const patch = async (name, body) => {
    const answer = await client.write(property(name), 'PATCH', paths.property(OT, name), body)
    return { answer, after: answer.status === 200 ? await read(name) : undefined }
  }
  const made = async (body) => {
    const answer = await create(body)
    return { answer, read: answer.status === 201 ? await read(body.name) : undefined }
  }

  const grouped = await client.create(
    { type: 'group', objectType: OT, name: group },
    paths.groups(OT),
    groupBody(group, 'Kalup conformance fields'),
  )
  const ready = grouped.status === 201
  const needsGroup = () => need(ready, `the run's fields group create answered ${grouped.status ?? grouped.error}`)

  const number = await check(ctx, FIELD_CHECKS.numberDisplay, async () => {
    needsGroup()
    const { answer, read: created } = await made(bodies.number)
    must(created, `the create answered ${answer.status ?? answer.error}`)
    const changed = await patch(bodies.number.name, {
      numberDisplayHint: 'duration',
      displayOrder: 1,
      hidden: false,
    })
    const relabelled = await patch(bodies.number.name, { label: 'Kalup field number, renamed' })
    const nulled = await patch(bodies.number.name, { numberDisplayHint: null })
    const fields = ['numberDisplayHint', 'displayOrder', 'hidden', 'formField']
    const pick = (p) => (p ? Object.fromEntries(fields.map((f) => [f, p[f] ?? null])) : null)
    const facts = {
      created: pick(created),
      updated: pick(changed.after),
      withoutThem: pick(relabelled.after),
      nullHint: { status: nulled.answer.status, after: pick(nulled.after) },
    }
    const expected = { numberDisplayHint: 'duration', displayOrder: 1, hidden: false, formField: true }
    const pass =
      differences(bodies.number, created).length === 0 &&
      equal(facts.updated, expected) &&
      equal(facts.withoutThem, expected) &&
      nulled.answer.status === 200 &&
      equal(facts.nullHint.after, expected)
    return { pass, note: `create ${answer.status}, update ${changed.answer.status}`, facts, value: true }
  })

  await check(ctx, FIELD_CHECKS.currency, async () => {
    needsGroup()
    const listed = await client.read(paths.properties(OT))
    const code = (listed.body?.results ?? []).find((p) => CURRENCY_CODE.test(p.name) && p.type === 'string')?.name
    need(code, 'the companies list holds no string property named *_currency_code')
    const base = { label: 'Kalup field currency', groupName: group, type: 'number', fieldType: 'number' }
    const good = { ...base, name: `${prefix}fcur`, showCurrencySymbol: true, currencyPropertyName: code }
    const bad = { ...base, name: `${prefix}fcurbad`, currencyPropertyName: code }
    const { answer, read: created } = await made(good)
    const refused = await create(bad)
    const off = created ? (await patch(good.name, { showCurrencySymbol: false })).answer : undefined
    const facts = {
      create: { status: answer.status, currencyPropertyName: created?.currencyPropertyName ?? null },
      withoutSymbol: { status: refused.status, subCategory: refused.body?.subCategory ?? null },
      symbolOff: { status: off?.status ?? null, subCategory: off?.body?.subCategory ?? null },
    }
    const pass =
      created?.showCurrencySymbol === true &&
      created.currencyPropertyName === code &&
      refused.status === 400 &&
      off?.status === 400
    return {
      pass,
      note: `create ${answer.status}, without the symbol ${refused.status}, symbol off ${off?.status}`,
      facts,
    }
  })

  await check(ctx, FIELD_CHECKS.textDisplay, async () => {
    needsGroup()
    const { answer, read: created } = await made(bodies.text)
    must(created, `the create answered ${answer.status ?? answer.error}`)
    const changed = await patch(bodies.text.name, { textDisplayHint: 'email' })
    const empty = await client.write(property(bodies.text.name), 'PATCH', paths.property(OT, bodies.text.name), {
      textDisplayHint: '',
    })
    const facts = {
      created: created.textDisplayHint ?? null,
      updated: changed.after?.textDisplayHint ?? null,
      empty: { status: empty.status, category: empty.body?.category ?? null },
    }
    const pass = facts.created === 'domain_name' && facts.updated === 'email' && empty.status === 400
    return { pass, note: `create ${answer.status}, update ${changed.answer.status}, empty ${empty.status}`, facts }
  })

  await check(ctx, FIELD_CHECKS.dateDisplay, async () => {
    needsGroup()
    const body = {
      name: `${prefix}fdate`,
      label: 'Kalup field date',
      groupName: group,
      type: 'datetime',
      fieldType: 'date',
      dateDisplayHint: 'time_since',
    }
    const { answer, read: created } = await made(body)
    must(created, `the create answered ${answer.status ?? answer.error}`)
    const changed = await patch(body.name, { dateDisplayHint: 'time_until' })
    const facts = {
      created: created.dateDisplayHint ?? null,
      update: { status: changed.answer.status, after: changed.after?.dateDisplayHint ?? null },
    }
    const pass = facts.created === null && changed.answer.status === 200 && facts.update.after === null
    return { pass, note: `create ${answer.status} stored ${facts.created}, update stored ${facts.update.after}`, facts }
  })

  await check(ctx, FIELD_CHECKS.kinds, async () => {
    needsGroup()
    const results = await serial(['phone', 'html', 'bool'], async (key) => {
      const { answer, read: created } = await made(bodies[key])
      return { key, status: answer.status, differs: differences(bodies[key], created) }
    })
    const bare = { ...bodies.bool, name: `${prefix}fboolbare`, options: undefined }
    const refused = await create(bare)
    const facts = { ...Object.fromEntries(results.map((r) => [r.key, r])), withoutOptions: refused.status }
    const pass = results.every((r) => r.status === 201 && r.differs.length === 0) && refused.status === 400
    return { pass, note: results.map((r) => `${r.key} ${r.status}`).join(', '), facts }
  })

  await check(ctx, FIELD_CHECKS.owner, async () => {
    needsGroup()
    const { answer, read: created } = await made(bodies.owner)
    must(created, `the create answered ${answer.status ?? answer.error}`)
    const withOptions = {
      ...bodies.owner,
      name: `${prefix}fownerbad`,
      options: [{ label: 'Nobody', value: 'nobody', displayOrder: 0, hidden: false }],
    }
    const refused = await create(withOptions)
    const retyped = await patch(bodies.owner.name, { referencedObjectType: 'COMPANY' })
    const facts = {
      differs: differences(bodies.owner, created),
      options: created.options ?? null,
      withOptions: refused.status,
      retype: { status: retyped.answer.status, after: retyped.after?.referencedObjectType ?? null },
    }
    const pass =
      facts.differs.length === 0 &&
      (created.options ?? []).length === 0 &&
      refused.status === 400 &&
      retyped.answer.status === 200 &&
      facts.retype.after === 'OWNER'
    return { pass, note: `create ${answer.status}, with options ${refused.status}`, facts }
  })

  await check(ctx, FIELD_CHECKS.calculation, async () => {
    need(number, 'needs write.companies.field.number-display')
    const { answer, read: created } = await made(bodies.calculation)
    // Calculation properties need a Professional or Enterprise subscription: a portal without them refuses the create.
    need(
      !(answer.status === 400 || answer.status === 403),
      `the calculation create answered ${answer.status} ${answer.body?.category ?? ''}: the portal cannot create one`,
    )
    must(created, `the create answered ${answer.status ?? answer.error}`)
    const next = `${prefix}fnum * 3`
    const changed = await patch(bodies.calculation.name, { calculationFormula: next })
    const facts = {
      sent: bodies.calculation.calculationFormula,
      stored: created.calculationFormula ?? null,
      calculated: created.calculated ?? null,
      updated: changed.after?.calculationFormula ?? null,
    }
    const pass =
      unspaced(facts.stored) === unspaced(facts.sent) &&
      created.calculated === true &&
      unspaced(facts.updated) === unspaced(next)
    return { pass, note: `sent '${facts.sent}', stored '${facts.stored}'`, facts }
  })

  await check(ctx, FIELD_CHECKS.fixed, async () => {
    need(number, 'needs write.companies.field.number-display')
    const { name } = bodies.number
    const answer = await client.write(property(name), 'PATCH', paths.property(OT, name), {
      hasUniqueValue: true,
      dataSensitivity: 'sensitive',
    })
    const after = answer.status === 200 ? await read(name) : undefined
    const facts = {
      status: answer.status,
      hasUniqueValue: after?.hasUniqueValue ?? null,
      dataSensitivity: after?.dataSensitivity ?? null,
    }
    const pass = answer.status === 200 && after?.hasUniqueValue === false && after.dataSensitivity === 'non_sensitive'
    return { pass, note: `${answer.status}; kept ${facts.hasUniqueValue}, ${facts.dataSensitivity}`, facts }
  })

  await check(ctx, FIELD_CHECKS.sensitive, async () => {
    needsGroup()
    const body = {
      name: `${prefix}fsens`,
      label: 'Kalup field sensitive',
      groupName: group,
      type: 'string',
      fieldType: 'text',
      dataSensitivity: 'sensitive',
    }
    const answer = await create(body, { dataSensitivity: 'sensitive' })
    const created = answer.status === 201 ? await read(body.name, { dataSensitivity: 'sensitive' }) : undefined
    const facts = {
      status: answer.status,
      message: answer.status === 201 ? null : String(answer.body?.message ?? '').slice(0, 120),
      dataSensitivity: created?.dataSensitivity ?? null,
    }
    const pass = (answer.status === 201 && created?.dataSensitivity === 'sensitive') || answer.status === 403
    return { pass, note: `${answer.status}${created ? ', reads back sensitive' : ''}`, facts }
  })
}

// The fields a create sent that read back otherwise, HubSpot's own left out. A formula compares without spacing.
function differences(sent, read) {
  if (!read) {
    return ['no read']
  }
  return Object.entries(sent)
    .filter(([field, value]) => value !== undefined && !OWN.has(field))
    .filter(([field, value]) => {
      if (field === 'calculationFormula') {
        return unspaced(value) !== unspaced(read[field])
      }
      return !equal(value, field === 'options' ? optionsOf(read.options) : read[field])
    })
    .map(([field]) => field)
}

function optionsOf(options = []) {
  return options.map((o) => ({ label: o.label, value: o.value, displayOrder: o.displayOrder, hidden: o.hidden }))
}

function unspaced(text) {
  return typeof text === 'string' ? text.replace(SPACE, '') : text
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}
