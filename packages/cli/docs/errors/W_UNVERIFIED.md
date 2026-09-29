# W_UNVERIFIED

HubSpot accepted a write, but reading it back did not show the value sent. Exit stays 0, except that the apply run exits 5: not every effect verified.

## When

After each write, apply reads the resource back and compares every unit it approved. A unit HubSpot stores differently, for example a label it rewrote, is unverified: its base does not move, and state records both values in the entry's `rewrites`. The next plan then notes "HubSpot stores X; change config to match" instead of writing the same value again. A write HubSpot acknowledged whose result no read showed within 60 seconds is unverified too.

## Fix

Change config to the value HubSpot stores, then run `kalup plan --target <name>`. When nothing read back in time, run `kalup plan` to compare the portal with state again.

## Example

```
W_UNVERIFIED: s1 Update property "Soil acidity" (soil_ph) on companies, set label: HubSpot stores label as "SOIL ACIDITY", not "Soil acidity" as sent (fix: change config to the value HubSpot stores, then run kalup plan --target sandbox) (docs: errors/W_UNVERIFIED.md)
```
