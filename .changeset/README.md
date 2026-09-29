# Pending release notes

Changesets describe user-visible package changes and the required version bump. They are consumed when Changesets prepares a release; they are not an implementation diary.

- Keep one note per coherent feature or fix. Update that note during implementation and review instead of adding a note for each agent checkpoint.
- Before the first release, consolidate completed notes by package, preserving the highest pending bump and meaningful compatibility changes. `cli-initial-release.md` and `core-initial-release.md` collect the completed foundation through saved-plan Apply; newer work keeps its own notes until it is ready to fold in.
- Contributor documentation, the website, examples and tests do not need package release notes. Shipped files under `packages/cli/docs/` do.

Inspect pending versions with `pnpm exec changeset status`. Consolidating notes does not publish packages or declare v1 ready. This README is not a changeset.
