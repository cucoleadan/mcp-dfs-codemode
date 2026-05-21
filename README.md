# mcp-dfs-codemode

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cucoleadan/mcp-dfs-codemode)

DataForSEO MCP server wrapped with **Cloudflare Codemode** — LLMs compose multi-step SEO API calls as JavaScript code in a secure sandbox, at ~745 tokens for tool discovery.

Built on top of [dataforseo/mcp-server-typescript](https://github.com/dataforseo/mcp-server-typescript) with automatic upstream sync.

## How it works

Instead of exposing 83 individual MCP tools, Codemode exposes a single `code` tool. The LLM writes JavaScript that chains any number of DataForSEO API calls:

```js
async () => {
  const serp = await codemode.serp_organic_live_advanced({
    keyword: "running shoes",
    location_name: "United States"
  });
  const url = serp?.items?.[0]?.url;
  if (url) {
    const bl = await codemode.backlinks_summary({ target: url });
    return { serp, backlinks_summary: bl };
  }
  return { serp };
}
```

One LLM step → any number of API calls with conditionals, loops, and data transformations.

| Version | tokens/list tokens |
|---------|-------------------|
| Official MCP (83 tools) | ~6,200 |
| Codemode (trimmed) | **~745** |

## Deployment

### One-click deploy

Click the button above. Everything is auto-provisioned:

- Worker deploys to your Cloudflare account
- KV namespace is **auto-created** during deploy (Cloudflare's automatic provisioning)
- No manual Cloudflare setup needed

After deploy, choose your auth mode.

### Manual CLI deploy

```bash
npm install --legacy-peer-deps
npm run worker:deploy
```

## Auth modes

Choose one of two modes after deployment.

### Mode A: Single-tenant (env vars — your DFS account)

Set these as **secrets** in Cloudflare Dashboard → Workers → mcp-dfs-codemode → Settings → Variables:

| Secret | Description |
|--------|-------------|
| `DATAFORSEO_USERNAME` | Your DataForSEO email |
| `DATAFORSEO_PASSWORD` | Your DataForSEO password |
| `MCP_ACCESS_TOKEN` | A secret token (e.g. `sk-my-token`) |

Then share: `https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/sk-my-token`

### Mode B: Multi-tenant (KV — each user brings their own DFS creds)

No secrets needed. The KV namespace is auto-provisioned. Visit your worker URL in a browser:

```
https://mcp-dfs-codemode.your-subdomain.workers.dev/
```

Enter your DataForSEO email, password, and a personal access token. Saved to KV immediately. Use:

```
https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/your-token
```

Multiple users can configure their own credentials independently.

### Auth logic

```
/mcp/<token> → check MCP_ACCESS_TOKEN env var → check KV → return DFS creds or 401
/mcp         → works only if no MCP_ACCESS_TOKEN and no KV configured (backward compat)
```

## Usage with clients

### Claude Desktop

```json
{
  "mcpServers": {
    "dfs": {
      "command": "npx",
      "args": ["mcp-remote", "https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/sk-my-token"]
    }
  }
}
```

### Claude Web (Add custom connector)

| Field | Value |
|-------|-------|
| Name | DataForSEO |
| URL | `https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/sk-my-token` |
| OAuth | Leave empty (token is in URL) |

### Cursor / any MCP client

Same as above — point to your worker URL with the token in the path.

## Available tool categories

All tools accessed as `codemode.<toolName>({...})`:

| Module | Example tools |
|--------|--------------|
| AI Optimization | keyword_data_search_volume, llm_response, chat_gpt_scraper |
| SERP | organic_live_advanced, youtube_* |
| Keywords Data | google_ads_search_volume, dfs_trends_*, google_trends_* |
| OnPage | content_parsing, instant_pages, lighthouse |
| DataForSEO Labs | ranked_keywords, competitors, keyword_ideas, domain_intersection, search_intent, bulk_* |
| Backlinks | summary, backlinks, anchors, bulk_*, competitors, intersection, timeseries_* |
| Business Data | business_listings_search |
| Domain Analytics | whois_overview, technologies |
| Content Analysis | search, summary, phrase_trends |
| Merchant | amazon_asin, amazon_sellers, amazon_products |

## Available endpoints

| Path | Description |
|------|-------------|
| `GET /health` | Health check |
| `GET /` | Config UI (multi-tenant) |
| `GET /configure` | Config UI form |
| `POST /configure` | Save DFS creds + token to KV |
| `POST /mcp` | MCP Streamable HTTP (requires token) |
| `POST /mcp/<token>` | MCP Streamable HTTP with token auth |

## Testing

```bash
npm test
```

## Upstream sync

This repo automatically syncs from `dataforseo/mcp-server-typescript` every Monday at 06:00 UTC via `.github/workflows/sync-upstream.yml`. A PR is opened with upstream changes for review.

## License

Apache-2.0
