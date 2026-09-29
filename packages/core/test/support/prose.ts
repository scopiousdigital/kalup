// The words of every issue in a value, in order, so a test holds them as one inline snapshot while it asserts codes,
// lines and config paths directly. An issue is any object with a string code and message; a fix follows its message.
export function prose(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(prose)
  }
  if (value === null || typeof value !== 'object') {
    return []
  }
  const { code, message, fix } = value as Record<string, unknown>
  if (typeof code === 'string' && typeof message === 'string') {
    return [typeof fix === 'string' ? `${message} (fix: ${fix})` : message]
  }
  return Object.values(value).flatMap(prose)
}
