import assert from "node:assert/strict";
import test from "node:test";
import { createPaymentQrPayload as qr } from "./payment-qr.ts";

// Synthetic checksum-valid account/reference fixtures, not payment destinations.
function checked(prefix, tail) {
  const numeric = (tail + prefix + "00").replace(/[A-Z]/g, (c) =>
    String(c.charCodeAt(0) - 55),
  );
  return prefix + String(98n - (BigInt(numeric) % 97n)).padStart(2, "0") + tail;
}
const iban = checked("CZ", "00000000000000000001");
const cz = { currency: "CZK", iban, amount: "123.4" };
const eu = {
  currency: "EUR",
  iban,
  amount: "7.89",
  recipientName: "Test recipient",
};

test("SPD has explicit CZK amount, optional message/VS and no invented defaults", () => {
  assert.equal(qr(cz), `SPD*1.0*ACC:${iban}*AM:123.40*CC:CZK`);
  assert.equal(
    qr({
      ...cz,
      amount: "0.01",
      variableSymbol: "000123",
      message: "Příspěvek",
    }),
    `SPD*1.0*ACC:${iban}*AM:0.01*CC:CZK*X-VS:000123*MSG:Příspěvek`,
  );
  assert.match(
    qr({
      ...cz,
      amount: "9999999.99",
      message: "x".repeat(60),
      variableSymbol: "9".repeat(10),
    }),
    /AM:9999999\.99/,
  );
});

test("EPC uses BCD 002 UTF-8/SCT, preserves internal blank lines, omits trailing blanks", () => {
  assert.deepEqual(qr(eu).split("\n"), [
    "BCD",
    "002",
    "1",
    "SCT",
    "",
    "Test recipient",
    iban,
    "EUR7.89",
  ]);
  const fields = qr({
    ...eu,
    bic: "AAAAZZ00XXX",
    amount: "999999999.99",
    purpose: "CHAR",
    remittance: "Test payment",
    information: "Information",
  }).split("\n");
  assert.equal(fields[4], "AAAAZZ00XXX");
  assert.equal(fields[8], "CHAR");
  assert.equal(fields[9], "");
  assert.equal(fields[10], "Test payment");
  assert.equal(fields[11], "Information");
  const reference = checked("RF", "123456789");
  assert.equal(
    qr({ ...eu, structuredReference: reference }).split("\n")[9],
    reference,
  );
});

test("amounts reject floats, signs, zero, exponent, commas, leading zeros and precision/size overflow", () => {
  for (const value of [
    null,
    1.23,
    "",
    "0",
    "0.00",
    "-1",
    "+1",
    "1e2",
    "01",
    "1,00",
    "1.234",
    "1.",
    ".01",
    " 1",
    "1\n",
  ]) {
    for (const input of [cz, eu])
      assert.throws(
        () => qr({ ...input, amount: value }),
        TypeError,
        String(value),
      );
  }
  assert.throws(() => qr({ ...cz, amount: "10000000" }), TypeError);
  assert.throws(() => qr({ ...eu, amount: "1000000000" }), TypeError);
  assert.match(qr({ ...eu, amount: "1" }), /EUR1\.00$/);
});

test("invalid IBAN, currency and unexpected fields fail closed", () => {
  for (const account of [
    undefined,
    "",
    iban.toLowerCase(),
    iban + " ",
    iban.slice(0, -1) + "2",
    checked("CZ", "000000000000000001"),
    checked("ZZ", "00000000000000000001"),
  ])
    assert.throws(() => qr({ ...cz, iban: account }), TypeError);
  for (const input of [
    null,
    {},
    { ...cz, currency: "USD" },
    { ...eu, variableSymbol: "123" },
    { ...cz, recipientName: "No" },
  ])
    assert.throws(() => qr(input), TypeError);
});

test("SPD field boundaries and delimiter/control injection are rejected", () => {
  for (const variableSymbol of ["", "1".repeat(11), 123, "-1", "1*AM:1", "1\n"])
    assert.throws(() => qr({ ...cz, variableSymbol }), TypeError);
  for (const message of [
    "",
    " ",
    "x".repeat(61),
    "x*CC:EUR",
    "x\n",
    "x\r",
    "x\0",
    "x\u2028",
    "x\u202e",
  ])
    assert.throws(() => qr({ ...cz, message }), TypeError);
});

test("EPC field lengths, RF checksum, mutual exclusion and UTF-8 331-byte limit", () => {
  for (const change of [
    { recipientName: undefined },
    { recipientName: "" },
    { recipientName: "x".repeat(71) },
    { bic: "" },
    { bic: "abcdcz00" },
    { bic: "AAAAZZ000" },
    { purpose: "ABC" },
    { structuredReference: "RF00123" },
    { structuredReference: checked("RF", "1".repeat(22)) },
    { structuredReference: checked("RF", "123"), remittance: "Both" },
    { remittance: "x".repeat(141) },
    { information: "x".repeat(71) },
    { remittance: "inject\nfield" },
    { recipientName: "x\u0085" },
    { recipientName: "é".repeat(70), remittance: "é".repeat(140) },
  ])
    assert.throws(
      () => qr({ ...eu, ...change }),
      TypeError,
      JSON.stringify(change),
    );
  assert.ok(
    qr({ ...eu, recipientName: "x".repeat(70), remittance: "x".repeat(140) }),
  );
  assert.ok(qr({ ...eu, information: "x".repeat(70) }));
  assert.equal(qr({ ...eu, information: "Tail" }).split("\n")[11], "Tail");
  const boundary = {
    ...eu,
    recipientName: "x".repeat(70),
    remittance: "x".repeat(140),
    information: "x".repeat(69),
  };
  assert.equal(new TextEncoder().encode(qr(boundary)).byteLength, 331);
  assert.throws(
    () => qr({ ...boundary, information: "x".repeat(70) }),
    TypeError,
  );
});
