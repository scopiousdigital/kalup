#!/usr/bin/env node
import { isInteractive, run } from './host/host.js'

// The one place that reads the terminal, the environment and the signals for the host.
process.exitCode = await run(process.argv.slice(2), {
  cwd: process.cwd(),
  stdin: process.stdin,
  interactive: isInteractive(process.stdin, process.stderr, process.env),
  signals: process,
  exit: (code) => process.exit(code),
  stdout: process.stdout,
  stderr: process.stderr,
})
