# 0003. Config is parsed, never executed

## Status

accepted

## Date

2026-09-22

## Context

The first draft loaded `kalup.config.ts` and the generated object files with `jiti`, and preserved hand edits on re-pull by evaluating the old file and building an override table. The authoring judge ruled against evaluation for four reasons: loading resolves imports, so an admin's folder with no `package.json` cannot run it; a pull request to the config repo runs code on the reviewer's machine, and Node cannot block its network access; blueprint strings would be printed into source the CLI later executes; and a hosted service could never touch customer config. The judge's ruling was plain data literals (`export default {...} as const satisfies ObjectFile`).

The founder kept the `p.*` builder syntax from the draft. It reads like Drizzle, the README demo was written around it, and it carries the app binding (key, codec, `required`, `readonly`) in one place next to the HubSpot definition. The reconciliation is this ADR.

## Decision

Config files are TypeScript in a restricted grammar. The tool parses them and prints them back in one canonical form. It never runs them: no `jiti`, no child process, no sandbox, no permission flags. The app runs the same file for its types and codecs (`InferProperties`, `defineObject`, the `p.*` codecs), which keeps the developer wedge: types with no generate step.

```ts
import { defineObject, p, type InferProperties } from '@kalup/core'

export const Company = defineObject('companies', {
  groups: { billing: { label: 'Billing' } },
  properties: {
    // Set by the billing sync. Do not edit by hand.
    billingStatus: p.enum('billing_status', {
      label: 'Billing status',
      group: 'billing',
      fieldType: 'select',
      options: [{ value: 'active', label: 'Active' }, { value: 'PAST DUE', label: 'Past due', as: 'past_due' }],
    }).required(),
    // HubSpot-defined property. Reference only.
    name: p.string('name'),
  },
})
export type CompanyData = InferProperties<typeof Company.properties> & { id: string }
```

The reader accepts, and nothing else:

- Import statements. The `@kalup/core` and `kalup` imports are tool-owned. Other imports are kept verbatim (they exist for `p.json` validators).
- `export const <Name> = defineObject('<object>', {...})` and `defineCustomObject('<name>', {...})`, one or more per file.
- `export type <Name>Data = InferProperties<typeof <Name>.properties> & { id: string }`.
- Inside: object literals, arrays, string, number and boolean literals, and builder calls `p.<kind>('<internal name>', {<definition>}?)` followed by any of `.required()`, `.readonly()`, `.managed(false)`.
- `p.json('<name>', <expression>, {<definition>}?)`, where the second argument is kept as opaque source text.
- Leading comments attached to a property, group or object entry, re-emitted in place.

Anything else (an identifier other than a builder, a spread, another call, a template string, a loop, a comment anywhere else) is `E_NOT_DATA` with file, line and a fix hint. Three invariants are tested: `write(parse(t)) === t` for canonical text, `parse(write(x))` deep-equals `x`, and a repeat `pull` with no portal change is byte-identical.

Everything the judge wanted from data literals holds: no evaluator, blueprints cannot run code, a hosted service can read and write config as text, and pull round-trips without an override table.

## Alternatives considered

- **Evaluate with `jiti` (the draft).** Runs code on every `pull`, `plan` and in any hosted service. Rejected.
- **Plain data literals (the judge's ruling).** Same safety, simpler parser. Overruled by the founder: it gives up the builder syntax and the one-file binding the developer persona buys. The restricted grammar gets the same properties with a slightly larger parser.
- **A dual frontend with a parser-based splice editor.** Best write-back quality (comments survive anywhere), but three modes and a printer in the first milestone. Too much for one part-time founder. Rejected.
- **Full TypeScript in a sandbox.** Node cannot sandbox untrusted code. Rejected.

## Consequences

- Loops, helpers, shared option lists and computed names are gone. A `.ts` file that rejects some TypeScript will surprise people; the error message must say why and where.
- Comments survive only in attached positions. Elsewhere they are an error rather than silently dropped.
- The reader and canonical writer are new code that must never lose data. The app imports tool-written files, so string escaping is a security boundary. Fuzz it.
- `p.json` validators stay opaque to the tool and to blueprints (ADR 0011).
- Each new resource type costs grammar and writer work. That is the price of the syntax.
- `kalup fmt` exists so hand edits land in canonical form before a pull.
- The dogfood project is the test: if the founder reaches for a loop in week one, reopen this.
