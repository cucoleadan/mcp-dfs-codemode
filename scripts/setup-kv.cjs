#!/usr/bin/env node
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WRANGLER_CONFIG = path.join(__dirname, "..", "wrangler.jsonc");
const KV_NAME = "mcp-dfs-codemode-creds";

function main() {
  const raw = fs.readFileSync(WRANGLER_CONFIG, "utf-8");

  // Already has a real ID? skip
  if (/"binding":\s*"CRED_CONFIG"[,\s\S]*?"id":\s*"([a-f0-9]{5,})"/.test(raw)) {
    return;
  }

  // Try Cloudflare API directly using available token
  const token = process.env.CLOUDFLARE_API_TOKEN || "";
  const acctId = process.env.CLOUDFLARE_ACCOUNT_ID || "";
  let nsId = null;

  if (token && acctId) {
    try {
      const out = execSync(
        `curl -sf "https://api.cloudflare.com/client/v4/accounts/${acctId}/storage/kv/namespaces?per_page=100" -H "Authorization: Bearer ${token}"`,
        { encoding: "utf-8", timeout: 10000 },
      );
      const list = JSON.parse(out);
      const found = (list.result || []).find((n) => n.title === KV_NAME);
      if (found) nsId = found.id;
    } catch {}
  }

  if (!nsId) {
    // Fall back to wrangler CLI
    try {
      const out = execSync("npx wrangler kv namespace list", { encoding: "utf-8", timeout: 15000 });
      const parsed = JSON.parse(out);
      const found = (Array.isArray(parsed) ? parsed : []).find((n) => n.title === KV_NAME);
      if (found) nsId = found.id;
    } catch {}

    if (!nsId) {
      try {
        const out = execSync(`npx wrangler kv namespace create "${KV_NAME}"`, { encoding: "utf-8", timeout: 15000 });
        const m = out.match(/id[:\s=]+"?([a-f0-9]+)"?/i);
        if (m) nsId = m[1];
      } catch {}
    }
  }

  if (!nsId) return;

  const block = `"kv_namespaces": [\n    { "binding": "CRED_CONFIG", "id": "${nsId}" }\n  ],`;
  let updated = raw.replace(/^\s*"kv_namespaces":\s*\[[^\]]*\]\s*,?\s*/m, "");
  updated = updated.replace(/(\s*)"worker_loaders":/, `  $1${block}\n$1"worker_loaders":`);
  fs.writeFileSync(WRANGLER_CONFIG, updated, "utf-8");
  console.log(`✅ KV CRED_CONFIG ready (id: ${nsId})`);
}

main();
