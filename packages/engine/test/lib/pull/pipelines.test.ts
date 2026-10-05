// The re-pull merge of one object's pipelines: which stage order pull leaves when --only selects stages, and how a
// stage a skip override leaves out is reported.
import { expect, test } from 'vitest'
import type { PipelineExport, Stage } from '../../../src/grammar/types.js'
import type { LivePipeline } from '../../../src/lib/pull/normalize.js'
import { mergePipelines, type PipelineMergeInput } from '../../../src/lib/pull/pipelines.js'

const pipeline = 'pipeline:deals/orchard_sales'
const stageAt = (id: string) => `stage:deals/orchard_sales/${id}`

function stage(key: string, id: string, label: string, probability: number): Stage {
  return { comments: [], key, id, label, probability }
}

// The file: tasting, then signed.
const file: PipelineExport = {
  comments: [],
  displayOrder: 1,
  id: 'orchard_sales',
  label: 'Orchard sales',
  name: 'OrchardSalesPipeline',
  object: 'deals',
  stages: [stage('tasting', 'orchard_tasting', 'Tasting', 0.2), stage('signed', 'orchard_signed', 'Signed', 1)],
}

function input(live: LivePipeline[], extra: Partial<PipelineMergeInput> = {}): PipelineMergeInput {
  return {
    all: false,
    excluded: new Set(),
    live,
    local: [file],
    object: 'deals',
    only: () => true,
    taken: new Set(['OrchardSalesPipeline']),
    ...extra,
  }
}

// The portal: signed moved before tasting, and tasting relabelled.
const reordered: LivePipeline = {
  displayOrder: 1,
  id: 'orchard_sales',
  label: 'Orchard sales',
  stages: [
    { id: 'orchard_signed', label: 'Signed', probability: 1 },
    { id: 'orchard_tasting', label: 'Tasting booked', probability: 0.2 },
  ],
}

test('pull --only on a stage merges that stage and keeps the file order, which belongs to the pipeline', () => {
  const merged = mergePipelines(input([reordered], { only: (address) => address === stageAt('orchard_tasting') }))
  const out = merged.merged.get('OrchardSalesPipeline')
  expect(out?.stages.map((st) => [st.id, st.label])).toEqual([
    ['orchard_tasting', 'Tasting booked'],
    ['orchard_signed', 'Signed'],
  ])
  expect(merged.changes.map((c) => [c.kind, c.address, c.field])).toEqual([
    ['changed', stageAt('orchard_tasting'), 'label'],
  ])
})

test('pull --only on the pipeline takes the portal stage order', () => {
  const merged = mergePipelines(input([reordered], { only: (address) => address === pipeline }))
  expect(merged.merged.get('OrchardSalesPipeline')?.stages.map((st) => st.id)).toEqual([
    'orchard_signed',
    'orchard_tasting',
  ])
})

test('a stage a skip override leaves out on the target is reported excluded, not missing in the portal', () => {
  // The read leaves an excluded stage out of the live pipeline.
  const live: LivePipeline = { ...reordered, stages: [{ id: 'orchard_tasting', label: 'Tasting', probability: 0.2 }] }
  const merged = mergePipelines(input([live], { excluded: new Set([stageAt('orchard_signed')]) }))
  expect(merged.counts.missing).toBe(0)
  expect(merged.changes.map((c) => [c.kind, c.address])).toEqual([['excluded', stageAt('orchard_signed')]])
  expect(merged.merged.get('OrchardSalesPipeline')?.stages.map((st) => st.id)).toEqual([
    'orchard_tasting',
    'orchard_signed',
  ])
})
