# mcp-dfs-codemode

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cucoleadan/mcp-dfs-codemode)

DataForSEO MCP server wrapped with **Cloudflare Codemode** — LLMs compose multi-step SEO API calls as JavaScript code in a secure sandbox, instead of making individual tool calls one at a time.

Built on top of the official [dataforseo/mcp-server-typescript](https://github.com/dataforseo/mcp-server-typescript) and automatically syncs upstream changes.

## How Codemode Changes the Game

Instead of the MCP client making 10+ round trips for a multi-step SEO workflow, the LLM writes one JavaScript function that chains everything:

```js
async () => {
  const serp = await codemode.serp_organic_live_advanced({
    keyword: "running shoes",
    location_name: "United States"
  });
  const firstUrl = serp?.items?.[0]?.url;
  if (firstUrl) {
    const bl = await codemode.backlinks_summary({ target: firstUrl });
    return { serp, backlinks_summary: bl };
  }
  return { serp };
}
```

This means: one tool call → one LLM step → any number of API calls, conditionals, and data transformations.

## Deploy

### One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cucoleadan/mcp-dfs-codemode)

After deploy, set your secrets in **Cloudflare Dashboard → Workers → mcp-dfs-codemode → Settings → Variables**.

### Two deployment modes

#### Mode A: Single-tenant (env vars)

Set these **secrets** (recommended for personal use):

| Secret | Description |
|--------|-------------|
| `DATAFORSEO_USERNAME` | Your DataForSEO email |
| `DATAFORSEO_PASSWORD` | Your DataForSEO password |
| `MCP_ACCESS_TOKEN` | A secret token for URL auth (e.g. `sk-your-random-token`) |

Then share: `https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/<token>`

If `MCP_ACCESS_TOKEN` is not set, plain `/mcp` still works with env creds (backward compatible).

#### Mode B: Multi-tenant (KV + browser UI)

No DataForSEO secrets needed. Add a **KV namespace** named `CRED_CONFIG`:

1. In Cloudflare Dashboard, go to **Workers & Pages → mcp-dfs-codemode → Settings → KV**
2. Click **Add binding** → Variable name: `CRED_CONFIG`, KV namespace: create a new one
3. Visit `https://mcp-dfs-codemode.your-subdomain.workers.dev/` in a browser
4. Enter your DataForSEO email, password, and an access token
5. Use: `https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/<your-token>`

Multiple users can configure their own credentials — each with their own token.

### Manual deploy

```bash
npm install --legacy-peer-deps

# Mode A: set your creds as secrets
npx wrangler secret put DATAFORSEO_USERNAME
npx wrangler secret put DATAFORSEO_PASSWORD
npx wrangler secret put MCP_ACCESS_TOKEN   # optional, enables token auth

# Mode B: create KV namespace (skip secrets)
npx wrangler kv namespace create CRED_CONFIG
# Then update the id in wrangler.jsonc

# Build and deploy
npm run worker:deploy
```

### Usage with Claude

**Claude Desktop** (recommended):

```json
{
  "mcpServers": {
    "dfs": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/sk-your-token"]
    }
  }
}
```

**Claude Web** (Add custom connector):

| Field | Value |
|-------|-------|
| URL | `https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/sk-your-token` |
| OAuth | Not needed (token is in the URL) |

## Auth flow

```
Client → /mcp/<token> → Worker validates token → uses stored DFS creds → handles MCP
```

- Token checked against `MCP_ACCESS_TOKEN` env var first
- If not set, falls back to `CRED_CONFIG` KV lookup
- If neither is configured, returns 401

## Features

- **Codemode-powered**: All DataForSEO APIs through a single `code` tool
- **Sandboxed execution**: Generated code runs in isolated Worker — network blocked
- **Supports Claude, Cursor, Copilot, any MCP client**: Streamable HTTP transport
- **Two auth modes**: Single-tenant (env vars) or multi-tenant (KV + config UI)
- **~745 tokens for tool list**: Compact description, no schema bloat
- **Upstream sync**: Weekly PRs from `dataforseo/mcp-server-typescript`

## Available tools

All tools available as `codemode.<toolName>({...})`:

- **AI Optimization**: keyword discovery, LLM benchmarking, ChatGPT scraper
- **SERP**: Google, Bing, Yahoo organic search results
- **Keywords Data**: search volume, CPC, Google Trends, DFS Trends
- **OnPage**: content parsing, Lighthouse, page optimization
- **DataForSEO Labs**: ranked keywords, competitors, keyword ideas, domain analytics
- **Backlinks**: summary, anchors, competitors, bulk ops
- **Business Data**: Google Maps business listings
- **Domain Analytics**: Whois, technology stack
- **Content Analysis**: citation search, phrase trends
- **Merchant**: Amazon product search, ASIN lookup

## Testing

```bash
npm test
```

## License

Apache-2.0
