// Whether a string Kalup is about to write holds a key: the journal checks each line, and the state writer every string
// of the file, so neither depends on which field names a later version adds.

// HubSpot's service keys and private app tokens: pat-<region>-<UUID>. Every key the live runs used has this shape.
const KEY_SHAPE = /pat-[a-z0-9]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Whether `value` holds one of `keys`, the keys the run holds, or anything shaped like a HubSpot key. */
export function holdsKey(value: string, keys: readonly string[] = []): boolean {
  return KEY_SHAPE.test(value) || keys.some((key) => key !== '' && value.includes(key))
}
