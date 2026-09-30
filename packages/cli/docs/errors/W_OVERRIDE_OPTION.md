# W_OVERRIDE_OPTION

A warning from validate: a target's definition override lists an option value the shared options of a `.strict()` enum lack. Exit stays 0.

## When

The app types and decodes an enum from the shared file alone. On that target HubSpot can store the new value, and a `.strict()` codec's `get` throws on it. A lenient enum reads it as `Unlisted`, so it gets no warning. A shared option the override leaves out is fine.

## Fix

If the app reads the property from that target, add the option to the shared options. Other targets then get it too, unless they override `options` as well. Or drop `.strict()`, and handle `Unlisted` in the app.

## Example

```
kalup.config.ts:8: W_OVERRIDE_OPTION: property:deals/payment_terms on target sandbox: option 'net90' is not in the shared options, so the app's codec for paymentTerms throws on this value (fix: add it to the shared options if the app reads paymentTerms from target sandbox) (docs: errors/W_OVERRIDE_OPTION.md)
```
