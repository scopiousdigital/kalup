import { expect, test } from 'vitest'
import stateSchema from '../../schemas/state-1.schema.json' with { type: 'json' }
import { fixture } from './fixture.js'
import type { TargetState } from './state.js'
import { type JsonSchema, validateSchema } from './validate.js'

const schema = stateSchema as unknown as JsonSchema

test('the architecture document state example conforms to state-1.schema.json', () => {
  expect(validateSchema(schema, fixture('state-example.json'))).toEqual([])
})

test('the state schema is closed', () => {
  const state = fixture<TargetState>('state-example.json')
  const withToken = { ...state, token: 'kalup-test-secret-9f2c' }
  expect(validateSchema(schema, withToken)).toEqual([{ path: 'token', message: 'unexpected field "token"' }])
  const oldFormat = { ...state, format: 'hubschema.state/1' }
  expect(validateSchema(schema, oldFormat)).toEqual([{ path: 'format', message: 'expected "kalup.state/1"' }])
  const badOrigin = {
    ...state,
    resources: { 'team:sales_emea': { origin: 'owned', id: '8841' } },
  }
  expect(validateSchema(schema, badOrigin)).toEqual([
    { path: 'resources.team:sales_emea.origin', message: 'expected one of "created", "adopted", "reference"' },
  ])
})
