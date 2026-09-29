// --simulate: the runner against the tests' HubSpot simulator (packages/engine/test/support/portal-sim.ts) instead of
// a portal. The simulator is TypeScript, so it is transpiled with the repository's typescript into the run's work
// directory and imported from there, as scripts/pack-smoke.mjs does with the example's fake portal: one source, no copy.
// The simulated portal holds invented data only, and other properties and groups besides the run's, so a run shows
// that cleanup leaves them alone. Its key holds the scopes a run names, which decide only the Limits Tracking answer,
// as observed on 2026-09-29. It also holds a second, limited key: the simulator checks no write scope, so
// withLimitedKey answers each write that key sends as HubSpot documents a missing scope, with a 403.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The key a simulated run uses. Invented: simulate mode never reads KALUP_CONFORMANCE_KEY. */
export const SIMULATED_KEY = 'kalupconf-simulated-key-3d8b61'
/** The second key of a simulated run, standing for a key without crm.schemas.companies.write. Invented. */
export const SIMULATED_LIMITED_KEY = 'kalupconf-simulated-limited-key-7c42e9'
/** The simulated portal's custom object. */
export const SIMULATED_OBJECT = '2-4400017'
/** The scope the simulated limited key lacks. */
const LIMITED_SCOPE = 'crm.schemas.companies.write'
/** The scopes the simulated key holds without --scopes: those of the first live run's key (run 89b45da9). */
export const SIMULATED_SCOPES = [
  'crm.schemas.contacts.read',
  'crm.schemas.contacts.write',
  'crm.schemas.companies.read',
  'crm.schemas.companies.write',
  'crm.schemas.deals.read',
  'crm.schemas.deals.write',
  'crm.schemas.custom.read',
  'crm.schemas.custom.write',
]
const BEARER = /^Bearer\s+(.+)$/i

const SIMULATOR = 'packages/engine/test/support/portal-sim.ts'
const SCOPE = 'packages/engine/src/lib/pull/scope.ts'
const SCOPE_IMPORT = "'../../src/lib/pull/scope.js'"

/** The simulator module, transpiled into `dir`. */
export function loadSimulator(repo, dir) {
  const ts = createRequire(join(repo, 'package.json'))('typescript')
  const compilerOptions = { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  const source = readFileSync(join(repo, SIMULATOR), 'utf8')
  if (!source.includes(SCOPE_IMPORT)) {
    throw new Error(`${SIMULATOR} no longer imports ${SCOPE_IMPORT}: update scripts/conformance/simulate.mjs`)
  }
  mkdirSync(dir, { recursive: true })
  const scope = ts.transpileModule(readFileSync(join(repo, SCOPE), 'utf8'), { compilerOptions }).outputText
  writeFileSync(join(dir, 'scope.mjs'), scope)
  const simulator = ts.transpileModule(source.replace(SCOPE_IMPORT, "'./scope.mjs'"), { compilerOptions }).outputText
  writeFileSync(join(dir, 'portal-sim.mjs'), simulator)
  return import(pathToFileURL(join(dir, 'portal-sim.mjs')).href)
}

/**
 * A developer test portal: HubSpot's own companies group and name, other custom properties and a custom object. The
 * run's key holds `scopes`.
 */
export function simulatedPortal(portalId, scopes = SIMULATED_SCOPES) {
  return {
    portalId,
    accountType: 'DEVELOPER_TEST',
    keys: { KALUP_CONFORMANCE_KEY: SIMULATED_KEY, KALUP_CONFORMANCE_LIMITED_KEY: SIMULATED_LIMITED_KEY },
    scopes: { KALUP_CONFORMANCE_KEY: scopes },
    objects: {
      companies: {
        groups: [
          { name: 'companyinformation', label: 'Company information' },
          { name: 'orchard_details', label: 'Orchard details' },
        ],
        properties: [
          {
            name: 'name',
            label: 'Company name',
            type: 'string',
            fieldType: 'text',
            groupName: 'companyinformation',
            hubspotDefined: true,
          },
          {
            name: 'orchard_rows',
            label: 'Orchard rows',
            type: 'number',
            fieldType: 'number',
            groupName: 'orchard_details',
          },
          {
            name: 'harvest_grade',
            label: 'Harvest grade',
            type: 'enumeration',
            fieldType: 'select',
            groupName: 'orchard_details',
            options: [
              { value: 'early', label: 'Early', displayOrder: 0, hidden: false },
              { value: 'late', label: 'Late', displayOrder: 1, hidden: false },
            ],
          },
          {
            name: 'grower_tax_ref',
            label: 'Grower tax reference',
            type: 'string',
            fieldType: 'text',
            groupName: 'orchard_details',
            dataSensitivity: 'sensitive',
          },
        ],
      },
      [SIMULATED_OBJECT]: {
        groups: [{ name: 'inspection_details', label: 'Inspection details' }],
        properties: [
          {
            name: 'inspection_name',
            label: 'Inspection name',
            type: 'string',
            fieldType: 'text',
            groupName: 'inspection_details',
          },
          {
            name: 'inspection_score',
            label: 'Inspection score',
            type: 'number',
            fieldType: 'number',
            groupName: 'inspection_details',
          },
        ],
      },
    },
    schemas: [
      {
        name: 'hive_inspections',
        objectTypeId: SIMULATED_OBJECT,
        labels: { singular: 'Hive inspection', plural: 'Hive inspections' },
        primaryDisplayProperty: 'inspection_name',
        secondaryDisplayProperties: ['inspection_score', 'inspection_name'],
      },
    ],
  }
}

/**
 * `fetch`, except that a write carrying the simulated limited key is answered as HubSpot answers a key without the
 * scope: 403 MISSING_SCOPES naming it in errors[].context.requiredGranularScopes. Reads go through.
 */
export function withLimitedKey(fetch) {
  let refused = 0
  return (input, init = {}) => {
    const key = BEARER.exec(new Headers(init.headers).get('authorization') ?? '')?.[1]
    if (key !== SIMULATED_LIMITED_KEY || (init.method ?? 'GET').toUpperCase() === 'GET') {
      return fetch(input, init)
    }
    refused += 1
    const body = {
      status: 'error',
      message: "This app hasn't been granted all required scopes to make this call.",
      correlationId: `5c0bba5e-0000-4000-8000-${String(refused).padStart(12, '0')}`,
      errors: [
        {
          message: 'One or more of the following scopes are required.',
          context: { requiredGranularScopes: [LIMITED_SCOPE] },
        },
      ],
      category: 'MISSING_SCOPES',
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), { status: 403, headers: { 'content-type': 'application/json' } }),
    )
  }
}
