import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { KalupError } from '../../src/lib/output.js'
import { type StagedIo, writeStaged } from '../../src/lib/staged.js'

const before = {
  'kalup.config.ts': 'export default 1\n',
  'kalup/objects/companies.ts': 'export const Company = 1\n',
}

function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'kalup-staged-'))
  mkdirSync(join(root, 'kalup', 'objects'), { recursive: true })
  for (const [file, text] of Object.entries(before)) {
    writeFileSync(join(root, file), text)
  }
  return root
}

/** Every file under `dir` but history, by relative path. */
function files(dir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && !e.parentPath.includes('.kalup'))
      .map((e) => {
        const full = join(e.parentPath, e.name)
        return [full.slice(dir.length + 1), readFileSync(full, 'utf8')]
      }),
  )
}

/** The node file operations, with the `n`th rename throwing EIO. */
function failingRename(n: number): StagedIo {
  let calls = 0
  return {
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    renameSync: (from, to) => {
      calls += 1
      if (calls === n) {
        throw Object.assign(new Error('rename failed'), { code: 'EIO' })
      }
      renameSync(from, to)
    },
  }
}

const next = {
  'kalup.config.ts': 'export default 2\n',
  'kalup/objects/companies.ts': 'export const Company = 2\n',
  'kalup/removed.ts': 'export default {}\n',
}

test('every file is written, each old one copied to history first, and a file already so is left alone', () => {
  const root = project()
  const now = new Date('2026-09-28T10:00:00.000Z')
  const written = writeStaged(root, { ...next, 'kalup.config.ts': before['kalup.config.ts'] }, { now })
  expect(written).toEqual(['kalup/objects/companies.ts', 'kalup/removed.ts'])
  expect(files(root)).toEqual({ ...next, 'kalup.config.ts': before['kalup.config.ts'] })
  const history = join(root, '.kalup', 'history', now.toISOString())
  expect(readFileSync(join(history, 'kalup/objects/companies.ts'), 'utf8')).toBe(before['kalup/objects/companies.ts'])
  expect(existsSync(join(history, 'kalup.config.ts'))).toBe(false)
  expect(writeStaged(root, next)).toEqual(['kalup.config.ts'])
})

test('a failure on the second rename puts back the first file, removes the temporary files, and says nothing changed', () => {
  const root = project()
  let error: unknown
  try {
    writeStaged(root, next, { io: failingRename(2) })
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]).toMatchObject({
    code: 'E_PROJECT_WRITE',
    message: expect.stringContaining('(EIO). Every file was left as it was'),
  })
  expect(files(root)).toEqual(before)
})

test('a failure on the last rename removes a file the write created and restores the rest', () => {
  const root = project()
  expect(() => writeStaged(root, next, { io: failingRename(3) })).toThrow(KalupError)
  expect(files(root)).toEqual(before)
})

test('a failure while writing the temporary files changes nothing', () => {
  const root = project()
  const io: StagedIo = {
    ...failingRename(0),
    writeFileSync: (path, text) => {
      if (String(path).includes('removed.ts')) {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      }
      writeFileSync(path, text)
    },
  }
  expect(() => writeStaged(root, next, { io })).toThrow('(ENOSPC)')
  expect(files(root)).toEqual(before)
})

test('nothing to write touches nothing, history included', () => {
  const root = project()
  expect(writeStaged(root, before)).toEqual([])
  expect(existsSync(join(root, '.kalup'))).toBe(false)
})

test('the temporary files never outlive a failure', () => {
  const root = project()
  expect(() => writeStaged(root, next, { io: failingRename(1) })).toThrow(KalupError)
  const left = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tmp'))
  expect(left).toEqual([])
  rmSync(root, { recursive: true, force: true })
})

// .kalup/history as a file: the history copy's mkdir fails with ENOTDIR before anything is renamed.
test('a history copy that fails is E_PROJECT_WRITE: every file as it was, no temporary file left', () => {
  const root = project()
  mkdirSync(join(root, '.kalup'))
  writeFileSync(join(root, '.kalup', 'history'), 'not a directory\n')
  let error: unknown
  try {
    writeStaged(root, next)
  } catch (caught) {
    error = caught
  }
  expect(error).toBeInstanceOf(KalupError)
  expect((error as KalupError).issues[0]).toMatchObject({
    code: 'E_PROJECT_WRITE',
    message: expect.stringContaining('(ENOTDIR). Every file was left as it was'),
  })
  expect(files(root)).toEqual(before)
  const left = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.tmp'))
  expect(left).toEqual([])
})

test('a file the restore cannot put back is named, with where its previous text is', () => {
  const root = project()
  const failing = failingRename(2)
  const io: StagedIo = {
    ...failing,
    // The restore writes the first renamed file's previous text back over it; that write fails.
    writeFileSync: (path, text) => {
      if (String(path) === join(root, 'kalup.config.ts')) {
        throw Object.assign(new Error('read-only'), { code: 'EROFS' })
      }
      writeFileSync(path, text)
    },
  }
  let error: unknown
  try {
    writeStaged(root, next, { io })
  } catch (caught) {
    error = caught
  }
  expect((error as KalupError).issues[0]).toMatchObject({
    code: 'E_PROJECT_WRITE',
    message: expect.stringContaining('These files could not be put back: kalup.config.ts'),
  })
  expect(files(root)).toEqual({ ...before, 'kalup.config.ts': next['kalup.config.ts'] })
  const history = readdirSync(join(root, '.kalup', 'history'))
  expect(readFileSync(join(root, '.kalup', 'history', history[0] as string, 'kalup.config.ts'), 'utf8')).toBe(
    before['kalup.config.ts'],
  )
})
