# W_KEY_COLLISION

A warning from `pull`: a new property's default key was taken, so its internal name is the key. Exit stays 0.

## When

Pull keys a new property by camelCase of its internal name. When another property of the object already has that key, the new one gets its internal name as key.

## Fix

Rename either key to what the app should call it. Pull keeps keys as written from then on.

## Example

```
W_KEY_COLLISION: property:companies/plot_count: the key plotCount is taken, so its internal name is the key (fix: rename one of the two keys) (docs: errors/W_KEY_COLLISION.md)
```
