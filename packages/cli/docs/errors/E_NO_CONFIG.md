# E_NO_CONFIG

No `kalup.config.ts` in the working directory or any directory above it. Exit 1.

## When

Every command except `init` starts by looking for `kalup.config.ts`, from the working directory upwards.

## Fix

Run the command inside the project. For a new project, run `npx kalup init --portal <id>`.

## Example

```
E_NO_CONFIG: no kalup.config.ts in /work/notes or any directory above it (fix: run npx kalup init --portal <id> in the project directory) (docs: errors/E_NO_CONFIG.md)
```
