// The Kalup commands end to end on a project the runner generates, pointed at the test portal: pull, plan, apply of a
// saved plan with --yes, a second plan with no effect, a UI-style edit held as drift, pull --only taking it, and rm with
// allowDestroy up to the delete a person confirms at a terminal. The CLI runs in its own process. In simulate mode its
// fetch goes over an IPC channel to the runner's simulator (packages/cli/test/scenarios/ipc-fetch.mjs, as the CLI's
// scenario tests do); live, it reads KALUP_CONFORMANCE_KEY from the environment it inherits. The runner checks every
// effect of a saved plan against its manifest before it lets apply run, and records the requests each apply sent from
// Kalup's journal. The UI-style edit comes once the settling window after the apply has passed, which live is a wait
// of up to five minutes.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createInterface } from 'node:readline'
import { pathToFileURL } from 'node:url'
import { check, messageOf, must, need } from './checks.mjs'
import { paths } from './client.mjs'

export const TARGET = 'conformance'
const IPC_FETCH = 'packages/cli/test/scenarios/ipc-fetch.mjs'
const OUTPUT_LIMIT = 300
/** How long the runner waits for a person to run the delete, and how often it looks. */
const PERSON_DEADLINE_MS = 15 * 60 * 1000
const PERSON_POLL_MS = 5000
/** How long after apply's writes a read that disagrees with one is settling: SETTLE_MS in packages/engine. */
export const SETTLE_MS = 5 * 60 * 1000

const CLI_CHECKS = {
  pull: {
    id: 'cli.pull',
    title: 'kalup pull writes a portal property and its group into config',
    gate: 'Useful comparison on existing portals (milestone 2)',
    assumption: 'Exit 0, and the object file holds the included property and its group.',
  },
  plan: {
    id: 'cli.plan',
    title: 'kalup plan --out saves a plan that adopts the pulled resources and creates the new ones',
    gate: 'CLI MVP with writes',
    assumption: 'Exit 0; the effects are two adopts and two creates, every one a resource of this run.',
  },
  apply: {
    id: 'cli.apply-saved-plan',
    title: 'kalup apply <plan> --yes on the unprotected test target',
    gate: 'CLI MVP with writes',
    assumption: 'Exit 0, outcome done, and the created property reads back.',
  },
  second: {
    id: 'cli.second-plan-no-effect',
    title: 'A second kalup plan after the apply',
    gate: 'A repeated successful apply performs no portal writes',
    assumption: 'Exit 0 and no step with an effect.',
  },
  drift: {
    id: 'cli.drift-held',
    title: 'A label edited through the API, as in the HubSpot UI, is held by the next plan',
    gate: 'Drift is held, not reverted',
    assumption: 'The step holds the label as drift and the plan has no effect.',
  },
  pullOnly: {
    id: 'cli.pull-only-takes-drift',
    title: 'kalup pull --only takes the edit into config, and apply records the base',
    gate: 'Drift is held, not reverted',
    assumption:
      'Config gets the portal label, the next plan holds nothing, and after its base-only apply no effect is left.',
  },
  rm: {
    id: 'cli.rm-destroy-plan',
    title: 'kalup rm plus allowDestroy plans a delete that --yes cannot run',
    gate: 'Deletes retain all existing ownership, policy, tombstone and confirmation requirements',
    assumption: 'One destructive delete step; apply --yes exits 4 with E_APPROVAL_REQUIRED and the property stays.',
  },
  terminal: {
    id: 'cli.delete-at-terminal',
    title: 'The delete, confirmed by a person at a terminal',
    gate: 'Nothing destructive runs without a person confirming it at a terminal',
    assumption: 'The property reads archived and state drops its entry.',
  },
}

/** `kalup --version --json`: the CLI's version, or null when it does not run. */
export async function kalupVersion(ctx) {
  const out = await kalup(ctx, ctx.work, ['--version', '--json'])
  return out.envelope?.data?.version ?? null
}

