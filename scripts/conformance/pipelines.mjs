// The pipeline checks: what plan and apply take as HubSpot's answer for deal pipelines and their stages, observed on
// 2026-10-01 and 2026-10-05 (docs/hubspot.md). Each check works on a pipeline of the run's own, its ID and its stage
// IDs carrying the run prefix, written to the manifest before its create is sent. Cleanup deletes it with its stages.
import { check, must } from './checks.mjs'
import { paths } from './client.mjs'

const DEALS = 'deals'

/** The specs of the pipeline checks. `gate` names the item in docs/hubspot.md. */
export const PIPELINE_CHECKS = {
  createIds: {
    id: 'pipeline.create-honours-ids',
    title: 'A deal pipeline create with its ID and its stages, each with its ID and probability, read back',
    gate: 'Pipelines are natural',
    assumption:
      'Created (201) with the pipeline and stage IDs as sent; a read returns them, each stage with its probability in HubSpot printed form and isClosed derived from it, 0 and 1 closed.',
  },
  emptyRefused: {
    id: 'pipeline.create-without-stage-refused',
    title: 'A deal pipeline create with no stage',
    gate: 'A pipeline needs a stage',
    assumption: 'Refused with a 400, nothing created: so a pipeline create carries its stages.',
  },
  takenSlot: {
    id: 'pipeline.stage-on-taken-slot',
    title: "A stage created on another stage's displayOrder",
    gate: 'Stage order: a write to a taken slot renumbers the pipeline',
    assumption:
      'The new stage goes right after the stage that held the slot, and the pipeline is renumbered 0..n-1: the move apply makes for a stage order.',
  },
  metadataMerge: {
    id: 'pipeline.stage-metadata-patch-merges',
    title: 'A stage PATCH of its label alone, then of its probability alone',
    gate: 'Stage metadata',
    assumption:
      'A label PATCH keeps the metadata, a probability PATCH changes it and HubSpot derives isClosed again: so a stage PATCH carries only the approved fields.',
  },
  deleteMissing: {
    id: 'pipeline.stage-delete-missing-204',
    title: "A stage DELETE of a stage ID the run's pipeline does not hold",
    gate: 'A stage DELETE answers 204 for anything',
    assumption: '204: so apply proves a stage delete only by a read that lacks the stage.',
  },
  limits: {
    id: 'pipeline.limits',
    title: 'Limits Tracking pipelines',
    gate: 'Limits Tracking readings',
    assumption: '200 with a limit and usage for deals and tickets, and overall figures for the custom objects.',
  },
}

