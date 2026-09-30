// A portal lock directory of this test file's own. pull and apply take the portal lock, and without this the tests
// that do not set KALUP_LOCK_DIR would share ~/.kalup/locks with each other and with the person running them.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.KALUP_LOCK_DIR = mkdtempSync(join(tmpdir(), 'kalup-test-locks-'))