/** The CLI checks. The run's own resources: a seed group and property it creates, a group and property apply creates. */
export async function kalupChecks(ctx) {
  const { client, prefix } = ctx
  const project = join(ctx.work, 'project')
  const names = {
    group: `${prefix}cli`,
    seed: `${prefix}cli_seed`,
    applied: `${prefix}kalup`,
    count: `${prefix}kalup_count`,
  }
  const address = (type, name) => `${type}:companies/${name}`
  const countAddress = address('property', names.count)
  const resource = (type, name) => ({ type, objectType: 'companies', name })
  const objectsPath = join(project, 'hubspot', 'objects', 'companies.ts')
  const run = (...args) => kalup(ctx, project, args)
  const needs = (value, id) => need(value, `needs ${id}`)
  // Every `kalup apply` goes through here: a saved plan is applied with --yes only when `allowed` holds and each of its
  // effects is on a resource the manifest names. `outside` lists the effects that are not.
  async function applySaved(file, steps, allowed = true) {
    const outside = steps.filter((s) => !ctx.manifest.holds(resourceOf(s.address))).map((s) => s.address)
    const out = allowed && outside.length === 0 ? await run('apply', file, '--yes', '--json') : undefined
    return { out, outside }
  }

  const pulled = await check(ctx, CLI_CHECKS.pull, async () => {
    must(ctx.kalupVersion, `the CLI at ${ctx.cli.path} did not run: build it with pnpm build, or pass --cli`)
    const group = await client.create(resource('group', names.group), paths.groups('companies'), {
      name: names.group,
      label: 'Kalup conformance pulled',
    })
    must(group.status === 201, `the seed group create answered ${group.status ?? group.error}`)
    const seed = await client.create(resource('property', names.seed), paths.properties('companies'), {
      name: names.seed,
      label: 'Kalup conformance seed',
      type: 'number',
      fieldType: 'number',
      groupName: names.group,
    })
    must(seed.status === 201, `the seed property create answered ${seed.status ?? seed.error}`)
    await ctx.poll(async () => {
      const listed = await client.read(paths.properties('companies'))
      return listed.body?.results?.some((p) => p.name === names.seed)
    })
    mkdirSync(join(project, 'hubspot', 'objects'), { recursive: true })
    writeConfig(project, ctx.portalId, [names.seed], false)
    const out = await run('pull', '--target', TARGET, '--json')
    const file = readText(objectsPath)
    const written = file.includes(`'${names.seed}'`) && file.includes(names.group)
    return {
      pass: out.code === 0 && written,
      note: `exit ${out.code}; the object file ${written ? 'holds' : 'lacks'} the seed property and its group`,
      facts: { ...outcome(out), written },
      value: out.code === 0 && written,
    }
  })

  const planned = await check(ctx, CLI_CHECKS.plan, async () => {
    needs(pulled, 'cli.pull')
    ctx.manifest.add(resource('group', names.applied))
    ctx.manifest.add(resource('property', names.count))
    must(addToObjectFile(objectsPath, names), 'the pulled object file has no groups and properties blocks to add to')
    const out = await run('plan', '--target', TARGET, '--out', 'plan.json', '--json')
    const steps = effects(out.envelope?.data)
    const outside = steps.filter((s) => !ctx.manifest.holds(resourceOf(s.address)))
    const expected = [
      `${address('group', names.group)} adopt`,
      `${address('property', names.seed)} adopt`,
      `${address('group', names.applied)} create`,
      `${address('property', names.count)} create`,
    ].sort()
    const actual = steps.map((s) => `${s.address} ${s.action}`).sort()
    const matches = JSON.stringify(actual) === JSON.stringify(expected)
    return {
      pass: out.code === 0 && outside.length === 0 && matches,
      note: `exit ${out.code}; ${steps.length} effects${outside.length > 0 ? `, ${outside.length} outside the manifest` : ''}`,
      facts: { ...outcome(out), effects: steps.map(stepFact), outsideManifest: outside.map((s) => s.address) },
      value: out.code === 0 && outside.length === 0 ? steps : undefined,
    }
  })

  const applied = await check(ctx, CLI_CHECKS.apply, async () => {
    const { out, outside } = await applySaved('plan.json', needs(planned, 'cli.plan'))
    must(out, `the saved plan has effects outside the manifest: ${outside.join(', ')}`)
    // Apply sent their creates, so cleanup's read-after-write wait for them counts from now.
    ctx.manifest.add(resource('group', names.applied))
    ctx.manifest.add(resource('property', names.count))
    const data = out.envelope?.data
    const seen = await ctx.poll(
      async () => (await client.read(paths.property('companies', names.count))).status === 200,
    )
    return {
      pass: out.code === 0 && data?.outcome === 'done' && seen.visible,
      note: `exit ${out.code}, outcome ${data?.outcome ?? 'none'}; the created property ${seen.visible ? 'reads back' : 'does not read back'}`,
      facts: {
        ...outcome(out),
        outcome: data?.outcome ?? null,
        approval: data?.approval ?? null,
        steps: (data?.steps ?? []).map((s) => ({ address: s.address, action: s.action, status: s.status })),
      },
      value: out.code === 0 && data?.outcome === 'done',
    }
  })

  await check(ctx, CLI_CHECKS.second, async () => {
    needs(applied, 'cli.apply-saved-plan')
    const out = await run('plan', '--target', TARGET, '--json')
    const steps = effects(out.envelope?.data)
    return {
      pass: out.code === 0 && steps.length === 0,
      note: `exit ${out.code}; ${steps.length} effects`,
      facts: { ...outcome(out), effects: steps.map(stepFact) },
    }
  })

  const edited = 'Kalup conformance count, edited in HubSpot'
  const drifted = await check(ctx, CLI_CHECKS.drift, async () => {
    needs(applied, 'cli.apply-saved-plan')
    // The property exists now, so it can join the pull scope, which pull --only needs to take its portal value.
    writeConfig(project, ctx.portalId, [names.seed, names.count], false)
    const count = resource('property', names.count)
    await afterSettling(ctx, project)
    const patched = await client.write(count, 'PATCH', paths.property('companies', names.count), { label: edited })
    must(patched.status === 200, `the label PATCH answered ${patched.status ?? patched.error}`)
    await ctx.poll(async () => (await client.read(paths.property('companies', names.count))).body?.label === edited)
    const out = await run('plan', '--target', TARGET, '--json')
    const step = out.envelope?.data?.steps?.find((s) => s.address === countAddress)
    const held = step?.held?.find((h) => h.unit === 'label')
    const steps = effects(out.envelope?.data)
    return {
      pass: out.code === 0 && held?.class === 'drift' && steps.length === 0,
      note: `exit ${out.code}; label ${held ? `held as ${held.class}` : 'not held'}; ${steps.length} effects`,
      facts: { ...outcome(out), held: step?.held ?? [], effects: steps.map(stepFact) },
      value: held?.class === 'drift',
    }
  })

  await check(ctx, CLI_CHECKS.pullOnly, async () => {
    needs(drifted, 'cli.drift-held')
    const pull = await run('pull', '--target', TARGET, '--only', countAddress, '--json')
    const taken = readText(objectsPath).includes(`'${edited}'`)
    const plan = await run('plan', '--target', TARGET, '--out', 'plan-base.json', '--json')
    const step = plan.envelope?.data?.steps?.find((s) => s.address === countAddress)
    const steps = effects(plan.envelope?.data)
    const baseOnly = steps.every((s) => s.action === 'update' && (s.changes ?? []).length === 0)
    const { out: apply, outside } = await applySaved('plan-base.json', steps, steps.length > 0 && baseOnly)
    const after = await run('plan', '--target', TARGET, '--json')
    const left = effects(after.envelope?.data)
    const held = step?.held ?? []
    const clean = baseOnly && outside.length === 0
    return {
      pass: pull.code === 0 && taken && held.length === 0 && clean && (apply?.code ?? 0) === 0 && left.length === 0,
      note: `pull exit ${pull.code}; config ${taken ? 'has' : 'lacks'} the portal label; ${held.length} held; ${steps.length} ${clean ? 'base-only effects applied' : 'effects, not all base-only on the manifest, so not applied'}; ${left.length} left`,
      facts: {
        pull: outcome(pull),
        taken,
        plan: { ...outcome(plan), held, effects: steps.map(stepFact), outsideManifest: outside },
        apply: apply ? outcome(apply) : null,
        after: { ...outcome(after), effects: left.map(stepFact) },
      },
    }
  })

  const deletion = await check(ctx, CLI_CHECKS.rm, async () => {
    needs(applied, 'cli.apply-saved-plan')
    const rm = await run('rm', countAddress, '--json')
    writeConfig(project, ctx.portalId, [names.seed, names.count], true)
    const plan = await run('plan', '--target', TARGET, '--out', 'delete-plan.json', '--json')
    const steps = effects(plan.envelope?.data)
    const one =
      steps.length === 1 &&
      steps[0].address === countAddress &&
      steps[0].action === 'delete' &&
      steps[0].risk === 'destructive'
    // Only the one delete is tried with --yes, which must refuse it: a plan with other effects is not applied.
    const { out: yes, outside } = await applySaved('delete-plan.json', steps, one)
    const codes = yes ? issueCodes(yes) : []
    const still = await client.read(paths.property('companies', names.count))
    const kept = still.status === 200 && still.body?.archived !== true
    return {
      pass: rm.code === 0 && plan.code === 0 && one && yes?.code === 4 && codes.includes('E_APPROVAL_REQUIRED') && kept,
      note: `rm exit ${rm.code}; ${steps.length} effects; apply --yes ${yes ? `exit ${yes.code} ${codes.join(' ')}` : 'not run'}; the property ${kept ? 'stays' : 'is gone'}`,
      facts: {
        rm: outcome(rm),
        plan: { ...outcome(plan), effects: steps.map(stepFact), outsideManifest: outside },
        yes: yes ? outcome(yes) : null,
        kept,
      },
      value: one && kept,
    }
  })

  await check(ctx, CLI_CHECKS.terminal, async () => {
    needs(deletion, 'cli.rm-destroy-plan')
    need(
      !ctx.cli.fetch || ctx.person,
      'needs a person: in simulate mode a command run in another terminal cannot reach the simulator',
    )
    need(ctx.interactive, 'needs a person: stdin is not a terminal')
    ctx.say(
      [
        '',
        'A person confirms the delete. In another terminal, with KALUP_CONFORMANCE_KEY set, run:',
        '',
        `  cd '${project}' && node '${ctx.cli.path}' apply delete-plan.json`,
        '',
        `Kalup asks for the target name (${TARGET}) and the number of destructive steps (1).`,
        `Waiting up to 15 minutes for ${countAddress} to read archived. Type skip and press Enter to skip.`,
        '',
      ].join('\n'),
    )
    const archived = async () => {
      const read = await client.read(paths.property('companies', names.count), { query: { archived: 'true' } })
      return read.status === 200 && read.body?.archived === true
    }
    // A simulated run's person runs the printed command against the simulator; live, a person runs it themselves.
    await ctx.person?.({ cwd: project, argv: ['apply', 'delete-plan.json'] })
    const seen = await waitForPerson(ctx, archived)
    need(seen.value !== 'skip', 'skipped by the person at the terminal')
    const state = readState(project, ctx.portalId)
    const dropped = state !== undefined && state.resources?.[countAddress] === undefined
    return {
      pass: seen.visible && dropped,
      note: seen.visible
        ? `archived after ${Math.round(seen.ms / 1000)} s; state ${dropped ? 'dropped' : 'kept'} the entry`
        : 'not archived in time',
      facts: { archived: seen.visible, waitedMs: seen.ms, stateDropped: dropped },
    }
  })
}