/** The pipeline checks, on a deal pipeline of the run's own. */
export async function pipelineChecks(ctx) {
  const { client, prefix } = ctx
  const id = `${prefix}p`
  const stage = (name) => `${prefix}${name}`
  const resource = { type: 'pipeline', objectType: DEALS, name: id }
  const read = async () => client.read(paths.pipeline(DEALS, id))

  const created = await check(ctx, PIPELINE_CHECKS.createIds, async () => {
    const answer = await client.create(resource, paths.pipelines(DEALS), {
      pipelineId: id,
      label: `Kalup conformance ${ctx.prefix}`,
      displayOrder: 99,
      stages: [
        { stageId: stage('open'), label: 'Open', displayOrder: 0, metadata: { probability: '0.25' } },
        { stageId: stage('won'), label: 'Won', displayOrder: 1, metadata: { probability: '1' } },
      ],
    })
    must(answer.status === 201, `the create answered ${answer.status ?? answer.error}`)
    const seen = await ctx.poll(async () => {
      const got = await read()
      return got.status === 200 ? got : undefined
    })
    const stages = seen.value?.body?.stages ?? []
    const facts = stages.map((st) => ({ id: st.id, metadata: st.metadata }))
    const won = stages.find((st) => st.id === stage('won'))
    const open = stages.find((st) => st.id === stage('open'))
    return {
      pass:
        seen.value?.body?.id === id &&
        open?.metadata?.probability === '0.25' &&
        open?.metadata?.isClosed === 'false' &&
        won?.metadata?.probability === '1.0' &&
        won?.metadata?.isClosed === 'true',
      note: `read back ${stages.length} stages`,
      facts: { status: answer.status, stages: facts },
      value: seen.visible,
    }
  })

  await check(ctx, PIPELINE_CHECKS.emptyRefused, async () => {
    const empty = { type: 'pipeline', objectType: DEALS, name: `${prefix}empty` }
    const answer = await client.create(empty, paths.pipelines(DEALS), {
      pipelineId: empty.name,
      label: `Kalup conformance empty ${ctx.prefix}`,
      displayOrder: 99,
      stages: [],
    })
    return {
      pass: answer.status === 400,
      note: `answered ${answer.status ?? answer.error}`,
      facts: { status: answer.status },
    }
  })

  await check(ctx, PIPELINE_CHECKS.takenSlot, async () => {
    must(created, 'needs pipeline.create-honours-ids')
    const answer = await client.write(resource, 'POST', paths.stages(DEALS, id), {
      stageId: stage('signed'),
      label: 'Signed',
      displayOrder: 0,
      metadata: { probability: '0.5' },
    })
    must(answer.status === 201, `the stage create answered ${answer.status ?? answer.error}`)
    const got = await read()
    const order = [...(got.body?.stages ?? [])]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((st) => [st.id, st.displayOrder])
    const expected = [
      [stage('open'), 0],
      [stage('signed'), 1],
      [stage('won'), 2],
    ]
    return {
      pass: JSON.stringify(order) === JSON.stringify(expected),
      note: order.map(([sid, at]) => `${String(sid).slice(prefix.length)} ${at}`).join(', '),
      facts: { order: order.map(([sid, at]) => ({ stage: String(sid).slice(prefix.length), displayOrder: at })) },
    }
  })

  await check(ctx, PIPELINE_CHECKS.metadataMerge, async () => {
    must(created, 'needs pipeline.create-honours-ids')
    const path = paths.stage(DEALS, id, stage('open'))
    const labelled = await client.write(resource, 'PATCH', path, { label: 'Opened' })
    const afterLabel = (await read()).body?.stages?.find((st) => st.id === stage('open'))
    const probable = await client.write(resource, 'PATCH', path, { metadata: { probability: '0' } })
    const afterProbability = (await read()).body?.stages?.find((st) => st.id === stage('open'))
    return {
      pass:
        labelled.status === 200 &&
        probable.status === 200 &&
        afterLabel?.label === 'Opened' &&
        afterLabel?.metadata?.probability === '0.25' &&
        afterProbability?.metadata?.probability === '0.0' &&
        afterProbability?.metadata?.isClosed === 'true',
      note: `label ${labelled.status}, probability ${probable.status}`,
      facts: { afterLabel: afterLabel?.metadata, afterProbability: afterProbability?.metadata },
    }
  })

  await check(ctx, PIPELINE_CHECKS.deleteMissing, async () => {
    must(created, 'needs pipeline.create-honours-ids')
    const answer = await client.write(resource, 'DELETE', paths.stage(DEALS, id, stage('absent')))
    return {
      pass: answer.status === 204,
      note: `answered ${answer.status ?? answer.error}`,
      facts: { status: answer.status },
    }
  })

  await check(ctx, PIPELINE_CHECKS.limits, async () => {
    const answer = await client.read(paths.limits('pipelines'))
    const body = answer.body ?? {}
    const standard = Array.isArray(body.hubspotDefinedObjectTypes) ? body.hubspotDefinedObjectTypes : []
    const deals = standard.find((e) => e?.objectTypeId === '0-3')
    const figures = (a, b) => Number.isInteger(a) && Number.isInteger(b)
    return {
      pass:
        answer.status === 200 &&
        figures(deals?.limit, deals?.usage) &&
        figures(body.customObjectTypes?.overallLimit, body.customObjectTypes?.overallUsage),
      note: answer.status === 200 ? `deals limit ${deals?.limit}, usage ${deals?.usage}` : `answered ${answer.status}`,
      facts: { status: answer.status, deals: deals ? { limit: deals.limit, usage: deals.usage } : null },
    }
  })
}
