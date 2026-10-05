import { expect, expectTypeOf, test } from 'vitest'
import { type AssociationName, defineAssociations } from '../../src/codecs/association.js'

const Associations = defineAssociations({
  // The person who signed the charter.
  signer: { from: 'deals', to: 'contacts', name: 'charter_signer', label: 'Signer', inverseLabel: 'Signed charter' },
  crew: { from: 'companies', to: 'contacts', name: 'crew', label: 'Crew' },
  hauler: { from: 'haul', to: 'companies', name: 'haul_to_company' },
})

test('defineAssociations returns its entries as written', () => {
  expect(Object.keys(Associations)).toEqual(['signer', 'crew', 'hauler'])
  expect(Associations.crew).toEqual({ from: 'companies', to: 'contacts', name: 'crew', label: 'Crew' })
  expect(Associations.hauler.label).toBeUndefined()
})

test('internal names keep their literal types', () => {
  expectTypeOf(Associations.signer.name).toEqualTypeOf<'charter_signer'>()
  expectTypeOf<AssociationName<typeof Associations>>().toEqualTypeOf<'charter_signer' | 'crew' | 'haul_to_company'>()
})
