# E_UNREACHABLE

HubSpot did not answer a request, even after retries. Exit 1.

## When

A read failed before any response came (no network, DNS, a proxy or a firewall), or got no answer within 30 seconds. Kalup retries it three times with a growing pause, as it does for a 5xx, then stops with this code. The message names the request and the last failure: the network error, or the timeout. `status` marks the target `unreachable` and checks the others.

## Fix

Check the network connection and any proxy, then run the command again.

## Example

```
E_UNREACHABLE: GET /account-info/2026-09/details got no answer from HubSpot in 4 attempts: fetch failed (fix: Check the network connection and any proxy, then run the command again.) (docs: errors/E_UNREACHABLE.md)
```
