/** Fixed, server-only donation bridge. Never forward browser headers or URLs. */
export interface DonationsEnv {
  DONATIONS_BACKEND_ORIGIN?: string;
  DONATIONS_PROXY_SECRET?: string;
  /** Exact PayPal business field configured in PHP; runtime-only, never guessed. */
  DONATIONS_PAYPAL_BUSINESS?: string;
  DONATIONS_CHECKOUT_RATE_LIMITER?: {
    limit(input: { key: string }): Promise<{ success: boolean }>;
  };
}

const PUBLIC_ORIGIN = "https://lamateam.eu";
const PAYPAL = "https://www.paypal.com/cgi-bin/webscr";
const IPN = `${PUBLIC_ORIGIN}/api/donations/ipn`;
const fieldsAllowed = new Set([
  "cmd",
  "business",
  "amount",
  "currency_code",
  "item_name",
  "item_number",
  "custom",
  "no_note",
  "no_shipping",
  "rm",
  "return",
  "notify_url",
  "cancel_return",
]);

function failure(status: number, message = "Checkout unavailable"): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(status === 405 ? { Allow: "POST" } : {}),
      },
    },
  );
}

async function bounded(
  stream: ReadableStream<Uint8Array> | null,
  max: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function upstreamOrigin(value: string | undefined): string {
  if (!value) throw new Error("Missing origin");
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname === "lamateam.eu" ||
    !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(url.hostname)
  ) {
    throw new Error("Invalid origin");
  }
  return url.origin;
}

function checkoutResponse(
  raw: Uint8Array,
  offer: string,
  payee: string,
): unknown {
  const data = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(raw),
  );
  const price = (
    { "1": "100.00", "6": "300.00", "12": "500.00" } as Record<string, string>
  )[offer];
  if (
    !data ||
    data.action !== PAYPAL ||
    typeof data.offerName !== "string" ||
    !data.offerName.trim() ||
    data.offerName.length > 120 ||
    data.amount !== price ||
    typeof data.steamId !== "string" ||
    !/^STEAM_0:[01]:[0-9]{1,10}$/.test(data.steamId) ||
    typeof data.estimatedExpiry !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+[0-9]{2}:[0-9]{2}$/.test(
      data.estimatedExpiry,
    ) ||
    !Number.isFinite(Date.parse(data.estimatedExpiry)) ||
    !data.fields ||
    typeof data.fields !== "object" ||
    Array.isArray(data.fields)
  )
    throw new Error("Invalid response");
  const fields = data.fields as Record<string, unknown>;
  if (
    Object.keys(fields).length !== fieldsAllowed.size ||
    Object.entries(fields).some(
      ([key, value]) =>
        !fieldsAllowed.has(key) ||
        typeof value !== "string" ||
        /[\x00-\x1f\x7f]/.test(value) ||
        value.length > 512,
    ) ||
    fields.cmd !== "_xclick" ||
    typeof fields.business !== "string" ||
    !fields.business.trim() ||
    fields.business !== payee ||
    fields.no_note !== "1" ||
    fields.no_shipping !== "1" ||
    fields.rm !== "2" ||
    fields.item_name !== data.offerName ||
    fields.currency_code !== "CZK" ||
    fields.amount !== price ||
    fields.notify_url !== IPN ||
    fields.item_number !== `reserve-${offer}` ||
    typeof fields.custom !== "string" ||
    !fields.custom.startsWith(`${data.steamId}|`) ||
    !new RegExp(
      `^STEAM_0:[01]:[0-9]{1,10}\\|[1-9][0-9]*\\|offer:${offer}$`,
    ).test(fields.custom) ||
    fields.return !== `${PUBLIC_ORIGIN}/vip` ||
    fields.cancel_return !== `${PUBLIC_ORIGIN}/vip`
  )
    throw new Error("Invalid fields");
  // Deliberately project, never pass upstream diagnostic or unrelated JSON through.
  return {
    action: PAYPAL,
    fields,
    offerName: data.offerName,
    amount: data.amount,
    steamId: data.steamId,
    estimatedExpiry: data.estimatedExpiry,
  };
}

