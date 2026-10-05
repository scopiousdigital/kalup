import { expect, expectTypeOf, test } from 'vitest'
import { definePipeline, type StageId } from '../../src/codecs/pipeline.js'

const Charters = definePipeline('deals', {
  id: 'charters',
  label: 'Charters',
  displayOrder: 2,
  stages: {
    quoted: { id: 'charters_quoted', label: 'Quoted', probability: 0.3 },
    booked: { id: 'charters_booked', label: 'Booked', probability: 1 },
  },
})

test('definePipeline carries the object, the pipeline fields and the stages in file order', () => {
  expect(Charters.object).toBe('deals')
  expect(Charters.id).toBe('charters')
  expect(Charters.label).toBe('Charters')
  expect(Charters.displayOrder).toBe(2)
  expect(Object.keys(Charters.stages)).toEqual(['quoted', 'booked'])
  expect(Charters.stages.booked).toEqual({ id: 'charters_booked', label: 'Booked', probability: 1 })
})

test('pipeline and stage IDs keep their literal types', () => {
  expectTypeOf(Charters.id).toEqualTypeOf<'charters'>()
  expectTypeOf(Charters.stages.booked.id).toEqualTypeOf<'charters_booked'>()
  expectTypeOf<StageId<typeof Charters>>().toEqualTypeOf<'charters_quoted' | 'charters_booked'>()
})

test('ticket and custom object stages take their own metadata field', () => {
  const Desk = definePipeline('tickets', {
    id: 'desk',
    label: 'Desk',
    displayOrder: 0,
    stages: {
      open: { id: 'desk_open', label: 'Open' },
      done: { id: 'desk_done', label: 'Done', ticketState: 'CLOSED' },
    },
  })
  expect(Desk.stages.done.ticketState).toBe('CLOSED')
  const Hauls = definePipeline('haul', {
    id: 'hauls',
    label: 'Hauls',
    displayOrder: 0,
    stages: { landed: { id: 'hauls_landed', label: 'Landed', state: 'CLOSED' } },
  })
  expect(Hauls.stages.landed.state).toBe('CLOSED')
})
