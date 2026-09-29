# E_DUPLICATE_PORTAL

Two targets pin the same portal. Exit 3.

## When

`validate` and every command that validates first check that no two targets in `kalup.config.ts` have the same `portalId`. Two names for one portal could carry different policies, and the less protected name would get around the stricter one. The issue points at the later target's `portalId` and names the earlier target.

## Fix

Keep one target per portal: remove one of the two, and move any settings you need to the one you keep.

## Example

```ts
targets: {
  sandbox: { portalId: 1111111 },
  qa: { portalId: 1111111 },
},
```

```
kalup.config.ts:6: E_DUPLICATE_PORTAL: target 'qa' pins portal 1111111, which target 'sandbox' pins too (fix: each portal has one target; remove or rename one of sandbox, qa) (docs: errors/E_DUPLICATE_PORTAL.md)
```
