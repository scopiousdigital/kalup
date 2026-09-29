import planSchema from '../../schemas/plan-1.schema.json' with { type: 'json' }
import type { Issue } from '../ir/types.js'
import { type JsonSchema, validateSchema } from '../ir/validate.js'

// TypeScript gives heterogeneous JSON arrays `?: undefined` members, so the literal type does not fit JsonSchema.
const PLAN_SCHEMA = planSchema as unknown as JsonSchema

/** Checks a document against plan-1.schema.json. Empty when it conforms. */
export function validatePlan(document: unknown): Issue[] {
  return validateSchema(PLAN_SCHEMA, document).map(({ path, message }) => ({
    code: 'E_PLAN_SCHEMA',
    message,
    ...(path ? { configPath: path } : {}),
  }))
}
