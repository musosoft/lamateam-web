import { createPaymentQrPayload } from "./payment-qr.ts";

export interface QrPlatbaInput {
  iban: string;
  amount?: string;
  variableSymbol?: string;
  message?: string;
}

export interface EpcInput {
  beneficiary: string;
  iban: string;
  bic?: string;
  amount?: string;
  /** ISO 11649 RF structured creditor reference, not a Czech variable symbol. */
  reference?: string;
  /** Unstructured remittance; mutually exclusive with reference. */
  remittance?: string;
}

function validateKeys(input: unknown, allowed: string[]): void {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !allowed.includes(key))
  )
    throw new TypeError("Invalid bank QR input");
}

/** CZK SPD 1.0 payload. Omitted amount/VS/message remain absent, with no defaults.
 * Amount, if supplied, must be a positive decimal string (up to two decimals).
 * IBAN is uppercase electronic format with a validated length and checksum.
 * Invalid fields throw TypeError. Rendering and bank configuration belong to UI.
 */
export function buildQrPlatbaPayload(input: QrPlatbaInput): string {
  validateKeys(input, ["iban", "amount", "variableSymbol", "message"]);
  return createPaymentQrPayload({ ...input, currency: "CZK" });
}

/** EUR EPC BCD 002/SCT payload, UTF-8. Beneficiary is mandatory; BIC/amount
 * are optional. An omitted amount stays empty, never replaced by a fixed price.
 * Reference must be a checksum-valid RF reference, exclusive with remittance.
 * Invalid fields throw TypeError. No payment details or rendering are supplied.
 */
export function buildEpcPayload(input: EpcInput): string {
  validateKeys(input, [
    "beneficiary",
    "iban",
    "bic",
    "amount",
    "reference",
    "remittance",
  ]);
  return createPaymentQrPayload({
    currency: "EUR",
    recipientName: input.beneficiary,
    iban: input.iban,
    bic: input.bic,
    amount: input.amount,
    structuredReference: input.reference,
    remittance: input.remittance,
  });
}
