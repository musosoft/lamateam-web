import assert from "node:assert/strict";
import test from "node:test";
import { buildQrPlatbaPayload, buildEpcPayload } from "./bank-qr.ts";

// Synthetic account/reference fixtures, not payment destinations.
function checked(prefix, tail) {
  const numeric = (tail + prefix + "00").replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  return prefix + String(98n - (BigInt(numeric) % 97n)).padStart(2, "0") + tail;
}
const iban = checked("CZ", "00000000000000000001");

test("named SPD builder omits unspecified amount and VS, preserves explicit fields", () => {
  assert.equal(buildQrPlatbaPayload({ iban }), `SPD*1.0*ACC:${iban}*CC:CZK`);
  assert.equal(
    buildQrPlatbaPayload({
      iban,
      amount: "42.5",
      variableSymbol: "00123",
      message: "Test",
    }),
    `SPD*1.0*ACC:${iban}*AM:42.50*CC:CZK*X-VS:00123*MSG:Test`,
  );
});

test("named EPC builder maps beneficiary and leaves unspecified amount/BIC empty", () => {
  assert.deepEqual(buildEpcPayload({ beneficiary: "Test", iban }).split("\n"), [
    "BCD",
    "002",
    "1",
    "SCT",
    "",
    "Test",
    iban,
  ]);
  const lines = buildEpcPayload({
    beneficiary: "Test",
    iban,
    remittance: "Test remittance",
  }).split("\n");
  assert.equal(lines[7], "");
  assert.equal(lines[8], "");
  assert.equal(lines[9], "");
  assert.equal(lines[10], "Test remittance");
  const reference = checked("RF", "123");
  const full = buildEpcPayload({
    beneficiary: "Test",
    iban,
    bic: "AAAAZZ00",
    amount: "0.01",
    reference,
  }).split("\n");
  assert.equal(full[4], "AAAAZZ00");
  assert.equal(full[7], "EUR0.01");
  assert.equal(full[9], reference);
});

test("named builders reject invalid explicit values and do not silently ignore fields", () => {
  for (const amount of [null, 12, "", "0", "-1", "1.234"]) {
    assert.throws(() => buildQrPlatbaPayload({ iban, amount }), TypeError);
    assert.throws(
      () => buildEpcPayload({ beneficiary: "Test", iban, amount }),
      TypeError,
    );
  }
  for (const input of [
    null,
    [],
    {},
    { iban: "invalid" },
    { iban, variableSymbol: "1".repeat(11) },
    { iban, message: "*AM:1" },
    { iban, currency: "EUR" },
  ])
    assert.throws(() => buildQrPlatbaPayload(input), TypeError);
  for (const input of [
    null,
    [],
    { iban },
    { iban, beneficiary: "" },
    { iban, beneficiary: "Bad\nname" },
    { iban, beneficiary: "Test", reference: "123" },
    {
      iban,
      beneficiary: "Test",
      reference: checked("RF", "123"),
      remittance: "Both",
    },
    { iban, beneficiary: "Test", variableSymbol: "123" },
  ])
    assert.throws(() => buildEpcPayload(input), TypeError);
});
