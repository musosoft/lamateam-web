const f = globalThis.fetch;

export default f;
export const fetch = f;

export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;

export const AbortError = class AbortError extends Error {
  constructor(message = "AbortError") {
    super(message);
    this.name = "AbortError";
  }
};

export const isRedirect = (code) =>
  code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
