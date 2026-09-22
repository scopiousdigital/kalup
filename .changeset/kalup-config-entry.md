---
"kalup": minor
---

The package now has a library entry: `import { defineConfig } from 'kalup'` gives `defineConfig` and the `KalupConfig` type, so `kalup.config.ts` type-checks in a project. A misspelled or unknown field, a string `portalId` or a target without one is a type error in the editor. Importing the package never starts the CLI.
