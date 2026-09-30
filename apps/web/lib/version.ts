import cli from '../../../packages/cli/package.json'

/**
 * The latest published version of `kalup`, from the npm registry. The answer goes through Next's fetch cache, which
 * vinext backs with Workers KV (kvDataAdapter in vite.config.ts), so the registry is asked at most once an hour. When
 * the registry is slow, down or answers something unexpected, this returns the version in packages/cli/package.json
 * as of the build, so a page never shows a blank or an error.
 */
export async function kalupVersion(): Promise<string> {
  try {
    const res = await fetch('https://registry.npmjs.org/kalup/latest', {
      // Pages that show the version set `revalidate = 3600` to match.
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) {
      return cli.version
    }
    const { version } = (await res.json()) as { version?: unknown }
    return typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version) ? version : cli.version
  } catch {
    return cli.version
  }
}
