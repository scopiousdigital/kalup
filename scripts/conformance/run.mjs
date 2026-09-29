#!/usr/bin/env node
// The live conformance runner: exercises one authorized HubSpot test portal and writes an evidence file. How to run it,
// what each check means and what to update afterwards: docs/conformance/checklist.md.
//
//   node scripts/conformance/run.mjs --portal <id> --i-own-this-test-portal <id> [--scopes <list>] [--out <dir>]
//                                    [--work <dir>] [--cli <path>] [--simulate]
//   node scripts/conformance/run.mjs --cleanup <manifest> --portal <id> --i-own-this-test-portal <id>
//
// It refuses to start unless --portal is given, --i-own-this-test-portal repeats it, the key in KALUP_CONFORMANCE_KEY
// belongs to that portal and the account is a developer test account or a sandbox; there is no override. The key is
// never a flag and never printed. Every resource it creates carries the prefix kalupconf_<run id>_ and is written to a
// run manifest before its create is sent; it changes and archives nothing else, and cleans up exactly those at the end.
// --simulate runs every check against the CLI tests' simulator instead, sending nothing to HubSpot. The runner never
// commits. KALUP_CONFORMANCE_LIMITED_KEY, when set, holds a second key of the same portal without
// crm.schemas.companies.write: the run checks it belongs to the portal before anything is written, then sends one create
// with it, which HubSpot should refuse with a 403.
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { lifecycle, logChecks, missingScope, poller, readChecks } from './checks.mjs'
import { API, cleanup, createClient, newManifest, paths, prefixOf, READ_DEADLINE_MS, readManifest } from './client.mjs'
import { EVIDENCE_FORMAT, writeEvidence } from './evidence.mjs'
import { kalupChecks, kalupVersion } from './kalup.mjs'
import { loadSimulator, SIMULATED_KEY, SIMULATED_LIMITED_KEY, simulatedPortal, withLimitedKey } from './simulate.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const KEY_VARIABLE = 'KALUP_CONFORMANCE_KEY'
const LIMITED_VARIABLE = 'KALUP_CONFORMANCE_LIMITED_KEY'
const ACCOUNT_TYPES = new Set(['DEVELOPER_TEST', 'SANDBOX'])
/** The version each API family the runner sends is pinned to, as in the CLI's endpoint registry. */
export const API_PINS = { 'crm.properties': API, 'crm-object-schemas': API, 'account-info': API, 'crm.limits': API }

const EXIT = { done: 0, failed: 1, refused: 2, leftBehind: 3 }
const PORTAL_ID = /^[1-9]\d{0,14}$/
const ACCOUNT_TYPE = /^[A-Z_]{1,40}$/
const CATEGORY = /^[A-Z_]{1,60}$/
const CORRELATION_ID = /^[0-9a-fA-F-]{8,64}$/
// A flag that looks like it carries a key, or an argument shaped like a HubSpot key.
const KEY_FLAG = /^--?(?:key|token|access-token|api-key|service-key|secret|bearer|auth|authorization)(?:=|$)/i
const KEY_SHAPE = /(?:^|=)pat-[a-z0-9]+-/i
/** The shortest environment value compared against the arguments, so an empty or tiny value matches nothing. */
const MIN_KEY_LENGTH = 8

const OPTIONS = {
  portal: { type: 'string' },
  'i-own-this-test-portal': { type: 'string' },
  cleanup: { type: 'string' },
  simulate: { type: 'boolean' },
  scopes: { type: 'string' },
  out: { type: 'string' },
  work: { type: 'string' },
  cli: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
}

