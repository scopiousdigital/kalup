// The re-pull merge of one object's pipelines: the portal wins for what HubSpot holds, the file keeps what HubSpot
// cannot know (export names, stage keys, comments). Where state owns a pipeline or stage with a base, the base decides
// each unit as it does for properties: a config change or a conflict keeps the file's value unless --accept takes the
// portal's. A stage HubSpot no longer holds stays in the file, reported missing. Pure.
import type { PipelineExport, Stage } from '../../grammar/types.js'
import type { UnitResult } from '../../plan/classify.js'
import { sanitize } from '../sanitize.js'
import { camelCase } from './keys.js'
import type { Change, Counts, Resolution } from './merge.js'
import type { LivePipeline, LiveStage } from './normalize.js'

export interface PipelineMergeInput {
  /**
   * `pipelines: true` on the object: pull adds the portal's pipelines the files lack. Without it pull refreshes only the
   * pipelines the files define, as `custom: false` does for properties.
   */
  all: boolean
  /** The addresses a skip override leaves out on the target: kept as written and noted. */
  excluded: ReadonlySet<string>
  /** The object's pipelines as the portal holds them, under local IDs, in display order. */
  live: LivePipeline[]
  /** The pipeline exports the files hold for this object, in file order. */
  local: PipelineExport[]
  object: string
  /** The addresses pull may merge: the --only filter. */
  only: (address: string) => boolean
  /** The addresses in removed.ts: never written back, reported as `removed`. */
  removed?: ReadonlySet<string>
  /** The base's verdict on an address state owns, or undefined to merge it as the portal holds it. */
  resolve?: (address: string) => Resolution | undefined
  /** The export names the project uses: a new pipeline's export name is made unique against them, and added. */
  taken: Set<string>
}

export interface PipelinesMerged {
  changes: Change[]
  counts: Counts
  /** The new exports, for pipelines the files lack, in display order. */
  fresh: PipelineExport[]
  /** The files' exports merged, by export name. */
  merged: Map<string, PipelineExport>
}

const STAGE_FIELDS = ['probability', 'ticketState', 'state'] as const
const SLUG = /^[a-z][a-z0-9_]*$/
const NOT_ALNUM = /[^A-Za-z0-9]+/
const LETTER = /[A-Za-z]/
const DIGIT_FIRST = /^[0-9]/

export function mergePipelines(input: PipelineMergeInput): PipelinesMerged {
  const { live, local, object, only, removed } = input
  const out: PipelinesMerged = {
    changes: [],
    counts: { added: 0, changed: 0, unchanged: 0, missing: 0 },
    fresh: [],
    merged: new Map(),
  }
  const note = (change: Change) => out.changes.push(scrub(change))
  const settle = (fields: Change[]) => {
    if (fields.some((c) => c.kind === 'changed' || c.kind === 'added')) {
      out.counts.changed += 1
    } else {
      out.counts.unchanged += 1
    }
    fields.forEach(note)
  }
  const ours = new Set(local.map((p) => p.id))
  for (const p of local) {
    out.merged.set(p.name, mergeOne(input, p, { note, settle, counts: out.counts }))
  }
  for (const l of live) {
    const address = `pipeline:${object}/${l.id}`
    if (!input.all || ours.has(l.id) || !(only(address) || l.stages.some((st) => only(stageAt(object, l.id, st.id))))) {
      continue
    }
    if (removed?.has(address)) {
      note({ kind: 'removed', address })
      continue
    }
    const fresh = freshExport(input, l)
    out.fresh.push(fresh)
    out.counts.added += 1 + fresh.stages.length
    note({ kind: 'added', address })
    for (const st of fresh.stages) {
      note({ kind: 'added', address: stageAt(object, l.id, st.id) })
    }
  }
  return out
}

interface Reporting {
  counts: Counts
  note: (change: Change) => void
  settle: (fields: Change[]) => void
}

// One export the files hold: its fields from the portal where the pull may merge it, its stages merged one by one in
// the portal's order, a stage only the file holds kept after the stage it follows in the file.
function mergeOne(input: PipelineMergeInput, p: PipelineExport, report: Reporting): PipelineExport {
  const { object, only, excluded } = input
  const address = `pipeline:${object}/${p.id}`
  const l = input.live.find((x) => x.id === p.id)
  const touched = only(address) || p.stages.some((st) => only(stageAt(object, p.id, st.id)))
  if (!touched) {
    return p
  }
  if (excluded.has(address)) {
    report.note({ kind: 'excluded', address })
    return p
  }
  if (!l) {
    report.counts.missing += 1
    report.note({ kind: 'missing', address })
    return p
  }
  const next: PipelineExport = { ...p }
  if (only(address)) {
    const fields: Change[] = []
    for (const field of ['label', 'displayOrder'] as const) {
      if (p[field] !== l[field]) {
        fields.push({ kind: 'changed', address, field, before: p[field], after: l[field] })
      }
      Object.assign(next, { [field]: l[field] })
    }
    resolveFields(
      address,
      p as unknown as Record<string, unknown>,
      next as unknown as Record<string, unknown>,
      fields,
      input.resolve?.(address),
    )
    next.stages = mergeStages(input, p, l, next, fields, report)
    report.settle(fields)
  } else {
    next.stages = mergeStages(input, p, l, next, [], report)
  }
  return next
}

