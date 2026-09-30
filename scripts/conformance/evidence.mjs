// The evidence a run leaves: live-runs/conformance/<date>-<run id>.json (gitignored) with every check, its facts and
// requests, and a Markdown summary next to it. Before either is written, the portal ID becomes `test-portal`, a custom
// object's type ID `custom-object`, HubSpot user IDs `[user]`, and any email address `[email]`; no key reaches them, the
// second, limited key included, and a text that would still hold one is not written. HubSpot's correlationId values
// stay, so HubSpot support can find a request.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const EVIDENCE_FORMAT = 'kalup-conformance/1'
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const CUSTOM_OBJECT = /\b2-\d+\b/g
const USER_FIELDS = new Set(['createdUserId', 'updatedUserId', 'userId'])
const PIPE = /\|/g
const NEWLINE = /\n/g

/** `value` with the portal ID, custom object type IDs, user IDs, email addresses and every key in `keys` replaced. */
export function redact(value, { keys, portalId }) {
  const portal = new RegExp(`\\b${portalId}\\b`, 'g')
  function text(s) {
    return keys
      .reduce((t, key) => t.replaceAll(key, '[key]'), s)
      .replace(CUSTOM_OBJECT, 'custom-object')
      .replace(portal, 'test-portal')
      .replace(EMAIL, '[email]')
  }
  function walk(v, field) {
    if (field !== undefined && USER_FIELDS.has(field) && v !== null && v !== undefined) {
      return '[user]'
    }
    if (typeof v === 'string') {
      return text(v)
    }
    if (typeof v === 'number') {
      return v === portalId ? 'test-portal' : v
    }
    if (Array.isArray(v)) {
      return v.map((item) => walk(item))
    }
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, item]) => [text(k), walk(item, k)]))
    }
    return v
  }
  return walk(value)
}

/** Writes the JSON and the Markdown summary into `dir`; returns both paths. */
export function writeEvidence(dir, evidence, secrets) {
  const redacted = redact(evidence, secrets)
  const base = `${redacted.date}-${redacted.runId}`
  const json = `${JSON.stringify(redacted, null, 2)}\n`
  const markdown = summary(redacted, `${base}.json`)
  for (const out of [json, markdown]) {
    if (secrets.keys.some((key) => out.includes(key))) {
      throw new Error('the evidence would hold a key; nothing was written')
    }
  }
  mkdirSync(dir, { recursive: true })
  const files = { json: join(dir, `${base}.json`), markdown: join(dir, `${base}.md`) }
  writeFileSync(files.json, json)
  writeFileSync(files.markdown, markdown)
  return files
}

function cell(text) {
  return String(text ?? '')
    .replace(PIPE, '\\|')
    .replace(NEWLINE, ' ')
}

const RESULT = { pass: 'pass', fail: '**fail**', 'not-applicable': 'n/a' }

/** The Markdown summary: the run, one row per check, the not-applicable reasons and the cleanup. */
export function summary(evidence, jsonName) {
  const { checks, cleanup, summary: counts, versions } = evidence
  const lines = [
    `# Conformance run ${evidence.runId}`,
    '',
    `A ${evidence.mode} run on ${evidence.date} against a ${evidence.accountType} account, recorded as \`test-portal\`. Kalup ${versions.kalup ?? 'not run'}, Node ${versions.node}, HubSpot API ${Object.values(versions.api)[0]}.`,
    '',
    `Result: ${counts.pass} pass, ${counts.fail} fail, ${counts['not-applicable']} not applicable. Cleanup: ${cleanup.complete ? 'complete' : `incomplete, ${cleanup.resources.filter((r) => !['archived', 'already-archived', 'absent'].includes(r.result)).length} resources left`}.`,
    '',
    evidence.mode === 'simulate'
      ? `Each check's facts and requests are in [${jsonName}](${jsonName}). The checks ran against Kalup's HubSpot simulator and no request reached HubSpot: a pass proves the runner's mechanics (the manifest, each check and the cleanup), not HubSpot's behaviour. Only a live run settles what docs/hubspot.md lists.`
      : `Each check's facts, requests and HubSpot correlation IDs are in [${jsonName}](${jsonName}). Pass means HubSpot behaved as Kalup assumes; fail means it did not. What to update after a run: docs/hubspot.md.`,
    '',
    '| Check | Result | Observed |',
    '|---|---|---|',
    ...checks.map((c) => `| \`${c.id}\` | ${RESULT[c.status]} | ${cell(c.note ?? c.reason ?? '')} |`),
    '',
  ]
  const failed = checks.filter((c) => c.status === 'fail')
  if (failed.length > 0) {
    lines.push(
      '## Failed',
      '',
      ...failed.map((c) => `- \`${c.id}\`: assumed ${cell(c.assumption)} Observed: ${cell(c.note)}`),
      '',
    )
  }
  const skipped = checks.filter((c) => c.status === 'not-applicable')
  if (skipped.length > 0) {
    lines.push('## Not applicable', '', ...skipped.map((c) => `- \`${c.id}\`: ${c.reason}`), '')
  }
  lines.push(
    '## Cleanup',
    '',
    '| Resource | Result |',
    '|---|---|',
    ...cleanup.resources.map((r) => `| \`${r.address}\` | ${r.result}${r.status ? ` (${r.status})` : ''} |`),
    '',
  )
  return lines.join('\n')
}
