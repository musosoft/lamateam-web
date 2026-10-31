/** Payloads only: no bank, exchange-rate, reference or rendering defaults.
 * Optional positive decimal string amounts only. Invalid input throws TypeError.
 */
export type PaymentQrInput = {
  iban: string;
  amount?: string;
} & (
  | { currency: "CZK"; variableSymbol?: string; message?: string }
  | {
      currency: "EUR";
      recipientName: string;
      bic?: string;
      purpose?: string;
      structuredReference?: string;
      remittance?: string;
      information?: string;
    }
);

function invalid(field: string): never {
  throw new TypeError(`Invalid payment QR ${field}`);
}

function text(value: unknown, field: string, max: number): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    [...value].length > max ||
    /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value)
  )
    invalid(field);
  return value;
}

function mod97(value: string): number {
  let remainder = 0;
  for (const char of value) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits)
      remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

function iban(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$/.test(value) ||
    mod97(value.slice(4) + value.slice(0, 4)) !== 1
  )
    invalid("IBAN");
  // Registered national lengths; do not accept checksum-valid truncated accounts.
  const lengths: Record<string, number> = {
    AD: 24,
    AE: 23,
    AL: 28,
    AT: 20,
    AZ: 28,
    BA: 20,
    BE: 16,
    BG: 22,
    BH: 22,
    BR: 29,
    BY: 28,
    CH: 21,
    CR: 22,
    CY: 28,
    CZ: 24,
    DE: 22,
    DK: 18,
    DO: 28,
    EE: 20,
    EG: 29,
    ES: 24,
    FI: 18,
    FO: 18,
    FR: 27,
    GB: 22,
    GE: 22,
    GI: 23,
    GL: 18,
    GR: 27,
    GT: 28,
    HR: 21,
    HU: 28,
    IE: 22,
    IL: 23,
    IQ: 23,
    IS: 26,
    IT: 27,
    JO: 30,
    KW: 30,
    KZ: 20,
    LB: 28,
    LC: 32,
    LI: 21,
    LT: 20,
    LU: 20,
    LV: 21,
    MC: 27,
    MD: 24,
    ME: 22,
    MK: 19,
    MR: 27,
    MT: 31,
    MU: 30,
    NL: 18,
    NO: 15,
    PK: 24,
    PL: 28,
    PS: 29,
    PT: 25,
    QA: 29,
    RO: 24,
    RS: 22,
    SA: 24,
    SC: 31,
    SE: 24,
    SI: 19,
    SK: 24,
    SM: 27,
    ST: 25,
    SV: 28,
    TL: 23,
    TN: 24,
    TR: 26,
    UA: 29,
    VA: 22,
    VG: 24,
    XK: 20,
  };
  if (lengths[value.slice(0, 2)] !== value.length)
    invalid("IBAN country/length");
  return value;
}

function amount(value: unknown, integerDigits: number): string {
  if (
    typeof value !== "string" ||
    !new RegExp(
      `^(?:0|[1-9][0-9]{0,${integerDigits - 1}})(?:\\.[0-9]{1,2})?$`,
    ).test(value)
  )
    invalid("amount");
  const [whole, fraction = ""] = value.split(".");
  const normalized = `${whole}.${fraction.padEnd(2, "0")}`;
  if (normalized === "0.00") invalid("amount");
  return normalized;
}

/** Stable UI entrypoint: supply operator-verified account/pricing data.
 * CZK: SPD 1.0, optional X-VS (1–10 digits) and MSG (60 characters).
 * EUR: EPC BCD 002/SCT, UTF-8, optional BIC; RF reference OR free remittance.
 * IBAN must be uppercase electronic format (no whitespace), valid checksum.
 */
export function createPaymentQrPayload(input: PaymentQrInput): string {
  if (!input || typeof input !== "object") invalid("input");
  const allowed = new Set([
    "currency",
    "iban",
    "amount",
    ...(input.currency === "CZK"
      ? ["variableSymbol", "message"]
      : [
          "recipientName",
          "bic",
          "purpose",
          "structuredReference",
          "remittance",
          "information",
        ]),
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) invalid("field");
  const account = iban(input.iban);
  if (input.currency === "CZK") {
    const fields = [
      "SPD",
      "1.0",
      `ACC:${account}`,
      ...(input.amount === undefined ? [] : [`AM:${amount(input.amount, 7)}`]),
      "CC:CZK",
    ];
    if (input.variableSymbol !== undefined) {
      if (
        typeof input.variableSymbol !== "string" ||
        !/^[0-9]{1,10}$/.test(input.variableSymbol)
      )
        invalid("variable symbol");
      fields.push(`X-VS:${input.variableSymbol}`);
    }
    if (input.message !== undefined) {
      const message = text(input.message, "message", 60);
      if (message.includes("*")) invalid("message");
      fields.push(`MSG:${message}`);
    }
    return fields.join("*");
  }
  if (input.currency !== "EUR") invalid("currency");
  const name = text(input.recipientName, "recipient name", 70);
  const bic = input.bic === undefined ? "" : text(input.bic, "BIC", 11);
  if (bic && !/^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(bic)) invalid("BIC");
  const purpose =
    input.purpose === undefined ? "" : text(input.purpose, "purpose", 4);
  if (purpose && !/^[A-Z]{4}$/.test(purpose)) invalid("purpose");
  const reference =
    input.structuredReference === undefined
      ? ""
      : text(input.structuredReference, "reference", 25);
  if (
    reference &&
    (!/^RF[0-9]{2}[A-Z0-9]{1,21}$/.test(reference) ||
      mod97(reference.slice(4) + reference.slice(0, 4)) !== 1)
  )
    invalid("reference");
  const remittance =
    input.remittance === undefined
      ? ""
      : text(input.remittance, "remittance", 140);
  if (reference && remittance) invalid("mutually exclusive remittance");
  const information =
    input.information === undefined
      ? ""
      : text(input.information, "information", 70);
  const lines = [
    "BCD",
    "002",
    "1",
    "SCT",
    bic,
    name,
    account,
    input.amount === undefined ? "" : `EUR${amount(input.amount, 9)}`,
    purpose,
    reference,
    remittance,
    information,
  ];
  while (lines.at(-1) === "") lines.pop();
  const payload = lines.join("\n");
  if (new TextEncoder().encode(payload).byteLength > 331)
    invalid("EPC byte limit");
  return payload;
}
