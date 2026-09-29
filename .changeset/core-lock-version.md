---
"@kalup/core": patch
---

`parseLock`, and so `loadFiles`, refuses a `kalup/blueprints.lock.json` whose `lockVersion` is not 1 with one `E_BLUEPRINT_LOCK` issue that names the lock version found and `blueprints-lock/1`, and says to use the version of Kalup that wrote it, instead of reporting the rest of the file against the wrong schema.
