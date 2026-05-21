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
  AiOptimizationApiModule: "AI Optimization",
  SerpApiModule: "SERP",
  KeywordsDataApiModule: "Keywords Data",
  OnPageApiModule: "OnPage",
  DataForSEOLabsApi: "DataForSEO Labs",
  BacklinksApiModule: "Backlinks",
  BusinessDataApiModule: "Business Data",
  DomainAnalyticsApiModule: "Domain Analytics",
  ContentAnalysisApiModule: "Content Analysis",
  MerchantApiModule: "Merchant",
};

function buildToolRegistryDescription(modules: BaseModule[]): string {
  const lines: string[] = [];
  modules.forEach((module) => {
    const label = MODULE_LABELS[module.constructor.name] || module.constructor.name;
    const tools = module.getTools();
    const names = Object.keys(tools)
      .filter((n) => /^(?!.*_(?:locations?|filters?|models?)$)/.test(n))
      .map((n) => n.replace(/^.+\./, ""));
    if (names.length === 0) return;
    lines.push(`  ${label}: ${names.join(", ")}`);
  });
  return lines.join("\n");
}

function createClient(login: string, password: string): DataForSEOClient {
  return new DataForSEOClient({ authHeader: buildBasicAuthHeader(login, password) });
}

function createUpstreamMcpServer(modules: BaseModule[]): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version });
  modules.forEach((module) => {
    const tools = module.getTools();
    Object.entries(tools).forEach(([name, tool]) => {
      const typedTool = tool as ToolDefinition;
      const schema = z.object(typedTool.params);
      server.tool(name, typedTool.description, schema.shape, typedTool.handler);
    });
    const prompts = module.getPrompts();
    Object.entries(prompts).forEach(([name, prompt]) => {
      server.registerPrompt(
        name,
        { description: prompt.description, argsSchema: prompt.params },
        prompt.handler,
      );
    });
  });
  return server;
}

function getModules(login: string, password: string, modulesFilter: string | null): BaseModule[] {
  const client = createClient(login, password);
  return ModuleLoaderService.loadModules(client, EnabledModulesSchema.parse(modulesFilter));
}

function renderConfigUI(error?: string, saved?: boolean): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MCP DFS Codemode — Configure</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px}
  h1{font-size:1.4rem}
  label{display:block;margin:12px 0 4px;font-weight:600}
  input{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;box-sizing:border-box}
  button{margin-top:16px;padding:10px 20px;background:#0051ff;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer}
  button:hover{background:#003dbf}
  .error{color:#d00;padding:8px;background:#fee;border-radius:6px;margin:8px 0}
  .success{color:#080;padding:8px;background:#efe;border-radius:6px;margin:8px 0}
  code{background:#f4f4f4;padding:2px 6px;border-radius:4px;font-size:.9rem}
</style>
</head>
<body>
  <h1>MCP DFS Codemode</h1>
  <p>Enter your DataForSEO credentials and choose an access token for your MCP URL.</p>
  ${error ? `<div class="error">${error}</div>` : ""}
  ${saved ? `<div class="success">Saved! Use your MCP URL:<br><code>/mcp/<your-token></code></div>` : ""}
  <form method="POST" action="/configure">
    <label for="username">DataForSEO Email</label>
    <input type="email" id="username" name="username" required autocomplete="email">
    <label for="password">DataForSEO Password</label>
    <input type="password" id="password" name="password" required autocomplete="current-password">
    <label for="token">Access Token</label>
    <input type="text" id="token" name="token" required minlength="8" placeholder="sk-your-secret-token" autocomplete="off">
    <button type="submit">Save &amp; Activate</button>
  </form>
</body>
</html>`;
}

function getKV(env: Env): KVNamespace | undefined {
  return (env as unknown as Record<string, unknown>).CRED_CONFIG as KVNamespace | undefined;
}

function jsonError(code: number, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health" && request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "healthy", server: SERVER_NAME, version, codemode: true }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Config UI — show form on GET, save credentials on POST
    if (path === "/" || path === "/configure") {
      const kv = getKV(env);
      if (!kv) {
        return new Response("KV namespace not configured. The CRED_CONFIG binding will be auto-provisioned on next deploy.", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      }
      if (request.method === "GET") {
        return new Response(renderConfigUI(), { headers: { "Content-Type": "text/html" } });
      }
      if (request.method === "POST") {
        try {
          const form = await request.formData();
          const username = form.get("username")?.toString().trim() || "";
          const password = form.get("password")?.toString() || "";
          const token = form.get("token")?.toString().trim() || "";
          if (!username || !password || token.length < 8) {
            return new Response(renderConfigUI("All fields required. Token must be at least 8 characters."), {
              headers: { "Content-Type": "text/html" },
            });
          }
          await kv.put(token, JSON.stringify({ username, password }));
          return new Response(renderConfigUI(undefined, true), {
            headers: { "Content-Type": "text/html" },
          });
        } catch {
          return new Response(renderConfigUI("Invalid form submission."), {
            headers: { "Content-Type": "text/html" },
          });
        }
      }
    }

    // Resolve credentials
    let dfsUsername: string | undefined;
    let dfsPassword: string | undefined;

    const isTokenPath = path.startsWith("/mcp/");
    const isPlainMCP = path === "/mcp";

    if (isTokenPath) {
      const token = path.slice(5);
      if (!token) return new Response("Not found", { status: 404 });

      if (env.MCP_ACCESS_TOKEN) {
        if (token !== env.MCP_ACCESS_TOKEN) {
          return jsonError(-32001, "Invalid access token", 401);
        }
        dfsUsername = env.DATAFORSEO_USERNAME;
        dfsPassword = env.DATAFORSEO_PASSWORD;
      } else {
        const kv = getKV(env);
        if (!kv) return jsonError(-32001, "No credential source. Set DATAFORSEO_USERNAME/PASSWORD or configure CRED_CONFIG KV.", 500);
        const stored = await kv.get(token, "json") as Record<string, string> | null;
        if (!stored) return jsonError(-32001, "Invalid access token", 401);
        dfsUsername = stored.username;
        dfsPassword = stored.password;
      }
    } else if (isPlainMCP) {
      if (env.MCP_ACCESS_TOKEN || getKV(env)) {
        return jsonError(-32001, "Access token required. Use /mcp/<your-token>", 401);
      }
      dfsUsername = env.DATAFORSEO_USERNAME;
      dfsPassword = env.DATAFORSEO_PASSWORD;
    }

    if (!dfsUsername || !dfsPassword) return new Response("Not found", { status: 404 });

    // Handle MCP request
    const modules = getModules(dfsUsername, dfsPassword, env.ENABLED_MODULES);
    const upstreamServer = createUpstreamMcpServer(modules);
    const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
    const toolDescriptions = buildToolRegistryDescription(modules);

    const codemodeServer = await codeMcpServer({
      server: upstreamServer,
      executor,
      description: `DataForSEO toolchain. Each tool accepts a JSON object.

${toolDescriptions}

Rules:
- All tools use underscore_names
- No fetch()/network in sandbox
- Return an object for the LLM

Example:
async () => {
  const s = await codemode.serp_organic_live_advanced({keyword: "shoes", location_name: "United States", language_code: "en"});
  return s;
}`,
    });

    const transport = new WebStandardStreamableHTTPServerTransport();
    codemodeServer.connect(transport);
    return transport.handleRequest(request);
  },
};
