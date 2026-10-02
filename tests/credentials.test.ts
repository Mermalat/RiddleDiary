import assert from "node:assert/strict";
import { test } from "node:test";
import { migrateApiKeys, persistedSettings, type SecretStore } from "../credentials";
import { loadSettings } from "../settings";
import { createProvider } from "../providers";

function store(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getSecret: id => values.get(id) ?? null, setSecret: (id, value) => { values.set(id, value); } };
}

test("legacy keys migrate to unique verified secret references and never serialize", () => {
  const settings = loadSettings(null);
  settings.providers.anthropic.apiKey = "fake-old-claude-key";
  settings.providers.openai.apiKey = "fake-old-openai-key";
  const secrets = store();
  secrets.setSecret("riddle-diary-openai", "another-vault-key");
  assert.equal(migrateApiKeys(settings, secrets), true);
  for (const id of ["anthropic", "openai"] as const) {
    assert.equal(settings.providers[id].apiKey, "");
    assert.match(settings.providers[id].secretId!, /^riddle-diary-[a-z]+-[a-f0-9-]+$/);
    assert.ok(secrets.getSecret(settings.providers[id].secretId!));
  }
  assert.equal(secrets.getSecret("riddle-diary-openai"), "another-vault-key");
  const saved = JSON.stringify(persistedSettings(settings));
  assert.ok(!saved.includes("fake-old") && !saved.includes('"apiKey"'));
  assert.equal(migrateApiKeys(settings, secrets), false);
  assert.equal(loadSettings(persistedSettings(settings)).providers.openai.secretId, settings.providers.openai.secretId);
});

test("partial migration failure keeps all legacy settings intact for retry", () => {
  const settings = loadSettings(null);
  settings.providers.anthropic.apiKey = "fake-one";
  settings.providers.openai.apiKey = "fake-two";
  const original = structuredClone(settings);
  const secrets = store();
  let writes = 0;
  const failing: SecretStore = { getSecret: secrets.getSecret, setSecret(id, value) {
    if (++writes === 2) throw new Error("unavailable");
    secrets.setSecret(id, value);
  } };
  assert.throws(() => migrateApiKeys(settings, failing));
  assert.deepEqual(settings, original);
});

test("unverified secret writes do not remove legacy keys", () => {
  const settings = loadSettings(null);
  settings.providers.openai.apiKey = "fake-legacy";
  assert.throws(() => migrateApiKeys(settings, { setSecret() {}, getSecret: () => null }), /verify/);
  assert.equal(settings.providers.openai.apiKey, "fake-legacy");
});

test("unrelated setting saves cannot serialize runtime credentials", () => {
  const settings = loadSettings(null);
  settings.providers.openai.apiKey = "fake-memory-only";
  settings.inkEffect = true;
  assert.ok(!JSON.stringify(persistedSettings(settings)).includes("fake-memory-only"));
  assert.equal(persistedSettings(settings).inkEffect, true);
  assert.equal(settings.providers.openai.apiKey, "fake-memory-only");
});

test("API requests resolve only the selected secret; missing storage fails without network or raw errors", async t => {
  const settings = loadSettings(null);
  settings.provider = "openai";
  settings.providers.openai.secretId = "selected-key";
  const secrets = store();
  secrets.setSecret("selected-key", "fake-secret-store-key");
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fake-secret-store-key");
    return new Response('data: {"type":"response.completed"}\n\n');
  });
  for await (const _text of createProvider(settings, secrets).streamReply([{ role: "user", content: "hello" }], "", new AbortController().signal)) { /* drain */ }
  t.mock.method(globalThis, "fetch", () => { assert.fail("must not call fetch without a stored key"); });
  for (const storage of [undefined, { setSecret() {}, getSecret() { throw new Error("raw-secret-error"); } }]) {
    await assert.rejects(async () => {
      for await (const _text of createProvider(settings, storage).streamReply([{ role: "user", content: "hello" }], "", new AbortController().signal)) { /* drain */ }
    }, error => error instanceof Error && error.message.includes("Add an API key") && !error.message.includes("raw-secret"));
  }
  settings.provider = "codex-cli";
  assert.equal(createProvider(settings, { setSecret() {}, getSecret() { assert.fail("CLI must not access API secrets"); } }).id, "codex-cli");
});
