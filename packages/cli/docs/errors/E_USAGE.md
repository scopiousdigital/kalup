# E_USAGE

The command line is wrong. Exit 1.

## When

An unknown command, a flag the command does not take (each command accepts only its own flags), a flag without its value or repeated, an argument the command does not take or a missing one (`compare` needs two), `init` with an invalid `--portal` or `--dir`, or with `--target config`, or an `--out` path that is a symbolic link or lies inside `.kalup/` (other than `.kalup/snapshots/` and `.kalup/plans/`), the lock directory or the state and journal directories `KALUP_STATE_DIR` moves, where Kalup keeps state, journals and locks. Without a command only `--json`, `--help`, `-h` and `--version` are accepted, so `kalup --target sandbox` reads `--target needs a command` and `kalup --help --bogus` reads `unknown flag --bogus`. Without `--json` the help for the named command, or the root help, follows the issue. `kalup <command> --help` lists the command's flags.

## Fix

Run `kalup --help` and correct the command.

## Example

```
E_USAGE: unknown flag --portal (fix: run kalup --help) (docs: errors/E_USAGE.md)
```
