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

  // Check if a valid ID already exists
  const match = raw.match(/"CRED_CONFIG"[^}]*"id":\s*"([^"]+)"/);
  if (match && match[1].length > 5) return; // already set

  console.log("🔧 Setting up CRED_CONFIG KV namespace...");

  // Try to find existing namespace
  let nsId = null;
  const listOut = run("npx wrangler kv namespace list");
  const listMatch = listOut.match(new RegExp(`"${KV_NAME}"[^}]*"id":\\s*"([^"]+)"`));
  if (listMatch) nsId = listMatch[1];

  if (!nsId) {
    const createOut = run(`npx wrangler kv namespace create "${KV_NAME}"`);
    const createMatch = createOut.match(/"id":\s*"([a-f0-9]+)"/i);
    if (createMatch) nsId = createMatch[1];
  }

  if (!nsId) {
    console.warn("⚠️  Could not create KV namespace. Multi-tenant mode unavailable.");
    return;
  }

  // Inject into wrangler.jsonc
  const block = `"kv_namespaces": [\n    { "binding": "CRED_CONFIG", "id": "${nsId}" }\n  ],`;
  let updated = raw.replace(/^\s*"kv_namespaces":\s*\[[^\]]*\]\s*,?\s*/m, "");
  updated = updated.replace(/(\s*)"worker_loaders":/, `  $1${block}\n$1"worker_loaders":`);
  fs.writeFileSync(WRANGLER_CONFIG, updated, "utf-8");
  console.log(`✅ CRED_CONFIG KV ready (id: ${nsId})`);
}

main();
