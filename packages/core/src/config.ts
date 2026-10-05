// The config authoring surface: `import { defineConfig } from '@kalup/core'` in kalup.config.ts, and
// `import { defineRemoved } from '@kalup/core'` in removed.ts in the folder of object files (hubspot/ by default). The
// tool parses those files and never runs them, and the app never imports them, so these exist for editor types. The
// reader returns the same shapes.
import type {
  DataSensitivity,
  EnumOption,
  NumberDisplayHint,
  PropertyLifecycle,
  TextDisplayHint,
} from './codecs/definition.js'
import type { StageSpec } from './codecs/pipeline.js'

/**
 * Property or group definition fields as a config file states them, every one optional. A target's override states only
 * the fields that differ on that target, and each field it states replaces the shared field whole.
 */
export interface Definition {
  /** The formula of a calculation property, whose fieldType is `calculation_equation`. */
  calculationFormula?: string
  /** The property HubSpot reads the currency code from. `p.number` only, with `showCurrencySymbol: true`. */
  currencyPropertyName?: string
  /** Sensitive data, set when HubSpot creates the property. A target override may not change it. */
  dataSensitivity?: DataSensitivity
  /** The description HubSpot shows. An empty string owns an empty description. */
  description?: string
  /** The property's place in its group: the lowest positive number first, `-1` after every positive one. */
  displayOrder?: number
  /** HubSpot's field type, such as `select` or `text`. It must be one the builder takes. */
  fieldType?: string
  /** Whether the property can be used in forms. */
  formField?: boolean
  /** The internal name of a group of the same object. */
  group?: string
  /** Whether HubSpot enforces a unique value. A target override may not change it. */
  hasUniqueValue?: boolean
  /** Whether HubSpot hides the property. */
  hidden?: boolean
  /** The label HubSpot shows. */
  label?: string
  /** How a plan treats this definition over time. */
  lifecycle?: PropertyLifecycle
  /** How HubSpot shows a number. `p.number` only. */
  numberDisplayHint?: NumberDisplayHint
  /**
   * The options in display order. An override's options are the whole list on that target, with no merge by value.
   * `options: []` owns an empty list.
   */
  options?: EnumOption[]
  /** Whether HubSpot shows the currency symbol with a number. `p.number` only. */
  showCurrencySymbol?: boolean
  /** How HubSpot shows and checks text. `p.string`, `p.stringArray`, `p.json` and `p.phoneNumber` only. */
  textDisplayHint?: TextDisplayHint
}

/**
 * What Kalup does with a custom property or group the portal holds and config lacks. `'addon'` leaves it alone.
 * `'takeover'` archives it when it is in the object's pull scope, and removes enum options only the portal holds; every
 * such removal needs `allowDestroy: true` on the target and a person at a terminal.
 */
export type Mode = 'addon' | 'takeover'

/**
 * One object's pull scope under `objects`: which of its properties the files hold. Every property an object file
 * defines is in scope whatever these settings say; they choose the rest.
 */
export interface ObjectScope {
  /**
   * The export name pull gives the object when it writes it for the first time. An export that already exists keeps its
   * name.
   * @default PascalCase singular of the object key, so `line_items` becomes `LineItem`
   */
  as?: string
  /**
   * Pull every property HubSpot did not define. `false` pulls no custom property the files do not define already.
   * @default true
   */
  custom?: boolean
  /**
   * Internal names of properties and groups to leave out: never pulled into the files, never archived by takeover. `*`
   * matches any run of characters, as in `--only`. `include` wins for a HubSpot-defined property it names; a name in
   * both lists is an error.
   * @default []
   */
  exclude?: string[]
  /**
   * Properties to pull as well, by internal name: HubSpot-defined ones, or custom ones while `custom` is off. The files'
   * own properties need no entry.
   * @default []
   */
  include?: string[]
  /**
   * The mode for this object. A target's statement wins over it.
   * @default the top-level mode
   */
  mode?: Mode
  /**
   * Pull the object's pipelines and their stages into the pipelines folder. A pipeline the files define is in scope
   * either way. Takeover never archives a pipeline or a stage.
   * @default false
   */
  pipelines?: boolean
}

