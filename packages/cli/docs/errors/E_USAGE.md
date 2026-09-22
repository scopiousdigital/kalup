# E_USAGE

The command line is wrong. Exit 1.

## When

An unknown command or flag, a flag without its value, an argument the command does not take, `pull` without `--target`, or `init` without a valid `--portal`, with a flag it does not take, or with `--target config`. Without `--json` the usage text follows the issue.

## Fix

Run `kalup --help` and correct the command.

## Example

```
E_USAGE: kalup pull needs --target <name> (fix: run kalup --help) (docs: errors/E_USAGE.md)
```
