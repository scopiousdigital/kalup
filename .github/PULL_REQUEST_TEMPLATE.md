## What and why

<!-- What this changes and why. Link the issue it belongs to. -->

## Checklist

- [ ] Tests live under `packages/<pkg>/test/`, mirroring `src/`, and never touch the network
- [ ] Fixtures use invented names
- [ ] A changeset (`pnpm changeset`) for anything that should ship in a release
- [ ] Docs updated where behaviour changed (`README.md`, `packages/cli/docs/`, `docs/`)
- [ ] Every commit is signed off (`git commit -s`) under the [DCO](https://developercertificate.org)
- [ ] No client data: no client names, real portal IDs, real property names, keys or email addresses
- [ ] No em dashes in prose
- [ ] `pnpm build && pnpm check && pnpm test` passes
