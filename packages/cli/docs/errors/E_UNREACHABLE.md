# E_UNREACHABLE

`status` got no answer from HubSpot. Exit 1.

## When

A request failed before any response: no network, DNS, a proxy or a firewall. `status` marks the target `unreachable` and checks the others. The message is the network error.

## Fix

Check the connection and any proxy, then run `kalup status` again.

## Example

```
E_UNREACHABLE: fetch failed (docs: errors/E_UNREACHABLE.md)
```
