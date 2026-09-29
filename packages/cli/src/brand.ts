// The brand lives here only, so a rename never touches the rest of the CLI. Pure constants: engine code names the CLI
// through this module, and the engine never reads the disk. The version comes from package.json, in version.ts.

export const bin = 'kalup'

export const disclaimer =
  'Kalup is an independent open-source project maintained by Scopious. It is not affiliated with, endorsed by, or sponsored by HubSpot, Inc. HubSpot is a registered trademark of HubSpot, Inc.'