const USAGE = `Usage:
  node scripts/conformance/run.mjs --portal <id> --i-own-this-test-portal <id> [options]
  node scripts/conformance/run.mjs --cleanup <manifest> --portal <id> --i-own-this-test-portal <id>

The key comes from ${KEY_VARIABLE}, never a flag. The account must be DEVELOPER_TEST or SANDBOX. A second key of the
same portal without crm.schemas.companies.write, in ${LIMITED_VARIABLE}, adds the missing-scope check.

Options:
  --scopes <list>   the scopes the key was given, comma-separated, recorded in the evidence
  --out <dir>       where the evidence goes (default docs/conformance/runs, or the work directory with --simulate)
  --work <dir>      the run's manifest and generated project (default a new directory under the system temp directory)
  --cli <path>      the Kalup CLI to run (default packages/cli/dist/index.mjs)
  --simulate        run every check against the CLI tests' simulator; nothing is sent to HubSpot
  --cleanup <file>  archive what an interrupted run's manifest names and still exists
`

/**
 * Runs the runner with `argv` and returns its exit code: 0 every check passed or was not applicable and cleanup is
 * complete, 1 a check failed, 2 refused before any write, 3 cleanup left resources behind.
 *
 * `io`: `env` (default process.env), `stdout` and `stderr` (text writers), `stdin`, `sleep`, and for --simulate `fetch`,
 * a simulator's fetch in place of the one the runner loads, and `person`, who gets the delete command the runner prints
 * ({ cwd, argv }) and runs it against that simulator, as a person at a terminal does live.
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env
  const secrets = secretsOf(env)
  const out = output(io, secrets)
  if (argv.some((arg) => KEY_FLAG.test(arg) || KEY_SHAPE.test(arg) || [...secrets].some((s) => arg.includes(s)))) {
    return refuse(
      out,
      `E_KEY_IN_FLAG: the key comes from ${KEY_VARIABLE} only, never a flag or an argument. Nothing was sent. If you typed a key on a command line, it is in your shell history: rotate it in HubSpot.`,
    )
  }
  let options
  try {
    options = parseArgs({ args: argv, options: OPTIONS, strict: true, allowPositionals: false }).values
  } catch (error) {
    return refuse(out, `E_USAGE: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
  }
  if (options.help) {
    out.say(USAGE)
    return EXIT.done
  }
  const portalId = portalOf(options)
  if (typeof portalId === 'string') {
    return refuse(out, portalId)
  }
  const simulate = options.simulate === true
  const scopes = options.scopes
    ? options.scopes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : null
  const key = simulate ? SIMULATED_KEY : env[KEY_VARIABLE]
  if (!key) {
    return refuse(out, `E_MISSING_KEY: set ${KEY_VARIABLE} to a service key of the test portal. Nothing was sent.`)
  }
  secrets.add(key)
  const runId = randomBytes(4).toString('hex')
  const work = resolve(options.work ?? join(tmpdir(), 'kalup-conformance', runId))
  const sleep = io.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)))
  const fetch = simulate ? withLimitedKey(io.fetch ?? (await simulatedFetch(work, portalId, scopes))) : globalThis.fetch
  const client = createClient({ fetch, key, sleep, gapMs: simulate ? 0 : 150 })
  const guarded = await guard(client, portalId)
  if (guarded.refusal) {
    return refuse(out, guarded.refusal)
  }
  const limited = await limitedKey({ env, fetch, key, portalId, simulate, sleep })
  if (limited.refusal) {
    return refuse(out, limited.refusal)
  }
  const poll = poller({
    sleep,
    now: () => performance.now(),
    intervalMs: simulate ? 0 : 500,
    deadlineMs: READ_DEADLINE_MS,
  })
  const setting = {
    client,
    env,
    fetch,
    io,
    key,
    limited,
    options,
    out,
    poll,
    portalId,
    runId,
    scopes,
    simulate,
    sleep,
    work,
  }
  if (options.cleanup !== undefined) {
    return cleanupOnly(setting)
  }
  return run({ ...setting, account: guarded.account })
}

// Every key the run may hold, simulated ones included: none is ever printed, and an argument that holds one is refused.
function secretsOf(env) {
  const secrets = new Set([SIMULATED_KEY, SIMULATED_LIMITED_KEY])
  for (const variable of [KEY_VARIABLE, LIMITED_VARIABLE]) {
    if (typeof env[variable] === 'string' && env[variable].length >= MIN_KEY_LENGTH) {
      secrets.add(env[variable])
    }
  }
  return secrets
}

// A writer to stdout that never prints a secret.
function output(io, secrets) {
  const hide = (text) => [...secrets].reduce((t, s) => t.replaceAll(s, '[key]'), text)
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))
  return { say: (text) => stdout(`${hide(text)}\n`), error: (text) => stderr(`${hide(text)}\n`) }
}

function refuse(out, message) {
  out.error(message)
  return EXIT.refused
}

// The portal ID from --portal, or the refusal: the confirmation flag must repeat it.
function portalOf(options) {
  const { portal, 'i-own-this-test-portal': confirmed } = options
  if (portal === undefined) {
    return 'E_USAGE: --portal <id> is required: the ID of the test portal you are authorized to use. Nothing was sent.'
  }
  if (confirmed === undefined) {
    return 'E_CONFIRMATION: --i-own-this-test-portal <id> is required and must repeat the --portal ID. Nothing was sent.'
  }
  if (!PORTAL_ID.test(portal)) {
    return 'E_USAGE: --portal takes a portal ID, a positive integer. Nothing was sent.'
  }
  if (confirmed !== portal) {
    return 'E_CONFIRMATION: --i-own-this-test-portal does not repeat the --portal ID. Nothing was sent.'
  }
  return Number(portal)
}

// The simulated key holds the --scopes list, or the scopes the first live run's key held.
async function simulatedFetch(work, portalId, scopes) {
  const { createPortalSim } = await loadSimulator(repo, join(work, 'simulator'))
  return createPortalSim([simulatedPortal(portalId, scopes ?? undefined)]).fetch
}

// account-info with the key: it must belong to the portal, which must be a developer test account or a sandbox.
async function guard(client, portalId) {
  const answer = await client.read(paths.accountInfo)
  if (answer.status === 403) {
    return {
      refusal: `E_GUARD: account-info answered ${answered(answer)}. The key may lack a scope account-info needs: HubSpot's reference names oauth (architecture 13.9). Record this answer as docs/conformance/checklist.md describes, then add the scope to the key if the key setup offers it and run again. Nothing was written.`,
    }
  }
  if (answer.status === 401) {
    return {
      refusal: `E_GUARD: account-info answered ${answered(answer)}: HubSpot did not accept the key. Check that ${KEY_VARIABLE} holds a current key of portal ${portalId}. Nothing was written.`,
    }
  }
  if (answer.status !== 200) {
    return {
      refusal: `E_GUARD: account-info answered ${answer.status ?? answer.error}, so the key's portal is unknown. Nothing was written. Check that ${KEY_VARIABLE} holds a key of portal ${portalId}.`,
    }
  }
  if (answer.body?.portalId !== portalId) {
    return {
      refusal: `E_PORTAL_MISMATCH: the key in ${KEY_VARIABLE} does not belong to portal ${portalId}. Nothing was written.`,
    }
  }
  const accountType = String(answer.body?.accountType ?? '')
  if (!ACCOUNT_TYPES.has(accountType)) {
    const shown = ACCOUNT_TYPE.test(accountType) ? accountType : 'unknown'
    return {
      refusal: `E_ACCOUNT_TYPE: portal ${portalId} is a ${shown} account. The runner runs only on a developer test account or a sandbox (DEVELOPER_TEST, SANDBOX), with no override. Nothing was written.`,
    }
  }
  return { account: { accountType } }
}

// A refused answer as the person records it: the status, HubSpot's category and its correlationId, each shown only when
// it has the shape HubSpot gives it.
function answered(answer) {
  const category = String(answer.body?.category ?? '')
  const correlationId = String(answer.correlationId ?? '')
  const details = [
    ...(CATEGORY.test(category) ? [category] : []),
    ...(CORRELATION_ID.test(correlationId) ? [`correlationId ${correlationId}`] : []),
  ]
  return details.length > 0 ? `${answer.status} (${details.join(', ')})` : String(answer.status)
}

/**
 * The second key and its client, once account-info shows it belongs to the portal; else why the check cannot write
 * with it. A key of another portal refuses the run before any write, as the first key's guard does.
 */
