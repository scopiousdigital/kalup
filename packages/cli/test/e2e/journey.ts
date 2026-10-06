// The e2e journeys' helper. A journey is what a person does with Kalup, command by command: the built bin runs as a
// process of its own in a temporary project, against a backend that stands for HubSpot, with a person at a real
// pseudo-terminal where Kalup asks one. The backend is the stateful simulator here; a live backend gives the same
// interface over an authorized test portal. Either one also acts as someone editing the portal in the HubSpot UI.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import type { Plan, TargetState } from '@kalup/engine'
import { onTestFinished } from 'vitest'
import {
  createPortalSim,
  type PortalSim,
  type SimPortalInput,
  type SimProperty,
  type SimPropertyInput,
  type SimRequest,
} from '../../../engine/test/support/portal-sim.js'
import { host } from '../../src/commands/testing.js'
import type { Envelope } from '../../src/lib/output.js'
import { leftOver } from '../scenarios/harness.js'
import { inTerminal } from '../support/terminal.js'

const bin = fileURLToPath(new URL('../../bin/kalup.mjs', import.meta.url))
const simFetch = new URL('./sim-fetch.mjs', import.meta.url).href
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the escape sequences a terminal prints
const ESCAPES = /\u001b\[[0-9;?]*[A-Za-z]/g
const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const core = realpathSync(fileURLToPath(new URL('../../node_modules/@kalup/core', import.meta.url)))

/** A portal as the journey finds it. Every portal also holds HubSpot's own companies and deals groups and names. */
export interface PortalSeed {
  accountType?: string
  /** How many schema reads leave out the name of an association a create made. */
  associationNameLag?: number
  /** Association labels and plain associations, by object type. */
  associations?: SimPortalInput['associations']
  objects?: SimPortalInput['objects']
  /** Pipelines by object, besides HubSpot's own default deal pipeline. */
  pipelines?: SimPortalInput['pipelines']
  portalId?: number
  /** The variable its key is read from. HUBSPOT_SERVICE_KEY, what init writes, by default. */
  variable?: string
}

/** What a property definition edit in the HubSpot UI can change. */
export type UiChange = Partial<Pick<SimProperty, 'label' | 'description' | 'groupName' | 'fieldType' | 'options'>>

/** A pipeline as HubSpot's pipelines API returns it: its stages, each with its display order and metadata. */
export interface UiPipeline {
  label: string
  stages: { displayOrder: number; id: string; label: string; metadata: Record<string, string> }[]
}

/** One user-defined association of a direction, as its labels list shows it. */
export interface UiLabel {
  label: string | null
  typeId: number
}

/** Someone working in the HubSpot UI of a target's portal. */
export interface HubSpotUi {
  createProperty: (target: string, object: string, input: SimPropertyInput) => Promise<void>
  /** Relabels both sides of an association label, by the type ID of the direction `from` to `to`. */
  editLabel: (
    target: string,
    pair: [from: string, to: string],
    typeId: number,
    labels: [label: string, inverseLabel: string],
  ) => Promise<void>
  editProperty: (target: string, object: string, name: string, change: UiChange) => Promise<void>
  /** Edits an active custom object's fields, as a person does in the object settings. */
  editSchema: (target: string, name: string, change: Partial<UiSchema>) => Promise<void>
  /** Relabels a stage, as a person does in the pipeline settings. */
  editStage: (target: string, object: string, pipeline: string, stage: string, label: string) => Promise<void>
  /** The user-defined associations of the direction `from` to `to`, each a standard object or custom object name. */
  labels: (target: string, from: string, to: string) => Promise<UiLabel[]>
  /** The pipeline HubSpot holds under this ID, its stages in display order; undefined when it holds none. */
  pipeline: (target: string, object: string, id: string) => Promise<UiPipeline | undefined>
  /** The property HubSpot holds under this name, archived or not. Throws when it holds none. */
  property: (target: string, object: string, name: string) => Promise<SimProperty>
  /** The active custom object of this name; undefined when HubSpot holds none. */
  schema: (target: string, name: string) => Promise<UiSchema | undefined>
}

/** A custom object schema as the schemas list shows it. */
export interface UiSchema {
  description?: string | null
  labels?: { plural?: string; singular?: string }
  name: string
  objectTypeId: string
  primaryDisplayProperty?: string
  requiredProperties?: string[]
  searchableProperties?: string[]
  secondaryDisplayProperties?: string[]
}

/** One kalup run as the evidence of a live journey keeps it. */
export interface Transcript {
  args: string[]
  exitCode: number | 'timeout' | null
  ms: number
  printed: string
}

export interface Backend {
  /**
   * Checks the plan an apply is about to carry out, and throws before it runs when the plan touches anything the
   * backend may not write. A live backend has one: it records each resource in its run manifest first.
   */
  beforeApply?: (plan: Plan) => void
  close: () => Promise<void>
  /** What each kalup run adds to its environment: every key under its variable, and what routes its fetch. */
  env: Record<string, string>
  /** Stops the running process instead of answering the request `when` picks. Simulator only. */
  killAt?: (when: (method: string, path: string, status: number) => boolean, kill: () => void) => void
  /** Node's arguments before the bin. */
  node: string[]
  /** Each target's portal and key variable. */
  portals: Record<string, { portalId: number; variable: string }>
  /** Keeps each kalup run as evidence. A live backend has one. */
  record?: (run: Transcript) => void
  /** The simulator, for its request log; undefined on a live portal. */
  sim?: PortalSim
  /**
   * How long a run at a terminal may take before it is stopped: the terminal helper's default against the simulator,
   * minutes against HubSpot, where an apply reads the portal, then writes and reads back each step.
   */
  terminalMs?: number
  ui: HubSpotUi
}

const DEFAULT_PORTALS: Record<string, number> = { sandbox: 8_800_101, client: 8_800_202, production: 8_800_303 }

/** HubSpot's own groups and a name property on companies and deals: what every portal starts with. */
function hubspotDefaults(): NonNullable<SimPortalInput['objects']> {
  const own = (name: string, label: string, group: string): SimPropertyInput => ({
    name,
    label,
    type: 'string',
    fieldType: 'text',
    groupName: group,
    hubspotDefined: true,
  })
  return {
    companies: {
      groups: [{ name: 'companyinformation', label: 'Company information' }],
      properties: [own('name', 'Company name', 'companyinformation')],
    },
    deals: {
      groups: [{ name: 'dealinformation', label: 'Deal information' }],
      properties: [own('dealname', 'Deal name', 'dealinformation')],
    },
  }
}

/** HubSpot's own default deal pipeline, which every portal holds, as HubSpot names it (observed 2026-10-05). */
function hubspotPipelines(): NonNullable<SimPortalInput['pipelines']> {
  const stage = (id: string, label: string, probability: string) => ({ id, label, metadata: { probability } })
  return {
    deals: [
      {
        id: 'default',
        label: 'Sales Pipeline',
        displayOrder: 0,
        stages: [
          stage('appointmentscheduled', 'Appointment Scheduled', '0.2'),
          stage('contractsent', 'Contract Sent', '0.9'),
          stage('closedwon', 'Closed Won', '1.0'),
          stage('closedlost', 'Closed Lost', '0.0'),
        ],
      },
    ],
  }
}

/** The simulator as the backend: one portal per target, served over a Unix socket to each kalup run. */
export async function simulator(seeds: Record<string, PortalSeed>): Promise<Backend> {
  const portals = Object.fromEntries(
    Object.entries(seeds).map(([target, seed]) => {
      const portalId = seed.portalId ?? DEFAULT_PORTALS[target]
      if (portalId === undefined) {
        throw new Error(`no default portal for target ${target}: give the seed a portalId`)
      }
      return [target, { portalId, variable: seed.variable ?? 'HUBSPOT_SERVICE_KEY' }]
    }),
  )
  const keys = Object.fromEntries(
    Object.entries(portals).map(([target, { variable }]) => [variable, `larkspur-${target}-key-4c1e9a`]),
  )
  const sim = createPortalSim(
    Object.entries(seeds).map(([target, seed]) => {
      const { portalId, variable } = portals[target] as { portalId: number; variable: string }
      const objects = hubspotDefaults()
      for (const [object, extra] of Object.entries(seed.objects ?? {})) {
        const own = objects[object] ?? {}
        objects[object] = {
          groups: [...(own.groups ?? []), ...(extra.groups ?? [])],
          properties: [...(own.properties ?? []), ...(extra.properties ?? [])],
        }
      }
      return {
        portalId,
        keys: { [variable]: keys[variable] as string },
        objects,
        pipelines: { ...hubspotPipelines(), ...seed.pipelines },
        ...(seed.accountType ? { accountType: seed.accountType } : {}),
        ...(seed.associations ? { associations: seed.associations } : {}),
        ...(seed.associationNameLag ? { associationNameLag: seed.associationNameLag } : {}),
      }
    }),
  )
  const socket = join(mkdtempSync(join(tmpdir(), 'kalup-e2e-')), 'hubspot.sock')
  let stop: { when: (method: string, path: string, status: number) => boolean; kill: () => void } | undefined
  const server = createServer(async (req, res) => {
    const body = await text(req)
    const answer = await sim.fetch(`https://api.hubapi.com${req.url}`, {
      method: req.method ?? 'GET',
      headers: req.headers as Record<string, string>,
      ...(body === '' ? {} : { body }),
    })
    if (stop?.when(req.method ?? 'GET', new URL(req.url ?? '/', 'https://x').pathname, answer.status)) {
      stop.kill()
      stop = undefined
      res.destroy()
      return
    }
    res.writeHead(answer.status, Object.fromEntries(answer.headers))
    res.end(answer.status === 204 ? undefined : await answer.text())
  })
  await listen(server, socket)
  const pipelineOf = (target: string, object: string, id: string) =>
    sim
      .portal((portals[target] as { portalId: number }).portalId)
      .pipelines.get(object)
      ?.find((p) => p.id === id)
  const schemaOf = (target: string, name: string) =>
    sim.portal((portals[target] as { portalId: number }).portalId).schemas.find((s) => s.name === name)
  const typeOf = (target: string, name: string) => schemaOf(target, name)?.objectTypeId ?? name
  const associationsOf = (target: string) => sim.portal((portals[target] as { portalId: number }).portalId).associations
  const held = (target: string, object: string, name: string): SimProperty => {
    const found = sim.object((portals[target] as { portalId: number }).portalId, object).properties.get(name)
    if (!found) {
      throw new Error(`the portal of ${target} holds no property ${name} on ${object}`)
    }
    return found
  }
  return {
    portals,
    env: { ...keys, KALUP_E2E_SOCKET: socket },
    node: ['--import', simFetch],
    sim,
    killAt: (when, kill) => {
      stop = { when, kill }
    },
    ui: {
      labels: (target, from, to) => {
        const [a, b] = [typeOf(target, from), typeOf(target, to)]
        const out = associationsOf(target)
          .filter(
            (x) => x.category === 'USER_DEFINED' && ((x.from === a && x.to === b) || (x.from === b && x.to === a)),
          )
          .map((x) => {
            const side = x.from === a ? 0 : 1
            return { label: x.labels[side] ?? null, typeId: x.typeIds[side] as number }
          })
        return Promise.resolve(out)
      },
      editLabel: (target, [from], typeId, [label, inverseLabel]) => {
        const found = associationsOf(target).find((x) => x.typeIds.includes(typeId))
        if (!found) {
          throw new Error(`the portal of ${target} holds no association type ${typeId}`)
        }
        const forward = found.from === typeOf(target, from) ? found.typeIds[0] === typeId : found.typeIds[1] === typeId
        found.labels = forward ? [label, inverseLabel] : [inverseLabel, label]
        return Promise.resolve()
      },
      property: (target, object, name) => Promise.resolve(structuredClone(held(target, object, name))),
      schema: (target, name) => {
        const found = schemaOf(target, name)
        return Promise.resolve(found ? (structuredClone(found) as UiSchema) : undefined)
      },
      editSchema: (target, name, change) => {
        const found = schemaOf(target, name)
        if (!found) {
          throw new Error(`the portal of ${target} holds no custom object ${name}`)
        }
        Object.assign(found, structuredClone(change))
        return Promise.resolve()
      },
      pipeline: (target, object, id) => {
        const found = pipelineOf(target, object, id)
        if (!found) {
          return Promise.resolve(undefined)
        }
        const stages = [...found.stages].sort((a, b) => a.displayOrder - b.displayOrder)
        return Promise.resolve(structuredClone({ label: found.label, stages }))
      },
      editStage: (target, object, pipeline, stage, label) => {
        const found = pipelineOf(target, object, pipeline)?.stages.find((st) => st.id === stage)
        if (!found) {
          throw new Error(`the portal of ${target} holds no stage ${stage} in ${pipeline} on ${object}`)
        }
        Object.assign(found, { label, updatedAt: new Date().toISOString() })
        return Promise.resolve()
      },
      editProperty: (target, object, name, change) => {
        Object.assign(held(target, object, name), structuredClone(change), { updatedAt: new Date().toISOString() })
        return Promise.resolve()
      },
      createProperty: async (target, object, input) => {
        const { portalId, variable } = portals[target] as { portalId: number; variable: string }
        const res = await sim.fetch(`https://api.hubapi.com/crm/properties/2026-09/${object}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${keys[variable]}` },
          body: JSON.stringify(input),
        })
        if (res.status !== 201) {
          throw new Error(`the property create on portal ${portalId} answered ${res.status}: ${await res.text()}`)
        }
      },
    },
    close: () => new Promise((closed) => server.close(() => closed())),
  }
}

