// A target's effective policy, as a plan records it and an approval binds it. Pure.
import type { Target } from '@kalup/core'

export interface Policy {
  adopt: 'hold' | 'overwrite'
  allowDestroy: boolean
  drift: 'hold' | 'overwrite'
  protected: boolean
  yesLimit: number
}

/** --yes covers at most this many writes, adoptions and releases together, unless the target sets yesLimit. */
export const YES_LIMIT = 25

/** The account types a target is not protected on unless config says so: test portals, sandboxes, app developers. */
const UNPROTECTED: ReadonlySet<string> = new Set(['DEVELOPER_TEST', 'SANDBOX', 'APP_DEVELOPER'])

/**
 * What config says, else the defaults: protected on every account type but a test portal, a sandbox and an app
 * developer account, so an unknown or new type is protected; drift and first adoptions held; destroys not allowed;
 * --yes up to YES_LIMIT.
 */
export function policyOf(target: Target, accountType: string): Policy {
  return {
    protected: target.protected ?? !UNPROTECTED.has(accountType),
    drift: target.drift ?? 'hold',
    adopt: target.adopt ?? 'hold',
    allowDestroy: target.allowDestroy ?? false,
    yesLimit: target.yesLimit ?? YES_LIMIT,
  }
}
