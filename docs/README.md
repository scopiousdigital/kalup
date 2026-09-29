# Documentation map

The [roadmap](roadmap.md) owns scope and delivery order.

## Current work and reference

| Document | Purpose |
| --- | --- |
| [Roadmap](roadmap.md) | Milestones and what belongs in each release |
| [Architecture](architecture.md) | Engine, configuration, state, planning and execution contracts |
| [Vision](vision.md) | Users, product direction and principles |
| [Decision records](adr/README.md) | Accepted decisions and proposals, with their history preserved |
| [HubSpot conformance reference](conformance/hubspot-reference.md) | Vendor references and the evidence needed for adapters |
| [Compatibility](compatibility.md) | What v1 promises for config, commands, JSON output and the file formats, and how older data is handled |
| [Live conformance checklist](conformance/checklist.md) | How to run the conformance runner against an authorized test portal and record the evidence |
| [Identity spike](conformance/identity-spike.md) | What `plan/1` and `kalup.state/1` can carry for server-assigned IDs and cross-target references |

## Documentation shipped elsewhere

- [CLI guide](../packages/cli/README.md) and [command/error pages](../packages/cli/docs/): bundled inside the npm package and referenced by CLI issues and generated agent instructions. Keep their paths stable.
- [Core guide](../packages/core/README.md): runtime usage and type inference.
- [Website documentation](../apps/web/content/docs/): the public MDX pages. Keep behavior consistent with the package guides; website navigation and rendering belong here.
- [Basic example](../examples/basic/README.md): runnable usage and a generated data dictionary.
- [Pending release notes](../.changeset/README.md): user-visible changes for the next package release.

Root README, contributor, support, security and agent-instruction files retain their conventional locations. Test fixtures that contain Markdown are test inputs, not additional documentation to consolidate. Error pages and decision records remain separate because each has a stable identifier and a specific reader.
