import { codeMcpServer } from "@cloudflare/codemode/mcp";
import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { DataForSEOClient, buildBasicAuthHeader } from "../core/client/dataforseo.client.js";
import { EnabledModulesSchema } from "../core/config/modules.config.js";
import { BaseModule, ToolDefinition } from "../core/modules/base.module.js";
import { ModuleLoaderService } from "../core/utils/module-loader.js";
import { version, name } from "./version.worker.js";

globalThis.__PACKAGE_VERSION__ = version;
globalThis.__PACKAGE_NAME__ = name;

const SERVER_NAME = `${name} (Codemode)`;

const MODULE_LABELS: Record<string, string> = {
  AiOptimizationApiModule: "AI Optimization", SerpApiModule: "SERP",
  KeywordsDataApiModule: "Keywords Data", OnPageApiModule: "OnPage",
  DataForSEOLabsApi: "DataForSEO Labs", BacklinksApiModule: "Backlinks",
  BusinessDataApiModule: "Business Data", DomainAnalyticsApiModule: "Domain Analytics",
  ContentAnalysisApiModule: "Content Analysis", MerchantApiModule: "Merchant",
};

function buildToolRegistryDescription(modules: BaseModule[]): string {
  const lines: string[] = [];
  modules.forEach((m) => {
    const label = MODULE_LABELS[m.constructor.name] || m.constructor.name;
    const names = Object.keys(m.getTools()).filter((n) => /^(?!.*_(?:locations?|filters?|models?)$)/.test(n));
    if (names.length > 0) lines.push(`  ${label}: ${names.join(", ")}`);
  });
  return lines.join("\n");
}

function createClient(login: string, password: string): DataForSEOClient {
  return new DataForSEOClient({ authHeader: buildBasicAuthHeader(login, password) });
}

function createUpstreamMcpServer(modules: BaseModule[]): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });
  modules.forEach((m) => {
    Object.entries(m.getTools()).forEach(([name, tool]) => {
      const t = tool as ToolDefinition;
      server.tool(name, t.description, z.object(t.params).shape, t.handler);
    });
    Object.entries(m.getPrompts()).forEach(([name, p]) => {
      server.registerPrompt(name, { description: p.description, argsSchema: p.params }, p.handler);
    });
  });
  return server;
}

function getModules(login: string, password: string, modulesFilter: string | null): BaseModule[] {
  return ModuleLoaderService.loadModules(createClient(login, password), EnabledModulesSchema.parse(modulesFilter));
}

function getKV(env: Env): KVNamespace | undefined {
  return (env as unknown as Record<string, unknown>).CRED_CONFIG as KVNamespace | undefined;
}

function jsonError(code: number, message: string, status: number): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "Content-Type": "application/json" } });
}

interface TokenEntry { username: string; password: string; name: string; created_at: string; expires_at: string | null; }

function genToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return "sk-" + btoa(String.fromCharCode(...buf)).replace(/[+/=]/g, "").slice(0, 40);
}
function expired(e: TokenEntry): boolean { return !!e.expires_at && new Date(e.expires_at).getTime() < Date.now(); }
function h(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function adminUI(baseUrl: string, tokens: Array<{ token: string; entry: TokenEntry }>, adminToken: string): string {
  const q = adminToken ? `?token=${adminToken}` : "";
  const rows = tokens.map(t => {
    const e = t.entry.expires_at;
    let expD = "Never";
    if (e) expD = expired(t.entry) ? `<span class="bad">Expired ${new Date(e).toLocaleDateString()}</span>` : new Date(e).toLocaleDateString();
    return `<tr>
      <td><b>${h(t.entry.name)}</b><br><code>${h(t.token.slice(0, 18))}…</code></td>
      <td>${h(t.entry.username)}</td><td>${expD}</td>
      <td><span class="chip ${expired(t.entry) ? 'bad' : 'ok'}">${expired(t.entry) ? 'expired' : 'active'}</span></td>
      <td>
        <button class="b s" onclick="cp('${h(t.token)}')">Copy URL</button>
        <button class="b s o" onclick="del('${h(t.token)}')">Delete</button>
      </td></tr>`;
  }).join("");

  return `<!DOCTYPE html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP DFS Codemode</title><style>
:root{--bg:#09090b;--c1:#18181b;--b:#27272a;--m:#3f3f46;--f:#fafafa;--f2:#a1a1aa;--p:#3b82f6;--p2:#1d4ed8;--r:#ef4444;--g:#22c55e;--y:#f59e0b}
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--f);margin:0;min-height:100vh}
.n{background:var(--c1);border-bottom:1px solid var(--b);padding:0 20px;display:flex;align-items:center;height:52px;gap:12px}
.n h1{font-size:.95rem;font-weight:600;margin:0}.n span{color:var(--f2);font-size:.78rem}
.m{max-width:900px;margin:0 auto;padding:28px 16px}
.c{background:var(--c1);border:1px solid var(--b);border-radius:12px;padding:22px 24px;margin-bottom:22px}
.c h2{font-size:1rem;margin:0 0 14px;font-weight:600}
.g{display:grid;grid-template-columns:1fr 1fr;gap:14px}.g3{grid-template-columns:1fr 1fr 1fr}
.f{margin-bottom:14px}.f label{display:block;font-size:.82rem;color:var(--f2);margin-bottom:5px;font-weight:500}
.f input,.f select{width:100%;padding:9px 12px;border:1px solid var(--b);border-radius:8px;background:var(--bg);color:var(--f);font-size:.87rem;outline:none}
.f input:focus,.f select:focus{border-color:var(--p)}
.b{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border:none;border-radius:8px;font-size:.85rem;font-weight:500;cursor:pointer;color:#fff;background:var(--p);transition:.15s}
.b:hover{background:var(--p2)}.b:active{transform:scale(.97)}
.b.s{padding:5px 11px;font-size:.78rem;border-radius:6px}
.b.o{background:transparent;border:1px solid var(--b);color:var(--r)}.b.o:hover{background:rgba(239,68,68,.1)}
.b.fw{width:100%}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:9px 10px;font-size:.78rem;color:var(--f2);font-weight:500;border-bottom:1px solid var(--b)}
td{padding:10px;border-bottom:1px solid var(--b);font-size:.83rem;vertical-align:top}tr:last-child td{border-bottom:none}
.chip{display:inline-block;padding:2px 7px;border-radius:999px;font-size:.72rem;font-weight:500;text-transform:uppercase}
.chip.ok{background:rgba(34,197,94,.15);color:var(--g)}.chip.bad{background:rgba(239,68,68,.1);color:var(--r)}
.bad{color:var(--r)}code{font-size:.78rem;color:var(--f2);word-break:break-all}
.empty{text-align:center;padding:36px;color:var(--f2)}
.toast{position:fixed;bottom:20px;right:20px;background:var(--c1);border:1px solid var(--b);border-radius:10px;padding:12px 18px;font-size:.85rem;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:99;display:none;animation:in .25s ease}
.toast.on{display:block}.toast.g{color:var(--g)}.toast.r{color:var(--r)}
@keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.url{display:none;margin-top:14px;padding:12px 14px;background:var(--bg);border:1px solid var(--p);border-radius:8px;font-family:monospace;font-size:.82rem;word-break:break-all;align-items:center;gap:10px}
.url.on{display:flex}.url span{flex:1}
</style></head><body>
<div class="n"><h1>MCP DFS Codemode</h1><span>v${version}</span><span style="flex:1"></span><span>${h(baseUrl)}</span></div>
<div class="m">
<div class="c"><h2>Create Token</h2>
<form id="f" onsubmit="cr(event)">
  <div class="g"><div class="f"><label>Token Name</label><input name="name" placeholder="My Workstation" required></div>
  <div class="f"><label>Expiration</label><select name="expires"><option value="">Never</option><option value="1w">1 Week</option><option value="1m">1 Month</option><option value="1y">1 Year</option></select></div></div>
  <div class="g"><div class="f"><label>DataForSEO Email</label><input name="username" type="email" placeholder="you@example.com" required></div>
  <div class="f"><label>DataForSEO Password</label><input name="password" type="password" required></div></div>
  <div style="margin-top:8px"><button type="submit" class="b" style="width:100%;height:44px;font-size:.95rem">Generate Token</button></div>
</form>
<div id="url" class="url"><span id="ut"></span><button class="b s" onclick="cps()">Copy</button></div>
</div>
<div class="c"><h2>Tokens (${tokens.length})</h2>
${tokens.length === 0 ? '<div class="empty">No tokens. Create one above.</div>' : `<table><thead><tr><th>Name / Key</th><th>Email</th><th>Expires</th><th>Status</th><th style="width:160px"></th></tr></thead><tbody>${rows}</tbody></table>`}
</div></div><div id="toast" class="toast"></div>
<script>
const B="${h(baseUrl)}",A="${h(adminToken)}",Q=A?"?token="+A:"";
function t(msg,k){let e=document.getElementById("toast");e.textContent=msg;e.className="toast on "+(k?"g":"r");setTimeout(()=>e.className="toast",2500)}
async function cr(e){e.preventDefault();let d=new FormData(e.target),b=Object.fromEntries(d),r=await fetch("/admin/tokens"+Q,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)});
if(r.ok){let j=await r.json();document.getElementById("ut").textContent=B+"/mcp/"+j.token;document.getElementById("url").classList.add("on");t("Created!",true);setTimeout(()=>location.reload(),1500)}else{let j=await r.json();t(j.error||"Failed",false)}}
async function del(token){if(!confirm("Delete?"))return;let r=await fetch("/admin/tokens?token="+token+Q.replace("?","&"),{method:"DELETE"});
if(r.ok){t("Deleted",true);location.reload()}else t("Failed",false)}
function cp(token){navigator.clipboard.writeText(B+"/mcp/"+token).then(()=>t("Copied!",true))}
function cps(){let e=document.getElementById("ut");navigator.clipboard.writeText(e.textContent).then(()=>t("Copied!",true))}
</script></body></html>`;
}

function checkAdmin(env: Env, url: URL): { ok: boolean; reason?: string } {
  const token = env.ADMIN_TOKEN;
  if (!token) return { ok: false, reason: "ADMIN_TOKEN not configured. Set it as an environment variable in the Cloudflare Dashboard (Workers → mcp-dfs-codemode → Settings → Variables → add ADMIN_TOKEN)." };
  if (url.searchParams.get("token") !== token) return { ok: false, reason: "Invalid or missing admin token. Access /admin?token=YOUR_ADMIN_TOKEN." };
  return { ok: true };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const kv = getKV(env);
    const baseUrl = url.origin;

    if (path === "/health" && request.method === "GET") {
      return json({ status: "healthy", server: SERVER_NAME, version, codemode: true });
    }

    // Admin panel + API — optionally protected by ADMIN_TOKEN
    const isAdminRoute = path === "/admin" || path.startsWith("/admin/tokens");
    if (isAdminRoute) {
      const adminCheck = checkAdmin(env, url);
      if (!adminCheck.ok) {
        return new Response(`<!DOCTYPE html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP DFS Codemode — Setup Required</title>
<style>:root{--bg:#09090b;--c1:#18181b;--b:#27272a;--f:#fafafa;--f2:#a1a1aa;--p:#3b82f6}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--f);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{background:var(--c1);border:1px solid var(--b);border-radius:12px;padding:32px;max-width:500px;text-align:center}
.c h1{font-size:1.1rem;margin:0 0 12px}
.c p{color:var(--f2);font-size:.9rem;line-height:1.5;margin:0}
.c code{background:var(--bg);padding:3px 7px;border-radius:5px;font-size:.85rem;color:var(--p)}</style></head>
<body><div class="c"><h1>Admin Panel Locked</h1><p>${h(adminCheck.reason || "Access denied")}</p></div></body></html>`,
          { status: 403, headers: { "Content-Type": "text/html" } });
      }
      if (!kv) return new Response("KV namespace not configured. Add CRED_CONFIG binding.", { status: 200, headers: { "Content-Type": "text/plain" } });

      if (path === "/admin") {
        const list = await kv.list({ prefix: "sk-" });
        const tokens: Array<{ token: string; entry: TokenEntry }> = [];
        for (const k of list.keys) {
          const v = await kv.get(k.name, "json") as TokenEntry | null;
          if (v) tokens.push({ token: k.name, entry: v });
        }
        tokens.sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime());
        return new Response(adminUI(baseUrl, tokens, env.ADMIN_TOKEN || ""), { headers: { "Content-Type": "text/html" } });
      }

      if (path === "/admin/tokens" && request.method === "GET") {
        const list = await kv.list({ prefix: "sk-" });
        const tokens = [];
        for (const k of list.keys) {
          const v = await kv.get(k.name, "json") as TokenEntry | null;
          if (v) tokens.push({ token: k.name, ...v });
        }
        return json(tokens);
      }

      if (path === "/admin/tokens" && request.method === "POST") {
        try {
          const body = await request.json() as { name?: string; username?: string; password?: string; expires?: string };
          if (!body.username || !body.password) return json({ error: "Missing credentials" }, 400);
          const token = genToken();
          const expMap: Record<string, number> = { "1w": 7, "1m": 30, "1y": 365 };
          let expires_at: string | null = null;
          if (body.expires && expMap[body.expires]) {
            expires_at = new Date(Date.now() + expMap[body.expires] * 86400000).toISOString();
          }
          const entry: TokenEntry = { username: body.username, password: body.password, name: body.name || "Unnamed", created_at: new Date().toISOString(), expires_at };
          await kv.put(token, JSON.stringify(entry));
          return json({ token, ...entry });
        } catch { return json({ error: "Invalid request" }, 400); }
      }

      if (path === "/admin/tokens" && request.method === "DELETE") {
        const token = url.searchParams.get("token");
        if (!token) return json({ error: "Missing token" }, 400);
        await kv.delete(token);
        return json({ ok: true });
      }
    }

    // Home page — redirect to admin if configured, else show setup message
    if (path === "/" && request.method === "GET") {
      const adminCheck = checkAdmin(env, url);
      if (!adminCheck.ok) {
        return new Response(`<!DOCTYPE html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP DFS Codemode — Setup</title>
<style>:root{--bg:#09090b;--c1:#18181b;--b:#27272a;--f:#fafafa;--f2:#a1a1aa;--p:#3b82f6}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--f);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{background:var(--c1);border:1px solid var(--b);border-radius:12px;padding:32px;max-width:500px;text-align:center}
.c h1{font-size:1.1rem;margin:0 0 12px}.c p{color:var(--f2);font-size:.9rem;line-height:1.5;margin:0}
.c code{background:var(--bg);padding:3px 7px;border-radius:5px;font-size:.85rem;color:var(--p)}</style></head>
<body><div class="c"><h1>MCP DFS Codemode</h1><p>${h(adminCheck.reason || "Setup required")}</p></div></body></html>`,
          { headers: { "Content-Type": "text/html" } });
      }
      const adminToken = env.ADMIN_TOKEN || "";
      return Response.redirect(`${baseUrl}/admin${adminToken ? '?token=' + adminToken : ""}`, 302);
    }

    // Resolve credentials for MCP
    let dfsUsername: string | undefined;
    let dfsPassword: string | undefined;

    if (path.startsWith("/mcp/")) {
      const token = path.slice(5);
      if (!token) return new Response("Not found", { status: 404 });
      if (env.MCP_ACCESS_TOKEN) {
        if (token !== env.MCP_ACCESS_TOKEN) return jsonError(-32001, "Invalid access token", 401);
        dfsUsername = env.DATAFORSEO_USERNAME;
        dfsPassword = env.DATAFORSEO_PASSWORD;
      } else {
        if (!kv) return jsonError(-32001, "No credential source configured", 500);
        const stored = await kv.get(token, "json") as TokenEntry | null;
        if (!stored) return jsonError(-32001, "Invalid access token", 401);
        if (expired(stored)) return jsonError(-32001, "Token has expired", 401);
        dfsUsername = stored.username;
        dfsPassword = stored.password;
      }
    } else if (path === "/mcp") {
      if (env.MCP_ACCESS_TOKEN || kv) return jsonError(-32001, "Access token required. Use /mcp/<your-token>", 401);
      dfsUsername = env.DATAFORSEO_USERNAME;
      dfsPassword = env.DATAFORSEO_PASSWORD;
    }

    if (!dfsUsername || !dfsPassword) return new Response("Not found", { status: 404 });

    const modules = getModules(dfsUsername, dfsPassword, env.ENABLED_MODULES);
    const upstreamServer = createUpstreamMcpServer(modules);
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const td = buildToolRegistryDescription(modules);

    const codemodeServer = await codeMcpServer({
      server: upstreamServer, executor,
      description: `DataForSEO toolchain. Each tool accepts a JSON object.\n\n${td}\n\nRules:\n- All tools use underscore_names\n- No fetch()/network in sandbox\n- Return an object for the LLM\n\nExample:\nasync () => {\n  const s = await codemode.serp_organic_live_advanced({keyword: "shoes", location_name: "United States", language_code: "en"});\n  return s;\n}`,
    });

    const transport = new WebStandardStreamableHTTPServerTransport();
    codemodeServer.connect(transport);
    return transport.handleRequest(request);
  },
};