export async function handleDonationProxy(
  request: Request,
  env: DonationsEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  const checkout = url.pathname === "/api/donations/checkout";
  if (!checkout && url.pathname !== "/api/donations/ipn")
    return failure(404, "Not found");
  if (url.search) return failure(400, "Invalid request");
  if (request.method !== "POST") return failure(405, "Method not allowed");
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(
      contentType,
    )
  )
    return failure(415, "Unsupported content type");
  if (
    checkout &&
    (url.origin !== PUBLIC_ORIGIN ||
      request.headers.get("origin") !== PUBLIC_ORIGIN ||
      (request.headers.has("sec-fetch-site") &&
        request.headers.get("sec-fetch-site") !== "same-origin"))
  )
    return failure(403, "Invalid origin");
  let origin: string;
  try {
    origin = upstreamOrigin(env.DONATIONS_BACKEND_ORIGIN);
    if (
      !env.DONATIONS_PROXY_SECRET ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(env.DONATIONS_PROXY_SECRET)
    )
      throw new Error("Missing secret");
    if (checkout) {
      // A trusted origin is not a substitute for pinning the payment recipient.
      // Match exactly; operators must provision the same identifier used by PHP.
      const payee = env.DONATIONS_PAYPAL_BUSINESS;
      if (
        typeof payee !== "string" ||
        payee.length > 254 ||
        /[\s\x00-\x1f\x7f]/.test(payee) ||
        !/^(?:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+|[A-Z0-9]{13})$/.test(payee)
      )
        return failure(503);
      // Cloudflare overwrites CF-Connecting-IP on public ingress. Never use XFF,
      // form fields or Astro clientAddress for this security boundary.
      const ip = request.headers.get("CF-Connecting-IP");
      if (
        !ip ||
        !/^[0-9a-f:.]{3,45}$/i.test(ip) ||
        !env.DONATIONS_CHECKOUT_RATE_LIMITER
      )
        return failure(503);
      if (
        !(
          await env.DONATIONS_CHECKOUT_RATE_LIMITER.limit({
            key: `checkout:${ip}`,
          })
        ).success
      )
        return failure(429, "Too many requests");
    }
  } catch {
    return failure(503);
  }
  const max = checkout ? 2048 : 65536;
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > max))
    return failure(413, "Request too large");
  let body: Uint8Array<ArrayBuffer>;
  let offer = "";
  try {
    body = await bounded(request.body, max);
    if (checkout) {
      const params = new URLSearchParams(
        new TextDecoder("utf-8", { fatal: true }).decode(body),
      );
      if (
        [...params.keys()].length !== 2 ||
        params.getAll("offer").length !== 1 ||
        params.getAll("steamid_user").length !== 1 ||
        !/^(1|6|12)$/.test(params.get("offer") ?? "") ||
        !params.get("steamid_user")?.trim() ||
        params.get("steamid_user")!.length > 200 ||
        /[\x00-\x1f\x7f]/.test(params.get("steamid_user")!)
      )
        return failure(400, "Invalid checkout");
      offer = params.get("offer")!;
    }
  } catch (error) {
    return failure(error instanceof RangeError ? 413 : 400, "Invalid request");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const upstream = await fetcher(
      `${origin}${checkout ? "/donations/checkout.php" : "/donations/scripts/ipn.php"}`,
      {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        body,
        headers: {
          "Content-Type": contentType,
          Accept: checkout ? "application/json" : "text/plain",
          "X-Donations-Proxy-Secret": env.DONATIONS_PROXY_SECRET!,
        },
      },
    );
    if (
      upstream.status < 200 ||
      upstream.status >= 600 ||
      (upstream.status >= 300 && upstream.status < 400)
    ) {
      await upstream.body?.cancel();
      return failure(502);
    }
    const raw = await bounded(upstream.body, checkout ? 16384 : 4096);
    const type = upstream.headers.get("content-type") ?? "";
    if (checkout) {
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))
        return failure(502);
      if (upstream.status !== 200)
        return failure(
          [400, 403, 405, 413, 415, 429, 503].includes(upstream.status)
            ? upstream.status
            : 502,
        );
      return Response.json(
        checkoutResponse(raw, offer, env.DONATIONS_PAYPAL_BUSINESS!),
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (!/^text\/plain(?:\s*;\s*charset=utf-8)?$/i.test(type))
      return failure(502);
    // Preserve status (including retryable failures), never reflect backend text,
    // cookies, redirects or diagnostics to PayPal/the public.
    return new Response(null, {
      status: upstream.status,
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return failure(502);
  } finally {
    clearTimeout(timer);
  }
}
