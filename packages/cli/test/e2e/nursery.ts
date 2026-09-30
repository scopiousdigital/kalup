// The journeys' portal: Larkspur Nurseries, an invented plant nursery, with a nursery group of custom company
// properties in every codec a pull writes. Journeys seed their portals from it and change what they need.
import type { SimOption, SimPropertyInput } from '../../../engine/test/support/portal-sim.js'
import type { Journey, PortalSeed } from './journey.js'

/** Enum options as HubSpot holds them, in display order. */
export function options(...pairs: [value: string, label: string][]): SimOption[] {
  return pairs.map(([value, label], displayOrder) => ({ value, label, displayOrder, hidden: false }))
}

export const nurseryGroup = { name: 'nursery', label: 'Nursery' }

export function nurseryProperties(): SimPropertyInput[] {
  const inNursery = { groupName: 'nursery' }
  return [
    { ...inNursery, name: 'bed_count', label: 'Bed count', type: 'number', fieldType: 'number' },
    { ...inNursery, name: 'grower_notes', label: 'Grower notes', type: 'string', fieldType: 'textarea' },
    { ...inNursery, name: 'last_frost', label: 'Last frost', type: 'date', fieldType: 'date' },
    {
      ...inNursery,
      name: 'nursery_zone',
      label: 'Nursery zone',
      type: 'enumeration',
      fieldType: 'select',
      options: options(['north', 'North'], ['south', 'South'], ['GLASS HOUSE', 'Glass house']),
    },
    {
      ...inNursery,
      name: 'plant_families',
      label: 'Plant families',
      type: 'enumeration',
      fieldType: 'checkbox',
      options: options(['roses', 'Roses'], ['ferns', 'Ferns'], ['herbs', 'Herbs']),
    },
  ]
}

/** A portal holding the nursery group and its properties on companies. */
export function nursery(seed: PortalSeed = {}): PortalSeed {
  return { ...seed, objects: { companies: { groups: [nurseryGroup], properties: nurseryProperties() } } }
}

/** `kalup init` on a target's portal, whose first pull writes the files and records their base. */
export async function initialised(j: Journey, target = 'sandbox', ...flags: string[]): Promise<void> {
  const portal = String(j.backend.portals[target]?.portalId)
  const out = await j.kalup('init', '--portal', portal, '--objects', 'companies', ...flags)
  if (out.exitCode !== 0) {
    throw new Error(`kalup init exited ${out.exitCode}: ${out.stdout}${out.stderr}`)
  }
}

/** init, then an apply that adopts what the pull wrote, so Kalup owns the nursery on the sandbox. */
export async function adopted(j: Journey): Promise<void> {
  await initialised(j)
  const out = await j.kalup('apply', '--yes')
  if (out.exitCode !== 0) {
    throw new Error(`kalup apply exited ${out.exitCode}: ${out.stdout}${out.stderr}`)
  }
}