async function limitedKey({ env, fetch, key, portalId, simulate, sleep }) {
  const limited = simulate ? SIMULATED_LIMITED_KEY : env[LIMITED_VARIABLE]
  if (!limited) {
    return {
      absent: `${LIMITED_VARIABLE} is not set: set it to a second key of this portal without crm.schemas.companies.write to record the 403`,
    }
  }
  if (limited === key) {
    return {
      refusal: `E_USAGE: ${LIMITED_VARIABLE} holds the same key as ${KEY_VARIABLE}; it takes a second key of the portal without crm.schemas.companies.write. Nothing was sent with it, and nothing was written.`,
    }
  }
  const client = createClient({ fetch, key: limited, sleep, gapMs: simulate ? 0 : 150 })
  const answer = await client.read(paths.accountInfo)
  if (answer.status === 200 && answer.body?.portalId !== portalId) {
    return {
      refusal: `E_PORTAL_MISMATCH: the key in ${LIMITED_VARIABLE} does not belong to portal ${portalId}. Nothing was written.`,
    }
  }
  if (answer.status !== 200) {
    return { key: limited, unguarded: `account-info answered ${answered(answer)} for the second key` }
  }
  return { client, key: limited }
}

function cleanupCommand(manifest, portalId, simulate) {
  const flags = `--cleanup '${manifest}' --portal ${portalId} --i-own-this-test-portal ${portalId}`
  return `node scripts/conformance/run.mjs ${flags}${simulate ? ' --simulate' : ''}`
}

