// Data shapes the reader returns and the writer takes. They are the contract for the loader.

import type {
  Definition,
  EnumOption,
  KalupConfig,
  ObjectScope,
  PropertyLifecycle,
  Target,
  Tombstone,
} from '@kalup/core'
import type { Issue } from '../ir/types.js'

// What users write is typed in @kalup/core. The reader returns those shapes, so the engine names them from there.
export type { Definition, Mode, ObjectScope, Override, Target, TargetObject, Tombstone } from '@kalup/core'
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
  /** The object file's path from the barrel, no extension, such as `./objects/companies`. The writer adds `.js`. */
  from: string
  name: string
}

export class IssueError extends Error {
  readonly issues: Issue[]

  constructor(issues: Issue[]) {
    super(issues.map((i) => `${i.code}: ${i.message} (${i.file}:${i.line})`).join('\n'))
    this.issues = issues
    this.name = 'IssueError'
  }
}
