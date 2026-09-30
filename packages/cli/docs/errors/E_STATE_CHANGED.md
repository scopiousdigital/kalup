# E_STATE_CHANGED

State for the portal changed after the plan was made. Exit 1. Nothing was written.

## When

A plan records the state lineage and serial it was made from, and an approval covers the plan with them. After it takes the portal lock, `kalup apply` reads state again and refuses when either differs: another apply, a pull that recorded bases, a state rebuild or a rebind ran in between. The one exception is a plan that is the last one applied, with outcome `done`: apply reports it as already applied and exits 0.

`state rebuild --write` shows its report before it takes the lock. Under the lock it reads state again and refuses when it is not the file the report showed, so it never archives a file the person did not see.

## Fix

Run `kalup plan --target <name> --out <file>` again. It starts from the new state. Review it and apply that file. For a rebuild, run it again and review the new report.

## Example

```
E_STATE_CHANGED: state for portal 2222222 changed since plan pl_7f3a1c07b2e4 was made (lineage 0a1b2c3d4e5f6071, serial 4; now lineage 0a1b2c3d4e5f6071, serial 6): another apply, pull or repair ran in between. Nothing was written. (fix: run kalup plan --target production --out <file> again and review it) (docs: errors/E_STATE_CHANGED.md)
```
