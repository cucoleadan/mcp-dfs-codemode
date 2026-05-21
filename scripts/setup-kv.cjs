#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WRANGLER_CONFIG = path.join(__dirname, "..", "wrangler.jsonc");
const KV_BINDING_NAME = "CRED_CONFIG";
const KV_NAMESPACE_TITLE = "mcp-dfs-codemode-creds";

function run(cmd) {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

function main() {
  let raw = fs.readFileSync(WRANGLER_CONFIG, "utf-8");

  // Check if a valid KV ID already exists (not the placeholder)
  const currentId = raw.match(/"id":\s*"([^"]+)"/);
  if (currentId && currentId[1] !== "YOUR_KV_NAMESPACE_ID" && currentId[1].length > 5) {
    return; // already configured
  }

  console.log("🔧 Setting up CRED_CONFIG KV namespace...");

  // Look for existing namespace by title
  let nsId = null;
  const listJson = run("npx wrangler kv namespace list");
  if (listJson) {
    try {
      const list = JSON.parse(listJson);
      const found = list.find((n) => n.title === KV_NAMESPACE_TITLE);
      if (found) nsId = found.id;
    } catch {}
  }

  if (!nsId) {
    const output = run(`npx wrangler kv namespace create "${KV_NAMESPACE_TITLE}" 2>&1`);
    const match = output.match(/id\s*[:=]?\s*"?([a-f0-9]+)"?/i);
    if (match) nsId = match[1];
  }

  if (!nsId) {
    console.warn("⚠️  Could not create KV namespace. Multi-tenant mode will not be available.");
    return;
  }

  // Inject the real ID into wrangler.jsonc
  const kvBlock = [
    `  "kv_namespaces": [`,
    `    {`,
    `      "binding": "${KV_BINDING_NAME}",`,
    `      "id": "${nsId}"`,
    `    }`,
    `  ],`,
  ].join("\n");

  // Remove old kv_namespaces block if present
  raw = raw.replace(/^\s*"kv_namespaces":\s*\[[^\]]*\]\s*,?\s*/m, "");

  // Insert before worker_loaders
  raw = raw.replace(
    /(\s*)"worker_loaders":/,
    `$1${kvBlock}\n$1"worker_loaders":`,
  );

  fs.writeFileSync(WRANGLER_CONFIG, raw, "utf-8");
  console.log(`✅ CRED_CONFIG KV namespace ready (id: ${nsId})`);
}

main();
