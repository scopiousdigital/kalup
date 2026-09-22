// The portal guard: the first request of every networked command. The pinned portalId must match the key's portal.
import type { HttpClient } from './http.js'
import { exitCodes, KalupError } from './output.js'
import { sanitize } from './sanitize.js'

export interface PortalInfo {
  accountType: string
  portalId: number
  timeZone: string
  uiDomain: string
}

export interface GuardTarget {
  /** The target name. Absent for init, whose portal comes from --portal before any config exists. */
  name?: string
  portalId: number
  /** The env variable the key came from, for the fix text. */
  variable: string
}

/** Reads account-info on the key and stops with exit 4 when its portal is not the pinned one. */
export async function guardPortal(http: HttpClient, target: GuardTarget): Promise<PortalInfo> {
  const details = await http.request<Record<string, unknown>>({ type: 'accountInfo', path: 'read' })
  const portalId = Number(details.portalId)
  if (portalId !== target.portalId) {
    const { name, variable } = target
    const pin = name === undefined ? 'given by --portal. Nothing was written' : `pinned for target ${name}`
    throw new KalupError(
      {
        code: 'E_TARGET_PORTAL_MISMATCH',
        message: `The key in ${variable} belongs to portal ${portalId}, not portal ${target.portalId} ${pin}.`,
        ...(name === undefined ? {} : { configPath: `targets.${name}.portalId` }),
        fix:
          name === undefined
            ? `Ask the user to check the key in ${variable} and the Hub ID in --portal.`
            : `The key in ${variable} belongs to portal ${portalId}. Ask the user to check the key and the pinned portalId for target ${name}.`,
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
