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
function h(s: unknown): string { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function isTokenEntry(v: unknown): v is TokenEntry {
  const r = v as Partial<TokenEntry> | null;
  return !!r && typeof r === "object" && typeof r.username === "string" && typeof r.password === "string" && typeof r.name === "string";
}

async function loadTokens(kv: KVNamespace): Promise<Array<{ token: string; entry: TokenEntry }>> {
  const list = await kv.list({ prefix: "sk-" });
  const tokens: Array<{ token: string; entry: TokenEntry }> = [];
  for (const k of list.keys) {
    try {
      const v = await kv.get(k.name, "json");
      if (isTokenEntry(v)) tokens.push({ token: k.name, entry: v });
    } catch (err) {
      console.warn(`Skipping invalid token entry ${k.name}`, err);
    }
  }
  tokens.sort((a, b) => new Date(b.entry.created_at).getTime() - new Date(a.entry.created_at).getTime());
  return tokens;
}

function tokenRow(baseUrl: string, t: { token: string; entry: TokenEntry }): string {
  const e = t.entry.expires_at;
  const isExp = expired(t.entry);
  let expD = "Never";
  if (e) expD = isExp ? `<span class="bad">Expired ${new Date(e).toLocaleDateString()}</span>` : new Date(e).toLocaleDateString();
  const chip = isExp ? '<span class="chip bad">expired</span>' : '<span class="chip ok">active</span>';
  return `<tr>
    <td><b>${h(t.entry.name)}</b><br><code>${h(t.token.slice(0, 18))}…</code></td>
    <td>${h(t.entry.username)}</td><td>${expD}</td>
    <td>${chip}</td>
    <td>
      <button class="b s" onclick="copyUrl('${h(t.token)}')">Copy URL</button>
      <button class="b s o" hx-delete="/admin/tokens?key=${h(t.token)}" hx-target="#token-list" hx-swap="outerHTML" hx-confirm="Delete this token?">Delete</button>
    </td></tr>`;
}

function tokenListSection(baseUrl: string, tokens: Array<{ token: string; entry: TokenEntry }>, oob = false): string {
  const count = tokens.length;
  const body = count === 0
    ? '<div class="empty">No tokens. Create one above.</div>'
    : `<table><thead><tr><th>Name / Key</th><th>Email</th><th>Expires</th><th>Status</th><th style="width:160px"></th></tr></thead><tbody>${tokens.map(t => tokenRow(baseUrl, t)).join("")}</tbody></table>`;
  return `<div class="c" id="token-list"${oob ? ' hx-swap-oob="true"' : ""}><h2>Tokens (${count})</h2>${body}</div>`;
}

function tokenResultHtml(baseUrl: string, token: string): string {
  return `<div id="token-result" class="res on">
    <div class="res-t"><span id="res-url">${h(baseUrl)}/mcp/${h(token)}</span><button class="b s" onclick="copyText('${h(baseUrl)}/mcp/${h(token)}')">Copy</button><button class="b s d" onclick="this.closest('.res').classList.remove('on')" title="Dismiss">&times;</button></div>
    <div class="res-note">Save this URL. It will only be shown once per creation.</div></div>`;
}

function adminUI(baseUrl: string, tokens: Array<{ token: string; entry: TokenEntry }>): string {
  return `<!DOCTYPE html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP DFS Codemode</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<style>
:root{--bg:#09090b;--c1:#18181b;--b:#27272a;--m:#3f3f46;--f:#fafafa;--f2:#a1a1aa;--p:#3b82f6;--p2:#1d4ed8;--r:#ef4444;--g:#22c55e;--y:#f59e0b}
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--f);margin:0;min-height:100vh}
.n{background:var(--c1);border-bottom:1px solid var(--b);padding:0 20px;display:flex;align-items:center;height:52px;gap:12px}
.n h1{font-size:.95rem;font-weight:600;margin:0}.n span{color:var(--f2);font-size:.78rem}
.m{max-width:900px;margin:0 auto;padding:28px 16px}
.c{background:var(--c1);border:1px solid var(--b);border-radius:12px;padding:22px 24px;margin-bottom:22px}
.c h2{font-size:1rem;margin:0 0 14px;font-weight:600}
.g{display:grid;grid-template-columns:1fr 1fr;gap:14px}.g3{grid-template-columns:1fr 1fr 1fr}
.fi{margin-bottom:14px}.fi label{display:block;font-size:.82rem;color:var(--f2);margin-bottom:5px;font-weight:500}
.fi input,.fi select{width:100%;padding:9px 12px;border:1px solid var(--b);border-radius:8px;background:var(--bg);color:var(--f);font-size:.87rem;outline:none}
.fi input:focus,.fi select:focus{border-color:var(--p)}
.b{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border:none;border-radius:8px;font-size:.85rem;font-weight:500;cursor:pointer;color:#fff;background:var(--p);transition:.15s}
.b:hover{background:var(--p2)}.b:active{transform:scale(.97)}
.b.s{padding:5px 11px;font-size:.78rem;border-radius:6px}
.b.d{background:transparent;border:1px solid var(--b);color:var(--f2);font-size:1.1rem;padding:4px 7px}.b.d:hover{background:var(--b);color:var(--f)}
.b.o{background:transparent;border:1px solid var(--b);color:var(--r)}.b.o:hover{background:rgba(239,68,68,.1)}
.b.fw{width:100%}
table{width:100%;border-collapse:collapse}
th{text-align:left;padding:9px 10px;font-size:.78rem;color:var(--f2);font-weight:500;border-bottom:1px solid var(--b)}
td{padding:10px;border-bottom:1px solid var(--b);font-size:.83rem;vertical-align:top}tr:last-child td{border-bottom:none}
.chip{display:inline-block;padding:2px 7px;border-radius:999px;font-size:.72rem;font-weight:500;text-transform:uppercase}
.chip.ok{background:rgba(34,197,94,.15);color:var(--g)}.chip.bad{background:rgba(239,68,68,.1);color:var(--r)}
.bad{color:var(--r)}code{font-size:.78rem;color:var(--f2);word-break:break-all}
.empty{text-align:center;padding:36px;color:var(--f2)}
.res{display:none;background:var(--c1);border:1px solid var(--g);border-radius:12px;padding:16px 20px;margin-bottom:22px}
.res.on{display:block}.res-t{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.res-t span{flex:1;font-family:monospace;font-size:.85rem;color:var(--f);word-break:break-all;min-width:200px}
.res-note{font-size:.78rem;color:var(--f2);margin-top:8px}
.htmx-indicator{opacity:0;transition:opacity .2s}.htmx-request .htmx-indicator,.htmx-request.htmx-indicator{opacity:1}
.spin{display:inline-block;width:14px;height:14px;border:2px solid var(--b);border-top-color:var(--p);border-radius:50%;animation:sp .6s linear infinite;margin-right:6px}
@keyframes sp{to{transform:rotate(360deg)}}
</style></head><body>
<div class="n"><h1>MCP DFS Codemode</h1><span>v${version}</span><span style="flex:1"></span><span>${h(baseUrl)}</span><button class="b s o" onclick="logout()">Logout</button></div>
<div class="m">
<div id="token-result"></div>
<div class="c"><h2>Create Token</h2>
<form hx-post="/admin/tokens" hx-target="#token-result" hx-swap="innerHTML" hx-indicator="#spinner">
  <div class="g"><div class="fi"><label>Token Name</label><input name="name" placeholder="My Workstation" required></div>
  <div class="fi"><label>Expiration</label><select name="expires"><option value="">Never</option><option value="1w">1 Week</option><option value="1m">1 Month</option><option value="1y">1 Year</option></select></div></div>
  <div class="g"><div class="fi"><label>DataForSEO Email</label><input name="username" type="email" placeholder="you@example.com" required></div>
  <div class="fi"><label>DataForSEO Password</label><input name="password" type="password" required></div></div>
  <div style="margin-top:8px"><button type="submit" class="b fw" style="height:44px;font-size:.95rem"><span id="spinner" class="spin htmx-indicator"></span>Generate Token</button></div>
</form>
</div>
${tokenListSection(baseUrl, tokens)}
</div>
<script>
let TOKEN=localStorage.getItem("dfs_admin_token")||"";
if(!TOKEN){let m=document.cookie.match(/admin_token=([^;]+)/);if(m){TOKEN=decodeURIComponent(m[1]);localStorage.setItem("dfs_admin_token",TOKEN)}else{location.href="/admin/login";document.body.innerHTML="";throw new Error()}}
document.addEventListener('DOMContentLoaded',function(){if(!document.getElementById("token-list")){location.href="/admin/login";document.body.innerHTML="";throw new Error()}});
htmx.config.selfRequestsOnly=false;
function copyUrl(token){navigator.clipboard.writeText("${h(baseUrl)}/mcp/"+token)}
function copyText(text){navigator.clipboard.writeText(text)}
function logout(){localStorage.removeItem("dfs_admin_token");document.cookie="admin_token=;Max-Age=0;Path=/admin";location.href="/admin/login"}
document.body.addEventListener('htmx:configRequest',function(e){var t=localStorage.getItem("dfs_admin_token");if(t)e.detail.headers.Authorization='Bearer '+t});
document.body.addEventListener('htmx:responseError',function(e){if(e.detail.xhr.status===401){localStorage.removeItem("dfs_admin_token");location.href="/admin/login"}});
</script></body></html>`;
}

const ADMIN_KV_KEY = "_admin:auth";

function LOGIN_PAGE_HTML(baseUrl: string, error?: string): string {
  const err = error ? `<div class="e">${h(error)}</div>` : "";
  return `<!DOCTYPE html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP DFS Codemode — Login</title>
<style>:root{--bg:#09090b;--c1:#18181b;--b:#27272a;--f:#fafafa;--f2:#a1a1aa;--p:#3b82f6;--p2:#1d4ed8;--r:#ef4444;--g:#22c55e}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--f);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{background:var(--c1);border:1px solid var(--b);border-radius:12px;padding:32px;max-width:380px;width:100%}
.c h1{font-size:1.15rem;margin:0 0 4px}.c p{color:var(--f2);font-size:.87rem;margin:0 0 24px}
.c label{display:block;font-size:.82rem;color:var(--f2);margin-bottom:6px;font-weight:500}
.c input{width:100%;padding:10px 12px;border:1px solid var(--b);border-radius:8px;background:var(--bg);color:var(--f);font-size:.9rem;outline:none;margin-bottom:16px}
.c input:focus{border-color:var(--p)}
.c button{width:100%;padding:10px;border:none;border-radius:8px;font-size:.9rem;font-weight:500;cursor:pointer;color:#fff;background:var(--p);transition:.15s}
.c button:hover{background:var(--p2)}
.e{background:rgba(239,68,68,.1);border:1px solid var(--r);color:var(--r);border-radius:8px;padding:10px 14px;font-size:.83rem;margin-bottom:16px}
.r{display:flex;align-items:center;gap:8px;margin-bottom:14px}.r input[type=checkbox]{width:auto;margin:0}.r label{font-size:.82rem;color:var(--f2);margin:0}
</style></head><body><div class="c">
<h1>MCP DFS Codemode</h1><p>Enter your admin token to continue.</p>
${err}
<form method="POST" action="/admin/login">
  <label for="t">Admin Token</label>
  <input id="t" name="token" type="password" autocomplete="current-password" placeholder="sk-admin-…" required autofocus>
  <div class="r"><input type="checkbox" id="rm" name="remember" checked><label for="rm">Remember this device</label></div>
  <button type="submit">Unlock</button>
</form>
</div>
<script>if(localStorage.getItem("dfs_admin_token")){let e=document.getElementById("t");e.value=localStorage.getItem("dfs_admin_token");e.type="password"}</script>
</body></html>`;
}

interface AdminResult { ok: boolean; token?: string; needsSetup?: boolean; }

function SETUP_PAGE_HTML(baseUrl: string): string {
  return `<!DOCTYPE html><html class="dark"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MCP DFS Codemode — Setup</title>
<style>:root{--bg:#09090b;--c1:#18181b;--b:#27272a;--f:#fafafa;--f2:#a1a1aa;--p:#3b82f6;--p2:#1d4ed8;--g:#22c55e;--r:#ef4444}
body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--f);display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.c{background:var(--c1);border:1px solid var(--b);border-radius:12px;padding:32px;max-width:460px}
.c h1{font-size:1.15rem;margin:0 0 4px}.c h2{font-size:.95rem;color:var(--f2);font-weight:400;margin:0 0 20px}
.c .step{font-size:.85rem;color:var(--f2);margin:16px 0 4px;font-weight:500}
.c code{background:var(--bg);padding:2px 6px;border-radius:5px;font-size:.83rem;color:var(--p)}
.tbox{display:flex;align-items:center;gap:10px;margin:8px 0 14px}
.tbox input{flex:1;padding:9px 12px;border:1px solid var(--b);border-radius:8px;background:var(--bg);color:var(--f);font-size:.85rem;font-family:monospace;outline:none}
.tbox input:focus{border-color:var(--p)}
.b{display:inline-flex;align-items:center;justify-content:center;padding:9px 18px;border:none;border-radius:8px;font-size:.85rem;font-weight:500;cursor:pointer;color:#fff;background:var(--p);transition:.15s;white-space:nowrap}
.b:hover{background:var(--p2)}.b:active{transform:scale(.97)}
.b.d{background:transparent;border:1px solid var(--b);color:var(--f)}.b.d:hover{background:var(--b)}
.b.g{background:var(--g);width:100%;padding:12px;font-size:.93rem}.b.g:hover{background:#16a34a}
.toast{position:fixed;bottom:20px;right:20px;background:var(--c1);border:1px solid var(--b);border-radius:10px;padding:12px 18px;font-size:.85rem;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:99;display:none;animation:in .25s ease}
.toast.on{display:block;color:var(--p)}.toast.r{color:var(--r)}.toast.g{color:var(--g)}
@keyframes in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.ed{display:none;margin-top:16px;padding:12px;background:var(--bg);border:1px solid var(--p);border-radius:8px;font-family:monospace;font-size:.82rem;word-break:break-all}.ed.on{display:block}
</style></head><body><div class="c">
<h1>MCP DFS Codemode</h1><h2>First-time admin setup</h2>
<div class="step">1. Generate your admin token:</div>
<div class="tbox"><input id="tv" readonly placeholder="Click generate…"><button class="b" onclick="g()">Generate</button><button class="b d" onclick="c()">Copy</button></div>
<div class="step">2. Save it:</div>
<button class="b g" onclick="s()">Save &amp; Activate</button>
<div id="ed" class="ed"><code id="ut"></code></div>
</div>
<div id="toast" class="toast"></div><script>
function g(){let a=new Uint8Array(16);crypto.getRandomValues(a);let t="sk-admin-"+btoa(String.fromCharCode(...a)).replace(/[+/=]/g,"").slice(0,20);document.getElementById("tv").value=t}
function c(){let e=document.getElementById("tv");if(!e.value)return;navigator.clipboard.writeText(e.value).then(()=>t("Copied",true))}
function t(msg,ok){let e=document.getElementById("toast");e.textContent=msg;e.className="toast on "+(ok?"g":"r");setTimeout(()=>e.className="toast",2500)}
async function s(){let v=document.getElementById("tv").value;if(!v)return t("Generate a token first",false);
let r=await fetch("/admin/setup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:v})});
if(r.ok){let j=await r.json();localStorage.setItem("dfs_admin_token",j.token);t("Saved! Redirecting…",true);setTimeout(()=>location.href="/admin",800)}
else{let j=await r.json().catch(()=>({}));t(j.error||"Failed to save",false)}}
</script></body></html>`;
}

function getToken(request: Request, url: URL, kv: KVNamespace | undefined): string | null {
  if (!kv) return null;
  // 1. URL param
  const q = url.searchParams.get("token");
  if (q) return q;
  // 2. Cookie
  const cookie = request.headers.get("Cookie") || "";
  const c = cookie.split(";").map(c => c.trim()).find(c => c.startsWith("admin_token="));
  if (c) return decodeURIComponent(c.split("=", 2)[1]);
  // 3. Authorization header
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

async function checkAdmin(request: Request, url: URL, kv: KVNamespace | undefined): Promise<AdminResult> {
  if (!kv) return { ok: false, needsSetup: false };
  const stored = await kv.get(ADMIN_KV_KEY);
  if (!stored) return { ok: false, needsSetup: true };
  const provided = getToken(request, url, kv);
  if (provided === stored) return { ok: true, token: stored };
  return { ok: false, needsSetup: false };
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

    // Admin panel + API — auth via KV-stored token
    const isAdminRoute = path === "/admin" || path.startsWith("/admin/");
    if (isAdminRoute) {
      const adminCheck = await checkAdmin(request, url, kv);

      // Setup — no admin token stored yet, show setup page
      if (adminCheck.needsSetup && path === "/admin") {
        return new Response(SETUP_PAGE_HTML(baseUrl), { headers: { "Content-Type": "text/html" } });
      }

      // POST /admin/setup — store the first admin token (only works if none exists)
      if (adminCheck.needsSetup && path === "/admin/setup" && request.method === "POST" && kv) {
        try {
          const body = await request.json() as { token?: string };
          if (!body.token) return json({ error: "Missing token" }, 400);
          const existing = await kv.get(ADMIN_KV_KEY);
          if (existing) return json({ error: "Admin already configured" }, 409);
          await kv.put(ADMIN_KV_KEY, body.token);
          return json({ ok: true, token: body.token });
        } catch { return json({ error: "Invalid request" }, 400); }
      }

      // GET /admin/login — show login page
      if (path === "/admin/login" && request.method === "GET") {
        const err = url.searchParams.get("error");
        return new Response(LOGIN_PAGE_HTML(baseUrl, err || undefined), { headers: { "Content-Type": "text/html" } });
      }

      // POST /admin/login — validate token and set cookie
      if (path === "/admin/login" && request.method === "POST" && kv) {
        const contentType = request.headers.get("Content-Type") || "";
        let token: string | null = null;
        let remember = false;
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const body = await request.text();
          const params = new URLSearchParams(body);
          token = params.get("token");
          remember = params.has("remember");
        } else {
          try {
            const body = await request.json() as { token?: string; remember?: boolean };
            token = body.token || null;
            remember = !!body.remember;
          } catch { /* fall through */ }
        }
        if (!token) return new Response(null, { status: 302, headers: { Location: "/admin/login?error=" + encodeURIComponent("Missing token") } });
        const stored = await kv.get(ADMIN_KV_KEY);
        if (!stored || token !== stored) return new Response(null, { status: 302, headers: { Location: "/admin/login?error=" + encodeURIComponent("Invalid token") } });
        const maxAge = remember ? ";Max-Age=31536000" : "";
        return new Response(null, {
          status: 302,
          headers: {
            Location: "/admin",
            "Set-Cookie": `admin_token=${encodeURIComponent(token)};Path=/admin;SameSite=Strict${maxAge};Secure`
          }
        });
      }

      // Not authorized — show login page for human routes, deny API routes
      if (!adminCheck.ok) {
        if (adminCheck.needsSetup) return new Response("Not found", { status: 404 });
        if (path === "/admin" || path === "/admin/login") {
          return new Response(LOGIN_PAGE_HTML(baseUrl, path === "/admin" ? "Access denied. Please log in." : undefined), { headers: { "Content-Type": "text/html" } });
        }
        return json({ error: "Unauthorized" }, 401);
      }

      if (!kv) return new Response("KV namespace not configured. Add CRED_CONFIG binding.", { status: 200, headers: { "Content-Type": "text/plain" } });

      if (path === "/admin") {
        const tokens = await loadTokens(kv);
        return new Response(adminUI(baseUrl, tokens), { headers: { "Content-Type": "text/html" } });
      }

      if (path === "/admin/tokens" && request.method === "GET") {
        return json({ error: "Not found" }, 404);
      }

      if (path === "/admin/tokens" && request.method === "POST") {
        try {
          const ct = request.headers.get("Content-Type") || "";
          let body: Record<string, string> = {};
          if (ct.includes("application/x-www-form-urlencoded")) {
            body = Object.fromEntries(new URLSearchParams(await request.text()));
          } else {
            body = await request.json() as Record<string, string>;
          }
          if (!body.username || !body.password) {
            return new Response(`<div id="token-result" class="res on" style="border-color:var(--r)"><div class="res-note" style="color:var(--r)">Missing credentials</div></div>`, { headers: { "Content-Type": "text/html" } });
          }
          const token = genToken();
          const expMap: Record<string, number> = { "1w": 7, "1m": 30, "1y": 365 };
          let expires_at: string | null = null;
          if (body.expires && expMap[body.expires]) {
            expires_at = new Date(Date.now() + expMap[body.expires] * 86400000).toISOString();
          }
          const entry: TokenEntry = { username: body.username, password: body.password, name: body.name || "Unnamed", created_at: new Date().toISOString(), expires_at };
          await kv.put(token, JSON.stringify(entry));
          const tokens = await loadTokens(kv);
          return new Response(
            tokenResultHtml(baseUrl, token) + "\n" + tokenListSection(baseUrl, tokens, true),
            { headers: { "Content-Type": "text/html" } }
          );
        } catch {
          return new Response(`<div id="token-result" class="res on" style="border-color:var(--r)"><div class="res-note" style="color:var(--r)">Invalid request</div></div>`, { headers: { "Content-Type": "text/html" } });
        }
      }

      if (path === "/admin/tokens" && request.method === "DELETE") {
        const key = url.searchParams.get("key");
        if (!key) return json({ error: "Missing key" }, 400);
        await kv.delete(key);
        const tokens = await loadTokens(kv);
        return new Response(tokenListSection(baseUrl, tokens), { headers: { "Content-Type": "text/html" } });
      }

      if (path === "/admin/token-list" && request.method === "GET") {
        const tokens = await loadTokens(kv);
        return new Response(tokenListSection(baseUrl, tokens), { headers: { "Content-Type": "text/html" } });
      }
    }

    // Home page
    if (path === "/" && request.method === "GET") {
      if (!kv) return new Response(`<html><body style="font-family:system-ui;padding:40px;text-align:center"><h2>MCP DFS Codemode</h2><p>KV not configured. Add CRED_CONFIG binding.</p></body></html>`, { headers: { "Content-Type": "text/html" } });
      const stored = await kv.get(ADMIN_KV_KEY);
      if (!stored) return new Response(SETUP_PAGE_HTML(baseUrl), { headers: { "Content-Type": "text/html" } });
      return Response.redirect("/admin", 302);
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
