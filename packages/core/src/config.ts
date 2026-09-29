// The config authoring surface: `import { defineConfig } from '@kalup/core'` in kalup.config.ts, and
// `import { defineRemoved } from '@kalup/core'` in kalup/removed.ts. The tool parses those files and never runs them,
// and the app never imports them, so these exist for editor types. The reader returns the same shapes.
import type { EnumOption, PropertyLifecycle } from './codecs/definition.js'

/**
 * Property or group definition fields as a config file states them, every one optional. A target's override states only
 * the fields that differ on that target, and each field it states replaces the shared field whole.
 */
export interface Definition {
  /** The description HubSpot shows. An empty string owns an empty description. */
  description?: string
  /** HubSpot's field type, such as `select` or `text`. It must be one the builder takes. */
  fieldType?: string
  /** Whether the property can be used in forms. */
  formField?: boolean
  /** The internal name of a group of the same object. */
  group?: string
  /** Whether HubSpot enforces a unique value. A target override may not change it. */
  hasUniqueValue?: boolean
  /** The label HubSpot shows. */
  label?: string
  /** How a plan treats this definition over time. */
  lifecycle?: PropertyLifecycle
  /**
   * The options in display order. An override's options are the whole list on that target, with no merge by value.
   * `options: []` owns an empty list.
   */
  options?: EnumOption[]
}

/** One object's pull scope under `objects`: which of its properties the files hold. */
export interface ObjectScope {
  /**
   * The export name pull gives the object when it writes it for the first time. An export that already exists keeps its
   * name.
   * @default PascalCase singular of the object key, so `line_items` becomes `LineItem`
   */
  as?: string
  /**
   * Pull every property HubSpot did not define.
   * @default true
   */
  custom?: boolean
  /**
   * HubSpot-defined properties to pull as well, by internal name.
   * @default []
   */
  include?: string[]
}

/** How one target differs from the files for one resource. The key is an address that exists in config. */
export interface Override {
  /**
   * Definition fields that differ on this target. Each field stated replaces the shared field whole; the fields left out
   * stay shared.
   * @default undefined, so the shared definition applies
   */
  definition?: Definition
  /**
   * Values that re-point a lookup resource on this target. Parsed and validated; no managed type uses it yet.
   * @default undefined
   */
  lookup?: Record<string, string>
  /**
   * The internal name this resource has on this target.
   * @default undefined, so the name in the files
   */
  name?: string
  /**
   * Leave the resource out on this target. A skipped group takes its config properties with it.
   * @default undefined, so the resource is in
   */
  skip?: true
}

/** Where a key comes from. */
interface Credential {
  /** The name of the environment variable that holds the key, such as `HUBSPOT_SANDBOX_KEY`. Never the key itself. */
  env: string
}

/**
 * A named portal pinned to a portal ID. A target is a name you chose, never an environment. `portalId` is optional
 * here only because the reader tolerates a missing one so validate can report it; {@link KalupConfig} requires it.
 */
export interface Target {
  /**
   * Whether a destroy tombstone may delete in this portal.
   * @default false
   */
  allowDestroy?: boolean
  /**
   * The environment variables that hold the keys. Only the variable's name is written here, never a key.
   * @default { read: { env: 'HUBSPOT_SERVICE_KEY' } }
   */
  credentials?: {
    /** The variable that holds the read key. */
    read: Credential
    /**
     * The variable that holds the write key, for apply, `state rebuild --write` and `target rebind`. `--approve` needs
     * one apart from the read variable.
     * @default the read variable
     */
    write?: Credential
  }
  /**
   * How a plan treats edits made in the HubSpot UI: `'hold'` holds drift for a person to settle, `'overwrite'` writes
   * config over it. A unit with no base in state is held either way.
   * @default 'hold'
   */
  drift?: 'hold' | 'overwrite'
  /**
   * Per-resource differences on this target, keyed by address, such as `property:companies/billing_status`.
   * @default {}
   */
  overrides?: Record<string, Override>
  /** The Hub ID of the portal: the wrong-portal guard. A positive integer, required. */
  portalId?: number
  /**
   * Whether an apply needs a saved plan and a person at a terminal, or a reviewed CI job with `--approve`.
   * @default false for a DEVELOPER_TEST, SANDBOX or APP_DEVELOPER account, else true
   */
  protected?: boolean
}

/** What defineConfig takes: the whole of kalup.config.ts. */
export interface KalupConfig {
  /**
   * The target a command uses when it is given none. It must name a declared target. It picks a target for one
   * invocation and never enters the IR.
   * @default undefined, so the only target, or a prompt at a terminal
   */
  defaultTarget?: string
  /**
   * The project name, `project` in the IR.
   * @default the project directory's name
   */
  name?: string
  /**
   * The pull scope, keyed by object name: a standard object's HubSpot name, such as `companies`, or a custom object's
   * name.
   * @default {}
   */
  objects?: Record<string, ObjectScope>
  /**
   * When set, validate warns for every managed property whose internal name does not start with it.
   * @default undefined, so no check
   */
  prefix?: string
  /**
   * The portals this project works with, keyed by target name. `config` is not a valid name.
   * @default {}
   */
  targets?: Record<
    string,
    Omit<Target, 'portalId'> & {
      /** The Hub ID of the portal: the wrong-portal guard. A positive integer. */
      portalId: number
    }
  >
}

// Not generic on purpose: a type parameter inferred from the literal would switch off excess property checks, and a
// misspelled field would type-check while the reader rejects it.
/** Types kalup.config.ts. Returns its argument: the tool parses the file and never runs it. */
export function defineConfig(config: KalupConfig): KalupConfig {
  return config
}

/** One entry of kalup/removed.ts, written by kalup rm. */
export interface Tombstone {
  /** `'destroy'` deletes the resource in a target that allows it; `'release'` stops managing it and leaves it. */
  action: 'destroy' | 'release'
  /**
   * Why the resource was removed, for the people reading the file.
   * @default undefined
   */
  reason?: string
}

/** What defineRemoved takes: a tombstone per property or group address, written by kalup rm. */
export type KalupRemoved = Record<`property:${string}/${string}` | `group:${string}/${string}`, Tombstone>

/** Types kalup/removed.ts. Returns its argument: the tool parses the file and never runs it. */
export function defineRemoved(removed: KalupRemoved): KalupRemoved {
  return removed
}
