// Data shapes the reader returns and the writer takes. They are the contract for the loader.

import type {
  Definition,
  EnumOption,
  KalupConfig,
  ObjectScope,
  PropertyLifecycle,
  StageState,
  Target,
  Tombstone,
} from '@kalup/core'
import type { Issue } from '../ir/types.js'

// What users write is typed in @kalup/core. The reader returns those shapes, so the engine names them from there.
export type {
  Definition,
  Mode,
  ObjectScope,
  Override,
  StageState,
  Target,
  TargetObject,
  Tombstone,
} from '@kalup/core'
export type Option = EnumOption
export type LifecycleFields = PropertyLifecycle

export type BuilderKind =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'multiEnum'
  | 'stringArray'
  | 'json'
  | 'phoneNumber'
  | 'owner'

export interface Property {
  /** `strict` is present, and true, only on a p.enum or p.multiEnum entry that calls `.strict()`. */
  chain: { strict?: boolean; required: boolean; readonly: boolean; managed: boolean }
  comments: string[]
  definition?: Definition
  json?: { validatorSource: string }
  key: string
  kind: BuilderKind
  name: string
}

export interface Group {
  comments: string[]
  label: string
  name: string
}

export interface ObjectExport {
  builder: 'defineObject' | 'defineCustomObject'
  comments: string[]
  description?: string
  groups: Group[]
  labels?: { singular: string; plural: string }
  name: string
  object: string
  primaryDisplayProperty?: string
  properties: Property[]
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

/** One stage of a pipeline export, in file order. Only the metadata field of the pipeline's object is meaningful. */
export interface Stage {
  comments: string[]
  id: string
  /** The TypeScript key the app reads the stage under. */
  key: string
  label: string
  probability?: number
  state?: StageState
  ticketState?: StageState
}

/** `export const <name> = definePipeline('<object>', {...})` in a file under the pipelines folder. */
export interface PipelineExport {
  comments: string[]
  displayOrder: number
  id: string
  label: string
  name: string
  object: string
  stages: Stage[]
}

/** One entry of `associations.ts`: an association label, or the plain association of a pair when it has no label. */
export interface AssociationEntry {
  comments: string[]
  from: string
  inverseLabel?: string
  /** The TypeScript key the app reads the entry under. */
  key: string
  label?: string
  name: string
  to: string
}

/** `<dir>/associations.ts`: one `export const <Name> = defineAssociations({...})`. */
export interface AssociationsFile {
  /** The comments before the export. */
  comments: string[]
  entries: AssociationEntry[]
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
  /** The export name, `Associations` when pull writes the file. */
  name: string
}

export interface PipelineFile {
  exports: PipelineExport[]
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
}

export interface ObjectFile {
  exports: ObjectExport[]
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
}

/** kalup.config.ts as the reader returns it: what defineConfig takes, plus the header and imports the reader owns. */
export interface ConfigFile extends Omit<KalupConfig, 'objects' | 'targets'> {
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
  objects: Record<string, ObjectScope>
  targets: Record<string, Target>
}

/** removed.ts in the folder of object files: `export default defineRemoved({...})`. */
export interface RemovedFile {
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
  /** By key as written, an address unless validate says otherwise. */
  tombstones: Record<string, Tombstone>
}

export interface BarrelEntry {
  /** The associations export, which has no `<name>Data` type to re-export either. */
  associations?: true
  /** The object file's path from the barrel, no extension, such as `./objects/companies`. The writer adds `.js`. */
  from: string
  name: string
  /** A pipeline export, which has no `<name>Data` type to re-export. */
  pipeline?: true
}

export class IssueError extends Error {
  readonly issues: Issue[]

  constructor(issues: Issue[]) {
    super(issues.map((i) => `${i.code}: ${i.message} (${i.file}:${i.line})`).join('\n'))
    this.issues = issues
    this.name = 'IssueError'
  }
}
