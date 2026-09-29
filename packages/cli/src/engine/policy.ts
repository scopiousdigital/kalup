// A target's effective policy, as a plan records it and an approval binds it (ADR 0021). Pure.
import type { Target } from '@kalup/core'

export interface Policy {
  allowDestroy: boolean
  drift: 'hold' | 'overwrite'
  protected: boolean
}

/** The account types a target is not protected on unless config says so: test portals, sandboxes, app developers. */
const UNPROTECTED: ReadonlySet<string> = new Set(['DEVELOPER_TEST', 'SANDBOX', 'APP_DEVELOPER'])

/**
 * What config says, else the defaults: protected on every account type but a test portal, a sandbox and an app
 * developer account, so an unknown or new type is protected; drift held; destroys not allowed.
 */
export function policyOf(target: Target, accountType: string): Policy {
  return {
    protected: target.protected ?? !UNPROTECTED.has(accountType),
    drift: target.drift ?? 'hold',
    allowDestroy: target.allowDestroy ?? false,
  }
}