function text(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => done(body))
    req.on('error', fail)
  })
}

function listen(server: Server, socket: string): Promise<void> {
  return new Promise((ready, fail) => {
    server.once('error', fail)
    server.listen(socket, () => ready())
  })
}

export interface Run<T = unknown> {
  /** The issue codes of a --json run, in order. */
  codes: string[]
  data?: T
  envelope?: Envelope<T>
  exitCode: number | null
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
}

export interface Typed {
  exitCode: number | 'timeout'
  /** What the terminal showed, without escape sequences or carriage returns. */
  printed: string
}

export interface Journey {
  backend: Backend
  dir: string
  edit: (file: string, from: string, to: string) => void
  /** Runs `kalup <args>` with no terminal; parses the envelope when --json is among them. */
  kalup: <T = unknown>(...args: string[]) => Promise<Run<T>>
  /** Like kalup, and ends the process with SIGKILL instead of answering the request `when` picks. */
  killed: (when: (method: string, path: string, status: number) => boolean, ...args: string[]) => Promise<Run>
  /** `kalup plan --json` with these flags; throws unless it exits 0. */
  plan: (...flags: string[]) => Promise<Plan>
  /** Plans again and throws unless nothing is left to do, held or noted. */
  planIsEmpty: (...flags: string[]) => Promise<Plan>
  read: (file: string) => string
  /** Every request the simulator answered, in order. Throws on a live backend, which keeps no log. */
  requests: () => SimRequest[]
  /** The state file of a target's portal. Throws when there is none. */
  state: (target?: string) => TargetState
  /** Runs `kalup <args>` in a pseudo-terminal and types each answer once the output shows its prompt, in order. */
  terminal: (args: string[], answers?: Record<string, string>) => Promise<Typed>
  /** The requests that were not GETs, as `<METHOD> <path>`. Simulator only, as requests. */
  writes: () => string[]
}

