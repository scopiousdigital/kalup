# W_WRITE_SCOPE

A warning from `status`: HubSpot's token introspection lists the read key's scopes, and a write scope apply needs is not among them. Exit stays 0.

## When

`status` reads the scopes a service key holds through HubSpot's token introspection (the key goes in the request body, as HubSpot requires) and checks the write scopes `init` lists against them by name, when apply writes with the same key. A separate write key is never resolved or sent, so its scopes stay unchecked and the line says so. When introspection answers nothing, status checks no write scope.

## Fix

Add the scope the message names to the key (Development > Keys > Service keys), then run `kalup status` again.

## Example

```
W_WRITE_SCOPE: the key in HUBSPOT_SANDBOX_KEY does not hold crm.schemas.companies.write, which apply needs for companies (fix: add the scope crm.schemas.companies.write to the key) (docs: errors/W_WRITE_SCOPE.md)
```
