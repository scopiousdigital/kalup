#!/usr/bin/env node
import { bin, commands, usage } from './usage.js'

const command = process.argv[2]

if (command === undefined || command === '--help' || command === '-h') {
  console.log(usage())
} else if (command in commands) {
  console.error(`${bin} ${command} is not implemented yet`)
  process.exitCode = 1
} else {
  console.error(`Unknown command: ${command}\n\n${usage()}`)
  process.exitCode = 1
}
