import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { buildQrPlatbaPayload } from "../src/lib/bank-qr.ts";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const component = read("src/components/VipPayment.astro");
const execute = (source, context) =>
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    context,
  );

test("VIP payment copy is complete and localized across all existing locales", () => {
  const context = { exports: {} };
  execute(read("src/lib/vip-copy.ts"), context);
  const locales = ["en", "cs", "sk", "pl", "hu", "de", "uk", "fr"];
  const english = context.exports.vipCopy("en");
  for (const locale of locales) {
    const copy = context.exports.vipCopy(locale);
    assert.equal(Object.keys(copy).length, 23);
    assert.ok(
      Object.values(copy).every(
        (value) => typeof value === "string" && value.trim(),
      ),
    );
    if (locale !== "en") assert.notEqual(copy.notice, english.notice);
    assert.match(copy.bank, /CZK/);
    assert.match(copy.paypal, /CZK/);
  }
});

test("bank fallback, accessible QR and existing VIP content are retained", () => {
  const page = read("src/pages/vip.astro");
  assert.match(component, /1939775153\/0800/);
  assert.match(component, /CZ88 0800 0000 0019 3977 5153/);
  assert.match(component, /data-copy="CZ8808000000001939775153"/);
  assert.match(component, /canvas role="img" aria-label/);
  assert.match(component, /<noscript>/);
  assert.match(component, /margin: 4/);
  assert.doesNotMatch(component, /https?:[^'"\s]*(?:qr|chart)/i);
  assert.doesNotMatch(component, /currency.*EUR|EPC|recipientName/);
  assert.match(page, /supporters\.map/);
  assert.match(page, /connect 82\.208\.17\.101:27516/);
  assert.match(page, /<VipPayment locale=\{locale\}/);
});

function node(extra = {}) {
  return {
    hidden: false,
    disabled: true,
    textContent: "",
    dataset: {},
    events: {},
    addEventListener(name, handler) {
      this.events[name] = handler;
    },
    setAttribute() {},
    removeAttribute() {},
    focus() {
      this.focused = true;
    },
    reportValidity() {
      return true;
    },
    ...extra,
  };
}

test("client keeps QR local, invalidates changed inputs and reviews PayPal before navigation", async () => {
  const bankButton = node();
  const bank = node({
    values: { amount: "100", nickname: "Test player" },
    querySelector: () => bankButton,
  });
  const submit = node();
  const checkout = node({
    values: { steamId: "STEAM_0:1:123", months: "6" },
    querySelector: () => submit,
  });
  const method = { value: "bank" };
  const picker = node({ querySelector: () => method });
  const panels = ["bank", "paypal"].map((value) =>
    node({ dataset: { method: value } }),
  );
  const canvas = node({ getContext: () => ({ drawImage() {} }) });
  const qrResult = node({ querySelector: () => canvas });
  const summary = node();
  const status = node();
  const qrStatus = node();
  const continueButton = node();
  const reviewFields = [
    "offerName",
    "amount",
    "steamId",
    "estimatedExpiry",
  ].map((key) => node({ dataset: { review: key } }));
  const review = node({ querySelectorAll: () => reviewFields });
  const nodes = {
    ".method-picker": picker,
    "#reserve-review": review,
    "#reserve-form": checkout,
    "#reserve-status": status,
    "#reserve-continue": continueButton,
    "#bank-qr-form": bank,
    "[data-qr-result]": qrResult,
    "[data-qr-status]": qrStatus,
    "[data-qr-summary]": summary,
  };
  const root = node({
    dataset: {
      qrError: "QR error",
      loading: "Loading",
      error: "Checkout error",
    },
    querySelector: (selector) => nodes[selector],
    querySelectorAll: (selector) =>
      selector === "[data-method]" ? panels : [],
  });
  let qrInput;
  let qrPayload;
  let request;
  let navigationCount = 0;
  let fetchCount = 0;
  const fields = {
    cmd: "_xclick",
    business: "merchant@example.invalid",
    item_name: "VIP",
    item_number: "reserve-6",
    amount: "300.00",
    currency_code: "CZK",
    custom: "target",
    notify_url: "https://example.invalid/ipn",
    return: "https://example.invalid/return",
    cancel_return: "https://example.invalid/cancel",
    no_shipping: "1",
    no_note: "1",
    rm: "2",
  };
  const response = {
    action: "https://www.paypal.com/cgi-bin/webscr",
    fields,
    offerName: "6 months",
    amount: "300.00",
    steamId: "STEAM_0:1:123",
    estimatedExpiry: "2027-05-02T00:00:00Z",
  };
  const context = {
    document: {
      querySelector: () => root,
      addEventListener() {},
      createElement: () => node({ appendChild() {} }),
      body: { appendChild() {} },
    },
    QRCode: {
      async toCanvas(_canvas, payload) {
        qrPayload = payload;
      },
    },
    buildQrPlatbaPayload(input) {
      qrInput = input;
      assert.equal(typeof input.amount, "string");
      return buildQrPlatbaPayload(input);
    },
    FormData: class {
      constructor(form) {
        this.values = { ...form.values };
      }
      get(key) {
        return this.values[key];
      }
    },
    URLSearchParams,
    AbortSignal,
    fetch: async (url, options) => {
      fetchCount++;
      request = { url, options };
      return {
        ok: true,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify(response),
      };
    },
    HTMLFormElement: class {
      submit() {
        navigationCount++;
      }
    },
  };
  const script = component
    .match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/^\s*import .*?;\s*$/gm, "");
  execute(script, context);
  const event = { preventDefault() {} };
  assert.equal(picker.hidden, false);
  assert.equal(panels[0].hidden, false);
  assert.equal(panels[1].hidden, true);
  assert.equal(bankButton.disabled, false);
  // Exercise the real helper: each selected package must render its own payload,
  // not just pass a permissive stub that silently accepts numeric amounts.
  for (const amount of ["100", "300", "500"]) {
    bank.values.amount = amount;
    bank.events.input();
    await bank.events.submit(event);
    assert.equal(qrInput.iban, "CZ8808000000001939775153");
    assert.equal(qrInput.amount, amount);
    assert.equal(qrInput.message, "Test player");
    assert.equal(
      qrPayload,
      `SPD*1.0*ACC:CZ8808000000001939775153*AM:${amount}.00*CC:CZK*MSG:Test player`,
    );
    assert.equal(qrResult.hidden, false);
    assert.equal(qrStatus.textContent, "");
    assert.equal(summary.textContent, `${amount} CZK · Test player`);
  }
  assert.equal(fetchCount, 0);
  bank.events.input();
  assert.equal(qrResult.hidden, true);
  method.value = "paypal";
  picker.events.change();
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);
  await checkout.events.submit(event);
  assert.equal(request.url, "/api/donations/checkout");
  assert.equal(request.options.body.get("offer"), "6");
  assert.equal(request.options.body.get("steamid_user"), "STEAM_0:1:123");
  assert.equal(review.hidden, false);
  assert.equal(navigationCount, 0);
  checkout.events.input();
  continueButton.events.click();
  assert.equal(navigationCount, 0);
  await checkout.events.submit(event);
  continueButton.events.click();
  assert.equal(navigationCount, 1);
  response.fields.amount = "500.00";
  await checkout.events.submit(event);
  assert.equal(review.hidden, true);
  assert.equal(status.textContent, "Checkout error");
});
