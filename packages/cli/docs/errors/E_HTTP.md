# E_HTTP

HubSpot returned an error Kalup has no other code for. Exit 1.

## When

A 400, a 404, a 5xx that three retries did not clear, or a success whose body is not JSON (often a proxy's HTML page). The issue holds the status, the method, the path and HubSpot's message when it sent one. In `apply`, a refusal whose reason HubSpot names and Kalup knows says it in plain words: a property in use, a group that still holds properties, or a property name that exists.

## Fix

A 5xx is usually temporary: run the command again later. A 404 on a properties list means the object does not exist in that portal. A body that is not JSON points at a proxy between you and HubSpot.

## Example

```
E_HTTP: HubSpot returned 503 for GET /crm/properties/2026-09/companies. (docs: errors/E_HTTP.md)
```
