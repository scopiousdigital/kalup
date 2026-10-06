// Every field the config files can set, at every level each is allowed, as the reader returns it. Each literal
// satisfies Required<> of its type, so a field added to a type does not compile here until this data sets it, and the
// round trip then proves the reader and the writer carry it. fixtures/grammar/every*.ts are these, written.
import type {
  Definition,
  EnumOption,
  KalupConfig,
  NumberDisplay,
  ObjectScope,
  Override,
  PropertyDefinition,
  PropertyLifecycle,
  Target,
  TargetObject,
  TextDisplay,
  Tombstone,
} from '@kalup/core'
import type {
  AssociationEntry,
  AssociationsFile,
  ConfigFile,
  Group,
  ObjectExport,
  ObjectFile,
  PipelineExport,
  PipelineFile,
  Property,
  RemovedFile,
  Stage,
} from '../../src/grammar/types.js'

const option = {
  value: 'CLAY',
  label: 'Clay',
  as: 'clay',
  hidden: false,
  description: 'Heavy soil',
} satisfies Required<EnumOption>

const lifecycle = {
  options: 'exact',
  removedOptions: ['sand'],
  ignoreChanges: ['description'],
  preventDestroy: true,
} satisfies Required<PropertyLifecycle>

const definition = {
  label: 'Soil type',
  group: 'orchard',
  fieldType: 'select',
  description: 'The dominant soil',
  options: [option, { value: 'loam', label: 'Loam' }],
  hasUniqueValue: false,
  formField: true,
  hidden: false,
  displayOrder: -1,
  numberDisplayHint: 'percentage',
  showCurrencySymbol: true,
  currencyPropertyName: 'orch_currency',
  textDisplayHint: 'multi_line',
  calculationFormula: 'orch_rows * 2',
  dataSensitivity: 'non_sensitive',
  lifecycle,
} satisfies Required<Definition> & Required<PropertyDefinition & NumberDisplay & TextDisplay>

const override = {
  skip: true,
  name: 'orch_soil_type',
  definition: { ...definition, probability: 0.4, ticketState: 'CLOSED', state: 'OPEN', inverseLabel: 'Grower' },
  lookup: { pipeline: 'orchard_sales' },
} satisfies Required<Override> & { definition: Required<NonNullable<Override['definition']>> }

const credentials = {
  read: { env: 'HUBSPOT_SANDBOX_KEY' },
  write: { env: 'HUBSPOT_SANDBOX_WRITE_KEY' },
} satisfies Required<NonNullable<Target['credentials']>>

const targetObject = { mode: 'takeover' } satisfies Required<TargetObject>

const target = {
  portalId: 1_111_111,
  mode: 'addon',
  protected: true,
  drift: 'overwrite',
  adopt: 'overwrite',
  allowDestroy: true,
  yesLimit: 100,
  credentials,
  objects: { companies: targetObject },
  overrides: { 'property:companies/soil_type': override },
} satisfies Required<Target>

const scope = {
  mode: 'takeover',
  include: ['name', 'lifecyclestage'],
  exclude: ['zi_*', 'orch_legacy'],
  custom: false,
  as: 'Firm',
  pipelines: true,
  associations: true,
} satisfies Required<ObjectScope>

const config = {
  name: 'orchard-crm',
  dir: 'lib/config/hubspot',
  state: 'repo',
  prefix: 'orch_',
  defaultTarget: 'sandbox',
  mode: 'takeover',
  objects: { companies: scope },
  targets: { sandbox: target },
} satisfies Required<KalupConfig>

export const everyConfig = {
  header: ['Every config field, at every level it is allowed.'],
  imports: [],
  ...config,
} satisfies Required<ConfigFile>

const tombstone = { action: 'destroy', reason: 'Replaced by soil_type' } satisfies Required<Tombstone>

export const everyRemoved = {
  header: ['Every tombstone field.'],
  imports: [],
  tombstones: { 'group:companies/legacy': { action: 'release' }, 'property:companies/soil_kind': tombstone },
} satisfies Required<RemovedFile>

const group = { name: 'orchard', label: 'Orchard details', comments: ['Kept by hand.'] } satisfies Required<Group>

const property = {
  key: 'rowMeta',
  kind: 'json',
  name: 'row_meta',
  definition: { ...definition, label: 'Row meta', fieldType: 'textarea', options: [] },
  json: { validatorSource: 'rowMeta' },
  chain: { required: true, readonly: true, managed: false },
  comments: ['Every definition field and every chain call.'],
} satisfies Required<Property>

const custom = {
  builder: 'defineCustomObject',
  name: 'Harvest',
  object: 'harvest',
  labels: { singular: 'Harvest', plural: 'Harvests' },
  description: 'One picking of one row.',
  primaryDisplayProperty: 'batch_code',
  requiredProperties: ['batch_code'],
  searchableProperties: ['batch_code'],
  secondaryDisplayProperties: ['row_meta'],
  groups: [group],
  properties: [
    property,
    {
      key: 'soilType',
      kind: 'enum',
      name: 'soil_type',
      definition,
      chain: { strict: true, required: true, readonly: true, managed: false },
      comments: [],
    },
  ],
  comments: ['Every field a custom object takes.'],
} satisfies Required<ObjectExport>

export const everyObject = {
  header: ['Every object field.'],
  imports: ["import { rowMeta } from '../../src/row-meta.js'"],
  exports: [custom],
} satisfies Required<ObjectFile>

const stage = {
  key: 'picked',
  id: 'harvests_picked',
  label: 'Picked',
  probability: 0.5,
  ticketState: 'OPEN',
  state: 'CLOSED',
  comments: ['Every stage field, whatever the object.'],
} satisfies Required<Stage>

const pipeline = {
  name: 'HarvestsPipeline',
  object: 'harvest',
  id: 'harvests',
  label: 'Harvests',
  displayOrder: 3,
  stages: [stage, { key: 'sold', id: 'harvests_sold', label: 'Sold', comments: [] }],
  comments: ['Every pipeline field.'],
} satisfies Required<PipelineExport>

export const everyPipeline = {
  header: ['Every pipeline file field.'],
  imports: [],
  exports: [pipeline],
} satisfies Required<PipelineFile>

const association = {
  key: 'grower',
  from: 'harvest',
  to: 'companies',
  name: 'harvest_grower',
  label: 'Grower',
  inverseLabel: 'Grown harvest',
  comments: ['Every association field.'],
} satisfies Required<AssociationEntry>

export const everyAssociations = {
  header: ['Every associations file field.'],
  imports: [],
  name: 'Associations',
  comments: ['The labels between the objects.'],
  entries: [association, { key: 'plain', from: 'harvest', to: 'contacts', name: 'harvest_to_contact', comments: [] }],
} satisfies Required<AssociationsFile>
