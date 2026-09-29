# 0017. Use oclif for the TypeScript command layer

## Status

accepted

## Date

2026-09-23

## Context

Kalup currently owns its argument parser, dispatcher and help registry. More commands would increase the work of maintaining CLI conventions. The product also needs its reconciliation logic to serve future MCP, UI and cloud hosts. The founder selected oclif after considering a smaller parser and a Go rewrite.

## Decision

Use `@oclif/core` for the command shell while retaining TypeScript and Kalup's domain logic. First migrate the existing six commands, preserving their behavior and the machine contract. New commands and the review's correctness fixes are separate tasks.

Oclif owns parsing, command selection and help metadata. Kalup owns its envelope, issues, exit codes, credentials, approval rules and domain operations. Command adapters remain thin. Core and engine modules never import oclif, and the `kalup` library entry for `defineConfig` stays independent of the executable.

Keep one `envelope/1` for every JSON invocation, including help, version and errors. Preserve the existing help/version data fields, omit absent data, and map framework failures to Kalup's error contract. Human help may change. Preserve non-TTY behavior and injectable output without terminating an embedding process.

Use npm package distribution for this migration. Prove command discovery and exports from an installed package. Additional installers, completion, updates and user-installed plugins are deferred, not automatic requirements of adopting oclif.

This supersedes only ADR 0008's rule that the CLI contains exactly one dynamic import. The engine still never loads executor code or executes project config. The CLI may load its own installed command modules and framework dependencies. Project config cannot introduce arbitrary module loading through command discovery. The planned external executor loader remains deferred under ADR 0008's other restrictions.

## Alternatives considered

- Retain the custom shell: minimal dependencies, but Kalup continues maintaining parsing and help conventions as the command surface grows.
- Commander: a smaller option, but the accepted choice is oclif for the command structure and CLI tooling. It is not an automatic fallback during implementation.
- Go with Cobra: would add a language boundary or rewrite the shared TypeScript logic without evidence that the current runtime is the constraint.
- A Terraform provider: changes the product's execution and lifecycle model and does not replace this command-layer task.

## Consequences

- The CLI gains a runtime framework dependency; `@kalup/core` stays small and dependency-free.
- Framework JSON, error handling and command discovery need explicit integration tests. Default framework behavior is not evidence of compatibility.
- Package layout may change, while the executable name, library exports and documented invocation contract stay intact.
- The old parser and parallel help registry are removed when migration completes. No general plugin platform or new engine package is introduced.
- [Roadmap](../roadmap.md) remains authoritative for subsequent work.
