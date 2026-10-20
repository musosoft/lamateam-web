import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = readFileSync(new URL("./sedliak.ts", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript,${encodeURIComponent(
  stripTypeScriptTypes(source, { mode: "transform" }),
)}`;
const { getSedliakReply } = await import(moduleUrl);

test("Sedliak answers matching Slovak and English game topics", () => {
  assert.match(
    getSedliakReply("Zase mi laguje server", "sk", () => 0) ?? "",
    /server|Ping|počítače/i,
  );
  assert.match(
    getSedliakReply("the server has terrible ping", "en", () => 0) ?? "",
    /server|ping/i,
  );
  assert.match(
    getSedliakReply("na tej mape", "sk", () => 0) ?? "",
    /map|mapa/i,
  );
  assert.match(
    getSedliakReply("my AWP missed again", "en", () => 0) ?? "",
    /weapon|gun|hand/i,
  );
  assert.match(
    getSedliakReply("V práci ma zase nahneval šéf", "sk", () => 0) ?? "",
    /práce|šatni|Šéf/i,
  );
  assert.match(
    getSedliakReply("my girlfriend says I play too much", "en", () => 0) ?? "",
    /relationships|miss you/i,
  );
});

test("unmatched chat stays silent and reply selection is bounded", () => {
  assert.equal(getSedliakReply("good morning everyone", "en"), null);
  assert.ok(getSedliakReply("rank discussion", "en", () => 0.999));
});

test("unsupported site locales receive English, while Slovak is preserved", () => {
  assert.match(getSedliakReply("lag", "de", () => 0) ?? "", /server|ping/i);
  assert.match(
    getSedliakReply("lag", "sk", () => 0) ?? "",
    /server|Ping|počítače/i,
  );
});
