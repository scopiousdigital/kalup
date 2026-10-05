// Every issue code Kalup raises, with its documentation: the one source for both. `IssueCode` is its keys, so raising a
// code that is not here does not compile. scripts/gen-docs.mjs writes the pages from it: packages/cli/docs/errors/
// <CODE>.md, which ships in the kalup package and which each issue's `docs` names, and the website's errors reference.
// Edit an entry here, then run `pnpm gen`. Only the type leaves this file: no command reads the prose at run time.

interface IssueDoc {
  /** A config snippet that raises the issue, and the lines the CLI prints for it. */
  example?: { config?: string[]; output: string[] }
  /** The Exit column of the website index. */
  exit: string
  /** Paragraphs of the Fix section. */
  fix: string[]
  /** The line under the page heading, with the exit code. */
  summary: string
  /** The Meaning column of the website index. */
  title: string
  /** Paragraphs of the When section. */
  when: string[]
}

export const issues = {
  E_ACCEPT_UNMATCHED: {
    exit: '1',
    title: 'A `pull --accept` selector matches nothing pull keeps',
    summary: 'A `pull --accept` selector matches nothing pull keeps. Exit 1. Nothing was written.',
    when: [
      "Where state owns a resource, pull keeps the file's value for a unit config changed, for a conflict, for an option config added, and for an option HubSpot removed that config still holds. `--accept <address[#unit]>` takes the portal's side of those units. A selector that matches none of them (a unit that agrees, one pull takes from the portal anyway, a typo) is refused. The message lists what pull keeps there. The run's warnings follow it, so an unread list (`E_SCOPE`, `E_INCOMPLETE`) that explains an empty match is shown too.",
    ],
    fix: [
      'Run `kalup pull --target <name> --check`, pick a unit it lists as a config change kept, a conflict or removed in HubSpot, and pass that. A selector without `#unit` takes every such unit on the address, and `*` in the address works as in `--only`.',
    ],
    example: {
      output: [
        'E_ACCEPT_UNMATCHED: --accept property:companies/soil_ph#description matches no config change, conflict or option removed in HubSpot; pull keeps: property:companies/soil_ph#label (conflict, config kept). Nothing was written. (fix: accept a unit that kalup pull --target sandbox --check lists as kept, a conflict or removed in HubSpot, or leave the selector out) (docs: errors/E_ACCEPT_UNMATCHED.md)',
      ],
    },
  },
  E_APPROVAL_REQUIRED: {
    exit: '4',
    title: 'Nothing approved the plan: no terminal and no flag, or a flag that does not cover it',
    summary: 'Nothing approved this plan. Exit 4, `humanRequired: true`. Nothing was written.',
    when: [
      'A plan with any effect needs one approval. A person at a terminal (stdin and stderr are terminals, no `--json`, `CI` unset) confirms it by typing the target name. `--yes` covers only an unprotected target, with no risky or destructive step, and at most as many writes, adoptions and releases as `yesLimit` on the target allows (25 by default; `yesLimit: 0` turns `--yes` off). Every delete, and every option removal takeover asks for, on every host, needs a person at a terminal who also types the number of destructive steps. Otherwise apply stops here, and the message says which condition failed. `kalup state rebuild --write` and `kalup target rebind` run only for a person at a terminal, and stop here otherwise.',
    ],
    fix: [
      "Stop. Hand the command in the fix to the user, who runs it in a terminal and confirms it there. Agents never approve on the user's behalf.",
    ],
    example: {
      output: [
        'E_APPROVAL_REQUIRED: --yes does not cover this plan: s1 (risky) is not safe. (fix: ask the user to run kalup apply plan.json in a terminal, where they confirm it) (docs: errors/E_APPROVAL_REQUIRED.md)',
      ],
    },
  },
  E_APPROVE_CREDENTIAL: {
    exit: '4',
    title: '`--approve` without a write key held only by the reviewed CI environment',
    summary:
      '`--approve` was refused because the write key is not held apart. Exit 4, `humanRequired: true`. Nothing was sent.',
    when: [
      "`--approve <writesHash>` lets a reviewed CI job apply a plan. It rests on custody: only that CI environment holds the write key. So the target must name its own `credentials.write`, and the key is read from the process environment only. Kalup refuses when the target has no `credentials.write`, or one that names the read credential's variable, or when `.env` in the project directory defines that variable at all, whatever its value, because the key is then on this machine. The message never includes a value.",
    ],
    fix: [
      'Stop. A person decides. Give the target `credentials.write` with a variable only the reviewed CI environment holds. Keep it out of `.env` and every workstation shell: exported there, it satisfies `--approve` too. Or a person applies the plan at a terminal. Agents: hand this to the user.',
    ],
    example: {
      output: [
        'E_APPROVE_CREDENTIAL: --approve needs a write key that only the reviewed CI environment holds, and .env in the project directory defines HUBSPOT_PROD_WRITE_KEY. (fix: Remove HUBSPOT_PROD_WRITE_KEY from .env, or have a person apply the plan at a terminal.) (docs: errors/E_APPROVE_CREDENTIAL.md)',
      ],
    },
  },
  E_APPROVE_MISMATCH: {
    exit: '1',
    title: "The digest given to `--approve` is not the plan's",
    summary: "The digest given to `--approve` is not this plan's. Exit 1. Nothing was written.",
    when: [
      '`--approve <writesHash>` is for a reviewed CI job: the digest of the plan a reviewer saw. `kalup apply` recomputes the digest of the plan file it was given and refuses when the two differ. The plan changed after the review, or the digest belongs to another plan.',
    ],
    fix: [
      'Review the plan file again, and approve the digest of the plan that will run. A person can also apply it with `kalup apply <plan-file>` in a terminal.',
    ],
    example: {
      output: [
        'E_APPROVE_MISMATCH: The digest given to --approve is not the writesHash of this plan: the plan changed after the review, or the digest belongs to another plan. Nothing was written. (fix: review this plan again; a person can apply it with kalup apply plan.json in a terminal) (docs: errors/E_APPROVE_MISMATCH.md)',
      ],
    },
  },
  E_AUTH: {
    exit: '1',
    title: 'HubSpot rejected the key (401)',
    summary: 'HubSpot rejected the read key with a 401. Exit 1.',
    when: [
      'A request from a command that reads a portal came back 401: the key is wrong, revoked or expired. `status` reports it for that target and checks the others.',
    ],
    fix: [
      'Check the key in the variable the target reads (`credentials.read.env`, or `HUBSPOT_SERVICE_KEY` when there is none). If it was revoked, a person creates a new one in HubSpot. When the request needed a scope, the fix names it.',
    ],
    example: {
      output: [
        'E_AUTH: HubSpot rejected the key (401). (fix: Check that the key is valid and not expired. It needs the scope crm.schemas.companies.read.) (docs: errors/E_AUTH.md)',
      ],
    },
  },
  E_BAD_CHAIN: {
    exit: '3',
    title: 'A chain call after a builder that Kalup does not accept',
    summary: 'A builder call is followed by a chain call Kalup does not accept. Exit 3.',
    when: [
      'After `p.<kind>(...)` only `.strict()`, `.required()`, `.readonly()` and `.managed(false)` are allowed, each once, and `.strict()` only after `p.enum` or `p.multiEnum`. `.optional()`, `.managed(true)`, `.required` without parentheses, `.required()` twice or `.strict()` on `p.string` are errors.',
    ],
    fix: [
      'Use one of the four calls, once each. A property is nullable unless it has `.required()`, so there is no `.optional()`. Drop `.strict()` from a builder other than `p.enum` and `p.multiEnum`.',
    ],
    example: {
      config: ["plotCount: p.number('plot_count').optional(),"],
      output: [
        'hubspot/objects/companies.ts:5: E_BAD_CHAIN: .optional() is not a chain call (fix: use .strict(), .required(), .readonly() or .managed(false)) (docs: errors/E_BAD_CHAIN.md)',
      ],
    },
  },
  E_BINDING_CHANGED: {
    exit: '1',
    title: 'A plan binds an address to a portal resource that config or the portal no longer gives it',
    summary:
      'A plan binds an address to a portal resource that kalup.config.ts or the portal does not give it now. Exit 1. Nothing was written.',
    when: [
      "A plan's `bindings` say which portal resource each address stands for: a target's name override, or a custom object's type ID. `kalup apply` never trusts the file. Before approval, every step but a release must be on an object `kalup.config.ts` declares under `objects`, each name binding must be the one the target's overrides give, and no two steps but releases may resolve to one portal resource. Under the lock, each custom object's type ID must be the one the schemas list gives now: a custom object made again has a new one.",
    ],
    fix: [
      'Run `kalup plan --target <name> --out <file>` again, review it, and apply that file. Never edit a plan file by hand.',
    ],
    example: {
      output: [
        'E_BINDING_CHANGED: plan pl_7f3a1c07b2e4 does not name what kalup.config.ts names on target sandbox: the plan binds property:companies/soil_ph to portal name plot_notes, and the name override in kalup.config.ts gives none. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_BINDING_CHANGED.md)',
      ],
    },
  },
  E_BIOME_CONFIG: {
    exit: '1',
    title: '`init` found a `biome.json` that is not valid JSON',
    summary: '`init` found a `biome.json` that is not valid JSON. Exit 1. Nothing was written.',
    when: [
      '`init` adds `!hubspot`, `!kalup.config.ts` and `!.kalup` (with the path from the config to the project in a monorepo) to `files.includes` in the nearest `biome.json` from the project up to the repository root, so it reads that file before it writes anything. Biome reads `biome.json` as plain JSON, so a comment in it is also this error. A `biome.jsonc` that does not parse is not an error: `init` leaves it alone and prints a note.',
    ],
    fix: [
      'Fix the JSON in `biome.json` (a trailing comma or a comment is the usual cause), then run `npx --no-install kalup init` again.',
    ],
    example: {
      output: [
        'biome.json: E_BIOME_CONFIG: biome.json is not valid JSON: <parser message> (fix: fix the file, then run npx kalup init again) (docs: errors/E_BIOME_CONFIG.md)',
      ],
    },
  },
  E_BLUEPRINT_ADDED: {
    exit: '1',
    title: '`add` was given a blueprint the project already has',
    summary: '`kalup add` was given a blueprint the project already has. Exit 1. Nothing was written.',
    when: [
      '`hubspot/blueprints.lock.json` lists each blueprint once, by name. Adding it again would lose its merge base and the conflicts the lock holds, so `add` refuses and points at `kalup blueprint upgrade`, which merges the new version with what the client changed.',
    ],
    fix: ['Run the command in the fix, `kalup blueprint upgrade <name> <source>`, to move to the version you gave.'],
    example: {
      output: [
        'E_BLUEPRINT_ADDED: acme/renewals is already in hubspot/blueprints.lock.json, at version 1.0.0. Nothing was written. (fix: to move to this version, run kalup blueprint upgrade acme/renewals blueprints/renewals-2.0.0.json) (docs: errors/E_BLUEPRINT_ADDED.md)',
      ],
    },
  },
  E_BLUEPRINT_COLLISION: {
    exit: '1',
    title: 'A blueprint resource has the address of a config resource with another definition',
    summary:
      'A blueprint resource has the address of a config resource with another definition. Exit 1. Nothing was written.',
    when: [
      '`kalup add` compares each resource of the blueprint, after the prefix, with config. The same definition and binding is recorded under the blueprint; any differing unit (a label, an option, the key, the codec, a lifecycle field) is a collision, listed with both values. So is a `.managed(false)` entry: a blueprint resource is managed. An address another blueprint provides collides even when alike, for `add` and for a resource new in `kalup blueprint upgrade`.',
    ],
    fix: [
      'Make config match the blueprint, take the resource out of config, or add the blueprint with `--prefix` so its names do not collide. HubSpot names are permanent, so choose the prefix with care. When another blueprint provides the resource, use `--prefix`, or your own copy of the blueprint without it.',
    ],
    example: {
      output: [
        'E_BLUEPRINT_COLLISION: property:deals/renewal_date is in config with another definition: label (config "Contract end", blueprint "Renewal date"). Nothing was written. (fix: make config match the blueprint, remove the resource from config, or add the blueprint with --prefix so its names do not collide) (docs: errors/E_BLUEPRINT_COLLISION.md)',
      ],
    },
  },
  E_BLUEPRINT_INTEGRITY: {
    exit: '1',
    title: 'A blueprint version now has other bytes than the ones Kalup recorded',
    summary: 'A blueprint version now has other bytes than the ones Kalup recorded. Exit 1. Nothing was written.',
    when: [
      '`sources` in `hubspot/blueprints.lock.json` remembers the hash of every source and version ever added or upgraded to. When the same source serves the same version with a different hash, someone changed a published version in place, by mistake or on purpose. Kalup refuses to use it, and names both hashes. `kalup blueprint upgrade` refuses the same version with another hash than the lock holds, from any source.',
    ],
    fix: [
      'The same version must hold the same bytes. Ask the author why it changed, and use a new version number for new content. Do not edit the lock to make the hashes match.',
    ],
    example: {
      output: [
        'E_BLUEPRINT_INTEGRITY: blueprints/renewals-1.0.0.json version 1.0.0 was recorded with sha256:3f1c…, and the source now serves sha256:9a0e…. Nothing was written. (fix: the same version must hold the same bytes: ask the author why it changed, and use a new version number for new content) (docs: errors/E_BLUEPRINT_INTEGRITY.md)',
      ],
    },
  },
  E_BLUEPRINT_LOCK: {
    exit: '3',
    title: '`hubspot/blueprints.lock.json` is not a valid lock',
    summary: '`hubspot/blueprints.lock.json` is not a valid lock. Exit 3.',
    when: [
      'The loader reads the lock to add provenance to the resources each blueprint provides, so every command that loads the project checks it: a `lockVersion` of 1 (another one was written by another version of Kalup), JSON that matches `blueprints-lock-1.schema.json`, each stored original at the path its name and version fix, each source and version listed under `sources` with the same hash, one blueprint per local address, and each held conflict on an address the blueprint lists. `kalup add` and `kalup blueprint upgrade` write the lock; a hand edit or a bad merge breaks it.',
    ],
    fix: [
      'For another lock version, use the version of Kalup that wrote it, or a newer one. Otherwise restore the file from git, for example `git checkout -- hubspot/blueprints.lock.json`. After a merge conflict, take one side whole and run `kalup blueprint upgrade` again rather than editing the JSON.',
    ],
    example: {
      output: [
        'hubspot/blueprints.lock.json: E_BLUEPRINT_LOCK: sources does not record blueprints/renewals-1.0.0.json@1.0.0 with the hash of acme/renewals (fix: restore hubspot/blueprints.lock.json from git: kalup add and kalup blueprint upgrade write it, never a person) (docs: errors/E_BLUEPRINT_LOCK.md)',
      ],
    },
  },
  E_BLUEPRINT_ORIGINAL: {
    exit: '1',
    title: "A blueprint's stored original is missing, was changed, or is another blueprint version",
    summary:
      'The stored original of a blueprint is missing, was changed, or is another blueprint version. Exit 1. Nothing was written.',
    when: [
      "`kalup blueprint upgrade` merges three ways, with the version the project last added or upgraded to as the base. Kalup keeps that version's bytes under `hubspot/.blueprints/` and checks them against the hash in `hubspot/blueprints.lock.json`. A deleted file, an edit, a reformat by another tool, a bad merge or git converting line endings (`core.autocrlf`) breaks the base, and a merge against it would misreport what the client changed.",
    ],
    fix: [
      'Restore the file from git, for example `git checkout -- hubspot/.blueprints/acme--renewals@1.0.0.json`, then run the upgrade again. Another blueprint version needs the Kalup that wrote it, or newer. Keep `hubspot/.blueprints/` out of formatters and commit it with the lock. `kalup add` writes `hubspot/.blueprints/** -text` to `.gitattributes` so git keeps the bytes; if that line is missing, add it back, commit, and check the file out again.',
    ],
    example: {
      output: [
        'E_BLUEPRINT_ORIGINAL: the stored original of acme/renewals 1.0.0, hubspot/.blueprints/acme--renewals@1.0.0.json, does not match the hash in hubspot/blueprints.lock.json; upgrade merges against it. Nothing was written. (fix: restore it from git, for example git checkout -- hubspot/.blueprints/acme--renewals@1.0.0.json, then run kalup blueprint upgrade again) (docs: errors/E_BLUEPRINT_ORIGINAL.md)',
      ],
    },
  },
  E_BLUEPRINT_REF: {
    exit: '1',
    title: 'A blueprint property is in a group neither the blueprint nor config holds',
    summary:
      'A blueprint property is in a group that neither the blueprint nor config holds. Exit 1. Nothing was written.',
    when: [
      'A blueprint may put its properties in a group the project provides instead of one of its own. `kalup add` and `kalup blueprint upgrade` check that each such group is a group of the same object in config, so the written property does not name a missing group.',
    ],
    fix: [
      "Add the group to the object in config, for example `contract: { label: 'Contract' }` under `groups`, or pull it from a portal that has it, then run the command again.",
    ],
    example: {
      output: [
        "E_BLUEPRINT_REF: property:deals/renewal_date is in group group:deals/contract, which is neither in the blueprint nor in config. Nothing was written. (fix: add contract: { label: '...' } to the groups of deals in config, then run the command again) (docs: errors/E_BLUEPRINT_REF.md)",
      ],
    },
  },
  E_BLUEPRINT_REQUIRES: {
    exit: '1',
    title: 'A blueprint needs a custom object config does not define',
    summary: 'A blueprint needs a custom object config does not define. Exit 1. Nothing was written.',
    when: [
      "A blueprint's resources and its `requires` list name objects. A standard object (contacts, companies, deals, tickets and the rest) is always there, and `kalup add` adds it to `objects` in `kalup.config.ts` when missing. A custom object has to be in config first: a blueprint carries no custom object schema, so its properties would have nowhere to go.",
    ],
    fix: [
      'Add the key under `objects` in `kalup.config.ts`. Define the object with `defineCustomObject` in its object file, or, when HubSpot has it already, run `kalup pull` to write that file. Then run the command again.',
    ],
    example: {
      output: [
        'E_BLUEPRINT_REQUIRES: the blueprint needs the custom object vineyard, which config does not define. Nothing was written. (fix: add vineyard: {} under objects in kalup.config.ts and define it with defineCustomObject, or run kalup pull to write its object file when HubSpot has it) (docs: errors/E_BLUEPRINT_REQUIRES.md)',
      ],
    },
  },
  E_BLUEPRINT_SCHEMA: {
    exit: '1',
    title: 'A blueprint is not a valid `blueprint/1` document',
    summary: 'A blueprint is not a valid `blueprint/1` document. Exit 1. Nothing was written.',
    when: [
      '`kalup add` and `kalup blueprint upgrade` parse the source as JSON, never as code. Another `blueprintVersion` is refused first. Then they check `blueprint-1.schema.json` and the rules the schema cannot state: addresses of the form `group:<object>/<name>` or `property:<object>/<name>` that match their type, plain names that never start with a prefix HubSpot reserves, `hs_` or `a<digits>_` (a group `$ref` names a plain group too), unique option values, aliases that name an option, and a codec that fits the HubSpot type and field type. Text that is not JSON or UTF-8 is refused, and so are names a prefix makes invalid. Each issue names its path; quoted text is sanitized.',
    ],
    fix: [
      'A blueprint is third-party data: ask its author for a version that passes, `blueprint/1` for another version. If you maintain the blueprint, fix the field the issue names. For a prefix problem, pass another `--prefix`.',
    ],
    example: {
      output: [
        "E_BLUEPRINT_SCHEMA: property name 'hs_renewal_flag' starts with hs_, a prefix HubSpot reserves (fix: a blueprint is third-party data: ask its author for a version that passes, or fix your own copy of the file) (docs: errors/E_BLUEPRINT_SCHEMA.md)",
      ],
    },
  },
  E_BLUEPRINT_SOURCE: {
    exit: '1',
    title: 'A blueprint source is not a readable file or https URL',
    summary: 'A blueprint source could not be read. Exit 1. Nothing was written.',
    when: [
      'A source is a path to a JSON file, relative to the current directory, or an `https://` URL. Kalup refuses anything else (an `http://` URL, a registry name), a missing file, a URL that answers with an error status or does not answer within 30 seconds, a redirect to a location that is not https, and a file or body over 1 MB. It also refuses a URL with credentials or a query string: the lock records the source. `kalup blueprint upgrade` also refuses a source that holds another blueprint than the name it was given. A URL fetch sends no key and no header but `accept`.',
    ],
    fix: [
      'Pass a path to the blueprint file, or an https URL that serves it. For a private URL, download the file and pass its path. Check the name against `hubspot/blueprints.lock.json` for an upgrade.',
    ],
    example: {
      output: [
        'E_BLUEPRINT_SOURCE: http://blueprints.example.com/renewals.json is not an https URL; Kalup fetches blueprints over https only (fix: pass a path to a blueprint JSON file, or an https:// URL that serves one) (docs: errors/E_BLUEPRINT_SOURCE.md)',
      ],
    },
  },
  E_BLUEPRINT_UNKNOWN: {
    exit: '1',
    title: '`blueprint upgrade` was given a name the lock does not hold',
    summary: '`kalup blueprint upgrade` was given a name the lock does not hold. Exit 1. Nothing was written.',
    when: [
      'Upgrade merges against the stored original of a blueprint the project added. The name must be one `hubspot/blueprints.lock.json` lists; the message names them.',
    ],
    fix: ['Use a name the lock lists, or add the blueprint first with `kalup add <source>`.'],
    example: {
      output: [
        'E_BLUEPRINT_UNKNOWN: acme/billing is not in hubspot/blueprints.lock.json, which lists acme/renewals (fix: add it first with kalup add <source>, or name a blueprint the lock lists) (docs: errors/E_BLUEPRINT_UNKNOWN.md)',
      ],
    },
  },
  E_BUDGET: {
    exit: '1',
    title: 'The apply would use more than half of the API calls left today',
    summary:
      'The apply would use more than half of the API calls HubSpot reports left today. Exit 1. Nothing was written.',
    when: [
      'After it reads the portal, `kalup apply` estimates its calls: the reads it made, plus three per step that writes (a read before it, the write, a read-back). When HubSpot reports a daily figure and the estimate is more than half of it, apply stops, so that other apps on the portal keep room. With no daily figure it warns `W_RATE_HEADERS` and goes on.',
    ],
    fix: [
      "Apply after the daily limit resets at midnight in the portal's time zone, or split the change into smaller plans.",
    ],
    example: {
      output: [
        'E_BUDGET: plan pl_7f3a1c07b2e4 needs about 640 API calls, more than half of the 1100 HubSpot reports left today. Nothing was written. (fix: apply after the daily limit resets, or split the change into smaller plans) (docs: errors/E_BUDGET.md)',
      ],
    },
  },
  E_CANCELLED: {
    exit: '1, or 5 after `apply` wrote',
    title: 'The person at the terminal cancelled, or a signal stopped `apply`',
    summary:
      'The person at the terminal cancelled, or a signal stopped `kalup apply`. Exit 1, or 5 when apply had already written.',
    when: [
      '`pull`, `plan`, `snapshot` or `apply` asked which target to use, and got the end of input (Ctrl-D), Ctrl-C, or three answers that were neither a listed number nor a target name. Nothing was read or written.',
      '`kalup apply` asked the person to type the target name, and the number of destructive steps when there are any, and the answer did not match or the input ended. Nothing was written.',
      'SIGINT or SIGTERM during `kalup apply`: it let the request in flight settle, sent nothing more, saved state and released the lock. A second signal stops at once.',
    ],
    fix: [
      'Run the command again and answer, or pass `--target <name>`. Set `defaultTarget` in `kalup.config.ts` to stop the question. After a stopped apply, run `kalup plan` to see what is left.',
    ],
    example: {
      output: [
        'E_CANCELLED: Not applied: the answer was not the target name. Nothing was written. (docs: errors/E_CANCELLED.md)',
      ],
    },
  },
  E_CONFIG_EXISTS: {
    exit: '1',
    title: '`init` found an existing `kalup.config.ts`',
    summary:
      '`init` refused to run because `kalup.config.ts` already exists in the working directory. Exit 1. Nothing was written.',
    when: ['`init` runs once per project. It never overwrites a config.'],
    fix: [
      'To refresh the files from the portal, run `npx --no-install kalup pull --target <name>`. To start over, remove `kalup.config.ts` first.',
    ],
    example: {
      output: [
        'kalup.config.ts: E_CONFIG_EXISTS: kalup.config.ts already exists in /work/orchard-crm (fix: this is a kalup project already: run npx kalup pull --target <name>, or remove the file to start over) (docs: errors/E_CONFIG_EXISTS.md)',
      ],
    },
  },
  E_DAILY_LIMIT: {
    exit: '1, or 5 after `apply` wrote',
    title: 'The portal used its daily API limit',
    summary: 'The portal has used its daily HubSpot API limit. Exit 1.',
    when: [
      "HubSpot answered 429 with the `DAILY` policy. Kalup does not retry it. Other apps on the portal share the same daily limit. On a Limits Tracking reading, `plan` records it as that reading's issue in `preflight.limits` and carries on. `kalup apply` stops before the write HubSpot refused, so that step and the rest do not run; exit 5 when earlier steps wrote.",
    ],
    fix: [
      "Run the command again after the time in the fix. Kalup takes it as the next midnight in the portal's time zone.",
    ],
    example: {
      output: [
        'E_DAILY_LIMIT: The portal has used its daily API limit. (fix: Try again after 2026-09-23T22:00:00.000Z.) (docs: errors/E_DAILY_LIMIT.md)',
      ],
    },
  },
  E_DEFAULT_TARGET: {
    exit: '3',
    title: '`defaultTarget` names an undeclared target',
    summary: '`defaultTarget` in `kalup.config.ts` names a target that `targets` does not declare. Exit 3.',
    when: [
      '`validate` reports it, and so does every command that loads the config, with or without `--target`, before anything is read. The name must match a key under `targets` exactly.',
    ],
    fix: [
      'Set `defaultTarget` to a declared name (the fix lists them), declare the target, or remove `defaultTarget`. A project with one target needs no default.',
    ],
    example: {
      output: [
        "kalup.config.ts:5: E_DEFAULT_TARGET: defaultTarget 'staging' is not a declared target (fix: use one of sandbox, production, or remove defaultTarget) (docs: errors/E_DEFAULT_TARGET.md)",
      ],
    },
  },
  E_DEFINITION_FIELD: {
    exit: '3',
    title: 'A property definition field the builder, the field type or another field rules out',
    summary: 'A property definition states a field HubSpot would refuse or misread for this property. Exit 3.',
    when: [
      '`validate` and every command that validates first check the fields that depend on the builder or on each other, as HubSpot does:',
      "- `numberDisplayHint`, `showCurrencySymbol` and `currencyPropertyName` belong to `p.number`, and `textDisplayHint` to `p.string`, `p.stringArray`, `p.json` and `p.phoneNumber`. HubSpot stores them on any property but shows them only on those.\n- `calculationFormula` needs `fieldType: 'calculation_equation'`. Sent with another field type, HubSpot turns the property into a calculation.\n- `currencyPropertyName` needs `showCurrencySymbol: true`. HubSpot refuses it otherwise (`ONLY_CURRENCY_PROPERTIES_CAN_SPECIFY_CURRENCY`), and an empty `''` is refused by Kalup: HubSpot stores it as a value and then never turns the symbol off again (live runs, 2026-10-01).\n- `displayOrder` is an integer from -1 up.\n- `p.owner` takes no `options`: HubSpot fills them with the account's users and refuses a create that sends any.",
      "A target's definition override that breaks one of these rules is `E_OVERRIDE_DEFINITION`.",
    ],
    fix: ['Change or remove the field the message names, or change the builder.'],
    example: {
      config: [
        "share: p.string('pick_share', { label: 'Pick share', group: 'orchard', fieldType: 'text', numberDisplayHint: 'percentage' }),",
      ],
      output: [
        'hubspot/objects/companies.ts:14: E_DEFINITION_FIELD: numberDisplayHint is for p.number, not p.string (fix: remove numberDisplayHint) (docs: errors/E_DEFINITION_FIELD.md)',
      ],
    },
  },
  E_DIR_AMBIGUOUS: {
    exit: '3',
    title: 'Both `hubspot/` and `kalup/` hold .ts files and `dir` is not set',
    summary:
      'Both `hubspot/` and the old default folder `kalup/` hold .ts files, and `kalup.config.ts` does not say which one holds the object files. Exit 3. Nothing was read or written.',
    when: [
      "Without `dir` in `kalup.config.ts`, Kalup reads `hubspot/`, or an older project's `kalup/` while `hubspot/` holds no .ts file (`W_LEGACY_DIR`). When both hold .ts files, such as a half-done move or a HubSpot developer project in `hubspot/`, Kalup does not guess: reading the wrong folder would make everything in the other look removed from config.",
    ],
    fix: [
      "Add `dir: 'kalup'` to `kalup.config.ts` to keep the old folder, or `dir: 'hubspot'` when the object files are there. Then move or remove the other folder's copy of the object files.",
    ],
    example: {
      output: [
        "kalup.config.ts: E_DIR_AMBIGUOUS: both hubspot/ and kalup/ hold .ts files, and kalup.config.ts does not say which one holds the object files (fix: add dir: 'kalup' to kalup.config.ts to keep the old folder, or dir: 'hubspot' when the object files are there) (docs: errors/E_DIR_AMBIGUOUS.md)",
      ],
    },
  },
  E_DIR_IN_USE: {
    exit: '1',
    title: "`init` found a file that is not Kalup's in the folder of object files",
    summary:
      "`init` refused to run because the folder of object files holds a .ts file that is not Kalup's, or is a file. Exit 1. Nothing was written.",
    when: [
      "The folder `--dir` names (`hubspot/` without it) belongs to Kalup alone: every command reads each .ts file in it as an object file, `pull` rewrites its `index.ts`, and `init` takes the folder out of the formatter's checks. A folder such as `lib/config` that already holds the app's own modules cannot be it. Object files, `removed.ts` and the `index.ts` barrel from an earlier `init` or `pull` are Kalup's, so `init` runs again after `kalup.config.ts` is removed.",
    ],
    fix: ['Pass `--dir` with a folder of its own, such as `lib/config/hubspot`, or move the file out of the folder.'],
    example: {
      output: [
        "lib/config/index.ts: E_DIR_IN_USE: lib/config/index.ts is not a kalup file, and lib/config/ must hold kalup's files only. Nothing was written. (fix: pass --dir with a folder of its own, such as lib/config/hubspot) (docs: errors/E_DIR_IN_USE.md)",
      ],
    },
  },
  E_DUPLICATE_ADDRESS: {
    exit: '3',
    title: 'One address defined twice',
    summary: 'One address is defined twice, in two files or in two exports. Exit 3.',
    when: [
      'Every group, property and custom object has one address, such as `group:companies/orchard`. Two exports of the same object that both declare the group `orchard`, or the same property in two files, give that address twice. The issue names both places.',
    ],
    fix: ['Keep one definition and remove the other, or give one of them another internal name.'],
    example: {
      output: [
        'hubspot/objects/companies.ts:15: E_DUPLICATE_ADDRESS: group:companies/orchard is defined twice: hubspot/objects/companies.ts:5 and hubspot/objects/companies.ts:15 (fix: remove or rename one of the two definitions) (docs: errors/E_DUPLICATE_ADDRESS.md)',
      ],
    },
  },
  E_DUPLICATE_ALIAS: {
    exit: '3',
    title: 'Two options of one enum share an alias',
    summary: 'Two options of one enum read as the same alias in the app. Exit 3.',
    when: [
      "Every option has an alias: its `as`, or its `value` when it has no `as`. Two options with the same alias would make `get` return one name for two stored values, and `set` could only write one of them. An `as` equal to another option's value counts, when that option has no `as` of its own. The app throws the same error when the builder runs.",
    ],
    fix: [
      'Give one of the two options a different `as`. Swapping names is fine: `a` read as `b` and `b` read as `a` is still one alias per value.',
    ],
    example: {
      config: [
        'options: [',
        "  { value: 'CLAY', label: 'Clay', as: 'clay' },",
        "  { value: 'clay', label: 'Clay (old)' },",
        '],',
      ],
      output: [
        "hubspot/objects/companies.ts:14: E_DUPLICATE_ALIAS: options 'CLAY' and 'clay' share the alias 'clay' (fix: give one of them another as; an option without as uses its value as the alias) (docs: errors/E_DUPLICATE_ALIAS.md)",
      ],
    },
  },
  E_DUPLICATE_KEY: {
    exit: '3',
    title: 'A name used twice where it must be unique',
    summary: 'A name is used twice where it must be unique. Exit 3.',
    when: [
      'The same key twice in one object literal, the same export name twice in one file, or one internal name under two keys of one export.',
    ],
    fix: ['Remove one of the two entries, or rename it.'],
    example: {
      config: ['properties: {', "  plotCount: p.number('plot_count'),", "  plotTotal: p.number('plot_count'),", '},'],
      output: [
        "hubspot/objects/companies.ts:9: E_DUPLICATE_KEY: internal name 'plot_count' is used by two keys of Company: 'plotCount' and 'plotTotal' (fix: remove or rename one of the two entries) (docs: errors/E_DUPLICATE_KEY.md)",
      ],
    },
  },
  E_DUPLICATE_LABEL: {
    exit: '3',
    title: 'Two stages of one pipeline, or two pipelines of one object, share a label',
    summary: 'Two stages of one pipeline, or two pipelines of one object, share a label. Exit 3.',
    when: [
      'HubSpot refuses a stage whose label another stage of the same pipeline has, ignoring case and spaces around it, and a pipeline whose label another pipeline of the same object has, ignoring case (live runs, 2026-10-05). The same label on stages of two pipelines, or on pipelines of two objects, is fine.',
    ],
    fix: ['Give one of the two another label.'],
    example: {
      config: [
        'stages: {',
        "  tasting: { id: 'orchard_tasting', label: 'Tasting', probability: 0.2 },",
        "  retasting: { id: 'orchard_retasting', label: 'tasting', probability: 0.3 },",
        '},',
      ],
      output: [
        "hubspot/pipelines/deals.ts:9: E_DUPLICATE_LABEL: stages 'orchard_tasting' and 'orchard_retasting' of pipeline:deals/orchard_sales share the label 'tasting', ignoring case (fix: give one of the two another label) (docs: errors/E_DUPLICATE_LABEL.md)",
      ],
    },
  },
  E_DUPLICATE_OPTION: {
    exit: '3',
    title: 'An enum lists the same option value twice',
    summary: 'An enum lists the same option value twice. Exit 3.',
    when: [
      'Two entries in `options` of a `p.enum` or `p.multiEnum` have the same `value`, in a full definition or in an options-only reference. HubSpot stores one value per option, and the app could not tell the two apart. The app throws the same error when the builder runs.',
    ],
    fix: ['Remove one of the two options. To show one stored value under another name in the app, give it an `as`.'],
    example: {
      config: [
        'options: [',
        "  { value: 'clay', label: 'Clay' },",
        "  { value: 'loam', label: 'Loam' },",
        "  { value: 'clay', label: 'Heavy clay' },",
        '],',
      ],
      output: [
        "hubspot/objects/companies.ts:14: E_DUPLICATE_OPTION: option value 'clay' is listed twice (fix: remove one of the two options) (docs: errors/E_DUPLICATE_OPTION.md)",
      ],
    },
  },
  E_DUPLICATE_PORTAL: {
    exit: '3',
    title: 'Two targets pin the same portal',
    summary: 'Two targets pin the same portal. Exit 3.',
    when: [
      "`validate` and every command that validates first check that no two targets in `kalup.config.ts` have the same `portalId`. Two names for one portal could carry different policies, and the less protected name would get around the stricter one. The issue points at the later target's `portalId` and names the earlier target.",
    ],
    fix: ['Keep one target per portal: remove one of the two, and move any settings you need to the one you keep.'],
    example: {
      config: ['targets: {', '  sandbox: { portalId: 1111111 },', '  qa: { portalId: 1111111 },', '},'],
      output: [
        "kalup.config.ts:6: E_DUPLICATE_PORTAL: target 'qa' pins portal 1111111, which target 'sandbox' pins too (fix: each portal has one target; remove or rename one of sandbox, qa) (docs: errors/E_DUPLICATE_PORTAL.md)",
      ],
    },
  },
  E_HS_PREFIX: {
    exit: '3',
    title: 'A managed property named with a prefix HubSpot reserves',
    summary: "A managed property's internal name starts with `hs_` or `a<digits>_`. Exit 3.",
    when: [
      "HubSpot reserves `hs_` for its own properties and `a<appId>_` for an integration's, and refuses a create with either (400, live runs 2026-10-01). Kalup never claims those prefixes for a property it would own; `pull` writes such a property as a reference. A reference (no definition) may carry the prefix.",
    ],
    fix: [
      "Give the property another internal name, or drop `label`, `group` and `fieldType` so it refers to HubSpot's property.",
    ],
    example: {
      config: ["plotCount: p.number('hs_plot_count', { label: 'Plot count', group: 'orchard', fieldType: 'number' }),"],
      output: [
        "hubspot/objects/companies.ts:9: E_HS_PREFIX: 'hs_plot_count' starts with hs_, a prefix HubSpot reserves (hs_ for its own properties, a<digits>_ for an integration's) (fix: rename the property, or drop label, group and fieldType to reference it) (docs: errors/E_HS_PREFIX.md)",
      ],
    },
  },
  E_HTTP: {
    exit: '1',
    title: 'Any other HubSpot error',
    summary: 'HubSpot returned an error Kalup has no other code for. Exit 1.',
    when: [
      "A 400, a 404, a 5xx that three retries did not clear, or a success whose body is not JSON (often a proxy's HTML page). The issue holds the status, the method, the path and HubSpot's message when it sent one. In `apply`, a refusal whose reason HubSpot names and Kalup knows says it in plain words: a property in use (each workflow, list, form or calculation named), a group that still holds active properties, a property name that exists, a currency symbol HubSpot never turns off again, or a sensitive property on a portal with sensitive data turned off.",
    ],
    fix: [
      'A 5xx is usually temporary: run the command again later. A 404 on a properties list means the object does not exist in that portal. A body that is not JSON points at a proxy between you and HubSpot.',
    ],
    example: {
      output: ['E_HTTP: HubSpot returned 503 for GET /crm/properties/2026-09/companies. (docs: errors/E_HTTP.md)'],
    },
  },
  E_INCOMPLETE: {
    exit: '1',
    title: '`pull`, `compare`, `apply`, `state rebuild --write` or `target rebind` could not read everything it needed',
    summary:
      'A command could not read all it needed. Exit 1, whatever the flags: with or without `--check`, `--exit-code` or `--discover`.',
    when: [
      'In `pull`, a properties, groups or custom object schemas list answered 403 (`E_SCOPE`). The object behind it was skipped: nothing on it was compared, reported missing or written. A refused schemas list skips every custom object. The objects read in full are still merged and, without `--check`, written.',
      'In `compare`, a side did not read an object either side names (a 403, a snapshot taken before config named it, or a key `objects` lacks), or an address is unknown (a `lookup` override, or whitespace in its group name, `W_UNADDRESSABLE_NAME`). `data` still holds the comparison, with `complete: false` and `ok: false`.',
      'In `apply`, the write key could not read a list (403) of an object the plan changes. Apply never writes on a partial read. In `state rebuild --write` and `target rebind`, the read missed something config names: a new state file would drop every entry there, created origins and agreed values included, so nothing was written and no prompt was shown. The read-only `state rebuild` still reports.',
      'It comes last and names what was not read. It is never clean, so a CI job running `--exit-code` fails on it.',
    ],
    fix: [
      'Add the scopes the fix names to the key in HubSpot, its object key to `objects` in `kalup.config.ts`, or rename the portal group to a name without spaces, then read the portal again (a new snapshot, when a snapshot side missed it). To leave an object out on purpose, remove its key from `objects` and its object file.',
    ],
    example: {
      output: [
        'E_INCOMPLETE: pull did not read everything in scope: the properties list of harvest. Nothing there was compared or written. (fix: add the scope crm.schemas.custom.read to the key, then run npx kalup pull --target sandbox) (docs: errors/E_INCOMPLETE.md)',
      ],
    },
  },
  E_IR_SCHEMA: {
    exit: '3',
    title: 'The derived IR or a snapshot file does not match the `ir/1` schema',
    summary: 'The IR that `kalup ir` derived does not match the `ir/1` JSON Schema. Exit 3.',
    when: [
      '`kalup ir` and `kalup ir --check` check the IR against the schema. `configPath` is a path in the IR, such as `targets.sandbox.portalId`, not a place in a file. From config files it comes with a validate issue that explains it. `compare` and `docs` check a snapshot file the same way; the issue then names the file, and a fix to that file, or a new snapshot, clears it.',
    ],
    fix: [
      'Fix the other issues first; this one goes with them. If it is the only issue left, it is a bug in Kalup: report it with the issue text.',
    ],
    example: {
      output: [
        'kalup.config.ts:9: E_PORTAL_ID: portalId 0 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer) (docs: errors/E_PORTAL_ID.md)',
        'E_IR_SCHEMA: expected at least 1 (docs: errors/E_IR_SCHEMA.md)',
      ],
    },
  },
  E_JOURNAL_WRITE: {
    exit: '1, or 5 after `apply` wrote',
    title: '`apply` could not write a line of its journal',
    summary: '`kalup apply` could not write a line of its journal. Exit 1, or 5 when a write had already been sent.',
    when: [
      'Apply records every request in `.kalup/journal/portal-<id>/` and flushes the line to disk before the next request goes. When a line cannot be written (a full disk, a directory without write permission), apply sends no further request. It still saves state for what it verified and records the outcome.',
    ],
    fix: [
      'Make the journal directory writable and check the disk has room. Then run `kalup plan`: it compares the portal with the state that was kept and shows what is left.',
    ],
    example: {
      output: [
        'E_JOURNAL_WRITE: the journal .kalup/journal/portal-2222222/pl_7f3a1c07b2e4-20260924T100000000Z.jsonl could not be written (ENOSPC: no space left on device, write), so the run stopped before its next request (fix: make the journal directory writable, then run kalup plan to see what the portal holds and what is left) (docs: errors/E_JOURNAL_WRITE.md)',
      ],
    },
  },
  E_KEY_COLLISION: {
    exit: '3',
    title: 'Two properties of one object share a key',
    summary: 'Two properties of one object have the same key. Exit 3.',
    when: [
      'The app reads every property of an object through one type, so keys must differ. Within one export a repeated key is `E_DUPLICATE_KEY`; this code is for two exports of the same object.',
    ],
    fix: ['Rename one of the keys. The internal name stays, so nothing changes in HubSpot.'],
    example: {
      config: [
        "export const Company = defineObject('companies', { properties: { owner: p.string('orch_owner') } })",
        "export const CompanyExtra = defineObject('companies', { properties: { owner: p.string('orch_owner_name') } })",
      ],
      output: [
        "hubspot/objects/companies.ts:39: E_KEY_COLLISION: key 'owner' is used by two properties of companies: property:companies/orch_owner and property:companies/orch_owner_name (fix: rename one of the two keys) (docs: errors/E_KEY_COLLISION.md)",
      ],
    },
  },
  E_KEY_INVALID: {
    exit: '1',
    title: 'A key holds a line break or another character a request header cannot carry',
    summary: 'The variable that holds a key has a value no request header can carry. Exit 1. Nothing was sent.',
    when: [
      'Kalup sends the key in the `Authorization` header. A value with a line break, a carriage return, a NUL or another control character, or a character outside Latin-1, cannot go into a header, and the HTTP client would quote the whole value in its error. Kalup checks the value first, for the read key and the write key, from the process environment or from `.env`. The message names the variable and never the value.',
      'This usually means the key was pasted across two lines, or with a stray character from a chat or a document.',
    ],
    fix: [
      'A person sets the variable again, with the key alone on one line, copied from HubSpot. Never paste the key into a chat, a log or a commit.',
    ],
    example: {
      output: [
        'E_KEY_INVALID: The value of HUBSPOT_SANDBOX_KEY holds a line break or another character a request header cannot carry, so it was not sent. (fix: Set HUBSPOT_SANDBOX_KEY again with the key alone on one line, as HubSpot shows it.) (docs: errors/E_KEY_INVALID.md)',
      ],
    },
  },
  E_LIFECYCLE: {
    exit: '3',
    title: 'A `lifecycle` block contradicts itself',
    summary: 'A `lifecycle` block contradicts itself. Exit 3.',
    when: [
      '`removedOptions` names a value that is still in `options`, or `ignoreChanges` names something other than a definition field: `label`, `group`, `fieldType`, `description`, `options`, `hasUniqueValue`, `formField`, `hidden`, `displayOrder`, `numberDisplayHint`, `showCurrencySymbol`, `currencyPropertyName`, `textDisplayHint`, `calculationFormula` or `dataSensitivity`.',
    ],
    fix: [
      'Take the value out of `options` or out of `removedOptions`. Spell `ignoreChanges` entries as definition field names.',
    ],
    example: {
      config: [
        "options: [{ value: 'clay', label: 'Clay' }, { value: 'loam', label: 'Loam' }],",
        "lifecycle: { removedOptions: ['clay'], ignoreChanges: ['colour'] },",
      ],
      output: [
        "hubspot/objects/companies.ts:14: E_LIFECYCLE: removedOptions names 'clay', which is still in options (fix: remove it from options or from removedOptions) (docs: errors/E_LIFECYCLE.md)",
        "hubspot/objects/companies.ts:14: E_LIFECYCLE: ignoreChanges names 'colour', which is not a definition field (fix: use one of label, group, fieldType, description, options, hasUniqueValue, formField) (docs: errors/E_LIFECYCLE.md)",
      ],
    },
  },
  E_LOCKED: {
    exit: '1',
    title: 'Another Kalup command holds the lock of the portal',
    summary: 'Another Kalup command holds the lock of this portal. Exit 1. Kalup does not wait.',
    when: [
      "Commands that write to a portal or its state take a lock named by the portal ID before they read state, and hold it until state is saved: `apply`, `state rebuild --write`, `target rebind`, and `pull` whenever it may record bases (not with `--check` or `--discover`). The lock is a file in `~/.kalup/locks` (or `KALUP_LOCK_DIR`) that names the holder's command, plan, host, process ID and start time. It keeps apart the writers of one user on one machine, across clones, worktrees and target names. Kalup never takes a lock over, even when its holder has ended: a command that crashed or was killed leaves its lock behind until a person deletes it.",
    ],
    fix: [
      'Wait for the other command to finish, then run yours again. If no Kalup command is running on the host the message names, the lock was left behind: delete the file the fix names, then run yours again. Never delete it while that command runs.',
    ],
    example: {
      output: [
        'E_LOCKED: portal 2222222 is locked by kalup apply for plan pl_7f3a1c07b2e4 on build-agent-7, pid 4242, since 2026-09-24T10:00:00.000Z. (fix: wait for it to finish; delete /home/dana/.kalup/locks/portal-2222222.lock only when no kalup command is running on build-agent-7) (docs: errors/E_LOCKED.md)',
      ],
    },
  },
  E_LOCK_DIR: {
    exit: '1',
    title: 'The lock directory cannot be written',
    summary: 'The lock directory cannot be written. Exit 1. No write was sent.',
    when: [
      "Commands that write to a portal lock it with a file in a per-user directory: `~/.kalup/locks`, or `KALUP_LOCK_DIR` when it is set. Kalup could not create that directory or a file in it (no permission, a read-only file system, or a path under a file). It never falls back to a directory in the project, because then two clones of one project would not see each other's locks.",
    ],
    fix: [
      'Set `KALUP_LOCK_DIR` to a directory this user can write, outside the project, or fix the permissions of `~/.kalup/locks`. Every Kalup command that writes to the same portal on this machine must use the same directory.',
    ],
    example: {
      output: [
        'E_LOCK_DIR: the lock directory /home/dana/.kalup/locks cannot be written (EACCES). (fix: set KALUP_LOCK_DIR to a directory this user can write, outside the project) (docs: errors/E_LOCK_DIR.md)',
      ],
    },
  },
  E_MISSING_EXPORT: {
    exit: '3',
    title: 'A file under `hubspot/` defines no object or pipeline',
    summary:
      'A file under `hubspot/` has no `defineObject` or `defineCustomObject` export, or a file under `hubspot/pipelines/` no `definePipeline` export. Exit 3.',
    when: [
      'Kalup reads every `.ts` file in the folder of object files (`hubspot/`, or the folder `dir` in `kalup.config.ts` names) except `index.ts` and `removed.ts` as an object file, and each one under `pipelines/` as a pipeline file. A file with only imports, or an empty file, has nothing to read.',
    ],
    fix: ['Add the export, or move the file out of `hubspot/`.'],
    example: {
      output: [
        "hubspot/objects/empty.ts:1: E_MISSING_EXPORT: no defineObject or defineCustomObject export in this file (fix: add `export const <Name> = defineObject('<object>', {...})`) (docs: errors/E_MISSING_EXPORT.md)",
      ],
    },
  },
  E_MISSING_KEY: {
    exit: '1',
    title: 'The variable for the read key is not set',
    summary: 'The variable that should hold the read key is not set. Exit 1.',
    when: [
      'The variable is `credentials.read.env` of the target, or `HUBSPOT_SERVICE_KEY` when the target has no `credentials`. `init` writes no `credentials`, so a new project reads `HUBSPOT_SERVICE_KEY`. Kalup looks in the process environment, then in `.env` in the project directory. `status` reports it per target and checks the others.',
    ],
    fix: [
      'A person sets the variable in the shell or adds `NAME=value` to `.env`. Never paste the key into a chat, a log or a commit. `.env` belongs in `.gitignore`, and `init` adds it there.',
    ],
    example: {
      output: [
        'E_MISSING_KEY: HUBSPOT_SANDBOX_KEY is not set. (fix: Set HUBSPOT_SANDBOX_KEY in the environment or in .env in the project directory.) (docs: errors/E_MISSING_KEY.md)',
      ],
    },
  },
  E_NOT_DATA: {
    exit: '3',
    title: 'Something outside the config grammar',
    summary: 'A config file holds something outside the grammar Kalup reads. Exit 3.',
    when: [
      "Kalup parses config as data and never runs it. Identifiers, spreads, template strings, calls other than the builders, a comment that is not on its own line above an entry, an unknown field, a value of the wrong type, a `credentials` `env` that is not an environment variable name (the value is never quoted back, in case it is the key itself), and a missing required field (a custom object's `labels` or `primaryDisplayProperty`, a group's `label`, an option's `value` or `label`, `credentials.read`) are all this code. The message and the fix say which. [config.md](../config.md#the-grammar) lists the grammar.",
    ],
    fix: ['Follow the fix. To keep a note, put a `//` comment on its own line above the property, group or export.'],
    example: {
      config: ["plotCount: p.number('plot_count'), // counted by hand"],
      output: [
        'hubspot/objects/companies.ts:5: E_NOT_DATA: this comment is not attached to an entry (fix: move this comment above the entry it describes) (docs: errors/E_NOT_DATA.md)',
      ],
    },
  },
  E_NO_CONFIG: {
    exit: '1',
    title: 'No `kalup.config.ts` found',
    summary: 'No `kalup.config.ts` in the working directory or any directory above it. Exit 1.',
    when: ['Every command except `init` starts by looking for `kalup.config.ts`, from the working directory upwards.'],
    fix: ['Run the command inside the project. For a new project, run `npx --no-install kalup init --portal <id>`.'],
    example: {
      output: [
        'E_NO_CONFIG: no kalup.config.ts in /work/notes or any directory above it (fix: run npx kalup init --portal <id> in the project directory) (docs: errors/E_NO_CONFIG.md)',
      ],
    },
  },
  E_NO_TARGETS: {
    exit: '3',
    title: '`kalup.config.ts` declares no targets',
    summary: '`kalup.config.ts` declares no targets, so a command that reads a portal has none to read. Exit 3.',
    when: [
      '`pull`, `plan` and `snapshot`, after the config validates and before any request. `validate`, `ir`, `fmt` and `docs` need no target.',
    ],
    fix: [
      "Declare one under `targets` with the portal's Hub ID, for example `targets: { prod: { portalId: 1111111 } }`. The name is yours to choose. `kalup init --portal <id>` writes one for a new project.",
    ],
    example: {
      output: [
        'E_NO_TARGETS: kalup.config.ts declares no targets (fix: declare one under targets, for example targets: { prod: { portalId: <Hub ID> } }) (docs: errors/E_NO_TARGETS.md)',
      ],
    },
  },
  E_OBJECT_FIELD: {
    exit: '3',
    title: 'A custom object name, label or secondary display list HubSpot would refuse',
    summary: 'A custom object in config has a name, a label or secondary display properties HubSpot refuses. Exit 3.',
    when: [
      'A custom object name starts with a letter and holds only letters, digits and underscores, at most 50 characters, and its singular and plural labels hold at most 50 characters each. HubSpot refuses anything else on create (live runs, 2026-10-05). The name is the first argument of `defineCustomObject` and is permanent once HubSpot creates the object; the labels can change.',
      '`secondaryDisplayProperties` holds at most two properties, each once: HubSpot refuses a third (live runs, 2026-10-01).',
    ],
    fix: [
      "Choose a name HubSpot takes, such as `orchard_visit`, or shorten the label. For an object HubSpot holds already, the name in config is the portal's: keep it. List at most two secondary display properties, each once.",
    ],
    example: {
      config: ["export const Visit = defineCustomObject('orchard-visit', {"],
      output: [
        "hubspot/objects/orchard_visit.ts:3: E_OBJECT_FIELD: 'orchard-visit' is not a custom object name HubSpot takes: a letter, then letters, digits and underscores, at most 50 characters (fix: choose another name; HubSpot never changes a custom object name once it creates the object) (docs: errors/E_OBJECT_FIELD.md)",
      ],
    },
  },
  E_OVERRIDE_AMBIGUOUS: {
    exit: '1',
    title: 'A name override matches two portal resources',
    summary: 'A name override is ambiguous: the portal holds both names. Exit 1.',
    when: [
      "`overrides: { '<address>': { name: '<portal name>' } }` says the resource has another name in this portal. When the portal also holds a resource under the address's own name, and no other name override claims that name, Kalup cannot tell which one the address means. A swap is fine, since each override claims the other's name, as is an override to the address's own name. In a chain, the first address's own name must be missing from the portal or claimed by another override. Property and group overrides are checked against the object's lists (an archived group does not count), `object:` overrides against the custom object schemas.",
    ],
    fix: ["Remove the override if the address's own name is the right one, or rename one of the two in HubSpot."],
    example: {
      config: ["overrides: { 'property:harvest/picked_on': { name: 'pickedon' } },"],
      output: [
        "E_OVERRIDE_AMBIGUOUS: the portal holds both 'pickedon' and 'picked_on' on harvest, so the name override for property:harvest/picked_on is ambiguous (fix: remove the override, or rename one of the two in HubSpot) (docs: errors/E_OVERRIDE_AMBIGUOUS.md)",
      ],
    },
  },
  E_OVERRIDE_DEFINITION: {
    exit: '3',
    title: 'A definition override states something that cannot differ per target',
    summary: "A target's definition override states something that cannot differ per target. Exit 3.",
    when: [
      "`overrides: { '<address>': { definition: {...} } }` replaces fields of the shared definition on one target. `validate` and every command that validates first report, at the override's line:",
      '- a field other than `label`, `description`, `group`, `fieldType`, `formField`, `options`, `hidden`, `displayOrder`, the display fields and `calculationFormula` on a property, or `label` on a group. `hasUniqueValue` and `dataSensitivity` are fixed when HubSpot creates a property, and `type` comes from the builder. In `lifecycle`, only `options`, `removedOptions` and `ignoreChanges`.\n- an override on a reference, a `.managed(false)` property or a custom object schema.\n- a result that breaks a shared rule: a `fieldType` the builder does not take, a `group` the object does not declare, an option value twice, `removedOptions` naming a kept option, `ignoreChanges` naming no definition field, or a rule of `E_DEFINITION_FIELD`.\n- an option with `as`. Aliases belong to the app and stay in the shared file.',
    ],
    fix: ['Change or remove what the message names.'],
    example: {
      config: ["overrides: { 'property:deals/term_days': { definition: { hasUniqueValue: true } } },"],
      output: [
        'kalup.config.ts:8: E_OVERRIDE_DEFINITION: property:deals/term_days on target sandbox: hasUniqueValue is fixed when HubSpot creates the property, so it cannot differ per target (fix: remove hasUniqueValue from the override) (docs: errors/E_OVERRIDE_DEFINITION.md)',
      ],
    },
  },
  E_OVERRIDE_NAME: {
    exit: '3',
    title: 'Two addresses would read one portal resource through a name override',
    summary: 'Two addresses in config would read one portal resource through a name override. Exit 3.',
    when: [
      "`overrides: { '<address>': { name: '<portal name>' } }` makes the address read the portal resource of that name on the target. When another address of the same type, on the same object, already has that name and no name override of its own on the target, both addresses would read the same portal resource. So would two name overrides with the same value, an override to the address's own name included. `validate` and every command that validates first report it.",
      'Swapping two names is fine: give each address its own name override.',
    ],
    fix: [
      'Give the other address its own name override on the target, give each of two overrides its own portal name, or rename one of the two in config.',
    ],
    example: {
      config: ["overrides: { 'property:deals/term_days': { name: 'amount' } },"],
      output: [
        "kalup.config.ts:8: E_OVERRIDE_NAME: the name override for property:deals/term_days on target sandbox is 'amount', the name of property:deals/amount, which has no name override there (fix: give property:deals/amount its own name override on sandbox, or rename one of the two in config) (docs: errors/E_OVERRIDE_NAME.md)",
      ],
    },
  },
  E_PENDING_TARGET: {
    exit: '3',
    title: 'The target has no `portalId` yet',
    summary: 'The command needs the portal of a target that has no `portalId` yet. Exit 3. Nothing was sent.',
    when: [
      '`kalup init` without `--portal` writes a pending target: a name and no `portalId`, since init never asks HubSpot. `validate`, `ir`, `fmt`, `rm`, `add` and `docs` work with it. A command that reads or writes the portal (`pull`, `plan`, `apply`, `compare`, `snapshot`, `state rebuild`, `target rebind`) refuses it before any request, because the portal guard has nothing to check the key against. `status` lists it as pending.',
    ],
    fix: [
      'Set `targets.<name>.portalId` in `kalup.config.ts` to the Hub ID from the HubSpot account menu, then run the command again.',
    ],
    example: {
      output: [
        'kalup.config.ts: E_PENDING_TARGET: target production has no portalId yet, so pull cannot check the key against its portal. Nothing was sent. (fix: set targets.production.portalId in kalup.config.ts to the Hub ID from the HubSpot account menu) (docs: errors/E_PENDING_TARGET.md)',
      ],
    },
  },
  E_PIPELINE_FIELD: {
    exit: '3',
    title: 'A pipeline or stage field HubSpot would refuse or drop',
    summary: 'A pipeline or stage states a field HubSpot would refuse, or drop without a word. Exit 3.',
    when: [
      "A stage carries one metadata field, by its pipeline's object: `probability` on deals, from 0 to 1 and required, `ticketState` on tickets and `state` on custom objects, each `'OPEN'` or `'CLOSED'`. HubSpot drops any other metadata without an error, so a write would change nothing and every plan would show it again; HubSpot derives `isClosed` itself. A pipeline on another object, such as the contacts lifecycle pipeline, is read and compared, never written, so its stages carry no metadata. A pipeline's `displayOrder` is an integer from 0 up (live runs, 2026-10-01 and 2026-10-05).",
      "A target's definition override that breaks one of these rules is `E_OVERRIDE_DEFINITION`.",
    ],
    fix: ['Change or remove the field the message names.'],
    example: {
      config: ["won: { id: 'orchard_signed', label: 'Signed', ticketState: 'CLOSED' },"],
      output: [
        'hubspot/pipelines/deals.ts:10: E_PIPELINE_FIELD: ticketState is for ticket stages; a deal stage takes probability (fix: replace ticketState with probability, from 0 to 1) (docs: errors/E_PIPELINE_FIELD.md)',
      ],
    },
  },
  E_PIPELINE_ID: {
    exit: '3',
    title: 'A pipeline or stage ID HubSpot would refuse, or one another pipeline or stage holds',
    summary:
      'A pipeline or stage ID cannot be used: it forms no address, is too long, or another one holds it. Exit 3.',
    when: [
      'A pipeline or stage ID is its address and what HubSpot stores, so it must hold no whitespace or slash. HubSpot stores a pipeline ID of at most 36 characters and a stage ID of at most 100, and answers 500 to a longer one. A pipeline ID is unique across the portal, deals and tickets included, and a stage ID across the pipelines of one object (live runs, 2026-10-01 and 2026-10-05), so two in config may not share one.',
    ],
    fix: [
      'Give the pipeline or stage another ID. An ID is permanent once HubSpot creates it, so choose a short, readable one, such as the pipeline ID followed by the stage, `orchard_signed`.',
    ],
    example: {
      output: [
        'hubspot/pipelines/tickets.ts:5: E_PIPELINE_ID: pipeline:tickets/orchard_sales has the ID of pipeline:deals/orchard_sales, and HubSpot keeps pipeline IDs unique across objects (fix: give one of the two another ID) (docs: errors/E_PIPELINE_ID.md)',
      ],
    },
  },
  E_PIPELINE_STAGES: {
    exit: '3',
    title: 'A pipeline without a stage, or a ticket pipeline without a closed stage',
    summary: 'A pipeline has no stage, or a ticket pipeline has no closed stage. Exit 3.',
    when: [
      "HubSpot refuses a pipeline with no stage, and a ticket pipeline with no stage whose `ticketState` is `'CLOSED'` (live runs, 2026-10-05). `kalup rm` refuses to remove such a pipeline's last stage, or its last closed one, for the same reason.",
    ],
    fix: [
      "Add a stage, or mark one ticket stage `ticketState: 'CLOSED'`. To drop the whole pipeline, run `kalup rm` on the pipeline.",
    ],
    example: {
      output: [
        "hubspot/pipelines/tickets.ts:3: E_PIPELINE_STAGES: pipeline:tickets/orchard_desk has no stage with ticketState 'CLOSED', and HubSpot needs one (fix: mark the stage tickets end in ticketState: 'CLOSED') (docs: errors/E_PIPELINE_STAGES.md)",
      ],
    },
  },
  E_PLAN_DELETE: {
    exit: '1',
    title: 'A saved plan deletes something config does not ask to delete',
    summary: 'A saved plan deletes something config does not ask to delete. Exit 1. Nothing was written.',
    when: [
      'A delete needs a `destroy` tombstone that `kalup rm` wrote, or takeover to ask for it (the mode of the object on the target is takeover, the address is in the pull scope, neither `exclude`, a `skip` override nor a tombstone names it, and the step carries the `takeover` label), and an address gone from config. Before approval, `kalup apply` reads `hubspot/removed.ts` and the object files as data, never running them, and refuses a delete step whose address has neither, is still in config, or sets `lifecycle.preventDestroy`; the message says why takeover does not archive it. It also refuses a delete of a portal resource that another address in config names through a name override on the target, and a custom object archive while config still holds anything on the object, since the archive takes it along. The tombstone was removed after planning, the resource came back into config or into `exclude`, or the plan file was edited.',
    ],
    fix: [
      'To delete a resource, run `kalup rm <address>`, then plan again and review the plan. A resource that sets `preventDestroy` is never deleted through Kalup.',
    ],
    example: {
      output: [
        'E_PLAN_DELETE: plan pl_7f3a1c07b2e4 deletes what config does not ask to delete: property:companies/soil_ph is in config and sets lifecycle.preventDestroy. Nothing was written. (fix: to delete a resource, run kalup rm <address>, then kalup plan --target sandbox --out <file> and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_DELETE.md)',
      ],
    },
  },
  E_PLAN_DESTINATION: {
    exit: '1',
    title: "The plan's target is undeclared or pins another portal now",
    summary: "The plan's target is not where `kalup.config.ts` points now. Exit 1. Nothing was sent.",
    when: [
      'A saved plan names its destination: a target name and a portal ID. `kalup apply` reads `kalup.config.ts` and refuses when that target is no longer declared, or when it now pins another portal. A renamed target keeps its state, but a plan saved under the old name is refused.',
    ],
    fix: [
      'Plan again against a declared target with `kalup plan --target <name> --out <file>`, review it, and apply that file. If the portal ID in config is wrong, a person corrects it first.',
    ],
    example: {
      output: [
        'E_PLAN_DESTINATION: plan pl_7f3a1c07b2e4 is for target production on portal 2222222, and kalup.config.ts pins that target to portal 3333333. Nothing was sent. (fix: run kalup plan against a declared target with --out, review it and apply that file) (docs: errors/E_PLAN_DESTINATION.md)',
      ],
    },
  },
  E_PLAN_DIGEST: {
    exit: '1',
    title: 'The plan file changed after `plan` saved it',
    summary: 'The plan file changed after `kalup plan` saved it. Exit 1. Nothing was sent.',
    when: [
      '`kalup apply` recomputes `writesHash` and `planId` from what the file says it writes: the destination, the policy, the state lineage and serial, the normalizer versions, the bindings and every step with an effect. When they differ from the values in the file, someone or something edited the plan. Titles, stated risk and counts are not part of the digest, so editing them does not trigger this.',
    ],
    fix: ['Run `kalup plan --target <name> --out <file>` again, review the new plan, and apply that file.'],
    example: {
      output: [
        'E_PLAN_DIGEST: plan.json: writesHash and planId do not match what the plan says it writes, so it was changed after kalup plan saved it. Nothing was sent. (fix: run kalup plan --target sandbox --out plan.json again and review it) (docs: errors/E_PLAN_DIGEST.md)',
      ],
    },
  },
  E_PLAN_INVALID: {
    exit: '1',
    title: 'The plan file is missing, not JSON, or not `plan/1`',
    summary: '`kalup apply` could not use the plan file. Exit 1. Nothing was sent.',
    when: [
      "The file named on the command line is missing, is not JSON, or does not match the `plan/1` schema. The message names the first place that fails. Apply also refuses a file whose steps contradict themselves: a change that writes a value the step's `desired` values do not hold. `kalup plan` never writes such a file.",
    ],
    fix: [
      'Save the plan again with `kalup plan --target <name> --out <file>`, review it, and apply that file. Never edit a plan file by hand.',
    ],
    example: {
      output: [
        'E_PLAN_INVALID: plan.json is not JSON. Nothing was sent. (fix: save the plan again with kalup plan --target <name> --out <file>, and apply that file) (docs: errors/E_PLAN_INVALID.md)',
      ],
    },
  },
  E_PLAN_RISK: {
    exit: '1',
    title: 'A step states less risk, fewer labels or less blocking than Kalup derives',
    summary:
      'A step in the plan does not match what Kalup derives from state and the portal. Exit 1. Nothing was written.',
    when: [
      "Under the portal lock, `kalup apply` reads state and the portal again and derives each step's risk, labels and blocked status as `plan` does. It refuses when a step states a lower risk than derived, leaves out a derived label (`reverts-ui-edit`, `overwrites-portal`, `takeover`), or would be blocked: an update of what state does not own, a delete of what state does not own that takeover does not archive, an adopt of what it does, a delete or takeover option removal the target does not allow, a takeover archive of what HubSpot defines, of a property in a group a `skip` override covers or one a custom object schema names, of a group that held no property, or whose `expect` leaves out a field the base holds (so an edit made in HubSpot after the review would not stop it), a custom object schema change, or a group delete while properties still name the group. A plan `kalup plan` saved matches, unless config changed since, such as a `skip` override added; otherwise the file was edited.",
    ],
    fix: ['Run `kalup plan --target <name> --out <file>` again and review it. Never edit a plan file by hand.'],
    example: {
      output: [
        'E_PLAN_RISK: plan pl_7f3a1c07b2e4 does not match what kalup derives from state and the portal: s1 states risk safe, and it is risky. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it; a plan file is never edited by hand) (docs: errors/E_PLAN_RISK.md)',
      ],
    },
  },
  E_PLAN_SCHEMA: {
    exit: '1',
    title: 'A plan does not match the `plan/1` schema',
    summary: 'A plan does not match the `plan/1` JSON Schema. Exit 1.',
    when: [
      '`kalup plan` checks the plan it built against `plan-1.schema.json` before it prints or writes it, and stops when the plan does not match. `configPath` is a path in the plan, such as `steps[2].risk`, not a place in a file. A tool that reads a plan file can check it against `plan-1.schema.json`, which the `kalup` package ships as `kalup/schemas/plan-1.schema.json`.',
    ],
    fix: [
      'A plan Kalup built always matches, so from `kalup plan` this is a bug in Kalup: report it with the command you ran and the issue text. For a plan file that was edited by hand, run `kalup plan` again instead.',
    ],
    example: {
      output: ['E_PLAN_SCHEMA: expected "blocked" (docs: errors/E_PLAN_SCHEMA.md)'],
    },
  },
  E_PLAN_STALE: {
    exit: '1 or 5',
    title: 'The portal changed after the plan was made',
    summary:
      'The portal changed after the plan was made. Exit 1 when nothing was written, 5 when earlier steps of the run wrote.',
    when: [
      'Each step records what it expects to find: whether the resource exists, and the live value of every field it writes. `kalup apply` checks every step against a fresh read before the first write, and each step again right before its own write. A change made in HubSpot since the plan, such as a label edited in the UI or a property created by someone else, stops the run there. The message lists what moved.',
    ],
    fix: [
      'Run `kalup plan --target <name> --out <file>` again. The new plan compares with what the portal holds now, so an edit made in HubSpot is held instead of overwritten. Review it and apply that file.',
    ],
    example: {
      output: [
        'E_PLAN_STALE: the portal changed since plan pl_7f3a1c07b2e4 was made: property:companies/soil_ph label. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it) (docs: errors/E_PLAN_STALE.md)',
      ],
    },
  },
  E_PLAN_VERSION: {
    exit: '1',
    title: 'The plan was made by another release line of Kalup, or for another API or normalizer version',
    summary: 'The plan was made for another version of Kalup. Exit 1. Nothing was written.',
    when: [
      "A saved plan applies only as `plan/1` and under the release line of Kalup that made it (`generator.version`): one major version from 1.0.0, one minor version before it (in 0.x any minor release may change what a field means), one exact pre-release. `kalup apply` checks this first, before the schema and any request, since a newer version's plan need not match this version's schema. After the portal guard it also refuses a step whose API row is not the one this version sends or whose pin has expired, and a plan compared under other normalizer versions. The comparison the plan was reviewed on would no longer hold.",
    ],
    fix: [
      'Plan again with the version you apply with: `kalup plan --target <name> --out <file>`, review it, and apply that file. An expired pin needs a newer release of Kalup.',
    ],
    example: {
      output: [
        'E_PLAN_VERSION: plan.json was made by kalup 2.0.0, and this is kalup 1.4.0: a saved plan applies only under the release line that made it. Nothing was sent. (fix: plan again with this version: run kalup plan --target <name> --out <file>, review it and apply that file) (docs: errors/E_PLAN_VERSION.md)',
        'E_PLAN_VERSION: plan pl_7f3a1c07b2e4 was made for another version of kalup: s2 uses crm.properties 2026-03, and this version sends crm.properties 2026-09. Nothing was written. (fix: run kalup plan --target sandbox --out <file> with this version and review it; an expired pin needs a newer release) (docs: errors/E_PLAN_VERSION.md)',
      ],
    },
  },
  E_POLICY_CHANGED: {
    exit: '1',
    title: "The target's policy changed after the plan was made",
    summary: "The target's policy changed after the plan was made. Exit 1. Nothing was written.",
    when: [
      "A plan records the target's effective policy: `protected`, `drift`, `adopt`, `allowDestroy`, `yesLimit` and the objects whose mode is takeover, with their defaults filled in (unless config says otherwise, every account but a `DEVELOPER_TEST`, `SANDBOX` or `APP_DEVELOPER` one is protected, an unknown type included). An approval covers the plan under that policy. `kalup apply` works the policy out again from `kalup.config.ts` and the account type, and refuses when any field differs. The message names each field, before and now.",
    ],
    fix: [
      'Run `kalup plan --target <name> --out <file>` again under the policy config holds now, review it, and apply that file.',
    ],
    example: {
      output: [
        'E_POLICY_CHANGED: the policy of target sandbox changed since plan pl_7f3a1c07b2e4: protected was false, now true. Nothing was written. (fix: run kalup plan --target sandbox --out <file> again and review it under the policy in kalup.config.ts) (docs: errors/E_POLICY_CHANGED.md)',
      ],
    },
  },
  E_PORTAL_ID: {
    exit: '3',
    title: "A target's `portalId` is not a positive integer",
    summary: "A target's `portalId` is not a positive integer. Exit 3.",
    when: [
      '`portalId` pins the target to one portal. Every networked command checks the key against it. A target with no `portalId` at all is pending (`W_PENDING_TARGET`), not this error.',
    ],
    fix: [
      'Set `portalId` to the Hub ID from the HubSpot account menu. Do not change a pin to make a mismatch go away; see E_TARGET_PORTAL_MISMATCH.md.',
    ],
    example: {
      output: [
        'kalup.config.ts:10: E_PORTAL_ID: portalId 0 is not a positive integer (fix: set portalId to the portal ID shown in HubSpot, a positive integer) (docs: errors/E_PORTAL_ID.md)',
      ],
    },
  },
  E_PREVENT_DESTROY: {
    exit: '3',
    title: '`rm` would write a destroy tombstone for a resource that sets `preventDestroy`',
    summary:
      '`kalup rm` was asked to write a destroy tombstone for a resource that sets `lifecycle.preventDestroy`. Exit 3. Nothing was written.',
    when: [
      "`preventDestroy: true` in a property's `lifecycle` says the property must never be deleted through Kalup. `kalup rm <address>` writes a `destroy` tombstone, which a later plan turns into a delete, so rm refuses it before it changes any file. A custom object's archive takes every group, property and pipeline on it along, so `kalup rm object:<name>` refuses while any of them sets `preventDestroy`, and names them.",
    ],
    fix: [
      'To delete it after all, remove `preventDestroy` from its lifecycle first, then run `kalup rm` again. To stop managing it and leave it in HubSpot, run `kalup rm <address> --release`, which preventDestroy allows.',
    ],
    example: {
      output: [
        'hubspot/objects/companies.ts:14: E_PREVENT_DESTROY: property:companies/soil_ph sets lifecycle.preventDestroy, so rm does not write a destroy tombstone for it. Nothing was written. (fix: remove preventDestroy from its lifecycle first, or run kalup rm property:companies/soil_ph --release to stop managing it and leave it in HubSpot) (docs: errors/E_PREVENT_DESTROY.md)',
      ],
    },
  },
  E_PROJECT_WRITE: {
    exit: '1',
    title:
      '`rm`, `pull`, `target rebind`, `add` or `blueprint upgrade` could not write the project files; they were put back',
    summary: 'A command could not write the project files it changes. Exit 1.',
    when: [
      '`kalup rm`, `kalup pull`, `kalup target rebind`, `kalup add` and `kalup blueprint upgrade` change several files as one: each file is copied to `.kalup/history`, written to a temporary name beside it, then renamed over the old one. When a history copy, a write, a rename or the removal of an old blueprint original fails, for example on a full disk or a read-only directory, every file already renamed gets its previous text back and the temporary files are removed, so the project is left as it was. The message says so, or names any file that could not be put back; its previous text is under `.kalup/history`.',
    ],
    fix: ['Check that the project directory is writable and the disk has room, then run the command again.'],
    example: {
      output: [
        'E_PROJECT_WRITE: could not write hubspot/index.ts, hubspot/objects/companies.ts, hubspot/removed.ts (ENOSPC). Every file was left as it was. (fix: check that the project directory is writable and the disk has room, then run the command again) (docs: errors/E_PROJECT_WRITE.md)',
      ],
    },
  },
  E_PROTECTED_SAVED_PLAN: {
    exit: '4',
    title: '`apply` without a plan file on a protected target, with no person at a terminal',
    summary:
      '`kalup apply` without a plan file on a protected target needs a person at a terminal. Exit 4, `humanRequired: true`. Nothing was written.',
    when: [
      'Without a file, `kalup apply` plans the target and applies that plan in one run. On a protected target (`protected: true`, and unless config says otherwise every account but a `DEVELOPER_TEST`, `SANDBOX` or `APP_DEVELOPER` one) a person at a terminal reviews that plan there and confirms it by typing the target name, and the number of destructive steps when there are any. Here nobody can: stdin or stderr is not a terminal, `--json` is set, or `CI` is. Apply stops after the portal guard, before it plans.',
    ],
    fix: [
      "Stop. Hand the command in the fix to the user, who runs it in a terminal and confirms it there. In CI, save the plan with `kalup plan --target <name> --out` for review, and let the reviewed job apply that file. Agents never approve on the user's behalf.",
    ],
    example: {
      output: [
        'E_PROTECTED_SAVED_PLAN: target production is protected: applying it without a plan file needs a person at a terminal to confirm the plan, and there is none here (no terminal, --json, or CI set). Nothing was written. (fix: ask the user to run kalup apply --target production in a terminal, where they confirm it; in CI, apply a plan saved with kalup plan --target production --out after review) (docs: errors/E_PROTECTED_SAVED_PLAN.md)',
      ],
    },
  },
  E_PULL_INVALID: {
    exit: '3',
    title: 'The files `pull` merged would not validate, so nothing was written',
    summary:
      'The files `pull` merged would not load or validate, so it wrote nothing. Exit 3, with or without `--check`.',
    when: [
      'Pull merges the portal into the object files, then loads and validates the whole project as it would write it, before saving anything. The issues after this one are what `validate` would report, with the file and line in the merged text, not the file on disk.',
      'An example: a new property whose internal name another key of the same object already uses (`E_DUPLICATE_KEY`).',
    ],
    fix: [
      'Change the portal or the file so the two agree, then pull again. To pull everything else first, leave the resource out with `--only`.',
    ],
    example: {
      output: [
        'E_PULL_INVALID: the pulled project would not validate; nothing was written (fix: the issues that follow point at the files as pull would write them: change the portal or the file so they agree, or leave the resource out with --only) (docs: errors/E_PULL_INVALID.md)',
        "hubspot/objects/companies.ts:20: E_DUPLICATE_KEY: internal name 'plot_count' is used by two keys of Company: 'plotCount' and 'plotTotal' (fix: remove or rename one of the two entries) (docs: errors/E_DUPLICATE_KEY.md)",
      ],
    },
  },
  E_RATE_LIMIT: {
    exit: '1, or 5 after `apply` wrote',
    title: 'HubSpot kept answering 429 after three retries',
    summary: 'HubSpot kept answering 429 after three retries. Exit 1, or 5 when `kalup apply` had already written.',
    when: [
      'Kalup honours `Retry-After` up to 60 seconds, else backs off, and retries three times. `kalup apply` waits out a 429, 423 or 477 on a write three times, reading the resource again before each new attempt, then stops the run with that step not run.',
    ],
    fix: ['Wait a minute and run the command again.'],
    example: {
      output: ['E_RATE_LIMIT: HubSpot rate limit hit and 3 retries did not clear it. (docs: errors/E_RATE_LIMIT.md)'],
    },
  },
  E_REBIND_STANDARD: {
    exit: '4',
    title: '`target rebind` was pointed at an account that is not a test portal or sandbox',
    summary:
      '`kalup target rebind` was pointed at an account that is not a test portal or a sandbox. Exit 4, `humanRequired: true`. Nothing was written.',
    when: [
      'Rebind is for a test portal or sandbox that was recreated under a new Hub ID. It rewrites the pin in `kalup.config.ts` and adopts, by name, every config resource the new portal holds. It accepts only a `DEVELOPER_TEST` or `SANDBOX` account. Any other type, `STANDARD`, `APP_DEVELOPER` or one Kalup does not know, is refused: a `STANDARD` account is usually a production portal, where adopting by name alone is not a safe way to move a target.',
    ],
    fix: [
      'Stop and ask the user to check the portal ID. To move a target to a production portal on purpose, a person changes `portalId` in `kalup.config.ts`, runs `kalup plan` and reviews every adoption before applying it.',
    ],
    example: {
      output: [
        'E_REBIND_STANDARD: portal 2222222 is a STANDARD account; rebind is only for recreated test portals (DEVELOPER_TEST) and sandboxes (SANDBOX). Nothing was written. (fix: ask the user to check the portal ID; to move a target to a production portal, change portalId in kalup.config.ts by hand and review the plan) (docs: errors/E_REBIND_STANDARD.md)',
      ],
    },
  },
  E_REFERENCE_DEFINITION: {
    exit: '3',
    title: 'A property is neither managed nor a valid reference',
    summary: 'A property is neither managed nor a valid reference. Exit 3.',
    when: [
      'A property is one of three things: a full definition with `label`, `group` and `fieldType`; `p.enum` or `p.multiEnum` with `options` only; or no definition. A definition missing one of the three fields, options only on another builder, or `.managed(false)` on a property with no full definition is this error.',
    ],
    fix: ["Add the missing fields, or drop the definition to reference the portal's property."],
    example: {
      config: ["plotTotal: p.number('plot_total', { label: 'Plot total' }),"],
      output: [
        'hubspot/objects/companies.ts:23: E_REFERENCE_DEFINITION: a definition needs label, group and fieldType (fix: add the missing fields, or drop the definition) (docs: errors/E_REFERENCE_DEFINITION.md)',
      ],
    },
  },
  E_RM_DEPENDENTS: {
    exit: '3',
    title: '`rm` would take out a group or property other config still uses',
    summary: '`kalup rm` was asked to take out a resource that other config still uses. Exit 3. Nothing was written.',
    when: [
      'A property group cannot leave config while properties in config name it as their `group`. A property cannot leave config while a custom object schema in config names it as its `primaryDisplayProperty` or in `secondaryDisplayProperties`, `requiredProperties` or `searchableProperties`. The message lists what uses it. The check is the same for `--release`.',
    ],
    fix: [
      'Move those properties to another group, or remove them first (with `kalup rm` for each), or change the schema. Then run `kalup rm` again.',
    ],
    example: {
      output: [
        'hubspot/objects/companies.ts:6: E_RM_DEPENDENTS: group:companies/orchard cannot leave config while properties in config use it: property:companies/soil_ph. Nothing was written. (fix: remove or change those first, then run rm again) (docs: errors/E_RM_DEPENDENTS.md)',
      ],
    },
  },
  E_SCOPE: {
    exit: '0 or 1',
    title: 'The key lacks a scope (403)',
    summary: 'HubSpot answered 403: the key lacks a scope.',
    when: [
      'A 403 on a properties, groups or schemas list is a gap: the objects behind it are not read and the rest continue. `pull` and `compare` then end with `E_INCOMPLETE`, exit 1. `plan` blocks what is on them and `snapshot` marks them unread, both with `W_INCOMPLETE` and exit 0. The archived properties lists `plan` reads for its creates are no gap: a 403 there stops `plan`, exit 1. In `status`, a 403 on a scope check marks the scope missing, exit 0. A 403 on account-info stops the command, exit 1; `status` marks that target failed and checks the others. A refused Limits Tracking reading is no error: `plan` records it as unreadable, and warns with `W_LIMIT_UNREADABLE` when it creates properties.',
    ],
    fix: [
      'A person adds the scope named in the fix to the key in HubSpot. A key can only hold scopes its creator has, so a Super Admin creates it.',
    ],
    example: {
      output: [
        'E_SCOPE: HubSpot refused GET /crm-object-schemas/2026-09/schemas (403). The key likely lacks the scope crm.schemas.custom.read. (fix: Add the scope crm.schemas.custom.read to the key.) (docs: errors/E_SCOPE.md)',
      ],
    },
  },
  E_SETTING_LEVEL: {
    exit: '3',
    title: 'A kalup.config.ts setting is at a level that does not allow it',
    summary: 'A setting in kalup.config.ts is at a level that does not allow it. Exit 3.',
    when: [
      'Each setting has the levels it may stand at. `mode` goes at the top level, under `objects.<object>`, under `targets.<target>` or under `targets.<target>.objects.<object>`. `include`, `exclude`, `custom` and `as` go under `objects.<object>`, and are never per target. `protected`, `drift`, `adopt`, `allowDestroy` and `yesLimit` go under `targets.<target>` only: a portal opts itself in, so none of them is inherited from the project or an object. No setting goes in an override or a property definition.',
    ],
    fix: [
      'Move the setting to one of the levels the fix lists, each with a snippet. The most specific statement of `mode` wins: `targets.<target>.objects.<object>`, then `targets.<target>`, then `objects.<object>`, then the top level.',
    ],
    example: {
      config: ['objects: { companies: { allowDestroy: true } },'],
      output: [
        'kalup.config.ts:6: E_SETTING_LEVEL: allowDestroy is not allowed in objects.companies (fix: move it to targets.<target> (targets: { sandbox: { allowDestroy: true } })) (docs: errors/E_SETTING_LEVEL.md)',
      ],
    },
  },
  E_SETTING_VALUE: {
    exit: '3',
    title: 'A kalup.config.ts setting has a value it does not allow',
    summary: 'A setting in kalup.config.ts has a value it does not allow. Exit 3.',
    when: [
      "`mode` takes `'addon'` or `'takeover'`; `drift` and `adopt` take `'hold'` or `'overwrite'`; `yesLimit` takes an integer from 0 to 1000. The fix names the nearest allowed value.",
      '`dir` takes a folder inside the project, relative to `kalup.config.ts`: not an absolute path, not one that leaves the project through `..`, and not the project directory itself.',
      '`validate` also reports a name that `include` and `exclude` of one object both list, and a `targets.<target>.objects` key that `objects` does not declare.',
    ],
    fix: [
      "Write the value the fix suggests, or another allowed one. Remove a name from one of `include` and `exclude`. Write `dir` as a relative path such as `'lib/config/hubspot'`, or remove it to use `hubspot/`.",
    ],
    example: {
      config: ["mode: 'take-over',"],
      output: [
        "kalup.config.ts:5: E_SETTING_VALUE: 'take-over' is not a value of mode (fix: did you mean 'takeover'? write 'addon' or 'takeover') (docs: errors/E_SETTING_VALUE.md)",
      ],
    },
  },
  E_SNAPSHOT: {
    exit: '1 or 3',
    title: 'A snapshot file is missing, not JSON, not a snapshot, or would be overwritten',
    summary:
      'A snapshot file could not be used. Exit 1 when the file is missing, is not JSON or would be overwritten; exit 3 when it is JSON but not a snapshot this version reads.',
    when: [
      '`compare` and `docs` read snapshot files that `kalup snapshot` wrote: `ir/1` documents from a portal read, with an observation block. A missing file, or one that is not JSON, is exit 1, as is a `compare` side that is neither `config`, a declared target nor a file. Exit 3: another `irVersion` (refused before anything else), the IR `kalup ir` derives, a resource typed unlike its address, or a coverage name no address can hold. A snapshot that breaks the `ir/1` schema gives `E_IR_SCHEMA` issues naming the file instead. `snapshot` never replaces a file: when its file already exists, it stops with exit 1.',
    ],
    fix: [
      'Pass a file `kalup snapshot` wrote, or `config` for the config files. For another `irVersion`, snapshot again with this version, or read it with the version of Kalup that wrote it. For a file that exists, pass another `--out` or move the old file away.',
    ],
    example: {
      output: [
        'E_SNAPSHOT: ir.json is not a snapshot: it is not an ir/1 document from a portal read with an observation block (fix: pass a file the snapshot command wrote, or config for the config files) (docs: errors/E_SNAPSHOT.md)',
      ],
    },
  },
  E_STANDARD_OBJECT: {
    exit: '3',
    title: "A `defineCustomObject` under a standard object's key",
    summary: 'A `defineCustomObject` uses the key of a standard object. Exit 3.',
    when: [
      "`defineCustomObject` defines a custom object schema. HubSpot has no custom object schema under a standard object's name (`contacts`, `companies`, `deals`, `line_items` and the rest), so no read can find one there. `validate` and every command that validates first report it, before any request.",
    ],
    fix: [
      "For the standard object, use `defineObject` and drop `labels` and the display properties. For a custom object, give it a name that is not a standard object's.",
    ],
    example: {
      config: [
        "export const Company = defineCustomObject('companies', { labels: { singular: 'Company', plural: 'Companies' }, ... })",
      ],
      output: [
        "hubspot/objects/companies.ts:6: E_STANDARD_OBJECT: 'companies' is a standard object in HubSpot, so defineCustomObject cannot define it (fix: use defineObject('companies', ...) without labels and the display properties, or name the custom object differently) (docs: errors/E_STANDARD_OBJECT.md)",
      ],
    },
  },
  E_STATE_CHANGED: {
    exit: '1',
    title: 'State for the portal changed after the plan or the rebuild report was made',
    summary: 'State for the portal changed after the plan was made. Exit 1. Nothing was written.',
    when: [
      'A plan records the state lineage and serial it was made from, and an approval covers the plan with them. After it takes the portal lock, `kalup apply` reads state again and refuses when either differs: another apply, a pull that recorded bases, a state rebuild or a rebind ran in between. The one exception is a plan that is the last one applied, with outcome `done`: apply reports it as already applied and exits 0.',
      '`state rebuild --write` shows its report before it takes the lock. Under the lock it reads state again and refuses when it is not the file the report showed, so it never archives a file the person did not see.',
    ],
    fix: [
      'Run `kalup plan --target <name> --out <file>` again. It starts from the new state. Review it and apply that file. For a rebuild, run it again and review the new report.',
    ],
    example: {
      output: [
        'E_STATE_CHANGED: state for portal 2222222 changed since plan pl_7f3a1c07b2e4 was made (lineage 0a1b2c3d4e5f6071, serial 4; now lineage 0a1b2c3d4e5f6071, serial 6): another apply, pull or repair ran in between. Nothing was written. (fix: run kalup plan --target production --out <file> again and review it) (docs: errors/E_STATE_CHANGED.md)',
      ],
    },
  },
  E_STATE_CONFLICT: {
    exit: '1',
    title: 'The state file changed while the command ran',
    summary: 'The state file changed while this command ran, so its save was refused. Exit 1.',
    when: [
      'Every state save compares serials: the file must still hold the serial the command read before it started. Another Kalup command saved state for the same portal in between, or someone replaced the file. Nothing was saved, and the file keeps what the other writer put there.',
    ],
    fix: [
      'Run `kalup plan` again. It reads the new state and shows what is left to do. Two commands that write to one portal should not run at once; the portal lock keeps them apart on one machine.',
    ],
    example: {
      output: [
        '.kalup/state/portal-2222222.json: E_STATE_CONFLICT: .kalup/state/portal-2222222.json changed while this command ran: its serial is 8, not 7. Nothing was saved. (fix: another kalup command wrote state for portal 2222222; run kalup plan again) (docs: errors/E_STATE_CONFLICT.md)',
      ],
    },
  },
  E_STATE_INVALID: {
    exit: '1',
    title: 'A state file is unreadable, not JSON, not `kalup.state/1`, or describes another portal',
    summary: 'A state file cannot be used. Exit 1. Nothing was written.',
    when: [
      'State lives in `.kalup/state/portal-<portalId>.json`, one file per portal. Kalup reads it before it plans or writes against that portal, and stops when the file cannot be read, is not JSON, names a format other than `kalup.state/1`, does not match that schema, or describes another portal than the one the key belongs to. The message says what is wrong.',
    ],
    fix: [
      'When the file cannot be read, fix its permissions. Another format means another version of Kalup wrote it: use that version or a newer one, and keep the file. Otherwise the file was edited, damaged or overwritten; never edit state by hand. The `.bak` beside it holds the state before its last save: rename it into place if it reads, knowing it lacks that save. Else move the file away and run `kalup state rebuild --target <name>`, or restore it from a CI state branch.',
    ],
    example: {
      output: [
        '.kalup/state/portal-2222222.json: E_STATE_INVALID: .kalup/state/portal-2222222.json is not JSON. (fix: rename portal-2222222.json.bak, the state before its last save, into its place if it reads; else move the file away and run kalup state rebuild --target production) (docs: errors/E_STATE_INVALID.md)',
      ],
    },
  },
  E_STATE_SCHEMA: {
    exit: '1',
    title: 'A state file does not match the `kalup.state/1` schema',
    summary: 'A state file does not match the `kalup.state/1` JSON Schema. Exit 1.',
    when: [
      'Kalup checks a state document against `state-1.schema.json` and returns this issue for each mismatch. `configPath` is a path in the state file, such as `resources.property:companies/billing_status.origin`, not a place in a config file. `kalup plan` reads it and reports a mismatch as `E_STATE_INVALID`.',
    ],
    fix: [
      'Kalup writes state that matches, so a mismatch means the file was edited by hand or damaged. Do not edit state by hand. Restore the file from where you keep it, such as the state branch of your CI setup.',
    ],
    example: {
      output: ['E_STATE_SCHEMA: missing required field "portalId" (docs: errors/E_STATE_SCHEMA.md)'],
    },
  },
  E_STATE_WRITE: {
    exit: '1, or 5 after `apply` wrote',
    title: 'State could not be saved; the previous file is intact, or archived by a rebuild',
    summary: 'State could not be saved or archived. Exit 1, or 5 when `kalup apply` had already written.',
    when: [
      'A save writes a temporary file, flushes it, keeps the old file as `.bak` and renames the new one over it. When a step fails (a full disk, no write permission, a read-only file system), the old file stays as it was.',
      '`state rebuild --write` and `target rebind` archive the old file first: when the new one fails to save, no state file is left, and the message names the archive. Until a state file exists again, the next plan proposes adopting every config resource the portal holds.',
    ],
    fix: [
      "Check that the state directory (`.kalup/state`, or `KALUP_STATE_DIR`) is writable and the disk has room, then run the command again. If `kalup apply` had already changed the portal, its message names the run's journal. Run `kalup plan`: it compares the portal with the state kept and shows what is left; a property the run created shows as an adopt, never a second create. After a rebuild or rebind, run it again, or move the archived file back to keep the previous state.",
    ],
    example: {
      output: [
        '.kalup/state/portal-2222222.json: E_STATE_WRITE: .kalup/state/portal-2222222.json: could not save it (ENOSPC). The previous file is intact. (fix: check that the state directory is writable and the disk has room, then run the command again) (docs: errors/E_STATE_WRITE.md)',
      ],
    },
  },
  E_STRICT_WITHOUT_OPTIONS: {
    exit: '3',
    title: '`.strict()` on an enum that lists no options',
    summary: '`.strict()` is on a `p.enum` or `p.multiEnum` that lists no options. Exit 3.',
    when: [
      "A strict enum's codec throws on any value its options do not list. With no options, it would throw on every value HubSpot stores. A bare reference such as `p.enum('lifecyclestage').strict()`, or a definition without `options`, is this error.",
    ],
    fix: [
      'List the options the app handles, as an options-only reference (`p.enum(name, { options: [...] })`) or in the full definition, or drop `.strict()`: without it the codec reads an unlisted value as `Unlisted`.',
    ],
    example: {
      config: ["stage: p.enum('lifecyclestage').strict(),"],
      output: [
        "hubspot/objects/companies.ts:9: E_STRICT_WITHOUT_OPTIONS: .strict() on 'lifecyclestage', which lists no options, so its codec would throw on every value (fix: list the options, or drop .strict()) (docs: errors/E_STRICT_WITHOUT_OPTIONS.md)",
      ],
    },
  },
  E_TAKE_UNMATCHED: {
    exit: '1',
    title: 'A `--take` selector names nothing `plan` or `blueprint upgrade` can take',
    summary: 'A `--take` selector names nothing it can take. Exit 1. Nothing was written.',
    when: [
      '`kalup plan --take config <address[#unit]>` writes config over held units and recreates a missing property HubSpot does not hold archived. Each selector must match a held unit (`drift`, `conflict` or `diverged`) or a resource listed in `missing`; a unit that already agrees, a config change or a typo matches nothing. The message lists the units held on the addresses the selector names, and names a missing resource a `#unit` selector matched: only the address alone recreates it.',
      '`kalup blueprint upgrade --take remote <address[#unit]>` must match a conflict of the upgrade, or one the lock holds when the version is unchanged.',
    ],
    fix: [
      'Run the command without `--take`, pick a held unit, missing resource or conflict from its output, and pass that. A selector without `#unit` takes every unit on the address; `*` in the address works as in `--only`.',
    ],
    example: {
      output: [
        'E_TAKE_UNMATCHED: --take config property:companies/billing_status#description matches no held unit and no missing resource; held there: property:companies/billing_status#label (fix: take a held unit or a missing resource that kalup plan --target production lists, or leave the selector out) (docs: errors/E_TAKE_UNMATCHED.md)',
      ],
    },
  },
  E_TARGET_NAME: {
    exit: '3',
    title: 'A target is named `config`',
    summary: 'A target is named `config`. Exit 3.',
    when: ['`compare` uses the word `config` for the config side, so no target may take it.'],
    fix: ['Rename the target, for example to `sandbox` or `production`.'],
    example: {
      output: [
        "kalup.config.ts:9: E_TARGET_NAME: a target may not be named 'config': compare uses that word for the config side (fix: rename the target) (docs: errors/E_TARGET_NAME.md)",
      ],
    },
  },
  E_TARGET_PORTAL_MISMATCH: {
    exit: '4',
    title: 'The key belongs to another portal',
    summary: 'The key belongs to another portal than the one pinned. Exit 4, `humanRequired: true`.',
    when: [
      "Every command that reads a target first checks account-info with its key; `target rebind` checks the portal `--portal` gives. The key's portal differs, so nothing more is sent with that key and nothing is written. `status` still checks the other targets with their own keys.",
    ],
    fix: [
      'Stop. A person checks which key is in the variable and which portal `portalId` names. Agents: hand this to the user. Do not edit `portalId` or the key yourself, and do not run `target rebind`: it needs a person at a terminal. Changing the pin to match the key is how the wrong portal gets read.',
      'When a test portal or sandbox was recreated under a new Hub ID, the person moves the target to it with `kalup target rebind <target> --portal <id>` at a terminal (see [state.md](../state.md#target-rebind)). Rebind accepts only a test portal or sandbox (`E_REBIND_STANDARD`), checks the key against the new portal and rebuilds state there.',
    ],
    example: {
      output: [
        'E_TARGET_PORTAL_MISMATCH: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333, not portal 2222222 pinned for target production. (fix: The key in HUBSPOT_PROD_READ_KEY belongs to portal 3333333. Ask the user to check the key and the pinned portalId for target production. For a recreated test portal or sandbox, the user can run kalup target rebind production --portal <id> in a terminal; it refuses STANDARD accounts.) (docs: errors/E_TARGET_PORTAL_MISMATCH.md)',
      ],
    },
  },
  E_TARGET_REQUIRED: {
    exit: '1',
    title: 'Several targets, none selected, and no terminal to ask',
    summary:
      'A command that runs against one target found several, none selected by `--target` or `defaultTarget`, and no person at a terminal to choose. Exit 1.',
    when: [
      '`pull`, `plan` and `snapshot`, after the config validates and before any request or file write. With `--json`, without a terminal, or with `CI` set, the command cannot ask, so it lists the names and portal IDs instead. At a terminal it asks on stderr. Kalup never picks the first target for you. See [Choosing a target](../targets.md#choosing-a-target).',
    ],
    fix: [
      'Pass `--target <name>` with one of the listed names, or set `defaultTarget` in `kalup.config.ts`. An agent should ask the user which portal to use, then pass `--target`.',
    ],
    example: {
      output: [
        'E_TARGET_REQUIRED: kalup.config.ts declares 2 targets and none is selected: sandbox (portal 1111111), production (portal 2222222) (fix: pass --target <name>, or set defaultTarget in kalup.config.ts. An agent should ask the user which portal to use.) (docs: errors/E_TARGET_REQUIRED.md)',
      ],
    },
  },
  E_TOMBSTONE_ADDRESS: {
    exit: '3',
    title: 'A key in `hubspot/removed.ts` is not an address Kalup removes',
    summary:
      'A key in `hubspot/removed.ts`, or the address given to `kalup rm`, is not the address of a property, group, pipeline or stage. Exit 3.',
    when: [
      'Each key in `hubspot/removed.ts` is an address, such as `property:companies/legacy_score`: the type, a colon, the object, a slash and the name. A key with no object, such as `property:legacy_score`, names nothing and is refused. A stage address names its pipeline as well: `stage:deals/renewals/won`. This version removes properties, property groups, pipelines and stages only, so a key of another type, such as `object:parcels`, is refused as well.',
    ],
    fix: ['Write the address as `kalup ir` lists it, or remove the entry.'],
    example: {
      config: ['export default defineRemoved({', "  legacyScore: { action: 'destroy' },", '})'],
      output: [
        "hubspot/removed.ts:4: E_TOMBSTONE_ADDRESS: 'legacyScore' is not an address (fix: write the address of a property, group, pipeline or stage, such as 'property:companies/legacy_score') (docs: errors/E_TOMBSTONE_ADDRESS.md)",
      ],
    },
  },
  E_TOMBSTONE_CONFLICT: {
    exit: '3',
    title: 'An address is in `hubspot/removed.ts` and still in config',
    summary: 'An address is in `hubspot/removed.ts` and still defined in config. Exit 3.',
    when: [
      'A tombstone takes a resource out of config: `destroy` deletes it in the portal, `release` stops managing it and leaves it there. Config may not define the same address at the same time, not even as a reference without `label`, `group` and `fieldType`. This usually means the entry was added to `hubspot/removed.ts` by hand and the property or group was left in its object file. A custom object tombstone takes everything on the object along, so config may not hold any group, property, pipeline or stage on that object either; `kalup rm object:<name>` takes them out with it.',
    ],
    fix: [
      'Remove the property or group from its object file. `kalup rm <address>` does both steps: it removes it from config and writes the tombstone. To keep managing the resource, remove the tombstone instead.',
    ],
    example: {
      output: [
        'hubspot/removed.ts:4: E_TOMBSTONE_CONFLICT: property:companies/legacy_score is in hubspot/removed.ts and in config (fix: remove it from config, or run kalup rm, which does both) (docs: errors/E_TOMBSTONE_CONFLICT.md)',
      ],
    },
  },
  E_TYPE_FIELDTYPE: {
    exit: '3',
    title: 'A `fieldType` the builder does not allow',
    summary: 'A `fieldType` the builder does not allow. Exit 3.',
    when: [
      'Each builder allows some `fieldType` values. `p.enum` takes `select`, `radio`, `booleancheckbox` or `calculation_equation`, and `p.multiEnum` only `checkbox`. [config.md](../config.md#builders) has the full list.',
    ],
    fix: ['Use one of the values in the fix, or change the builder: a `checkbox` enumeration is `p.multiEnum`.'],
    example: {
      config: [
        "soil: p.enum('soil_type', { label: 'Soil type', group: 'orchard', fieldType: 'checkbox', options: [...] }),",
      ],
      output: [
        "hubspot/objects/companies.ts:14: E_TYPE_FIELDTYPE: fieldType 'checkbox' is not allowed for p.enum (type enumeration) (fix: use one of 'select', 'radio', 'booleancheckbox', 'calculation_equation') (docs: errors/E_TYPE_FIELDTYPE.md)",
      ],
    },
  },
  E_UNCERTAIN_WRITE: {
    exit: '5',
    title: 'HubSpot may or may not have applied a write',
    summary: 'HubSpot may or may not have applied a write. Exit 5. Kalup never sends it again.',
    when: [
      'The write timed out, the network failed, HubSpot answered 5xx or a body that is not JSON, or it refused a create whose name then read back. HubSpot documents no idempotency keys, so a second attempt could fail on what the first made, or undo an edit made in between. Apply reads the resource back until a deadline of 60 seconds, and settles the step only when the approved values read back. Otherwise the step is `uncertain`, its state entry stays as it was, and steps that depend on it do not run.',
    ],
    fix: [
      'Run `kalup plan --target <name>`. It reads what HubSpot holds: a property the write made shows as an adopt, and anything not made shows again.',
    ],
    example: {
      output: [
        'E_UNCERTAIN_WRITE: s2 Create property "Soil pH" (soil_ph) on companies: HubSpot may or may not have applied it (no read showed the approved values within 60 s). kalup never sends it again. (fix: run kalup plan --target sandbox: it reads what HubSpot holds and shows what is left) (docs: errors/E_UNCERTAIN_WRITE.md)',
      ],
    },
  },
  E_UNEXPECTED: {
    exit: '1',
    title: 'An error Kalup has no code for',
    summary: 'An error Kalup has no code for. Exit 1.',
    when: [
      'Anything that is not a Kalup or HubSpot error: a file it cannot read, or a request that got no answer in any command but `status`. The message is the first line of the error, stripped of control characters. It never holds a key.',
    ],
    fix: [
      'Read the message. A network failure clears when the network does. If it looks like a bug, report it with the command you ran and this line.',
    ],
    example: {
      output: ['E_UNEXPECTED: fetch failed (docs: errors/E_UNEXPECTED.md)'],
    },
  },
  E_UNKNOWN_BUILDER: {
    exit: '3',
    title: '`p.<kind>` is not a builder',
    summary: '`p.<kind>` is not a builder. Exit 3.',
    when: [
      'The builders are `p.string`, `p.number`, `p.boolean`, `p.date`, `p.datetime`, `p.enum`, `p.multiEnum`, `p.stringArray`, `p.json`, `p.phoneNumber` and `p.owner`. HubSpot field types such as `text` are not builders.',
    ],
    fix: ['Pick the builder for the HubSpot type and put the field type in `fieldType`.'],
    example: {
      config: ["plotCount: p.text('plot_count'),"],
      output: [
        'hubspot/objects/companies.ts:5: E_UNKNOWN_BUILDER: p.text is not a builder (fix: use one of p.string, p.number, p.boolean, p.date, p.datetime, p.enum, p.multiEnum, p.stringArray, p.json, p.phoneNumber, p.owner) (docs: errors/E_UNKNOWN_BUILDER.md)',
      ],
    },
  },
  E_UNKNOWN_GROUP: {
    exit: '3',
    title: "A property's group is not declared",
    summary: "A property's `group` is not declared for its object. Exit 3.",
    when: [
      'A managed definition names its group by internal name. That group must be declared under `groups` in some export of the same object, in this file or another.',
    ],
    fix: [
      'Add the group to `groups`, or use a group that is there. `kalup pull` writes every group a pulled property uses.',
    ],
    example: {
      config: ["plotCount: p.number('plot_count', { label: 'Plot count', group: 'orchard', fieldType: 'number' }),"],
      output: [
        "hubspot/objects/companies.ts:5: E_UNKNOWN_GROUP: group 'orchard' is not in the groups of companies (fix: add orchard: { label: '...' } to the groups block) (docs: errors/E_UNKNOWN_GROUP.md)",
      ],
    },
  },
  E_UNKNOWN_INCLUDE: {
    exit: '3',
    title: '`include` names properties the portal does not have',
    summary:
      '`objects.<key>.include` names properties that neither the portal nor the object files have. Exit 3. Nothing is written.',
    when: [
      "`pull` checks every `include` name against the portal's property list for that object, after reading all objects.",
      'A name the object files define is never unknown: pull reports it as missing in the portal and plan creates it. The files need no `include` for their own properties.',
    ],
    fix: ["Remove the names, or correct them to the internal names shown in HubSpot's property settings."],
    example: {
      output: [
        'kalup.config.ts:6: E_UNKNOWN_INCLUDE: objects.companies.include names properties the portal does not have: plot_colour (fix: remove them, or check the internal names in HubSpot) (docs: errors/E_UNKNOWN_INCLUDE.md)',
      ],
    },
  },
  E_UNKNOWN_OBJECT: {
    exit: '3',
    title: 'An object the portal does not have',
    summary:
      'A key under `objects` is neither a standard object nor a custom object in the portal. Exit 3. Nothing is written.',
    when: [
      "A key that is not a standard object name (`contacts`, `companies`, `deals`, `line_items` and the rest, plural) is read as a custom object. None of the portal's custom objects has that name, and config defines none either. A key a `defineCustomObject` in config backs is never this code: `pull` reports that object missing in portal and leaves its file as it is, `plan` creates it, and `compare` finds it on the config side only. A key whose object `hubspot/removed.ts` names is left out by `pull` too, whether or not HubSpot still holds it.",
    ],
    fix: [
      "Use one of the names the message lists, or remove the key. Standard objects use HubSpot's plural API name: `companies`, not `company`.",
    ],
    example: {
      output: [
        "kalup.config.ts:8: E_UNKNOWN_OBJECT: 'presses' is not a standard object or a custom object in the portal (custom objects: harvest, press_run) (fix: use one of the names listed, or remove the key) (docs: errors/E_UNKNOWN_OBJECT.md)",
      ],
    },
  },
  E_UNKNOWN_OVERRIDE: {
    exit: '3',
    title: 'An override key that is not an address in config',
    summary: 'An override key is not an address in config. Exit 3.',
    when: [
      '`targets.<name>.overrides` is keyed by address: `property:<object>/<name>`, `group:<object>/<name>` or `object:<name>`. The address must exist in the config files.',
    ],
    fix: [
      'Use an address that `kalup ir` lists, or remove the override. Add the property to config first if it is missing.',
    ],
    example: {
      output: [
        "kalup.config.ts:13: E_UNKNOWN_OVERRIDE: override 'property:companies/plot_size' is not an address in config (fix: use an address that kalup ir lists, or remove the override) (docs: errors/E_UNKNOWN_OVERRIDE.md)",
      ],
    },
  },
  E_UNKNOWN_TARGET: {
    exit: '3',
    title: '`--target` names an undeclared target',
    summary: '`--target` names a target that `kalup.config.ts` does not declare. Exit 3.',
    when: [
      'Commands check `--target` against the `targets` block before they send anything. An undeclared name never falls back to `defaultTarget` or to the only target. A `defaultTarget` that names no declared target is `E_DEFAULT_TARGET`.',
    ],
    fix: ['Use a declared name (the fix lists them), or add the target with its `portalId` and `credentials`.'],
    example: {
      output: [
        "kalup.config.ts:8: E_UNKNOWN_TARGET: target 'staging' is not declared (fix: use one of sandbox, production, or declare targets.staging) (docs: errors/E_UNKNOWN_TARGET.md)",
      ],
    },
  },
  E_UNREACHABLE: {
    exit: '1',
    title: 'HubSpot did not answer a request, even after retries',
    summary: 'HubSpot did not answer a request, even after retries. Exit 1.',
    when: [
      'A read failed before any response came (no network, DNS, a proxy or a firewall), or got no answer within 30 seconds. Kalup retries it three times with a growing pause, as it does for a 5xx, then stops with this code. The message names the request and the last failure: the network error, or the timeout. `status` marks the target `unreachable` and checks the others.',
    ],
    fix: ['Check the network connection and any proxy, then run the command again.'],
    example: {
      output: [
        'E_UNREACHABLE: GET /account-info/2026-09/details got no answer from HubSpot in 4 attempts: fetch failed (fix: Check the network connection and any proxy, then run the command again.) (docs: errors/E_UNREACHABLE.md)',
      ],
    },
  },
  E_UNSUPPORTED_FILE: {
    exit: '3',
    title: 'A file under `hubspot/` this version does not read',
    summary: 'A file under `hubspot/` that this version does not read. Exit 3.',
    when: [
      'A `definePipeline` file outside `hubspot/pipelines/`, a `defineConfig` file under `hubspot/`, and a `defineRemoved` file anywhere under `hubspot/` except `hubspot/removed.ts`. With `dir` set in `kalup.config.ts`, the same paths under that folder. Kalup reports them instead of skipping them silently.',
    ],
    fix: [
      'Move pipelines to `hubspot/pipelines/<object>.ts`, such as `hubspot/pipelines/deals.ts`. A `defineConfig` file belongs at the project root as `kalup.config.ts`, and tombstones belong in `hubspot/removed.ts`.',
    ],
    example: {
      output: [
        'hubspot/deals.ts:1: E_UNSUPPORTED_FILE: a definePipeline file belongs under hubspot/pipelines/ (fix: move it to hubspot/pipelines/) (docs: errors/E_UNSUPPORTED_FILE.md)',
      ],
    },
  },
  E_USAGE: {
    exit: '1',
    title: 'The command line is wrong',
    summary: 'The command line is wrong. Exit 1.',
    when: [
      "An unknown command, a flag the command does not take (each command accepts only its own flags), a flag without its value or repeated, an argument the command does not take or a missing one (`compare` needs two), `init` with an invalid `--portal` or `--dir`, or with `--target config`, or an `--out` path that is a symbolic link or lies inside `.kalup/` (other than `.kalup/snapshots/` and `.kalup/plans/`), the lock directory or the state and journal directories `KALUP_STATE_DIR` moves, where Kalup keeps state, journals and locks. Without a command only `--json`, `--help`, `-h` and `--version` are accepted, so `kalup --target sandbox` reads `--target needs a command` and `kalup --help --bogus` reads `unknown flag --bogus`. Without `--json` the help for the named command, or the root help, follows the issue. `kalup <command> --help` lists the command's flags.",
    ],
    fix: ['Run `kalup --help` and correct the command.'],
    example: {
      output: ['E_USAGE: unknown flag --portal (fix: run kalup --help) (docs: errors/E_USAGE.md)'],
    },
  },
  E_WRITE_IN_READ_MODE: {
    exit: '1',
    title: 'A request to a write path through a read client was refused',
    summary: 'Kalup refused to send a request to a write path through a read client. Exit 1. Nothing was sent.',
    when: [
      'Every command that only reads (`pull`, `plan`, `status`, `compare`, `snapshot`) goes through a client that allows only paths tagged `read`, so none of them can reach a write path. Only `kalup apply` opens a write client, and it may send only the writes on its own list (see `E_WRITE_NOT_ALLOWED`).',
    ],
    fix: ['This is a bug in Kalup. Report it with the command you ran.'],
    example: {
      output: [
        'E_WRITE_IN_READ_MODE: POST /crm/properties/2026-09/{objectType} is a write path and this client only reads. (docs: errors/E_WRITE_IN_READ_MODE.md)',
      ],
    },
  },
  E_WRITE_NOT_ALLOWED: {
    exit: '1',
    title: 'A write this run may not send was refused',
    summary: 'Kalup refused to send a write that this run may not send. Exit 1. Nothing was sent.',
    when: [
      'A run that writes gets an explicit list of the writes it may send. This version allows creating, updating and archiving properties and property groups, and creating, updating and deleting pipelines and stages, and nothing else: no custom object schema writes and no pipeline replace (PUT). A request to any other write path, or to a read path through the write channel, is refused before it leaves Kalup.',
    ],
    fix: ['This is a bug in Kalup. Report it with the command you ran.'],
    example: {
      output: [
        'E_WRITE_NOT_ALLOWED: POST /crm-object-schemas/2026-09/schemas (object create) is not a write this run may send. Nothing was sent. (docs: errors/E_WRITE_NOT_ALLOWED.md)',
      ],
    },
  },
  W_BLUEPRINT_DOWNGRADE: {
    exit: '0',
    title: '`blueprint upgrade` moves to a lower version',
    summary:
      'A warning from `kalup blueprint upgrade`: the new version is lower than the one the lock holds. Exit stays 0.',
    when: [
      "Versions compare as semantic versions, a pre-release below its release. Moving to a lower version is allowed, for example to back out a release, and merges like any other: config's own changes stay, and resources the lower version lacks are detached, not deleted.",
    ],
    fix: [
      'Check that the lower version is the one you meant. If not, run the upgrade again with the version you want.',
    ],
    example: {
      output: [
        'W_BLUEPRINT_DOWNGRADE: acme/renewals goes from 2.0.0 down to 1.0.0 (fix: check that the lower version is the one you meant; the merge treats it like any other version) (docs: errors/W_BLUEPRINT_DOWNGRADE.md)',
      ],
    },
  },
  W_CODEC_MISMATCH: {
    exit: '0, or 2 with `pull --check --exit-code`',
    title: "The file's builder does not match the portal type or fieldType",
    summary:
      "A warning from `pull`: the file's builder does not match the portal's property type or fieldType. Exit stays 0, except that `--check --exit-code` exits 2 on it.",
    when: [
      "The file has `p.string` for a `number` in the portal, say, or `p.enum` where the portal fieldType is `checkbox`, which only `p.multiEnum` takes. Pull keeps the property as written and refreshes nothing on it, so the app's types hold and the file still validates. A fieldType no builder takes, such as `calculation_rollup`, is not a mismatch. A custom HubSpot user property in the portal is managed by `p.owner` only, so another builder over it is a mismatch.",
    ],
    fix: ['Change the builder to the one the message names, or keep it if the app relies on it.'],
    example: {
      output: [
        'W_CODEC_MISMATCH: property:companies/plot_count is p.string in the file but type number in the portal; the file keeps p.string and nothing is refreshed (fix: change the builder to match the portal type, or keep it if the app relies on it) (docs: errors/W_CODEC_MISMATCH.md)',
        'W_CODEC_MISMATCH: property:companies/yield_tier is p.enum in the file, but its fieldType in the portal is checkbox, which p.enum does not take (p.multiEnum does); the file keeps p.enum and nothing is refreshed (fix: change the builder to p.multiEnum, or keep it if the app relies on it) (docs: errors/W_CODEC_MISMATCH.md)',
      ],
    },
  },
  W_INCOMPLETE: {
    exit: '0',
    title: 'A read of a target left some objects, or config properties, unread',
    summary: 'A warning: a read of a target left something unread, so what it holds is unknown. Exit stays 0.',
    when: [
      "A properties, groups or custom object schemas list answered 403 (`E_SCOPE`), so the object behind it was not read. Or a config property's portal group name holds whitespace (`W_UNADDRESSABLE_NAME`), so the read could not capture it: the snapshot lists it as `unaddressable`, with `complete: false`, and `plan` blocks its step with `W_UNADDRESSABLE_NAME` instead. `snapshot` still writes the file; its coverage marks what was not read. `docs` gives it for such a snapshot, listing it under Coverage. `plan` gives it when it could not read an object, or config has resources on a key not under `objects`, and blocks every resource there with reason `scope`: it never creates one. `compare` stops with `E_INCOMPLETE` instead.",
      'A resource missing from an object that was not read may still exist in the portal.',
    ],
    fix: [
      "A person adds the scopes the fix names to the target's read key in HubSpot, or renames the group it names to a name without spaces, then takes a new snapshot or plans again. For an object key the fix names, add it to `objects` in `kalup.config.ts`.",
    ],
    example: {
      output: [
        'W_INCOMPLETE: the snapshot of target sandbox is incomplete: harvest was not read, so what it holds is unknown (fix: add the scope crm.schemas.custom.read to the read key of target sandbox, then take a new snapshot) (docs: errors/W_INCOMPLETE.md)',
      ],
    },
  },
  W_JSON_FIELDTYPE: {
    exit: '0',
    title: 'A `p.json` property that is not a textarea',
    summary: 'A warning from validate: a `p.json` property whose `fieldType` is not `textarea`. Exit stays 0.',
    when: ['JSON text is often longer than one line, so it belongs in a textarea.'],
    fix: ["Set `fieldType: 'textarea'`."],
    example: {
      output: [
        "hubspot/objects/companies.ts:24: W_JSON_FIELDTYPE: p.json 'orch_row_meta' has fieldType 'text'; JSON text belongs in a textarea (fix: set fieldType: 'textarea') (docs: errors/W_JSON_FIELDTYPE.md)",
      ],
    },
  },
  W_KEY_COLLISION: {
    exit: '0',
    title: "A new property's default key was taken",
    summary:
      "A warning from `pull`: a new property's default key was taken, so its internal name is the key. Exit stays 0.",
    when: [
      'Pull keys a new property by camelCase of its internal name. When another property of the object already has that key, the new one gets its internal name as key.',
    ],
    fix: ['Rename either key to what the app should call it. Pull keeps keys as written from then on.'],
    example: {
      output: [
        'W_KEY_COLLISION: property:companies/plot_count: the key plotCount is taken, so its internal name is the key (fix: rename one of the two keys) (docs: errors/W_KEY_COLLISION.md)',
      ],
    },
  },
  W_LARGE_SCOPE: {
    exit: '0',
    title: 'A pull wrote more than 200 properties into a new object file',
    summary: 'A warning from `pull`: it wrote more than 200 properties into a new object file. Exit stays 0.',
    when: [
      '`init` writes `{}` for each object, so every custom property is in the pull scope, and the first pull writes each object file.',
    ],
    fix: [
      'If the app needs only some of them, set `custom: false` for that object, then delete the properties it does not need from the object file. Every property the file keeps stays in the pull scope; with `custom: false` pull adds no other custom property, and removing one from a file never deletes it in HubSpot. `include` names any other property the app needs.',
    ],
    example: {
      config: ['objects: {', "  companies: { custom: false, include: ['domain'] },", '},'],
      output: [
        'W_LARGE_SCOPE: the pull wrote 312 properties into the new file for companies: every custom property is in the pull scope (fix: set objects.companies.custom to false, then delete the properties the app does not need from hubspot/objects/companies.ts) (docs: errors/W_LARGE_SCOPE.md)',
      ],
    },
  },
  W_LEGACY_DIR: {
    exit: '0',
    title: 'The object files are in `kalup/`, the old default folder',
    summary: 'A warning from every command that reads the project: the object files are in `kalup/`. Exit stays 0.',
    when: [
      'Kalup keeps the object files in the folder `dir` in `kalup.config.ts` names, `hubspot/` by default. When `dir` is not set, `kalup/` holds .ts files and `hubspot/` holds none, Kalup keeps reading and writing `kalup/` and warns once per command. When both hold .ts files it stops with `E_DIR_AMBIGUOUS` instead.',
    ],
    fix: [
      "Add `dir: 'kalup'` to `kalup.config.ts` to keep the folder, or move `kalup/` to `hubspot/` (`git mv kalup hubspot`) and change the imports of `./kalup` in the app. If the folder holds `blueprints.lock.json`, replace `kalup/.blueprints/` with `hubspot/.blueprints/` in it. Update the formatter ignore `init` wrote (`!kalup` in biome, `kalup/` in `.prettierignore`) to the folder you keep.",
    ],
    example: {
      output: [
        "kalup.config.ts: W_LEGACY_DIR: the object files are in kalup/, the old default folder; the default is now hubspot/ (fix: add dir: 'kalup' to kalup.config.ts, or move kalup/ to hubspot/) (docs: errors/W_LEGACY_DIR.md)",
      ],
    },
  },
  W_LIMIT_HEADROOM: {
    exit: '0',
    title: 'HubSpot reports room for fewer custom properties than the plan creates',
    summary:
      'A warning from `plan`: HubSpot reports room for fewer custom properties than the plan creates. Exit stays 0.',
    when: [
      "Before it plans, `plan` reads HubSpot's Limits Tracking API for the custom property limit when the plan creates a property. It does not read the custom object limit, since custom object creates are unsupported. Properties count against the portal's limit and against their object's own limit, standard or custom, when HubSpot lists one. When the limit minus the usage is above 0 but below the number of creates, every create stays in the plan and the ones past the limit would fail. When nothing is left, each create is blocked with reason `limit` instead.",
      'A reading HubSpot refuses, or answers without a limit and usage, is unreadable and blocks nothing (`W_LIMIT_UNREADABLE`).',
    ],
    fix: [
      "Leave some of the creates out on this target: add `{ '<address>': { skip: true } }` under `targets.<target>.overrides` for each one.",
    ],
    example: {
      output: [
        'W_LIMIT_HEADROOM: the plan creates 3 custom properties and HubSpot reports room for 2 more (limit 1000, 998 in use) (fix: leave some of them out on this target with skip overrides under targets.sandbox.overrides) (docs: errors/W_LIMIT_HEADROOM.md)',
      ],
    },
  },
  W_LIMIT_UNREADABLE: {
    exit: '0',
    title: "The plan creates properties and HubSpot's property limit could not be read",
    summary:
      "A warning from `plan`, and from `apply` without a plan file: the plan creates properties, and HubSpot's property limit reading could not be read, so the plan did not check them against the limit. Exit stays 0. Nothing is blocked.",
    when: [
      "Before it plans a property create, `plan` reads HubSpot's Limits Tracking API for the custom property limit (W_LIMIT_HEADROOM). That read answers 403 to a key with `crm.schemas.*` scopes only, and 200 once the key holds one `crm.objects.<object>.read` scope of any object (live runs, 2026-09-29 and 2026-10-01). The message gives HubSpot's status, or the issue code for another error or a 200 without a limit and a usage (`E_HTTP`). A create past the limit then fails in `apply` instead of being blocked in the plan.",
    ],
    fix: [
      "Add a `crm.objects.<object>.read` scope to the key, such as `crm.objects.companies.read` (Development > Keys > Service keys); it also lets the key read that object's records, which Kalup never requests. One such scope, of any object, is enough for every Limits Tracking reading.",
    ],
    example: {
      output: [
        "W_LIMIT_UNREADABLE: HubSpot's property limit reading answered 403, so the plan could not check the property limit for 2 creates (fix: add a crm.objects.<object>.read scope, such as crm.objects.companies.read, to the key) (docs: errors/W_LIMIT_UNREADABLE.md)",
      ],
    },
  },
  W_MODE_SHADOWED: {
    exit: '0',
    title: "A target's mode overrides an object's mode",
    summary: "A warning from validate: a target's `mode` overrides the mode an object states. Exit stays 0.",
    when: [
      "`targets.<target>.mode` wins over `objects.<object>.mode` on that target. When the two differ and the target states nothing for that object under `targets.<target>.objects`, the object's statement has no effect there, which is easy to miss when you read `objects` alone.",
    ],
    fix: [
      'If that is intended, state it for the object on the target, under `targets.<target>.objects.<object>.mode`, and the warning goes. Otherwise remove one of the two statements.',
    ],
    example: {
      output: [
        "kalup.config.ts:14: W_MODE_SHADOWED: targets.sandbox.mode 'addon' overrides objects.companies.mode 'takeover' on target sandbox (fix: state it under targets.sandbox.objects.companies.mode, or remove one of the two) (docs: errors/W_MODE_SHADOWED.md)",
      ],
    },
  },
  W_OBJECT_PROPERTY: {
    exit: '0',
    title: "A custom object's display, required or searchable field names a property the object file does not list",
    summary:
      "A warning from validate: a custom object's `primaryDisplayProperty`, `secondaryDisplayProperties`, `requiredProperties` or `searchableProperties` names a property its object file does not list. Exit stays 0.",
    when: [
      'HubSpot refuses a schema create or update that names a property it does not hold (live runs, 2026-10-05). A property HubSpot gives every custom object, such as `hs_object_id` or `hs_createdate`, needs no entry. Any other one the object file does not list may still be in the portal, outside the pull scope, so validate only warns. `plan` blocks a schema write that names a property neither the portal holds nor the plan creates.',
    ],
    fix: [
      "Add the property to the object's `properties`: with its definition when Kalup should create it, or as a reference, `p.string('<name>')`, when HubSpot holds it already.",
    ],
    example: {
      output: [
        "hubspot/objects/orchard_visit.ts:3: W_OBJECT_PROPERTY: primaryDisplayProperty of object:orchard_visit names visit_title, which the object file does not list; HubSpot refuses a schema write naming a property it does not hold (fix: add visit_title to the object's properties, as a reference if HubSpot holds it already: p.string('visit_title')) (docs: errors/W_OBJECT_PROPERTY.md)",
      ],
    },
  },
  W_OVERRIDE_OPTION: {
    exit: '0',
    title: "A definition override lists an option value a strict enum's shared options lack",
    summary:
      "A warning from validate: a target's definition override lists an option value the shared options of a `.strict()` enum lack. Exit stays 0.",
    when: [
      "The app types and decodes an enum from the shared file alone. On that target HubSpot can store the new value, and a `.strict()` codec's `get` throws on it. A lenient enum reads it as `Unlisted`, so it gets no warning. A shared option the override leaves out is fine.",
    ],
    fix: [
      'If the app reads the property from that target, add the option to the shared options. Other targets then get it too, unless they override `options` as well. Or drop `.strict()`, and handle `Unlisted` in the app.',
    ],
    example: {
      output: [
        "kalup.config.ts:8: W_OVERRIDE_OPTION: property:deals/payment_terms on target sandbox: option 'net90' is not in the shared options, so the app's codec for paymentTerms throws on this value (fix: add it to the shared options if the app reads paymentTerms from target sandbox) (docs: errors/W_OVERRIDE_OPTION.md)",
      ],
    },
  },
  W_PENDING_TARGET: {
    exit: '0',
    title: 'A target has no `portalId` yet',
    summary:
      'A warning from `validate` and every command that validates: a target has no `portalId` yet. Exit stays 0.',
    when: [
      '`kalup init` without `--portal` writes a pending target, since init never asks HubSpot. Commands that only read the files work; one that needs the portal refuses the target with `E_PENDING_TARGET`. A pending target is left out of the IR, and it pins no portal.',
    ],
    fix: ['Set `portalId` on the target to the Hub ID from the HubSpot account menu.'],
    example: {
      config: ['targets: {', "  production: { credentials: { read: { env: 'HUBSPOT_SERVICE_KEY' } } },", '},'],
      output: [
        "kalup.config.ts:7: W_PENDING_TARGET: target 'production' has no portalId yet, so no command reads or writes its portal (fix: set targets.production.portalId to the Hub ID from the HubSpot account menu) (docs: errors/W_PENDING_TARGET.md)",
      ],
    },
  },
  W_PIN_EXPIRES: {
    exit: '0',
    title: 'A pinned HubSpot API version expires within 90 days',
    summary:
      'A warning from `status` or `plan`: a HubSpot API version Kalup pins expires within 90 days. Exit stays 0.',
    when: [
      'HubSpot supports each dated API version for 18 months. Kalup pins one version per API family and warns once per family as the end nears: `status` for every family it pins, `plan` for the families its steps use.',
    ],
    fix: ['Upgrade `kalup` to a release that pins a newer version.'],
    example: {
      output: [
        'W_PIN_EXPIRES: the crm.properties API pin 2026-09 expires 2028-03 (fix: upgrade kalup to a release that pins a newer version) (docs: errors/W_PIN_EXPIRES.md)',
      ],
    },
  },
  W_PREFIX: {
    exit: '0',
    title: 'A managed property lacks the project prefix',
    summary: "A warning from validate: a managed property's internal name lacks the project `prefix`. Exit stays 0.",
    when: [
      '`prefix` in `kalup.config.ts` is set, and a property Kalup would own does not start with it. References are not checked.',
    ],
    fix: [
      'Rename the property to carry the prefix, or clear `prefix`. A property already in HubSpot keeps its internal name; renaming means a new property.',
    ],
    example: {
      output: [
        "hubspot/objects/companies.ts:14: W_PREFIX: 'soil_type' does not carry the project prefix 'orch_' (fix: rename it to orch_soil_type, or clear prefix in kalup.config.ts) (docs: errors/W_PREFIX.md)",
      ],
    },
  },
  W_RATE_HEADERS: {
    exit: '0',
    title: 'No rate-limit headers (from `status`), or no daily figure (from `plan` and `apply`)',
    summary: "A warning from `status`, `plan` or `apply` about HubSpot's rate-limit headers. Exit stays 0.",
    when: [
      'From `status`: HubSpot sent no rate-limit headers, so Kalup sends at most 8 requests per second. The other commands report that as W_RATE_LIMIT.',
      'From `plan`: HubSpot sent no daily figure, or one that is not a whole number of requests (empty, fractional, negative), so `budget.dailyRemaining` is `null` and the plan cannot weigh its calls against the daily limit. From `apply`: the same, so it cannot refuse a run that would use more than half of what is left (`E_BUDGET`).',
      "A service key's answers carry the daily headers (live runs, 2026-09-29 and 2026-10-01), so this warning is not expected with one; the fallback stays for an answer without them.",
    ],
    fix: ['Nothing to fix.'],
    example: {
      output: [
        'W_RATE_HEADERS: HubSpot sent no daily rate-limit header, so the plan cannot weigh its calls against the daily limit (docs: errors/W_RATE_HEADERS.md)',
      ],
    },
  },
  W_RATE_LIMIT: {
    exit: '0',
    title: 'No rate-limit headers (from `pull`, `plan`, `snapshot` and `compare`)',
    summary:
      'A warning from `pull`, `plan`, `snapshot` or `compare`: HubSpot sent no rate-limit headers. Exit stays 0.',
    when: [
      "Kalup paces requests from HubSpot's rate-limit headers. Without them it sends at most 8 requests per second. A service key's answers carry them (live runs, 2026-09-29 and 2026-10-01), so this warning is not expected with one. `status` reports the same thing as W_RATE_HEADERS.",
    ],
    fix: ['Nothing to fix. A large read takes a little longer.'],
    example: {
      output: [
        'W_RATE_LIMIT: HubSpot sent no rate-limit headers. Sending at most 8 requests per second. (docs: errors/W_RATE_LIMIT.md)',
      ],
    },
  },
  W_STATE_NOT_MOVED: {
    exit: '0',
    title: "`state: 'repo'` finds no state file, but the local state directory has one",
    summary:
      "A warning from `status`, `pull`, `plan` and `apply`: with `state: 'repo'` the portal has no state file beside the object files, but `.kalup/state/` holds one. Exit stays 0.",
    when: [
      "`state: 'repo'` moves where Kalup reads and writes state, from `.kalup/state/` to `<dir>/state/`. Kalup does not move the file for you. Until it is moved, every command starts from no state: what Kalup created plans as adopt steps, and a value you changed in a file is held as diverged instead of planned as an update.",
    ],
    fix: [
      'Move the file the warning names before the next apply, for example `mkdir -p hubspot/state && mv .kalup/state/portal-2222222.json hubspot/state/portal-2222222.json`, then commit it. If a `pull` already wrote a new file there, the move replaces it, which is what you want: the old file keeps what Kalup created and the values it last applied.',
    ],
    example: {
      output: [
        "hubspot/state/portal-2222222.json: W_STATE_NOT_MOVED: state: 'repo' reads hubspot/state/portal-2222222.json, which does not exist, but .kalup/state/portal-2222222.json holds the state from before the switch; this command starts from no state (fix: move it before the next apply: mkdir -p hubspot/state && mv .kalup/state/portal-2222222.json hubspot/state/portal-2222222.json) (docs: errors/W_STATE_NOT_MOVED.md)",
      ],
    },
  },
  W_UNADDRESSABLE_NAME: {
    exit: '0, or 1 with `compare` for a property config names',
    title: 'A portal group or property has a name no address can hold, so the read left it out',
    summary:
      'A warning from `compare`, `plan` and `snapshot`: a portal group or property has a name no address can hold, so the read left it out. Exit stays 0, except as below.',
    when: [
      'An address is `<type>:<path>` with no whitespace. HubSpot names its groups and properties without spaces, but its API does not promise it. A group whose name holds whitespace is not captured, nor is a property whose own name or group name holds it; the property is listed as out of scope. A property outside the pull scope that config does not name gets no warning.',
      'A property config names in such a group is `unaddressable` in coverage instead: unknown, never absent, so `plan` never creates it. `compare` reports it `unknown` (`E_INCOMPLETE`, exit 1), `plan` blocks it, and the read is incomplete (`W_INCOMPLETE` in `snapshot`).',
      '`pull` still writes such a name into config, and `validate` accepts it. `compare` and `plan` then stop with `E_UNEXPECTED`.',
    ],
    fix: ['Rename it in HubSpot to a name without spaces if you want Kalup to compare it. Otherwise nothing to fix.'],
    example: {
      output: [
        "W_UNADDRESSABLE_NAME: property 'a b' on companies has a name no address can hold, so it is not captured (fix: rename it in HubSpot to a name without spaces) (docs: errors/W_UNADDRESSABLE_NAME.md)",
      ],
    },
  },
  W_UNFINISHED_APPLY: {
    exit: '0',
    title: 'The last apply to this portal did not finish, or left a write whose outcome is unknown',
    summary:
      'A warning from `plan`, and from `apply` without a plan file, about the last apply to this portal. Exit stays 0.',
    when: [
      'State records that the last apply did not finish (the process ended while it ran, so `lastApply.outcome` is still `running`), or that it left a write whose outcome is unknown (`uncertain`). What that apply wrote may already be in HubSpot. A property or group it created appears in this plan as an adopt step, because state has no entry for it yet, and a value it wrote may appear as a held value.',
      'Recovery is this plan: nothing is repeated blindly, and nothing is adopted without your review.',
    ],
    fix: [
      'Review the adopt steps and held values before you apply this plan. `kalup status` shows the last apply and its plan ID, and the journal under `.kalup/journal/` lists each request it sent.',
    ],
    example: {
      output: [
        'W_UNFINISHED_APPLY: the last apply (pl_3f9a1c07b2e4, at 2026-09-24T10:15:30.000Z) did not finish; resources it may have written appear below as adopt steps or held values (fix: review those steps before you apply this plan; kalup status shows the last apply) (docs: errors/W_UNFINISHED_APPLY.md)',
      ],
    },
  },
  W_UNRESOLVED: {
    exit: '0',
    title: 'A resource carries an `$unresolved` marker',
    summary: 'A warning from validate: a resource carries an `$unresolved` marker. Exit stays 0.',
    when: [
      'The marker stands for a portal ID that could not be mapped to an address. In this version no command writes it and the config grammar has no place for it, so it should not appear.',
    ],
    fix: [
      'If you see it, report it with the command you ran. The `kalup bind` command its fix names does not exist yet.',
    ],
    example: {
      output: [
        'W_UNRESOLVED: workflow:renewal_reminder carries team ID 8841 from target production, which no address maps to (fix: run kalup bind workflow:renewal_reminder 8841 --target <target> to map it, or replace it with a $ref) (docs: errors/W_UNRESOLVED.md)',
      ],
    },
  },
  W_UNSUPPORTED_TYPE: {
    exit: '0',
    title: 'A portal property Kalup does not write',
    summary:
      'A warning from any command that reads a portal: a property in the pull scope or the object files that Kalup does not write. It reads as a `p.string` reference. Exit stays 0.',
    when: [
      'Its HubSpot `type` has no builder (`object_coordinates`, `json`, or a type Kalup does not know), it is a custom property whose `fieldType` its builder does not allow (a `calculation_rollup`), or it is a custom `externalOptions` property that is not an owner select or radio (a multi-owner checkbox, or options from elsewhere), whose options HubSpot fills. An owner select or radio is `p.owner`. Pull writes it as a `p.string` reference, with `.readonly()` when HubSpot marks its value read-only. A file entry that is already a reference keeps its builder; a managed one becomes a `p.string` reference. `plan` never creates, changes or archives it, and blocks a managed entry; `compare` compares the fields it has.',
      'A HubSpot-defined or HubSpot-calculated `externalOptions` property raises no warning: it is a reference like any HubSpot-defined property. Nor does a property outside the pull scope that no object file names: the project does not use it.',
    ],
    fix: [
      'Nothing to fix in config. Read the value through the `p.string` reference, or through another builder the app chooses for a reference. To change the property, change it in HubSpot.',
    ],
    example: {
      output: [
        'W_UNSUPPORTED_TYPE: property:companies/plot_shape has type object_coordinates and fieldType text, which Kalup does not write; read as a p.string reference (docs: errors/W_UNSUPPORTED_TYPE.md)',
      ],
    },
  },
  W_UNVERIFIED: {
    exit: '5 for the apply run',
    title: 'A write read back with another value than the one sent, or did not read back in time',
    summary:
      'HubSpot accepted a write, but reading it back did not show the value sent. Exit stays 0, except that the apply run exits 5: not every effect verified.',
    when: [
      'After each write, apply reads the resource back and compares every unit it approved. A unit HubSpot stores differently, for example a label it rewrote, is unverified: its base does not move, and state records both values in the entry\'s `rewrites`. The next plan then notes "HubSpot stores X; change config to match" instead of writing the same value again. A write HubSpot acknowledged whose result no read showed within 60 seconds is unverified too.',
    ],
    fix: [
      'Change config to the value HubSpot stores, then run `kalup plan --target <name>`. When nothing read back in time, run `kalup plan` to compare the portal with state again.',
    ],
    example: {
      output: [
        'W_UNVERIFIED: s1 Update property "Soil acidity" (soil_ph) on companies, set label: HubSpot stores label as "SOIL ACIDITY", not "Soil acidity" as sent (fix: change config to the value HubSpot stores, then run kalup plan --target sandbox) (docs: errors/W_UNVERIFIED.md)',
      ],
    },
  },
  W_WRITE_SCOPE: {
    exit: '0',
    title: 'The key apply writes with lacks a write scope apply needs',
    summary:
      "A warning from `status`: HubSpot's token introspection lists the read key's scopes, and a write scope apply needs is not among them. Exit stays 0.",
    when: [
      "`status` reads the scopes a service key holds through HubSpot's token introspection (the key goes in the request body, as HubSpot requires) and checks the write scopes `init` lists against them by name, when apply writes with the same key. A separate write key is never resolved or sent, so its scopes stay unchecked and the line says so. When introspection answers nothing, status checks no write scope.",
    ],
    fix: [
      'Add the scope the message names to the key (Development > Keys > Service keys), then run `kalup status` again.',
    ],
    example: {
      output: [
        'W_WRITE_SCOPE: the key in HUBSPOT_SANDBOX_KEY does not hold crm.schemas.companies.write, which apply needs for companies (fix: add the scope crm.schemas.companies.write to the key) (docs: errors/W_WRITE_SCOPE.md)',
      ],
    },
  },
} satisfies Record<string, IssueDoc>

export type IssueCode = keyof typeof issues
