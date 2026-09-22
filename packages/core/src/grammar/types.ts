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
  value: string
  label: string
  as?: string
  hidden?: boolean
  description?: string
}

export interface LifecycleFields {
  options?: 'additive' | 'exact'
  removedOptions?: string[]
  ignoreChanges?: string[]
  preventDestroy?: boolean
}

export interface Definition {
  label?: string
  group?: string
  fieldType?: string
  description?: string
  options?: Option[]
  hasUniqueValue?: boolean
  formField?: boolean
  lifecycle?: LifecycleFields
}

export interface Property {
  key: string
  kind: BuilderKind
  name: string
  definition?: Definition
  chain: { required: boolean; readonly: boolean; managed: boolean }
  json?: { validatorSource: string }
  comments: string[]
}

export interface Group {
  name: string
  label: string
  comments: string[]
}

export interface ObjectExport {
  name: string
  builder: 'defineObject' | 'defineCustomObject'
  object: string
  comments: string[]
  labels?: { singular: string; plural: string }
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
  groups: Group[]
  properties: Property[]
}

export interface ObjectFile {
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
  exports: ObjectExport[]
}

export interface ObjectScope {
  include?: string[]
  custom?: boolean
  as?: string
}

export interface Override {
  skip?: true
  name?: string
  definition?: Definition
  lookup?: Record<string, string>
}

export interface Target {
  portalId?: number
  protected?: boolean
  drift?: 'hold' | 'overwrite'
  credentials?: { read: { env: string }; write?: { env: string } }
  overrides?: Record<string, Override>
}

export interface ConfigFile {
  /** The comment block before the imports, re-emitted at the top of the file. Absent when the file has none. */
  header?: string[]
  imports: string[]
  name?: string
  prefix?: string
  objects: Record<string, ObjectScope>
  targets: Record<string, Target>
}

export interface BarrelEntry {
  name: string
  from: string
}

export class IssueError extends Error {
  constructor(readonly issues: Issue[]) {
    super(issues.map((i) => `${i.code}: ${i.message} (${i.file}:${i.line})`).join('\n'))
    this.name = 'IssueError'
  }
}
