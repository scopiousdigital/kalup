// The portal guard: the first request of every networked command. The pinned portalId must match the key's portal.
import type { HttpClient } from './http.js'
import { exitCodes, KalupError } from './output.js'
import { sanitize } from './sanitize.js'

export interface PortalInfo {
  portalId: number
  accountType: string
  uiDomain: string
  timeZone: string
}

export interface GuardTarget {
  name: string
  portalId: number
  /** The env variable the key came from, for the fix text. */
  variable: string
}

/** Reads account-info on the key and stops with exit 4 when its portal is not the pinned one. */
export async function guardPortal(http: HttpClient, target: GuardTarget): Promise<PortalInfo> {
  const details = await http.request<Record<string, unknown>>({ type: 'accountInfo', path: 'read' })
  const portalId = Number(details.portalId)
  if (portalId !== target.portalId) {
    throw new KalupError(
      {
        code: 'E_TARGET_PORTAL_MISMATCH',
        message: `The key in ${target.variable} belongs to portal ${portalId}, not portal ${target.portalId} pinned for target ${target.name}.`,
        configPath: `targets.${target.name}.portalId`,
        fix: `The key in ${target.variable} belongs to portal ${portalId}. Ask the user to check the key and the pinned portalId for target ${target.name}.`,
        humanRequired: true,
      },
      exitCodes.humanRequired,
    )
  }
  const info: PortalInfo = {
    portalId,
    accountType: sanitize(String(details.accountType ?? '')),
    uiDomain: sanitize(String(details.uiDomain ?? '')),
    timeZone: sanitize(String(details.timeZone ?? '')) || 'UTC',
  }
  http.timeZone = info.timeZone
  return info
}
