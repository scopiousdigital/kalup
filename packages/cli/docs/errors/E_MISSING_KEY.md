# E_MISSING_KEY

The variable that should hold the read key is not set. Exit 1.

## When

The variable is `credentials.read.env` of the target, or `HUBSPOT_SERVICE_KEY` when the target has no `credentials`. In this version `init` has no `--env` flag and always reads `HUBSPOT_SERVICE_KEY`. Kalup looks in the process environment, then in `.env` in the project directory. `status` reports it per target and checks the others.

## Fix

A person sets the variable in the shell or adds `NAME=value` to `.env`. Never paste the key into a chat, a log or a commit. `.env` belongs in `.gitignore`.

## Example

```
E_MISSING_KEY: HUBSPOT_SANDBOX_KEY is not set. (fix: Set HUBSPOT_SANDBOX_KEY in the environment or in .env in the project directory.) (docs: errors/E_MISSING_KEY.md)
```
