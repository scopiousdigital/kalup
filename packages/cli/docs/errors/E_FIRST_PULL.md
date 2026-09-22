# E_FIRST_PULL

`init` wrote the project files, but the first pull failed. The exit code is the pull's.

## When

`init` checks the portal, writes `kalup.config.ts`, `.gitignore`, `AGENTS.md`, `CLAUDE.md` and, when it finds a formatter, its ignore entry, then runs a pull. The issue before this one says why the pull failed.

## Fix

Fix that issue, then run the pull yourself. Do not run `init` again: the config exists now, so it would stop with `E_CONFIG_EXISTS`.

## Example

```
E_AUTH: HubSpot rejected the key (401). (fix: Check that the key is valid and not expired. It needs the scope crm.schemas.companies.read.) (docs: errors/E_AUTH.md)
E_FIRST_PULL: The project files are written, but the first pull failed. (fix: fix the issue above, then run npx kalup pull --target sandbox) (docs: errors/E_FIRST_PULL.md)
```