/** A journey in a new temporary project against `backend`, closed when the test finishes. */
export function journey(backend: Backend): Journey {
  // Throws unless dist was built from the sources as they are now.
  host()
  const root = mkdtempSync(join(tmpdir(), 'kalup-journey-'))
  const dir = join(root, 'larkspur')
  for (const folder of [dir, join(root, 'home'), join(root, 'locks')]) {
    mkdirSync(folder)
  }
  onTestFinished(async () => {
    await backend.close()
    rmSync(root, { recursive: true, force: true })
  })
  // A clean environment: no CI, no state directory override, a home and lock directory of the journey's own.
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: join(root, 'home'),
    TMPDIR: process.env.TMPDIR,
    LANG: 'C.UTF-8',
    KALUP_LOCK_DIR: join(root, 'locks'),
    ...backend.env,
  }
  const command = (args: string[]) => [process.execPath, ...backend.node, bin, ...args]
  const secrets = Object.entries(backend.env)
    .filter(([name]) => name !== 'KALUP_E2E_SOCKET')
    .map(([, value]) => value)
  const noKey = (args: string[], printed: string) => {
    if (secrets.some((key) => printed.includes(key))) {
      throw new Error(`kalup ${args.join(' ')} printed a key`)
    }
  }

  // A live backend sees the plan an apply carries out before it runs: the saved plan it names, else a fresh plan.
  async function beforeApply(args: string[]): Promise<void> {
    if (!backend.beforeApply || args[0] !== 'apply') {
      return
    }
    const [, file] = args
    const target = args.includes('--target') ? ['--target', args[args.indexOf('--target') + 1] as string] : []
    const planned =
      file === undefined || file.startsWith('-')
        ? await plan(...target)
        : (JSON.parse(readFileSync(join(dir, file), 'utf8')) as Plan)
    backend.beforeApply(planned)
  }

  async function spawnRun<T>(args: string[], started?: (child: ChildProcess) => void): Promise<Run<T>> {
    await beforeApply(args)
    const [program, ...rest] = command(args) as [string, ...string[]]
    const began = performance.now()
    const child = spawn(program, rest, { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] })
    started?.(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    return new Promise((done, fail) => {
      child.on('error', fail)
      // A throw in a listener would not reach the promise: a printed key or stdout that is not JSON rejects the run.
      child.on('close', (exitCode, signal) => {
        try {
          noKey(args, `${stdout}${stderr}`)
          backend.record?.({ args, exitCode, ms: Math.round(performance.now() - began), printed: `${stdout}${stderr}` })
          const envelope = args.includes('--json') && stdout !== '' ? (JSON.parse(stdout) as Envelope<T>) : undefined
          const codes = (envelope?.issues ?? []).map((issue) => issue.code)
          done({
            exitCode,
            signal,
            stdout,
            stderr,
            envelope,
            codes,
            ...(envelope?.data ? { data: envelope.data } : {}),
          })
        } catch (error) {
          fail(error)
        }
      })
    })
  }

  function requests(): SimRequest[] {
    if (!backend.sim) {
      throw new Error('only the simulator keeps a request log')
    }
    return backend.sim.log
  }

  async function plan(...flags: string[]): Promise<Plan> {
    const out = await spawnRun<Plan>(['plan', '--json', ...flags])
    if (out.exitCode !== 0 || !out.data) {
      throw new Error(`kalup plan exited ${out.exitCode}: ${out.stdout}${out.stderr}`)
    }
    return out.data
  }

  return {
    backend,
    dir,
    kalup: (...args) => spawnRun(args),
    killed: (when, ...args) => {
      const { killAt } = backend
      if (!killAt) {
        throw new Error('only the simulator can stop a run at a request')
      }
      return spawnRun(args, (child) => killAt(when, () => child.kill('SIGKILL')))
    },
    plan,
    planIsEmpty: async (...flags) => {
      const planned = await plan(...flags)
      const left = leftOver(planned)
      if (left) {
        throw new Error(`the plan is not empty: ${left}`)
      }
      return planned
    },
    terminal: async (args, answers = {}) => {
      await beforeApply(args)
      const began = performance.now()
      const typed = await inTerminal(command(args), {
        cwd: dir,
        env,
        answers: Object.entries(answers).map(([after, type]) => ({ after, type: `${type}\r` })),
        ...(backend.terminalMs === undefined ? {} : { timeoutMs: backend.terminalMs }),
      })
      noKey(args, typed.printed)
      const printed = typed.printed.replace(ESCAPES, '').replaceAll('\r', '')
      backend.record?.({ args, exitCode: typed.status, ms: Math.round(performance.now() - began), printed })
      return { exitCode: typed.status, printed }
    },
    read: (file) => readFileSync(join(dir, file), 'utf8'),
    edit: (file, from, to) => {
      const content = readFileSync(join(dir, file), 'utf8')
      if (!content.includes(from)) {
        throw new Error(`${file} has no ${JSON.stringify(from)}`)
      }
      writeFileSync(join(dir, file), content.replace(from, to))
    },
    requests,
    writes: () =>
      requests()
        .filter((r) => r.method !== 'GET')
        .map((r) => `${r.method} ${r.path}`),
    state: (target = 'sandbox') => {
      const file = join(dir, '.kalup', 'state', `portal-${backend.portals[target]?.portalId}.json`)
      if (!existsSync(file)) {
        throw new Error(`no state file for target ${target}`)
      }
      return JSON.parse(readFileSync(file, 'utf8')) as TargetState
    },
  }
}

/**
 * The app side of a project: `files` written into `dir` (an app's sources, relative paths), @kalup/core linked where
 * the app installs it, and tsc run over them with NodeNext resolution, as an app compiles the files kalup writes.
 * `tsc` holds the extra compiler arguments; with --outDir the output runs under plain Node.
 */
export function compileApp(dir: string, files: Record<string, string>, ...tsc: string[]) {
  mkdirSync(join(dir, 'node_modules', '@kalup'), { recursive: true })
  if (!existsSync(join(dir, 'node_modules', '@kalup', 'core'))) {
    symlinkSync(core, join(dir, 'node_modules', '@kalup', 'core'), 'dir')
  }
  writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n')
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true })
    writeFileSync(join(dir, file), source)
  }
  const options = ['--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--strict']
  const started = performance.now()
  const out = spawnSync(process.execPath, [tscBin, ...options, '--skipLibCheck', ...tsc, ...Object.keys(files)], {
    cwd: dir,
    encoding: 'utf8',
  })
  return { exitCode: out.status, output: `${out.stdout}${out.stderr}`, ms: performance.now() - started }
}
