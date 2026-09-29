# E_SNAPSHOT

A snapshot file could not be used. Exit 1 when the file is missing, is not JSON or would be overwritten; exit 3 when it is JSON but not a snapshot this version reads.

## When

`compare` and `docs` read snapshot files that `kalup snapshot` wrote: `ir/1` documents from a portal read, with an observation block. A missing file, or one that is not JSON, is exit 1, as is a `compare` side that is neither `config`, a declared target nor a file. Exit 3: another `irVersion`, the IR `kalup ir` derives, a resource typed unlike its address, or a coverage name no address can hold. A snapshot that breaks the `ir/1` schema gives `E_IR_SCHEMA` issues naming the file instead.

## Fix

Pass a file `kalup snapshot` wrote, or `config` for the config files. For another `irVersion`, snapshot again with this version. For a file that exists, pass another `--out` or move the old file away.

## Example

```
E_SNAPSHOT: ir.json is not a snapshot: it is not an ir/1 document from a portal read with an observation block (fix: pass a file the snapshot command wrote, or config for the config files) (docs: errors/E_SNAPSHOT.md)
```
