// The custom object schema checks: what plan and apply take as HubSpot's answer for a schema create, a schema PATCH and
// an archive, observed on 2026-10-05 (docs/hubspot.md). They work on one custom object of the run's own, its name
// carrying the run prefix, written to the manifest before its create is sent. Cleanup archives and purges it.
import { check, must } from './checks.mjs'
import { paths } from './client.mjs'

/** The specs of the schema checks. `gate` names the item in docs/hubspot.md. */
export const OBJECT_CHECKS = {
  createBare: {
    id: 'schema.create-bare',
    title: 'A custom object create with its name, labels and hs_object_id as its primary display property',
    gate: 'Custom object schemas 2026-09: A bare create',
    assumption:
      'Created (201) with HubSpot defaults: no secondary or required properties, hs_object_id searchable, HubSpot properties in the group <name>_information. So apply creates the schema bare and sets its display fields once its own properties exist.',
  },
  sameName: {
    id: 'schema.create-same-name',
    title: "A second create with the run's custom object name",
    gate: 'Custom object schemas 2026-09: Names',
    assumption:
      '201 with the existing schema and its type ID, nothing new: so a create answered with a known type ID made nothing.',
  },
  missingProperty: {
    id: 'schema.patch-missing-property',
    title: 'A schema PATCH whose primary display property the object does not hold',
    gate: 'Custom object schemas 2026-09: Display fields',
    assumption:
      'Refused with a 400 and changed nothing: so plan blocks a display field naming a property HubSpot will not hold.',
  },
  fullPatch: {
    id: 'schema.patch-every-field',
    title: 'A schema PATCH with every field it takes, read back from the list',
    gate: 'Custom object schemas 2026-09: Every PATCH sends every field',
    assumption:
      'The list shows every field as sent (searchable properties as a set): the full PATCH apply sends lands as a whole.',
  },
  archive: {
    id: 'schema.archive',
    title: "A DELETE of the run's custom object with no record",
    gate: 'Custom object schemas 2026-09: Archive',
    assumption:
      '204; the active list no longer holds it and the list with archived=true marks it archived: so an archive is proven by the list.',
  },
}

/** The schema checks, on a custom object of the run's own. */
export async function objectChecks(ctx) {
  const { client, prefix } = ctx
  const name = `${prefix}visit`
  const resource = { type: 'object', objectType: 'schemas', name }
  const labels = { singular: 'Kalup conformance visit', plural: 'Kalup conformance visits' }
  const listed = async (archived = false) => {
    const all = await client.read(paths.schemas, archived ? { query: { archived: 'true' } } : {})
    return all.body?.results?.find((s) => s.name === name)
  }

  const created = await check(ctx, OBJECT_CHECKS.createBare, async () => {
    const answer = await client.create(resource, paths.schemas, {
      name,
      labels,
      primaryDisplayProperty: 'hs_object_id',
    })
    must(answer.status === 201, `the create answered ${answer.status ?? answer.error}`)
    const seen = await ctx.poll(async () => listed())
    const schema = seen.value ?? {}
    const typeId = schema.objectTypeId
    const groups = typeId ? await client.read(paths.groups(typeId)) : undefined
    const group = groups?.body?.results?.find((g) => g.name === `${name}_information`)
    return {
      pass:
        schema.primaryDisplayProperty === 'hs_object_id' &&
        JSON.stringify(schema.searchableProperties) === JSON.stringify(['hs_object_id']) &&
        (schema.requiredProperties ?? []).length === 0 &&
        (schema.secondaryDisplayProperties ?? []).length === 0 &&
        group !== undefined,
      note: typeId ? `type ID ${typeId}` : 'not listed',
      facts: { status: answer.status, searchable: schema.searchableProperties, group: group?.name ?? null },
      value: typeId ? { typeId } : undefined,
    }
  })
  const typeId = created?.typeId

  await check(ctx, OBJECT_CHECKS.sameName, async () => {
    must(typeId, 'needs schema.create-bare')
    const answer = await client.write(resource, 'POST', paths.schemas, {
      name,
      labels,
      primaryDisplayProperty: 'hs_object_id',
    })
    return {
      pass: answer.status === 201 && answer.body?.objectTypeId === typeId,
      note: `answered ${answer.status ?? answer.error}`,
      facts: { status: answer.status, sameTypeId: answer.body?.objectTypeId === typeId },
    }
  })

  await check(ctx, OBJECT_CHECKS.missingProperty, async () => {
    must(typeId, 'needs schema.create-bare')
    const answer = await client.write(resource, 'PATCH', paths.schema(typeId), {
      primaryDisplayProperty: `${prefix}missing`,
    })
    const after = await listed()
    return {
      pass: answer.status === 400 && after?.primaryDisplayProperty === 'hs_object_id',
      note: `answered ${answer.status ?? answer.error}`,
      facts: { status: answer.status, subCategory: answer.body?.subCategory ?? null },
    }
  })

  await check(ctx, OBJECT_CHECKS.fullPatch, async () => {
    must(typeId, 'needs schema.create-bare')
    const body = {
      labels: { singular: 'Kalup conformance visit', plural: 'Kalup conformance site visits' },
      description: 'Made by the Kalup conformance runner.',
      clearDescription: false,
      primaryDisplayProperty: 'hs_object_id',
      secondaryDisplayProperties: ['hs_createdate'],
      requiredProperties: [],
      searchableProperties: ['hs_object_id', 'hs_createdate'],
      restorable: true,
    }
    const answer = await client.write(resource, 'PATCH', paths.schema(typeId), body)
    must(answer.status === 200, `the PATCH answered ${answer.status ?? answer.error}`)
    const seen = await ctx.poll(async () => {
      const s = await listed()
      const searchable = [...(s?.searchableProperties ?? [])].sort().join()
      return s?.labels?.plural === body.labels.plural &&
        s.description === body.description &&
        JSON.stringify(s.secondaryDisplayProperties) === JSON.stringify(body.secondaryDisplayProperties) &&
        searchable === [...body.searchableProperties].sort().join()
        ? s
        : undefined
    })
    return {
      pass: seen.visible,
      note: seen.visible ? `read back after ${seen.ms} ms` : 'not read back as sent',
      facts: { status: answer.status, ms: seen.ms },
    }
  })

  await check(ctx, OBJECT_CHECKS.archive, async () => {
    must(typeId, 'needs schema.create-bare')
    const answer = await client.write(resource, 'DELETE', paths.schema(typeId))
    must(answer.status === 204 || answer.status === 200, `the DELETE answered ${answer.status ?? answer.error}`)
    const gone = await ctx.poll(async () => ((await listed()) === undefined ? true : undefined))
    const archived = await listed(true)
    return {
      pass: gone.visible && archived?.archived === true,
      note: `answered ${answer.status}; archived ${archived?.archived === true}`,
      facts: { status: answer.status, archived: archived?.archived ?? null },
    }
  })
}
