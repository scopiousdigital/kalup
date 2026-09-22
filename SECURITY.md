# Security policy

Report a security problem privately through GitHub, never in a public issue, discussion or pull request.

## Supported versions

Kalup is pre-1.0. Only the latest release gets security fixes. Before the first release, fixes land on `main`.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Any older release | No |

## How to report

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to [the report form](https://github.com/scopiousdigital/kalup/security/advisories/new). Only the maintainers can see the report.

Include:

- the Kalup version (`kalup --version`) or the commit,
- the steps to reproduce, with invented names and data,
- what an attacker gains, as far as you can tell.

Never include a real key, token or client data. If a key leaked while you were testing, revoke it in HubSpot before you report.

## What counts

- A key or token in any output: normal output, errors, debug output, `--json` envelopes, the IR, plans, state files or the copies under `.kalup/history/`.
- A request that is not tagged `read` in the endpoint registry leaving the machine in read mode. Milestones 1 and 2 must never write to a portal.
- A command that reads from or writes to a portal other than the target's pinned `portalId`.
- Text from a portal or a config file that the canonical writer turns into running code when your app imports the file. The writer's escaping is a security boundary.
- Text from a portal that reaches output without being sanitized, for example control characters that rewrite a terminal.
- A path in config that makes Kalup read or write outside the project directory.
- A person's email address sent in a request header or payload.

## What does not count

- An AI agent with a shell on the same machine reading a key from `.env`. The docs say so plainly: the confirmation at a terminal guards against an over-eager agent, not a hostile one. CI is the real boundary.
- A problem in HubSpot itself. Report that to HubSpot.
- A vulnerable dependency that Kalup does not call in an exploitable way. Open a normal issue or wait for the weekly Dependabot update.

## What to expect

Kalup is maintained part-time by one founder with AI agents, so a reply can take a few days. A confirmed problem gets a fix in a new release and a GitHub security advisory, credited to you unless you ask us not to. Please give us a reasonable time to ship the fix before you publish details.
