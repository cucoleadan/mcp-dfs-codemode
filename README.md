# mcp-dfs-codemode

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/chillibot-chillital/mcp-dfs-codemode)

DataForSEO MCP server wrapped with **Cloudflare Codemode** — LLMs compose multi-step SEO API calls as JavaScript code in a secure sandbox, instead of making individual tool calls one at a time.

Built on top of the official [dataforseo/mcp-server-typescript](https://github.com/dataforseo/mcp-server-typescript) and automatically syncs upstream changes.

## How Codemode Changes the Game

Instead of the MCP client making 10+ round trips for a multi-step SEO workflow, the LLM writes one JavaScript function that chains everything:

```js
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
}
```

This means: one tool call → one LLM step → any number of API calls, conditionals, and data transformations.

## Features

- **Codemode-powered**: All DataForSEO APIs exposed through a single `code` tool — LLMs write JavaScript, not individual tool calls
- **Sandboxed execution**: Generated code runs in an isolated Worker — `fetch()` and network are blocked by default
- **Full DataForSEO API coverage**: SERP, Keywords, Backlinks, OnPage, Labs, Business Data, Domain Analytics, Content Analysis, AI Optimization
- **Cloudflare Workers**: Serverless, edge-distributed, auto-scaling
- **Upstream sync**: Weekly automated PRs from `dataforseo/mcp-server-typescript`

## Available Tools

All tools from the upstream DataForSEO MCP server are available as `codemode.<toolName>({...})` inside the code sandbox:

- **AI_OPTIMIZATION**: keyword discovery, conversational optimization, LLM benchmarking
- **SERP**: real-time Google, Bing, Yahoo results
- **KEYWORDS_DATA**: search volume, CPC, clickstream data
- **ONPAGE**: crawl websites for on-page SEO metrics
- **DATAFORSEO_LABS**: proprietary keyword/SERP/domain data
- **BACKLINKS**: referring domains, anchor text, link quality
- **BUSINESS_DATA**: Google, Trustpilot, Tripadvisor data
- **DOMAIN_ANALYTICS**: traffic, tech stack, Whois
- **CONTENT_ANALYSIS**: brand monitoring, sentiment, citations

## Deploy to Cloudflare

### One-click deploy

Click the button above — it will fork this repo and deploy the worker to your Cloudflare account.

### Manual deploy

```bash
# Install dependencies
npm install --legacy-peer-deps

# Set credentials
npx wrangler secret put DATAFORSEO_USERNAME
npx wrangler secret put DATAFORSEO_PASSWORD

# Build and deploy
npm run worker:build
npx wrangler deploy
```

### Worker endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /mcp` | MCP Streamable HTTP transport (single `code` tool) |
| `GET /health` | Health check |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATAFORSEO_USERNAME` | Yes | DataForSEO API login email |
| `DATAFORSEO_PASSWORD` | Yes | DataForSEO API password |
| `ENABLED_MODULES` | No | Comma-separated module names (default: all) |
| `DATAFORSEO_FULL_RESPONSE` | No | `"true"` for raw API responses |

## Usage with Claude / Cursor / Any MCP Client

```json
{
  "mcpServers": {
    "dfs-codemode": {
      "type": "http",
      "url": "https://your-worker.workers.dev/mcp"
    }
  }
}
```

## Syncing Upstream Changes

This repo automatically syncs from `dataforseo/mcp-server-typescript` every Monday at 06:00 UTC via GitHub Actions. A PR is opened with upstream changes for review.

## License

Apache-2.0