// The stages of one pipeline: the portal's in its order, each a file stage merged or a new one added; then each stage
// only the file holds, kept after the stage it follows in the file. The order unit of the base may keep the file's
// order of the stages both hold.
function mergeStages(
  input: PipelineMergeInput,
  p: PipelineExport,
  l: LivePipeline,
  next: PipelineExport,
  fields: Change[],
  report: Reporting,
): Stage[] {
  const merged = portalStages(input, p, l, report)
  keepFileOnly(input, p, merged, report)
  return orderStages(input, p, merged, next, fields)
}

// The portal's stages in its order: a stage the file holds merged (or as written where the pull may not take it), a new
// one added, one in removed.ts noted.
function portalStages(input: PipelineMergeInput, p: PipelineExport, l: LivePipeline, report: Reporting): Stage[] {
  const { object, only, excluded, removed } = input
  const mine = new Map(p.stages.map((st) => [st.id, st]))
  const keys = new Set(p.stages.map((st) => st.key))
  const merged: Stage[] = []
  for (const ls of l.stages) {
    const address = stageAt(object, p.id, ls.id)
    const st = mine.get(ls.id)
    const taken = only(address) && !excluded.has(address)
    if (st) {
      if (excluded.has(address) && only(address)) {
        report.note({ kind: 'excluded', address })
      }
      merged.push(taken ? mergeStage(input, st, ls, address, report) : st)
    } else if (removed?.has(address)) {
      report.note({ kind: 'removed', address })
    } else if (taken) {
      const key = stageKey(ls, keys)
      keys.add(key)
      merged.push(stageOf(ls, key, []))
      report.counts.added += 1
      report.note({ kind: 'added', address })
    }
  }
  return merged
}

// Each stage only the file holds, reported missing, kept after the stage it follows in the file. `merged` changes in
// place.
function keepFileOnly(input: PipelineMergeInput, p: PipelineExport, merged: Stage[], report: Reporting): void {
  const order = p.stages.map((st) => st.id)
  for (const [index, st] of p.stages.entries()) {
    if (merged.some((m) => m.id === st.id)) {
      continue
    }
    const address = stageAt(input.object, p.id, st.id)
    if (input.only(address)) {
      report.counts.missing += 1
      report.note({ kind: 'missing', address })
    }
    const before = order
      .slice(0, index)
      .reverse()
      .find((id) => merged.some((m) => m.id === id))
    merged.splice(before === undefined ? 0 : merged.findIndex((m) => m.id === before) + 1, 0, st)
  }
}

// The stage order pull leaves: the portal's, unless the base says config changed it, which keeps the file's order of
// the stages both hold. A changed order is reported on the pipeline.
function orderStages(
  input: PipelineMergeInput,
  p: PipelineExport,
  merged: Stage[],
  next: PipelineExport,
  fields: Change[],
): Stage[] {
  const pipeline = `pipeline:${input.object}/${p.id}`
  const order = p.stages.map((st) => st.id)
  const resolution = input.resolve?.(pipeline)
  const unit = resolution?.units.find((u) => u.unit === 'stages')
  const ids = (stages: Stage[]) => stages.map((st) => st.id).filter((id) => order.includes(id))
  if (unit && resolution && input.only(pipeline) && keepsFile(unit, resolution)) {
    const kept = inFileOrder(order, merged)
    const kind = unit.class === 'conflict' ? 'conflict' : 'kept'
    fields.push({ kind, address: pipeline, field: 'stages', before: ids(kept), after: ids(merged) })
    next.stages = kept
    return kept
  }
  const was = order.filter((id) => merged.some((m) => m.id === id))
  const now = ids(merged)
  if (input.only(pipeline) && was.join('\u0000') !== now.join('\u0000')) {
    fields.push({ kind: 'changed', address: pipeline, field: 'stages', before: was, after: now })
  }
  return merged
}

// One stage both hold: its label and metadata from the portal, its key and comments from the file.
function mergeStage(input: PipelineMergeInput, st: Stage, ls: LiveStage, address: string, report: Reporting): Stage {
  const fields: Change[] = []
  const next = stageOf(ls, st.key, st.comments)
  if (st.label !== ls.label) {
    fields.push({ kind: 'changed', address, field: 'label', before: st.label, after: ls.label })
  }
  for (const field of STAGE_FIELDS) {
    if (st[field] !== ls[field]) {
      fields.push({ kind: 'changed', address, field, before: st[field], after: ls[field] })
    }
  }
  const merged = { ...next } as unknown as Record<string, unknown>
  resolveFields(address, st as unknown as Record<string, unknown>, merged, fields, input.resolve?.(address))
  report.settle(fields)
  return merged as unknown as Stage
}

