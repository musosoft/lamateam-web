const MAX_TEXTS = 50;
const MAX_CHARACTERS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;
const UPSTREAM_TIMEOUT_MS = 15_000;
// DeepL target codes use CS for Czech and UK for Ukrainian (not CZ/UA).
export const TARGET_LANGUAGES = new Set([
  "CS",
  "SK",
  "PL",
  "HU",
  "DE",
  "UK",
  "FR",
]);

interface TranslationSecurity {
  rateLimiter:
    | { limit(options: { key: string }): Promise<{ success: boolean }> }
    | undefined;
  development?: boolean;
}

function json(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

// Bound the actual stream, not just the optional/untrusted Content-Length.
async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

/** Server-only handler. The key must come from the Worker secret binding. */
export async function handleTranslationRequest(
  request: Request,
  apiKey: unknown,
  security: TranslationSecurity,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST") {
    return json({ error: "Use POST for translation requests." }, 405, {
      Allow: "POST",
    });
  }
  const url = new URL(request.url);
  // Browser-only endpoint: reject absent, null, and cross-origin Origins.
  if (request.headers.get("origin") !== url.origin) {
    return json({ error: "A same-origin request is required." }, 403);
  }
  // CF sets this header at ingress. Never trust X-Forwarded-For or client IDs.
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    (security.development &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ? "local-development"
      : undefined);
  if (!ip || !security.rateLimiter) {
    return json({ error: "Translation service is unavailable." }, 503);
  }
  try {
    const { success } = await security.rateLimiter.limit({
      key: `translate:${ip}`,
    });
    if (!success) {
      return json(
        { error: "Too many translation requests. Try again later." },
        429,
        {
          "Retry-After": "60",
        },
      );
    }
  } catch {
    // Fail closed if the binding cannot enforce the burst limit.
    return json({ error: "Translation service is unavailable." }, 503);
  }
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  let input: unknown;
  try {
    const body = await readBody(request);
    if (body === null) {
      return json({ error: "Request body exceeds 64 KiB." }, 413);
    }
    input = JSON.parse(body);
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json(
      { error: "Expected an object with texts and targetLang." },
      400,
    );
  }
  const { texts, targetLang } = input as Record<string, unknown>;
  if (typeof targetLang !== "string" || !TARGET_LANGUAGES.has(targetLang)) {
    return json(
      { error: "targetLang must be CS, SK, PL, HU, DE, UK, or FR." },
      400,
    );
  }
  if (
    !Array.isArray(texts) ||
    texts.length === 0 ||
    texts.length > MAX_TEXTS ||
    !texts.every(
      (text): text is string =>
        typeof text === "string" && text.trim().length > 0,
    )
  ) {
    return json({ error: "texts must contain 1–50 nonempty strings." }, 400);
  }
  // UTF-16 length is a conservative character budget (astral characters count twice).
  if (texts.reduce((total, text) => total + text.length, 0) > MAX_CHARACTERS) {
    return json(
      { error: "texts exceed the 10000-character batch limit." },
      413,
    );
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return json({ error: "Translation service is not configured." }, 503);
  }

  // DeepL's documented :fx suffix identifies Free keys; Pro keys have no suffix.
  const key = apiKey.trim();
  const endpoint = key.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: texts, target_lang: targetLang }),
      signal: controller.signal,
      // Workers do not implement "error"; fail closed on any manual redirect
      // so the Authorization header can never be forwarded to another origin.
      redirect: "manual",
    });
    if (!response.ok) {
      // Never return or log provider bodies, which may contain sensitive input.
      await response.body?.cancel();
      return json({ error: "Translation provider is unavailable." }, 502);
    }
    const result: unknown = await response.json();
    const translations =
      result && typeof result === "object"
        ? (result as Record<string, unknown>).translations
        : undefined;
    if (
      !Array.isArray(translations) ||
      translations.length !== texts.length ||
      !translations.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof item.text === "string" &&
          item.text.trim(),
      )
    ) {
      return json(
        { error: "Translation provider returned an invalid response." },
        502,
      );
    }
    return json({
      translations: translations.map((item) => item.text as string),
    });
  } catch {
    return controller.signal.aborted
      ? json({ error: "Translation provider timed out." }, 504)
      : json({ error: "Translation provider is unavailable." }, 502);
  } finally {
    clearTimeout(timeout);
  }
}
