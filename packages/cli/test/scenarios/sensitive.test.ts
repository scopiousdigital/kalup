// Scenario: a sensitive property create HubSpot refuses is reported in plain words. Without the object's sensitive
// write scope HubSpot answers 403 naming an action, not a scope (observed 2026-10-01); apply names the scope. With the
// scope but the portal's Sensitive data setting off, HubSpot answers 400; apply names the setting.
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { normalise } from '../../../engine/test/support/normalise.js'
import { fault } from '../../../engine/test/support/portal-sim.js'
import { apply, companies, environment, onFakeTime, portal, project, terminal } from './harness.js'

beforeEach(() => {
  environment()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

const TAX_REF = (sensitivity: string) => `    taxRef: p.string('tax_ref', {
      label: 'Tax reference',
      group: 'apiary',
      fieldType: 'text',
      dataSensitivity: '${sensitivity}',
    }),
`
const scopes = ['crm.schemas.companies.read', 'crm.schemas.companies.write', 'crm.objects.companies.read']

test('a sensitive create without the sensitive write scope is E_SCOPE naming crm.objects.<object>.sensitive.write', async () => {
  portal({ scopes: { KESTREL_READ_KEY: scopes, KESTREL_WRITE_KEY: scopes } })
  const dir = project({ properties: TAX_REF('sensitive') })
  const out = await apply(terminal(dir, 'sandbox'), '--target', 'sandbox')
  // The group landed and the property did not: partial, exit 5.
  expect(out.exitCode, out.stderr).toBe(5)
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Plan pl_<id> for target sandbox, portal 7700001 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Create property group "Apiary" (apiary) on companies
      label "Apiary"
    s2 safe Create property "Tax reference" (tax_ref) on companies
      label "Tax reference", group apiary, fieldType "text", dataSensitivity "sensitive" (create only)
    2 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 14 API calls; 999991 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 safe Create property group "Apiary" (apiary) on companies
      s2 safe Create property "Tax reference" (tax_ref) on companies
    2 writes, 0 destructive
    Type the target name to apply: E_SCOPE: s2 Create property "Tax reference" (tax_ref) on companies was refused (MISSING_SCOPES): HubSpot refuses the create because the key lacks the sensitive data scope for companies (fix: add the scope crm.objects.companies.sensitive.write to the write key, then run kalup plan --target sandbox) (docs: errors/E_SCOPE.md)
    "
  `)
})

test('a highly sensitive create without its scope names crm.objects.<object>.highly_sensitive.write', async () => {
  portal({ scopes: { KESTREL_READ_KEY: scopes, KESTREL_WRITE_KEY: scopes } })
  const dir = project({ properties: TAX_REF('highly_sensitive') })
  const out = await apply(terminal(dir, 'sandbox'), '--target', 'sandbox')
  expect(out.exitCode, out.stderr).toBe(5)
  expect(out.stderr).toContain('add the scope crm.objects.companies.highly_sensitive.write to the write key')
  expect(out.stderr).not.toContain('crm.schemas.companies.write')
})

test('a sensitive create on a portal with sensitive data turned off names the setting', async () => {
  const sim = portal()
  const refusal = {
    status: 'error',
    message: 'Portal 7700001 is not enabled for sensitive data properties',
    correlationId: '01a0f665-acfa-76d2-9d1f-c12b4846cdc8',
    context: { portalId: ['7700001'] },
    category: 'VALIDATION_ERROR',
    subCategory: 'PropertyValidationError.PORTAL_NOT_ENABLED_FOR_SENSITIVE_DATA',
  }
  sim.fault({ method: 'POST', path: companies, action: fault.status(400, refusal) })
  const dir = project({ properties: TAX_REF('sensitive') })
  // A rejected create is read again until the read-back deadline, so run the clock.
  const out = await onFakeTime(() => apply(terminal(dir, 'sandbox'), '--target', 'sandbox'))
  expect(out.exitCode, out.stderr).toBe(5)
  expect(normalise(out.stderr)).toMatchInlineSnapshot(`
    "Plan pl_<id> for target sandbox, portal 7700001 (SANDBOX, not protected)
    Settings: mode addon; adopt hold; drift hold; allowDestroy false; yesLimit 25
    s1 safe Create property group "Apiary" (apiary) on companies
      label "Apiary"
    s2 safe Create property "Tax reference" (tax_ref) on companies
      label "Tax reference", group apiary, fieldType "text", dataSensitivity "sensitive" (create only)
    2 safe, 0 risky, 0 destructive, 0 blocked, 0 manual; 0 held
    Coverage: complete; 0 unsupported, 0 skipped.
    About 14 API calls; 999991 left today.
    Not copied, HubSpot has no API: conditional property logic, field-level permissions.
    Apply plan pl_<id> to target sandbox, portal 7700001 (SANDBOX, not protected):
      s1 safe Create property group "Apiary" (apiary) on companies
      s2 safe Create property "Tax reference" (tax_ref) on companies
    2 writes, 0 destructive
    Type the target name to apply: E_HTTP: s2 Create property "Tax reference" (tax_ref) on companies was refused (VALIDATION_ERROR): HubSpot has sensitive data turned off for this portal (fix: turn it on under Settings > Privacy & Consent > Sensitive data, then run kalup plan --target sandbox) (docs: errors/E_HTTP.md)
    "
  `)
})
