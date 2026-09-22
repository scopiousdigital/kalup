// Data shapes the reader returns and the writer takes. They are the contract for the loader.

import type { Issue } from '../ir/types.js'

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

export interface Option {
  as?: string
  description?: string
  hidden?: boolean
  label: string
  value: string
}

export interface LifecycleFields {
  ignoreChanges?: string[]
  options?: 'additive' | 'exact'
  preventDestroy?: boolean
  removedOptions?: string[]
}

export interface Definition {
  description?: string
  fieldType?: string
  formField?: boolean
  group?: string
  hasUniqueValue?: boolean
  label?: string
  lifecycle?: LifecycleFields
  options?: Option[]
}

export interface Property {
  chain: { required: boolean; readonly: boolean; managed: boolean }
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

export interface ObjectScope {
  as?: string
  custom?: boolean
  include?: string[]
}

export interface Override {
  definition?: Definition
  lookup?: Record<string, string>
  name?: string
  skip?: true
}

export interface Target {
  credentials?: { read: { env: string }; write?: { env: string } }
  drift?: 'hold' | 'overwrite'
  overrides?: Record<string, Override>
  portalId?: number
  protected?: boolean
}

export interface ConfigFile {
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
  name?: string
  objects: Record<string, ObjectScope>
  prefix?: string
  targets: Record<string, Target>
}

export interface BarrelEntry {
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