// Comes back once the settling window after apply's writes has passed, as a person whose UI edit comes minutes later:
// within it, a read that disagrees with a unit apply wrote is settling, never drift. Live, the runner waits for the
// window to end; simulated, the state's write times move back by it.
async function afterSettling(ctx, project) {
  const state = readState(project, ctx.portalId)
  const entries = Object.values(state?.resources ?? {})
  if (ctx.cli.fetch === undefined) {
    const times = entries.flatMap((entry) => Object.values(entry.written ?? {}).map((at) => Date.parse(at)))
    const wait = Math.max(0, ...times) + SETTLE_MS - Date.now()
    if (wait > 0) {
      ctx.say(`Waiting ${Math.ceil(wait / 1000)} s for the settling window after the apply to pass.`)
      await new Promise((done) => setTimeout(done, wait))
    }
    return
  }
  for (const entry of entries.filter((e) => e.written)) {
    const earlier = (at) => new Date(Date.parse(at) - SETTLE_MS).toISOString()
    entry.written = Object.fromEntries(Object.entries(entry.written).map(([unit, at]) => [unit, earlier(at)]))
  }
  if (state) {
    writeFileSync(
      join(project, '.kalup', 'state', `portal-${ctx.portalId}.json`),
      `${JSON.stringify(state, null, 2)}\n`,
    )
  }
}