async function run(setting) {
  const { account, client, io, limited, options, out, poll, portalId, runId, scopes, simulate, work } = setting
  const manifestFile = join(work, 'manifest.json')
  if (existsSync(manifestFile)) {
    return refuse(
      out,
      `E_WORK: ${work} already holds a run manifest. Pass another --work, or clean that run up with --cleanup.`,
    )
  }
  mkdirSync(work, { recursive: true })
  const prefix = prefixOf(runId)
  const mode = simulate ? 'simulate' : 'live'
  const manifest = newManifest(manifestFile, { runId, portalId, prefix, mode })
  client.manifest = manifest
  if (limited.client) {
    limited.client.manifest = manifest
  }
  const startedAt = new Date()
  out.say(`Conformance run ${runId}, ${mode}, on portal ${portalId} (${account.accountType}). Work directory: ${work}`)
  out.say(
    `If the run stops before its cleanup, archive what it created with:\n  ${cleanupCommand(manifestFile, portalId, simulate)}`,
  )
  const stdin = io.stdin ?? process.stdin
  const ctx = {
    accountType: account.accountType,
    cli: cliSetting(setting),
    client,
    deadlineMs: READ_DEADLINE_MS,
    interactive: stdin.isTTY === true,
    kalupVersion: null,
    limited,
    manifest,
    // Only a simulated run takes a person from `io`; live, a person runs the command in another terminal.
    person: simulate ? io.person : undefined,
    poll,
    portalId,
    prefix,
    repo,
    results: [],
    say: out.say,
    scopes,
    stdin,
    work,
  }
  let cleaned
  try {
    ctx.kalupVersion = await kalupVersion(ctx)
    const custom = await readChecks(ctx)
    await lifecycle(ctx, { objectType: 'companies', label: 'companies' })
    await lifecycle(ctx, custom)
    await missingScope(ctx)
    await kalupChecks(ctx)
    await logChecks(ctx)
  } finally {
    out.say('Cleaning up the resources the manifest names.')
    cleaned = await cleanup(client, manifest, poll)
    manifest.record({ at: new Date().toISOString(), ...cleaned })
  }
  const evidence = evidenceOf(ctx, { mode, runId, startedAt, cleaned })
  const outDir = resolve(options.out ?? (simulate ? join(work, 'runs') : join(repo, 'docs', 'conformance', 'runs')))
  const keys = [setting.key, ...(limited.key ? [limited.key] : [])]
  const files = writeEvidence(outDir, evidence, { keys, portalId })
  const { pass, fail } = evidence.summary
  out.say(`${pass} pass, ${fail} fail, ${evidence.summary['not-applicable']} not applicable. Evidence: ${files.json}`)
  out.say(`Summary: ${files.markdown}`)
  if (!cleaned.complete) {
    out.error(
      `Cleanup left resources behind (see the evidence). Try again with:\n  ${cleanupCommand(manifestFile, portalId, simulate)}`,
    )
    return EXIT.leftBehind
  }
  return fail > 0 ? EXIT.failed : EXIT.done
}

