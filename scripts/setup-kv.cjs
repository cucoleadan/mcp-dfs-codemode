#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WRANGLER_CONFIG = path.join(__dirname, "..", "wrangler.jsonc");
const KV_NAME = "mcp-dfs-codemode-creds";

function run(cmd) {
  try { return execSync(cmd, { encoding: "utf-8", timeout: 15000 }).trim(); }
  catch { return ""; }
}

function main() {
  const raw = fs.readFileSync(WRANGLER_CONFIG, "utf-8");

  // Already configured? skip entirely.
  if (/"CRED_CONFIG"[^}]*"id":\s*"[a-f0-9]{10,}"/.test(raw)) {
    return;
  }

  console.log("🔧 Setting up CRED_CONFIG KV namespace...");

  // Find existing namespace by title
  let nsId = null;
  const listOut = run('npx wrangler kv namespace list --json 2>/dev/null || echo "[]"');
  try {
    const list = JSON.parse(listOut);
    const found = list.find((n) => n.title === KV_NAME);
    if (found) nsId = found.id;
  } catch {}

  if (!nsId) {
    const createOut = run(`npx wrangler kv namespace create "${KV_NAME}" 2>&1`);
    const m = createOut.match(/"id":\s*"([a-f0-9]+)"/);
    if (m) nsId = m[1];
  }

  if (!nsId) {
    console.warn("⚠️  Could not create CRED_CONFIG KV. Multi-tenant will be unavailable.");
    return;
  }

  // Inject ID into wrangler.jsonc
  const block = `"kv_namespaces": [
    { "binding": "CRED_CONFIG", "id": "${nsId}" }
  ],`;
  let updated = raw.replace(/^\s*"kv_namespaces":\s*\[[^\]]*\]\s*,?\s*/m, "");
  updated = updated.replace(/(\s*)"worker_loaders":/, `  $1${block}\n$1"worker_loaders":`);
  fs.writeFileSync(WRANGLER_CONFIG, updated, "utf-8");
  console.log(`✅ CRED_CONFIG KV ready (id: ${nsId})`);
}

main();
