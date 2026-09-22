# Targets

A target is a named HubSpot portal under `targets` in `kalup.config.ts`. Call it a target, never an environment.

```ts
targets: {
  sandbox: { portalId: 1111111, credentials: { read: { env: 'HUBSPOT_SANDBOX_KEY' } } },
  production: {
    portalId: 2222222,
    protected: true,
    credentials: { read: { env: 'HUBSPOT_PROD_READ_KEY' } },
    overrides: { 'property:harvest/picked_on': { name: 'pickedon' } },
  },
},
```

A target may not be named `config` (`E_TARGET_NAME`).

## Portal pin and guard

`portalId` is required, a positive integer (`E_PORTAL_ID`): the Hub ID from the HubSpot account menu. `pull` and `status` first read account-info with the target's read key and compare the portal to the pin; `init` compares it to `--portal` before writing. A mismatch is `E_TARGET_PORTAL_MISMATCH`, exit 4, `humanRequired: true`. Nothing more is sent with that key (`status` checks the other targets), and a person checks the key and pin. The fix never suggests changing the pin.

## Keys

`credentials.read.env` names the variable that holds the read key. Without `credentials` it is `HUBSPOT_SERVICE_KEY`. `init` has no `--env` flag yet and always reads that one. The key comes from the environment, else from the project's `.env`. A missing key is `E_MISSING_KEY`, which names the variable. No output carries a key.

The key goes out as `Authorization: Bearer`. A service key and a legacy private app token both work. `init` prints the read scopes the pull scope needs; `status` checks each with one list call and reads a 403 as a missing scope. `credentials.write` is parsed and never read: this version sends no writes.

## Overrides

`overrides` is keyed by address: `property:<object>/<name>`, `group:<object>/<name>` or `object:<name>`. A key that is not an address in config is `E_UNKNOWN_OVERRIDE`. Any field other than these four is `E_NOT_DATA`:

- `name: '<portal name>'`: the resource has another internal name in this portal. `pull` reads it under that name and writes it under the address. For a property or group, a portal that holds both names is `E_OVERRIDE_AMBIGUOUS`.
- `skip: true`, `definition` and `lookup`: carried into the IR; no command applies them yet.

## Protected and drift

`protected: true` marks a portal that, once apply exists, accepts only saved plans and is not covered by `--yes`. `init` writes it for a `STANDARD` account. `status` prints it and treats a `STANDARD` account as protected when config is silent. `drift` (`'hold'` or `'overwrite'`, default hold) is carried into the IR and unused until plan and apply exist.
