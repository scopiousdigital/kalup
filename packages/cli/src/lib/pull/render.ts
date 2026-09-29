// IR resources back into the grammar's shapes: the inverse of core's definitionToIR and the loader's property rules. A
// blueprint is IR, so add and upgrade render it through here and then the canonical writer. Pure.
import {
  type Address,
  type BuilderKind,
  DEFAULTS,
  type Definition,
  defaultCodec,
  type Group,
  type IROption,
  type IRResource,
  type LifecycleFields,
  type Property,
} from '@kalup/core'
import { camelCase } from './keys.js'

/**
 * A property resource as a `p.<kind>(...)` entry: the key from `binding.key` or camelCase of the name, the kind from
 * the codec (or the one the HubSpot type implies), each option's `as` from `binding.aliases`, the chain from
 * `required`, `readonly` and `managed`, the group `$ref` as the group's name, and a lifecycle that differs from the
 * default. `previous`, the entry the file holds today, keeps its comments, its p.json validator and the lifecycle
 * fields it states, so a rendered entry changes only what the resource changed.
 */
export function toProperty(address: Address, resource: IRResource, previous?: Property): Property {
  const name = nameOf(address)
  const d = resource.definition ?? {}
  const binding = resource.binding ?? {}
  const kind = (binding.codec ?? defaultCodec(d.type, d.fieldType) ?? previous?.kind ?? 'string') as BuilderKind
  const aliases = binding.aliases ?? {}
  const options = d.options as IROption[] | undefined
  const definition = compact<Definition>({
    label: d.label as string | undefined,
    group: groupName(d.group),
    fieldType: d.fieldType as string | undefined,
    description: d.description as string | undefined,
    options: options?.map((o) =>
      compact({
        value: o.value,
        label: o.label,
        as: Object.hasOwn(aliases, o.value) ? aliases[o.value] : undefined,
        hidden: o.hidden,
        description: o.description,
      }),
    ),
    hasUniqueValue: d.hasUniqueValue as boolean | undefined,
    formField: d.formField as boolean | undefined,
    lifecycle: lifecycleOf(resource.lifecycle, previous?.definition?.lifecycle),
  })
  const full = definition.label !== undefined && definition.group !== undefined && definition.fieldType !== undefined
  const json = kind === 'json' && previous?.json ? { json: previous.json } : {}
  return {
    key: binding.key ?? camelCase(name),
    kind,
    name,
    ...(Object.keys(definition).length > 0 ? { definition } : {}),
    ...json,
    // A reference is never .managed(false): only a full definition can be left unmanaged.
    chain: {
      required: binding.required === true,
      readonly: binding.readonly === true,
      managed: resource.managed || !full,
    },
    comments: previous?.comments ?? [],
  }
}

/** A group resource as a `groups` entry, keeping the comments of the entry the file holds today. */
export function toGroup(address: Address, resource: IRResource, previous?: Group): Group {
  return { name: nameOf(address), label: String(resource.definition?.label ?? ''), comments: previous?.comments ?? [] }
}

/** The last path segment of a property or group address. */
function nameOf(address: Address): string {
  return address.slice(address.lastIndexOf('/') + 1)
}

function groupName(group: unknown): string | undefined {
  const ref = (group as { $ref?: unknown } | undefined)?.$ref
  return typeof ref === 'string' ? nameOf(ref) : undefined
}

// The lifecycle fields that differ from the default, and any the file states today, a stated default written as its
// value (`preventDestroy: false`). A lifecycle the file states stays, `{}` included: a present field is owned.
function lifecycleOf(
  lifecycle: IRResource['lifecycle'],
  stated: LifecycleFields | undefined,
): LifecycleFields | undefined {
  if (!lifecycle) {
    return undefined
  }
  const keep = (field: keyof LifecycleFields, isDefault: boolean) => !isDefault || stated?.[field] !== undefined
  const out = compact<LifecycleFields>({
    options: keep('options', lifecycle.options === DEFAULTS.lifecycle.options) ? lifecycle.options : undefined,
    removedOptions: lifecycle.removedOptions,
    ignoreChanges: lifecycle.ignoreChanges,
    preventDestroy: keep('preventDestroy', lifecycle.preventDestroy !== true)
      ? lifecycle.preventDestroy === true
      : undefined,
  })
  return Object.keys(out).length > 0 || stated !== undefined ? out : undefined
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T
}
