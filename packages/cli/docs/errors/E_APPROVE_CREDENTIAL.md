# E_APPROVE_CREDENTIAL

`--approve` was refused because the write key is not held apart. Exit 4, `humanRequired: true`. Nothing was sent.

## When

`--approve <writesHash>` lets a reviewed CI job apply a plan. It rests on custody: only that CI environment holds the write key. So the target must name its own `credentials.write`, and the key is read from the process environment only. Kalup refuses when the target has no `credentials.write`, or one that names the read credential's variable, or when `.env` in the project directory defines that variable at all, whatever its value, because the key is then on this machine. The message never includes a value.

## Fix

Stop. A person decides. Give the target `credentials.write` with a variable only the reviewed CI environment holds. Keep it out of `.env` and every workstation shell: exported there, it satisfies `--approve` too. Or a person applies the plan at a terminal. Agents: hand this to the user.

## Example

```
E_APPROVE_CREDENTIAL: --approve needs a write key that only the reviewed CI environment holds, and .env in the project directory defines HUBSPOT_PROD_WRITE_KEY. (fix: Remove HUBSPOT_PROD_WRITE_KEY from .env, or have a person apply the plan at a terminal.) (docs: errors/E_APPROVE_CREDENTIAL.md)
```
