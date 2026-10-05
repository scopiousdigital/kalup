// Pipelines and their stages as the files in the pipelines/ folder carry them, in HubSpot terms. The app imports these
// files for typed pipeline and stage IDs; the tool parses them and never runs them.

/** Whether a ticket or custom object stage counts as closed. */
export type StageState = 'OPEN' | 'CLOSED'

/**
 * One stage. Its place in the pipeline is its place among the `stages` entries. The metadata field depends on the
 * object: `probability` on deals, `ticketState` on tickets, `state` on custom objects. HubSpot derives `isClosed` from
 * it, so config never states it.
 */
export interface StageSpec {
  /** The stage ID HubSpot stores: unique within the object type, at most 100 characters, never changed. */
  id: string
  /** The label HubSpot shows. Unique within the pipeline, ignoring case. */
  label: string
  /** Deals only: the chance a deal in this stage closes, from 0 to 1. 0 and 1 make the stage closed. */
  probability?: number
  /**
   * Custom objects only: whether a record in this stage is closed.
   * @default 'OPEN'
   */
  state?: StageState
  /**
   * Tickets only: whether a ticket in this stage is closed. A ticket pipeline needs at least one closed stage.
   * @default 'OPEN'
   */
  ticketState?: StageState
}

/** What definePipeline takes besides the object. */
export interface PipelineSpec {
  /** Where HubSpot lists the pipeline among the object's pipelines, lowest first. Pipelines may share a number. */
  displayOrder: number
  /** The pipeline ID HubSpot stores: unique across the portal's pipelines, at most 36 characters, never changed. */
  id: string
  /** The label HubSpot shows. Unique among the object's pipelines, ignoring case. */
  label: string
  /** The stages in display order, keyed by a name the app chooses. At least one. */
  stages: Record<string, StageSpec>
}

export interface DefinedPipeline<S extends PipelineSpec> {
  readonly displayOrder: number
  readonly id: S['id']
  readonly label: string
  /** The object the pipeline belongs to, such as `deals`. */
  readonly object: string
  readonly stages: S['stages']
}

/**
 * A pipeline of `object`: a standard object's name, such as `deals` or `tickets`, or a custom object's name. Its IDs
 * keep their literal types, so `Renewals.stages.won.id` is typed `'renewals_won'`.
 */
export function definePipeline<const S extends PipelineSpec>(object: string, spec: S): DefinedPipeline<S> {
  return { object, id: spec.id, label: spec.label, displayOrder: spec.displayOrder, stages: spec.stages }
}

/** The stage IDs of a pipeline as a union, `StageId<typeof Renewals>`: what a record's stage property holds. */
export type StageId<P extends { readonly stages: Record<string, { readonly id: string }> }> =
  P['stages'][keyof P['stages']]['id']
