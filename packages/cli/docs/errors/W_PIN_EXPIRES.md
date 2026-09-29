# W_PIN_EXPIRES

A warning from `status` or `plan`: a HubSpot API version Kalup pins expires within 90 days. Exit stays 0.

## When

HubSpot supports each dated API version for 18 months. Kalup pins one version per API family and warns once per family as the end nears: `status` for every family it pins, `plan` for the families its steps use.

## Fix

Upgrade `kalup` to a release that pins a newer version.

## Example

```
W_PIN_EXPIRES: the crm.properties API pin 2026-09 expires 2028-03 (fix: upgrade kalup to a release that pins a newer version) (docs: errors/W_PIN_EXPIRES.md)
```
