# VIP payment UI integration gates

- The UI imports `buildQrPlatbaPayload({ iban, amount?, variableSymbol?, message? })`
  from the implemented `src/lib/bank-qr.ts` helper. The selected CZK package
  supplies a validated decimal string (`"100"`, `"300"` or `"500"`) and the player's
  nickname as the remittance message. The helper validates/encodes the payload;
  the UI renders it locally with `qrcode`, without a remote QR API.
- Local QR generation and the real-helper runtime regression pass. The regression
  in `tests/vip-payment.test.mjs` verifies that each selected package passes a
  string amount to the actual helper and renders the corresponding payload.
- PayPal uses the contract inspected in commit `1904fea`: POST
  `/api/donations/checkout` with `steamid_user` and `offer` (1/6/12), then validate
  the returned `action`, `fields`, `offerName`, `amount`, `steamId` and
  `estimatedExpiry`. Only the separate continuation button posts to PayPal.
  The checkout and IPN API routes and `src/lib/donations-proxy.ts` are restored.
  Production deployment is live at 100% on Worker version
  `d03eefc7-e205-4911-b32c-2c09d7ecf814`; `/vip` returns 200 with PayPal and CZK
  QR. Checkout/IPN GETs return 405 with `Allow: POST`, and `/donations` returns
  404. No checkout POST, IPN delivery, or payment/activation was exercised.
- Cloudflare runtime configuration requires `DONATIONS_BACKEND_ORIGIN`,
  `DONATIONS_PROXY_SECRET` and `DONATIONS_PAYPAL_BUSINESS`, provisioned as Worker
  secrets, plus the `DONATIONS_CHECKOUT_RATE_LIMITER` binding for checkout. All
  three production secret names and the rate-limit binding are present; values
  remain undisclosed.
  Never commit or expose their values in client code or logs.
- EUR QR is deferred by user choice; no EUR payment UI is exposed. Current bank
  research lists incoming EUR SEPA transfers to Česká spořitelna (0800) as free,
  with conversion using the exchange rate at credit. Fixed EUR package pricing
  and the beneficiary's exact account-holder name are not configured. Any future
  EUR UI requires those verified details; do not infer an EUR price from CZK.
- Follow-up QA: complete QR decoding verification and inspect desktop/narrow
  layouts. Browser QA was blocked by the WSL/Windows CDP vsock timeout; no
  screenshot review completed. Test the review flow only against a configured
  non-production checkout; do not send a real payment during UI verification.
- QR generation/scanning and opening PayPal are not payment confirmations. The
  UI deliberately makes no paid/active claim; the server confirms activation.
