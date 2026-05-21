# mcp-dfs-codemode

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cucoleadan/mcp-dfs-codemode)

DataForSEO MCP server wrapped with **Cloudflare Codemode** — LLMs compose multi-step SEO API calls as JavaScript code in a secure sandbox, at ~745 tokens for tool discovery.

Built on top of [dataforseo/mcp-server-typescript](https://github.com/dataforseo/mcp-server-typescript) with automatic upstream sync.

## Quick start (6 steps)

### Step 1 — Deploy

Click **Deploy to Cloudflare** above. Everything is auto-provisioned:
- Worker deploys to your Cloudflare account
- KV namespace is created automatically (Cloudflare's automatic provisioning)
- No manual setup needed

### Step 2 — Visit your admin panel

Open your worker URL in a browser (e.g. `https://mcp-dfs-codemode.your-subdomain.workers.dev`).

You'll see the **first-time setup page** — no admin token is configured yet.

### Step 3 — Generate and save your admin token

1. Click **Generate** — a random token like `sk-admin-abc123...` appears
2. Click **Copy** to save it somewhere safe
3. Click **Save & Activate** — the token is stored in KV and you're redirected to the login page

### Step 4 — Log in

1. The login page shows a password field with your token pre-filled (from localStorage)
2. Check **Remember this device** (recommended) to stay logged in for 1 year
3. Click **Unlock**

> Your browser will offer to save the password — accept it so you never lose your admin token.

### Step 5 — Create API tokens

On the admin dashboard, create tokens for your MCP clients:

| Field | Value |
|-------|-------|
| Token Name | A label (e.g. "Claude Desktop") |
| Expiration | Never / 1 Week / 1 Month / 1 Year |
| Email | Your DataForSEO account email |
| Password | Your DataForSEO account password |

### Step 6 — Connect your MCP client

Use the generated token in your MCP client URL:

```
https://mcp-dfs-codemode.your-subdomain.workers.dev/mcp/sk-your-token
```

## How Codemode works

Instead of 83 individual MCP tools, Codemode exposes a single `code` tool. The LLM writes JavaScript that chains any number of DataForSEO API calls:

```js
async () => {
  const serp = await codemode.serp_organic_live_advanced({
    keyword: "running shoes", location_name: "United States"
  });
  const url = serp?.items?.[0]?.url;
  if (url) {
    const bl = await codemode.backlinks_summary({ target: url });
    return { serp, backlinks_summary: bl };
  }
  return { serp };
}
```

| Version | tokens/list tokens |
|---------|-------------------|
| Official MCP (83 tools) | ~6,200 |
| Codemode (trimmed) | **~745** |

## Admin panel

### Auth flow

```
First visit → Setup page (generate + save token to KV)
                         ↓
Login page (password form, autocomplete="current-password")
   ↓
Cookie set → Admin dashboard unlocked
```

**Auth is checked via 3 sources (checked in order):**
1. `?token=` URL query parameter (backward compatible)
2. `admin_token` cookie (set by login form)
3. `Authorization: Bearer <token>` HTTP header (used by the admin panel JS)

**Browser persistence:**
- Token is stored in `localStorage` — survives page reloads and browser restarts
- If you checked "Remember this device", the server sets a 1-year cookie
- On return visits, the admin panel reads localStorage first, falls back to the cookie
- Chrome/Edge will offer to save the token as a password

**Forgot your admin token?**
- Check your browser's saved passwords (Settings → Passwords)
- Check your browser's localStorage (DevTools → Application → Local Storage → `dfs_admin_token`)
- As a last resort, delete the `_admin:auth` key from your KV namespace and revisit the setup page

### Logging out

Click **Logout** in the admin navbar. This clears both the cookie and localStorage. You'll be redirected to the login page.

### Token management

- **Create tokens**: Fill the form at the top of the admin panel. Expiration is optional.
- **List tokens**: All active tokens shown in the table below the form.
- **Copy MCP URL**: Click **Copy URL** on any token row to get the full MCP endpoint.
- **Delete tokens**: Click **Delete** to revoke a token.

## Auth modes

### Mode A: Single-tenant (your DFS account via secrets)

Set these as **secrets** in Cloudflare Dashboard → Workers → mcp-dfs-codemode → Settings:

| Secret | Description |
|--------|-------------|
| `DATAFORSEO_USERNAME` | Your DataForSEO email |
| `DATAFORSEO_PASSWORD` | Your DataForSEO password |
| `MCP_ACCESS_TOKEN` | A secret token users must include in the URL path |

Users access via: `https://<worker>/mcp/<your-mcp-access-token>`

### Mode B: Multi-tenant (each user brings their own DFS creds — default)

No secrets needed. Use the admin panel to create tokens. Each token maps to its own DataForSEO credentials.

```
/mcp/<token> → check MCP_ACCESS_TOKEN env var → check KV → return DFS creds or 401
/mcp         → backward compat (only works without token auth configured)
```

## Client setup

### Claude Desktop

```json
{
  "mcpServers": {
    "dfs": {
      "command": "npx",
      "args": ["mcp-remote", "https://<worker>/mcp/sk-your-token"]
    }
  }
}
```

### Claude Web (Add custom connector)

| Field | Value |
|-------|-------|
| Name | DataForSEO |
| URL | `https://<worker>/mcp/sk-your-token` |
| OAuth | Leave empty (token is in URL) |

### Cursor / any MCP client

Point your client to `https://<worker>/mcp/sk-your-token`. The token in the URL path authenticates the request.

## Available tools

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

## Endpoints

| Path | Method | Description | Auth |
|------|--------|-------------|------|
| `GET /` | GET | Home — redirects to admin if configured, else setup | None |
| `GET /health` | GET | Health check | None |
| `GET /admin` | GET | Admin panel (tokens CRUD) | Cookie / token |
| `GET /admin/login` | GET | Login form | None |
| `POST /admin/login` | POST | Validate token, set cookie | None |
| `POST /admin/setup` | POST | First-time admin token save | KV only if empty |
| `POST /admin/tokens` | POST | Create a new API token | Cookie / token |
| `GET /admin/tokens` | GET | List all API tokens | Cookie / token |
| `DELETE /admin/tokens?token=X` | DELETE | Delete an API token | Cookie / token |
| `POST /mcp/<token>` | POST | MCP Streamable HTTP | Token in path |
| `POST /mcp` | POST | MCP (backward compat) | Env var |

## CLI deploy

```bash
npm install --legacy-peer-deps
npm run worker:deploy
```

## Testing

```bash
npm test
```

## Upstream sync

Auto-syncs from `dataforseo/mcp-server-typescript` every Monday at 06:00 UTC via `.github/workflows/sync-upstream.yml`. A PR is opened with upstream changes for review.

## License

Apache-2.0
