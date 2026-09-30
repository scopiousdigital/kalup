// The live journeys' setup. Against the simulator (KALUP_LIVE_BACKEND=sim) nothing in the test process may reach a
// network: global fetch throws, and each run's client gets the simulator's fetch. Against HubSpot it does nothing; each
// journey reads the key when it opens its run.
import { simulated } from './live.js'

if (simulated) {
  globalThis.fetch = () => Promise.reject(new Error('KALUP_LIVE_BACKEND=sim: nothing reaches a network'))
}