/** One object's settings on one target, under `targets.<target>.objects`. */
export interface TargetObject {
  /**
   * The mode for this object on this target: the most specific statement, so it wins over every other.
   * @default the target's mode
   */
  mode?: Mode
}

/** How one target differs from the files for one resource. The key is an address that exists in config. */
export interface Override {
  /**
   * Definition fields that differ on this target. Each field stated replaces the shared field whole; the fields left out
   * stay shared. A pipeline takes `label` and `displayOrder`, a stage `label` and its metadata field.
   * @default undefined, so the shared definition applies
   */
  definition?: Definition & Pick<StageSpec, 'probability' | 'state' | 'ticketState'>
  /**
   * Values that re-point a lookup resource on this target. Parsed and validated; no managed type uses it yet.
   * @default undefined
   */
  lookup?: Record<string, string>
  /**
   * The internal name this resource has on this target: a pipeline's or a stage's ID for those.
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
   * What a plan does with a unit that has no base in state and differs from the portal, as on a first adoption:
   * `'hold'` holds it for a person to settle, `'overwrite'` writes config over the portal's value, as a risky step
   * labelled `overwrites-portal` that `--yes` never covers.
   * @default 'hold'
   */
  adopt?: 'hold' | 'overwrite'
  /**
   * Whether this portal may lose things: a destroy tombstone, and every takeover removal. Never inherited.
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
   * The mode on this target, for every object. It wins over the top level and `objects.<object>.mode`; only
   * `targets.<target>.objects.<object>.mode` wins over it.
   * @default the object's mode
   */
  mode?: Mode
  /**
   * Per-object settings on this target, keyed by an object `objects` names.
   * @default {}
   */
  objects?: Record<string, TargetObject>
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
  /**
   * The most writes, adoptions and releases one `--yes` covers, an integer from 0 to 1000. `0` turns `--yes` off.
   * @default 25
   */
  yesLimit?: number
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
   * The folder of object files, relative to the project directory, such as `'lib/config/hubspot'`. It holds
   * `objects/<object>.ts`, `index.ts` and `removed.ts`. It must lie inside the project directory.
   * @default 'hubspot'
   */
  dir?: string
  /**
   * The mode for every object, unless an object or a target states its own.
   * @default 'addon'
   */
  mode?: Mode
  /**
   * The project name, `project` in the IR and the heading of the data dictionary.
   * @default the name in the nearest package.json up to the repository root, else the project directory's name
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
   * Where state lives. `'local'`: in `.kalup/state/`, gitignored, on this machine only. `'repo'`: in `state/` inside
   * the folder of object files, committed with them, so teammates and CI share it. It holds no key and no record data.
   * The portal lock and the journal stay local either way.
   * @default 'local'
   */
  state?: 'local' | 'repo'
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

/** One entry of removed.ts in the folder of object files, written by kalup rm. */
export interface Tombstone {
  /** `'destroy'` deletes the resource in a target that allows it; `'release'` stops managing it and leaves it. */
  action: 'destroy' | 'release'
  /**
   * Why the resource was removed, for the people reading the file.
   * @default undefined
   */
  reason?: string
}

/**
 * What defineRemoved takes: a tombstone per custom object, property, group, pipeline or stage address, written by
 * kalup rm.
 */
export type KalupRemoved = Record<
  | `object:${string}`
  | `property:${string}/${string}`
  | `group:${string}/${string}`
  | `pipeline:${string}/${string}`
  | `stage:${string}/${string}/${string}`,
  Tombstone
>

/** Types removed.ts in the folder of object files. Returns its argument: the tool parses the file and never runs it. */
export function defineRemoved(removed: KalupRemoved): KalupRemoved {
  return removed
}
