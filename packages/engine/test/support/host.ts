// An in-memory host for the executor tests: the state store, portal lock and journal apply takes, with the same
// contracts as the CLI's file-backed ones (compare-and-swap on the serial, E_LOCKED for a held portal, a journal that
// takes only registry path templates and refuses a line holding a key). The CLI tests its file-backed ones itself.
import type { ApplyDeps, Journal, JournalEntry, JournalRun, StateStore } from '../../src/engine/apply.js'
import { stableStringify } from '../../src/ir/serialize.js'
import type { TargetState } from '../../src/ir/state.js'
import { validateState } from '../../src/ir/state.js'
import { KalupError } from '../../src/lib/errors.js'
import { registry } from '../../src/lib/registry.js'

const TEMPLATES = new Set(Object.values(registry).flatMap((row) => Object.values(row.paths).map((e) => e.path)))

export interface MemoryHost {
  /** The portals whose lock is held. */
  held: Set<number>
  /** Opens the journal of one run, named by the time it opened at. */
  journal: (run: JournalRun, at: Date) => Journal
  /** Every journal the runs opened, by path, with the lines appended. */
  journals: Map<string, JournalEntry[]>
  lock: ApplyDeps['lock']
  store: StateStore
}

export function memoryHost(): MemoryHost {
  const files = new Map<number, string>()
  const held = new Set<number>()
  const journals = new Map<string, JournalEntry[]>()
  let lineages = 0

  const store: StateStore = {
    newLineage: () => {
      lineages += 1
      return lineages.toString(16).padStart(16, '0')
    },
    path: (portalId) => `memory/portal-${portalId}.json`,
    read: (portalId) => {
      const text = files.get(portalId)
      return text === undefined ? null : (JSON.parse(text) as TargetState)
    },
    write: (next, expectSerial) => {
      const current = files.get(next.portalId)
      const stored = current === undefined ? null : (JSON.parse(current) as TargetState).serial
      if (stored !== expectSerial) {
        throw new KalupError({
          code: 'E_STATE_CONFLICT',
          message: `the state of portal ${next.portalId} has serial ${stored ?? 'absent'}, not ${expectSerial ?? 'absent'}`,
        })
      }
      const problems = validateState(next)
      if (problems.length > 0) {
        throw new Error(`refusing to save state that does not match kalup.state/1: ${problems[0]?.message}`)
      }
      const text = stableStringify(next)
      if (text === current) {
        return false
      }
      files.set(next.portalId, text)
      return true
    },
  }

  function lock(portalId: number): Promise<{ release: () => void }> {
    if (held.has(portalId)) {
      return Promise.reject(new KalupError({ code: 'E_LOCKED', message: `portal ${portalId} is locked` }))
    }
    held.add(portalId)
    return Promise.resolve({ release: () => held.delete(portalId) })
  }

  function journal(run: JournalRun, at: Date): Journal {
    const path = `memory/journal/portal-${run.portalId}/${run.planId}-${at.toISOString()}.jsonl`
    const lines: JournalEntry[] = []
    journals.set(path, lines)
    const keys = run.keys.filter((key) => key !== '')
    return {
      path,
      append: (entry) => {
        if (!TEMPLATES.has(entry.path)) {
          throw new Error(`the journal takes a registry path template, not ${entry.path}`)
        }
        if (Object.values(entry).some((v) => typeof v === 'string' && keys.some((key) => v.includes(key)))) {
          throw new Error('refusing to journal a line that holds a key')
        }
        lines.push(entry)
      },
    }
  }

  return { held, journal, journals, lock, store }
}
