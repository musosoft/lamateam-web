import type { DonationsEnv } from "../lib/donations-proxy";

// Separate from env.d.ts so existing, unrelated local binding changes stay intact.
declare global {
  namespace Cloudflare {
    interface Env extends DonationsEnv {}
  }
}