// Polls for the archived property while listening for "skip" on stdin.
async function waitForPerson(ctx, archived) {
  const lines = createInterface({ input: ctx.stdin })
  let skipped = false
  lines.on('line', (line) => {
    skipped = skipped || line.trim() === 'skip'
  })
  try {
    return await ctx.poll(async () => (skipped ? 'skip' : await archived()), {
      intervalMs: PERSON_POLL_MS,
      deadlineMs: PERSON_DEADLINE_MS,
    })
  } finally {
    lines.close()
  }
}

/** Runs the CLI in `cwd`: { code, cwd, stdout, stderr, envelope }. Never throws. */
export function kalup(ctx, cwd, args) {
  const simulated = ctx.cli.fetch !== undefined
  const preload = simulated ? ['--import', pathToFileURL(join(ctx.repo, IPC_FETCH)).href] : []
  return new Promise((done) => {
    const child = spawn(process.execPath, [...preload, ctx.cli.path, ...args], {
      cwd,
      env: ctx.cli.env,
      stdio: ['ignore', 'pipe', 'pipe', ...(simulated ? ['ipc'] : [])],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    if (simulated) {
      child.on('message', (message) => answer(child, ctx.cli.fetch, message))
    }
    child.on('error', (error) => done({ code: null, cwd, stdout, stderr: messageOf(error), envelope: undefined }))
    child.on('close', (code) => done({ code, cwd, stdout, stderr, envelope: envelopeOf(stdout) }))
  })
}

// One request of the spawned CLI, answered from the simulator.
async function answer(child, fetch, message) {
  let reply
  try {
    const init = {
      method: message.method,
      headers: message.headers,
      ...(message.body === undefined ? {} : { body: message.body }),
    }
    const res = await fetch(message.url, init)
    const body = res.status === 204 ? null : await res.text()
    reply = { id: message.id, status: res.status, headers: Object.fromEntries(res.headers), body }
  } catch (error) {
    reply = { id: message.id, error: messageOf(error) }
  }
  if (child.connected) {
    child.send(reply)
  }
}

function envelopeOf(stdout) {
  try {
    const parsed = JSON.parse(stdout)
    return parsed?.format === 'envelope/1' ? parsed : undefined
  } catch {
    return undefined
  }
}

function issueCodes(out) {
  return (out.envelope?.issues ?? []).map((i) => i.code)
}

// What a command's outcome shows: its exit, ok and issue codes, stderr's start when stdout held no envelope, and for an
// apply that sent requests, each of them from its journal.
function outcome(out) {
  const journal = journalOf(out)
  return {
    exitCode: out.code,
    ok: out.envelope?.ok ?? null,
    issues: issueCodes(out),
    ...(out.envelope ? {} : { stderr: out.stderr.slice(0, OUTPUT_LIMIT) }),
    ...(journal.length > 0 ? { journal } : {}),
  }
}

// The requests an apply sent, from the journal it names: step, address, method, path template, status, HubSpot's
// category, subCategory and correlationId, outcome and time. The journal holds no key and no body.
function journalOf(out) {
  const named = out.envelope?.data?.journal
  if (typeof named !== 'string') {
    return []
  }
  const file = isAbsolute(named) ? named : join(out.cwd, named)
  return readText(file)
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const {
        step,
        address,
        method,
        path,
        status,
        category,
        subCategory,
        correlationId,
        outcome: result,
        ms,
      } = JSON.parse(line)
      return { step, address, method, path, status, category, subCategory, correlationId, outcome: result, ms }
    })
}