// How the CLI runs: which file, with what environment, and in simulate mode the fetch its requests are answered from.
function cliSetting({ env, fetch, key, options, simulate, work }) {
  const cliEnv = { ...env }
  for (const name of ['KALUP_STATE_DIR', 'CI', LIMITED_VARIABLE]) {
    delete cliEnv[name]
  }
  if (simulate) {
    cliEnv[KEY_VARIABLE] = key
    cliEnv.KALUP_LOCK_DIR = join(work, 'locks')
  }
  return {
    path: resolve(options.cli ?? join(repo, 'packages', 'cli', 'dist', 'index.mjs')),
    env: cliEnv,
    fetch: simulate ? fetch : undefined,
  }
}

function evidenceOf(ctx, { mode, runId, startedAt, cleaned }) {
  const count = (status) => ctx.results.filter((c) => c.status === status).length
  const statuses = {}
  for (const entry of ctx.client.log) {
    const status = String(entry.status ?? entry.error)
    statuses[status] = (statuses[status] ?? 0) + 1
  }
  return {
    format: EVIDENCE_FORMAT,
    runId,
    mode,
    date: startedAt.toISOString().slice(0, 10),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    portal: 'test-portal',
    accountType: ctx.accountType,
    versions: { kalup: ctx.kalupVersion, node: process.version, api: API_PINS },
    key: { variable: mode === 'live' ? KEY_VARIABLE : 'simulated', scopes: ctx.scopes },
    limitedKey: ctx.limited.absent ? null : { variable: mode === 'live' ? LIMITED_VARIABLE : 'simulated' },
    summary: { pass: count('pass'), fail: count('fail'), 'not-applicable': count('not-applicable') },
    checks: ctx.results,
    cleanup: cleaned,
    requests: { total: ctx.client.log.length, byStatus: statuses },
  }
}

// --cleanup: the manifest must be of this portal; archives what it names and still exists, and records the result.
async function cleanupOnly({ client, options, out, poll, portalId, simulate }) {
  let manifest
  try {
    manifest = readManifest(resolve(options.cleanup))
  } catch (error) {
    return refuse(out, `E_MANIFEST: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (manifest.data.portalId !== portalId) {
    return refuse(out, `E_PORTAL_MISMATCH: the manifest is of another portal than ${portalId}. Nothing was written.`)
  }
  if (manifest.data.mode !== (simulate ? 'simulate' : 'live')) {
    return refuse(
      out,
      `E_MANIFEST: the manifest is of a ${manifest.data.mode} run; pass --simulate for a simulated one.`,
    )
  }
  client.manifest = manifest
  const cleaned = await cleanup(client, manifest, poll)
  manifest.record({ at: new Date().toISOString(), ...cleaned })
  for (const resource of cleaned.resources) {
    out.say(`${resource.result.padEnd(16)} ${resource.address}${resource.status ? ` (${resource.status})` : ''}`)
  }
  if (!cleaned.complete) {
    out.error(
      'Some resources were not cleaned up; the lines above say why. Run the cleanup again, or archive them in HubSpot.',
    )
    return EXIT.leftBehind
  }
  out.say(`Cleanup complete for run ${manifest.data.runId}.`)
  return EXIT.done
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2))
}
