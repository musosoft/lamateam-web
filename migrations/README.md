# Map ratings

`001-map-ratings.sql` is a manual, additive prerequisite for the ratings API.
An authorized operator must back up and verify the intended Turso database,
then apply this file with the existing database tooling before enabling the UI.
This change does not apply it locally or remotely. It can be reapplied; if a
table named `MapRatings` already exists, verify its schema matches first.
The composite primary key enforces one editable vote per map/Steam account.
Rollback the feature by removing its route/UI, retaining the table and votes;
do not drop stored ratings as part of an application rollback.

## API contract

- `GET /api/map-ratings`: `{ authenticated: boolean, ratings: [{ map, average, count, userRating }] }`
  for every catalog map, including unrated maps. `authenticated` is true when the
  caller has a verified Steam session; otherwise false. No identity is returned.
- `GET /api/map-ratings?map=de_dust2`: `{ authenticated: boolean, map, average, count, userRating }`.
  `authenticated` follows the same rule. No identity is returned.
- `POST /api/map-ratings`: JSON `{ map, stars }`, integer stars 1–5. Requires
  same-origin `Origin`, JSON content type, and verified Steam login. Returns the
  updated single-map aggregate (200); repeated votes update, not append.
- An unrated map has `average: null`, `count: 0`. `userRating` is null for
  anonymous callers or players who have not voted. Averages are not rounded.
- All responses are `private, no-store`. No identities are returned.
- 400: invalid input; 401: login required; 403: origin/CSRF failure; 415:
  non-JSON body; 503: database/config unavailable (including missing migration).

The legacy HTTP-only JSON cookie is unsigned and remains display-only. Steam
callback additionally issues `steam_auth`, an expiring HMAC cookie keyed by the
existing server-only Steam API key. Legacy sessions must sign in again once;
rotating that key invalidates rating sessions. No new deployment binding is
needed. Do not authorize votes using the legacy cookie, browser-provided
Steam IDs, player names, or User-Agent. Signed cookies must remain HTTP-only,
Secure and SameSite=Lax. HTTPS is required, including local login testing.

Focused offline tests (no secrets or network):

```sh
node --test src/lib/map-ratings.test.mjs src/lib/steam-session.test.mjs
pnpm typecheck
```