/** The steps with an effect, as the scenario tests count them: not blocked, not manual, not an empty update. */
function effects(plan) {
  return (plan?.steps ?? []).filter(
    (s) =>
      s.risk !== 'blocked' &&
      s.risk !== 'manual' &&
      !(s.action === 'update' && (s.changes ?? []).length === 0 && (s.baseUnits ?? []).length === 0),
  )
}

function stepFact(step) {
  return {
    address: step.address,
    action: step.action,
    risk: step.risk,
    ...(step.baseUnits ? { baseUnits: step.baseUnits } : {}),
    ...(step.changes ? { changes: step.changes.map((c) => c.unit) } : {}),
  }
}

// `property:companies/x` as a manifest resource.
function resourceOf(address) {
  const [type, rest = ''] = address.split(':')
  const slash = rest.indexOf('/')
  return { type, objectType: rest.slice(0, slash), name: rest.slice(slash + 1) }
}

function readText(file) {
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}

function readState(project, portalId) {
  const file = join(project, '.kalup', 'state', `portal-${portalId}.json`)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
}

// The project's config: one unprotected target on the test portal, companies scoped to the run's own properties.
function writeConfig(project, portalId, include, allowDestroy) {
  const text = [
    "import { defineConfig } from '@kalup/core'",
    '',
    'export default defineConfig({',
    "  name: 'kalup-conformance',",
    '  objects: {',
    `    companies: { custom: false, include: [${include.map((name) => `'${name}'`).join(', ')}] },`,
    '  },',
    '  targets: {',
    `    ${TARGET}: {`,
    `      portalId: ${portalId},`,
    '      protected: false,',
    ...(allowDestroy ? ['      allowDestroy: true,'] : []),
    "      credentials: { read: { env: 'KALUP_CONFORMANCE_KEY' } },",
    '    },',
    '  },',
    '})',
    '',
  ]
  writeFileSync(join(project, 'kalup.config.ts'), text.join('\n'))
}

// Adds the group and property kalup apply creates to the object file pull wrote, which holds companies' one export.
function addToObjectFile(file, names) {
  const text = readText(file)
  const groups = '  groups: {\n'
  const properties = '  properties: {\n'
  if (!(text.includes(groups) && text.includes(properties))) {
    return false
  }
  const group = `    ${names.applied}: { label: 'Kalup conformance applied' },\n`
  const property = [
    `    conformanceCount: p.number('${names.count}', {`,
    "      label: 'Kalup conformance count',",
    `      group: '${names.applied}',`,
    "      fieldType: 'number',",
    '    }),',
    '',
  ].join('\n')
  writeFileSync(file, text.replace(groups, `${groups}${group}`).replace(properties, `${properties}${property}`))
  return true
}
