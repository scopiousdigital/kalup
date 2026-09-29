// The apply journal, ADR 0021: one JSON line per request, on disk before the next request goes. A line names the
// request by its registry path template, never its URL, and holds no key, no request or response body and no person.
import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { registry } from './registry.js'
import { writeAll } from './state.js'

export type ApprovalMode = 'terminal' | 'yes' | 'approve'

export interface JournalRun {
  approval: ApprovalMode
  /** Every key the run holds. A line with a string that contains one is refused. */
  keys: readonly string[]
  planId: string
  portalId: number
  writesHash: string
}

export interface JournalEntry {
  address: string
  /** When the request went, as an ISO time. */
  at: string
  category?: string
  correlationId?: string
  method: string
  /** How long the request took. */
  ms: number
  outcome: 'ok' | 'rejected' | 'wait' | 'uncertain' | 'failed'
  /** The registry's path template, such as /crm/properties/2026-09/{objectType}/{name}: never a URL. */
  path: string
  /** Absent when no answer came. */
  status?: number
  step: string
  /** HubSpot's subCategory of a rejected write, when it sent one. */
  subCategory?: string
}

export interface Journal {
  append: (entry: JournalEntry) => void
  path: string
}

/** The file operations the journal uses, injectable so a test can see the flush happen before append returns. */
export interface JournalIo {
  closeSync: typeof closeSync
  fsyncSync: typeof fsyncSync
  mkdirSync: typeof mkdirSync
  openSync: typeof openSync
  writeSync: typeof writeSync
}

const nodeIo: JournalIo = { closeSync, fsyncSync, mkdirSync, openSync, writeSync }

// The compact form of an ISO time that snapshot file names use: safe on every file system.
const COMPACT = /[-:.]/g
const TEMPLATES = new Set(Object.values(registry).flatMap((row) => Object.values(row.paths).map((e) => e.path)))

/**
 * Opens the journal of one run at <stateDirectory>/../journal/portal-<id>/<planId>-<time>.jsonl. `append` writes one
 * line and flushes it to disk before it returns. It throws, writing nothing, when the path is not a registry template
 * or a string holds a key; fields other than the entry's own are never written.
 */
export function openJournal(stateDirectory: string, run: JournalRun, now = new Date(), io = nodeIo): Journal {
  const dir = join(stateDirectory, '..', 'journal', `portal-${run.portalId}`)
  const path = join(dir, `${run.planId}-${now.toISOString().replace(COMPACT, '')}.jsonl`)
  io.mkdirSync(dir, { recursive: true })
  const keys = run.keys.filter((key) => key !== '')

  return {
    path,
    append(entry: JournalEntry): void {
      if (!TEMPLATES.has(entry.path)) {
        throw new Error(`the journal takes a registry path template, not ${entry.path}`)
      }
      const line = {
        planId: run.planId,
        writesHash: run.writesHash,
        portalId: run.portalId,
        approval: run.approval,
        at: entry.at,
        step: entry.step,
        address: entry.address,
        method: entry.method,
        path: entry.path,
        status: entry.status ?? null,
        category: entry.category ?? null,
        subCategory: entry.subCategory ?? null,
        correlationId: entry.correlationId ?? null,
        outcome: entry.outcome,
        ms: entry.ms,
      }
      if (Object.values(line).some((value) => typeof value === 'string' && keys.some((key) => value.includes(key)))) {
        throw new Error('refusing to journal a line that holds a key')
      }
      const fd = io.openSync(path, 'a')
      try {
        writeAll(io.writeSync, fd, `${JSON.stringify(line)}\n`)
        io.fsyncSync(fd)
      } finally {
        io.closeSync(fd)
      }
    },
  }
}
