# Donations proxy (deployed 2026-10-23)

Server routes live under `src/pages/api/donations/`; `src/lib/donations-proxy.ts`
owns fixed destinations, validation, secret injection, byte bounds and deadline.
`src/pages/donations/[...path].ts` denies the old standalone public surface.

Required Worker secrets (no `PUBLIC_` prefix): `DONATIONS_BACKEND_ORIGIN` and
`DONATIONS_PROXY_SECRET`. Missing secrets or checkout rate-limit binding fail
closed. `DONATIONS_BACKEND_ORIGIN` must be a dedicated HTTPS origin with matching
TLS/SNI and **no Worker route or Custom Domain**, never `https://lamateam.eu`.
Do not put these values in committed Wrangler vars, frontend code or logs.
Namespace 1002 is the checkout-only per-colo limiter (6/minute/trusted CF IP).

Checkout accepts URL-encoded `offer` (1/6/12) and `steamid_user` only, from Origin
`https://lamateam.eu`. It returns the authoritative PHP JSON PayPal form contract.
The UI submits those fields to PayPal itself; this endpoint never sends payment.
Notify URL is always `https://lamateam.eu/api/donations/ipn`. IPN forwarding is
raw-byte exact and not browser-origin checked/rate-limited. Neither API follows
redirects or reflects upstream diagnostics/cookies.

The companion PHP checkout contains the operator plan and Apache/FPM templates:
`donations-control-pp/deploy/proxy/README.md`. The compatible PHP gate and
dedicated origin are deployed, and the exact old `banlist.lamateam.eu` IPN path
is relayed to this Worker without exposing the proxy secret. The standalone
donations page is blocked. Safe GET/non-POST checks passed; no checkout/IPN POST
or payment test was sent. The recovered PHP snapshot has no original full test
suite, so deployment validation used 53 PHP syntax checks and 99 focused offline
proxy/legacy-IPN assertions; see the PHP rollout notes for limitations. Cloudflare
has an exact POST-only, empty-query WAF exception for the two API endpoints and
the historical banlist IPN URL; the Worker checkout limiter and PHP/PayPal
validation remain in force. The missing `custom_chatcolors` and
`promotions_redeemed` InnoDB tables were added, with application access scoped to
those tables; PHP's `FixedOffers::ready()` now passes. The `/vip` form also
reinitializes on Astro ClientRouter page loads, so navigating away and back does
not leave its submit button disabled.

Offline checks: `node --test src/lib/donations-proxy.test.mjs`, `pnpm typecheck`.
