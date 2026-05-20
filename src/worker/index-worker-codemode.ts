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

function buildToolRegistryDescription(modules: BaseModule[]): string {
  const lines: string[] = [];
  modules.forEach((module) => {
    const tools = module.getTools();
    Object.entries(tools).forEach(([toolName, tool]) => {
      const t = tool as ToolDefinition;
      lines.push(`  - codemode.${toolName}: ${t.description}`);
    });
  });
  return lines.join("\n");
}

function createClientAndModules(env: Env) {
  const client = new DataForSEOClient({
    authHeader: buildBasicAuthHeader(
      env.DATAFORSEO_USERNAME || "",
      env.DATAFORSEO_PASSWORD || "",
    ),
  });
  const enabledModules = EnabledModulesSchema.parse(env.ENABLED_MODULES);
  const modules = ModuleLoaderService.loadModules(client, enabledModules);
  return { client, modules };
}

function createUpstreamMcpServer(env: Env, modules: BaseModule[]): McpServer {
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
        {
          description: prompt.description,
          argsSchema: prompt.params,
        },
        prompt.handler,
      );
    });
  });

  return server;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response(
        JSON.stringify({
          status: "healthy",
          server: SERVER_NAME,
          version,
          codemode: true,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    if (!env.DATAFORSEO_USERNAME || !env.DATAFORSEO_PASSWORD) {
      if (url.pathname === "/mcp") {
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32001,
              message: "DataForSEO credentials not configured in worker environment variables",
            },
            id: null,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
    }

    if (url.pathname === "/mcp") {
      const { modules } = createClientAndModules(env);
      const upstreamServer = createUpstreamMcpServer(env, modules);
      const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
      const toolDescriptions = buildToolRegistryDescription(modules);

      const codemodeServer = await codeMcpServer({
        server: upstreamServer,
        executor,
        description: `DataForSEO API orchestrator. Write JavaScript to compose SEO data tool calls as code.

Available tools (use as codemode.<toolName>({...})):
${toolDescriptions}

Rules:
- All tool names use underscores (e.g., serp_google_organic_live_advanced)
- Each tool returns structured data — chain multiple calls, filter results in code
- fetch() and network access are blocked in the sandbox
- Return an object with the results you want the LLM to see

Example — fetch SERP + backlinks for the top result:
async () => {
  const serp = await codemode.serp_google_organic_live_advanced({
    keyword: "running shoes",
    location_code: 2840,
    language_code: "en"
  });
  const firstUrl = serp?.items?.[0]?.url;
  if (firstUrl) {
    const backlinks = await codemode.backlinks_backlinks_summary_live({
      target: firstUrl
    });
    return { serp, backlinks };
  }
  return { serp };
}`,
      });

      const transport = new WebStandardStreamableHTTPServerTransport();
      codemodeServer.connect(transport);
      return transport.handleRequest(request);
    }

    return new Response("Not found", { status: 404 });
  },
};
