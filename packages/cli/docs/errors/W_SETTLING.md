# W_SETTLING

A warning from every command that reads a target: for some minutes after a write HubSpot may serve an older copy of what was written, so the read cannot be trusted on those resources yet. Exit stays 0, except as below.

## When

After `apply` verifies a write, state records when it did and the units it wrote. For 5 minutes after that, a read that shows another value than apply verified on one of those units, or does not show the resource, is settling: HubSpot has been seen to serve a custom object schema's fields from before a PATCH, to leave a new custom object out of the schemas list, and to leave a new association's name out of its schema read for about 5 minutes. A label HubSpot lists that its schema read does not name yet settles the same way.

A settling resource is unknown, never absent, drifted or held: `plan` blocks its step with reason `settling` and never creates, deletes or writes it, a destroy tombstone on it included, `pull` keeps the file as it is, `compare` reports it `unknown` (`E_INCOMPLETE`, exit 1), and the read is incomplete. Takeover waits only while something on the object it removes from settles; `state rebuild --write` and `target rebind` only while something config names does. Its base in state never moves on such a read. A difference on a unit apply did not write is drift as ever.

## Fix

Run the command again after the time the warning names. Nothing to change.

## Example

```
W_SETTLING: HubSpot still serves an older copy of 1 resource apply wrote minutes ago, so this read is not trusted on it until 2026-10-06T09:05:00.000Z: property:companies/billing_status (fix: run the command again after 2026-10-06T09:05:00.000Z) (docs: errors/W_SETTLING.md)
```