// The base decides the units a merge keeps: a config change or a conflict keeps the file's value unless --accept takes
// the portal's. Drift and diverged units keep the portal's value. `merged` and `fields` change in place.
function resolveFields(
  address: string,
  mine: Record<string, unknown>,
  merged: Record<string, unknown>,
  fields: Change[],
  r: Resolution | undefined,
): void {
  for (const u of r?.units ?? []) {
    if (u.unit === 'stages' || !keepsFile(u, r as Resolution)) {
      continue
    }
    const at = fields.findIndex((c) => c.kind === 'changed' && c.field === u.unit)
    if (at >= 0) {
      fields.splice(at, 1)
    }
    fields.push({
      kind: u.class === 'conflict' ? 'conflict' : 'kept',
      address,
      field: u.unit,
      before: mine[u.unit],
      after: merged[u.unit],
    })
    if (mine[u.unit] === undefined) {
      delete merged[u.unit]
    } else {
      merged[u.unit] = mine[u.unit]
    }
  }
}

function keepsFile(u: UnitResult, r: Resolution): boolean {
  return (u.class === 'config-change' || u.class === 'conflict') && !r.accept(u.unit)
}

// The merged stages with the file's stages, among those both hold, in the file's order, each in a slot one of them held.
function inFileOrder(order: string[], merged: Stage[]): Stage[] {
  const queue = order.flatMap((id) => merged.filter((st) => st.id === id))
  return merged.map((st) => (order.includes(st.id) ? (queue.shift() ?? st) : st))
}

function stageOf(ls: LiveStage, key: string, comments: string[]): Stage {
  const out: Stage = { key, id: ls.id, label: ls.label, comments }
  for (const field of STAGE_FIELDS) {
    if (ls[field] !== undefined) {
      Object.assign(out, { [field]: ls[field] })
    }
  }
  return out
}

// A new pipeline's export: PascalCase of the label, ending in Pipeline, unique in the project.
function freshExport(input: PipelineMergeInput, l: LivePipeline): PipelineExport {
  const keys = new Set<string>()
  const stages = l.stages.map((ls) => {
    const key = stageKey(ls, keys)
    keys.add(key)
    return stageOf(ls, key, [])
  })
  const name = unique(pipelineExportName(l.label, l.id), input.taken)
  input.taken.add(name)
  return { name, object: input.object, id: l.id, label: l.label, displayOrder: l.displayOrder, stages, comments: [] }
}

/**
 * The export name pull gives a pipeline: PascalCase of the words of its label, followed by `Pipeline` unless the label
 * ends with that word, `SalesPipeline` for "Sales Pipeline"; the ID's words when the label has no letter.
 */
export function pipelineExportName(label: string, id: string): string {
  const words = (text: string) => text.split(NOT_ALNUM).filter(Boolean)
  const parts = words(label).some((w) => LETTER.test(w)) ? words(label) : words(id)
  const name = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('')
  const base = DIGIT_FIRST.test(name) || name === '' ? `Pipeline${name}` : name
  return base.endsWith('Pipeline') ? base : `${base}Pipeline`
}

/**
 * The key pull gives a stage: camelCase of its ID when the ID is a lowercase slug, else of its label, with `stage` in
 * front of one that would start with a digit, unique in the pipeline.
 */
export function stageKey(ls: Pick<LiveStage, 'id' | 'label'>, taken: ReadonlySet<string>): string {
  const words = (text: string) => text.toLowerCase().split(NOT_ALNUM).filter(Boolean).join('_')
  const base = camelCase(SLUG.test(ls.id) ? ls.id : words(ls.label) || words(ls.id)) || 'stage'
  return unique(DIGIT_FIRST.test(base) ? `stage${base}` : base, taken)
}

function unique(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) {
    return name
  }
  let n = 2
  while (taken.has(`${name}${n}`)) {
    n += 1
  }
  return `${name}${n}`
}

function stageAt(object: string, pipeline: string, stage: string): string {
  return `stage:${object}/${pipeline}/${stage}`
}

// Portal strings are untrusted, so every string in a change line is sanitized before it reaches any output.
function scrub(change: Change): Change {
  const clean = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return sanitize(value)
    }
    return Array.isArray(value) ? value.map(clean) : value
  }
  const out: Change = { ...change, address: sanitize(change.address) }
  if (change.field !== undefined) {
    out.field = sanitize(change.field)
  }
  if (change.before !== undefined) {
    out.before = clean(change.before)
  }
  if (change.after !== undefined) {
    out.after = clean(change.after)
  }
  return out
}
