# E_DIR_AMBIGUOUS

Both `hubspot/` and the old default folder `kalup/` hold .ts files, and `kalup.config.ts` does not say which one holds the object files. Exit 3. Nothing was read or written.

## When

Without `dir` in `kalup.config.ts`, Kalup reads `hubspot/`, or an older project's `kalup/` while `hubspot/` holds no .ts file (`W_LEGACY_DIR`). When both hold .ts files, such as a half-done move or a HubSpot developer project in `hubspot/`, Kalup does not guess: reading the wrong folder would make everything in the other look removed from config.

## Fix

Add `dir: 'kalup'` to `kalup.config.ts` to keep the old folder, or `dir: 'hubspot'` when the object files are there. Then move or remove the other folder's copy of the object files.

## Example

```
kalup.config.ts: E_DIR_AMBIGUOUS: both hubspot/ and kalup/ hold .ts files, and kalup.config.ts does not say which one holds the object files (fix: add dir: 'kalup' to kalup.config.ts to keep the old folder, or dir: 'hubspot' when the object files are there) (docs: errors/E_DIR_AMBIGUOUS.md)
```
