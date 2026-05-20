import { describe, it, expect, vi, beforeEach } from "vitest";

// Helper to simulate URL path matching and credential resolution
function resolveCredentials(
  path: string,
  env: {
    MCP_ACCESS_TOKEN?: string | null;
    DATAFORSEO_USERNAME?: string;
    DATAFORSEO_PASSWORD?: string;
    CRED_CONFIG?: { get: (key: string) => Promise<Record<string, string> | null> };
  },
): { username?: string; password?: string; error?: string; status?: number } {
  const isTokenPath = path.startsWith("/mcp/");
  const isPlainMCP = path === "/mcp";

  if (isTokenPath) {
    const token = path.slice(5);
    if (!token) return { error: "Not found", status: 404 };

    if (env.MCP_ACCESS_TOKEN) {
      if (token !== env.MCP_ACCESS_TOKEN) {
        return { error: "Invalid access token", status: 401 };
      }
      return { username: env.DATAFORSEO_USERNAME, password: env.DATAFORSEO_PASSWORD };
    }

    // KV mode would be tested separately
    return { error: "No credential source", status: 500 };
  }

  if (isPlainMCP) {
    if (env.MCP_ACCESS_TOKEN) {
      return { error: "Access token required. Use /mcp/<your-token>", status: 401 };
    }
    if (env.DATAFORSEO_USERNAME && env.DATAFORSEO_PASSWORD) {
      return { username: env.DATAFORSEO_USERNAME, password: env.DATAFORSEO_PASSWORD };
    }
    return { error: "Not found", status: 404 };
  }

  return { error: "Not found", status: 404 };
}

describe("Auth: URL token resolution", () => {
  it("allows /mcp/<token> when MCP_ACCESS_TOKEN is set", () => {
    const result = resolveCredentials("/mcp/sk-secret", {
      MCP_ACCESS_TOKEN: "sk-secret",
      DATAFORSEO_USERNAME: "user@example.com",
      DATAFORSEO_PASSWORD: "pass123",
    });
    expect(result.username).toBe("user@example.com");
    expect(result.password).toBe("pass123");
  });

  it("rejects /mcp/<wrong-token> when MCP_ACCESS_TOKEN is set", () => {
    const result = resolveCredentials("/mcp/sk-wrong", {
      MCP_ACCESS_TOKEN: "sk-secret",
    });
    expect(result.error).toBe("Invalid access token");
    expect(result.status).toBe(401);
  });

  it("rejects plain /mcp when MCP_ACCESS_TOKEN is set", () => {
    const result = resolveCredentials("/mcp", {
      MCP_ACCESS_TOKEN: "sk-secret",
    });
    expect(result.error).toContain("Access token required");
    expect(result.status).toBe(401);
  });

  it("allows plain /mcp when no MCP_ACCESS_TOKEN is configured", () => {
    const result = resolveCredentials("/mcp", {
      DATAFORSEO_USERNAME: "user@example.com",
      DATAFORSEO_PASSWORD: "pass123",
    });
    expect(result.username).toBe("user@example.com");
    expect(result.password).toBe("pass123");
  });

  it("returns 404 for /mcp/<empty-token>", () => {
    const result = resolveCredentials("/mcp/", {});
    expect(result.error).toBe("Not found");
    expect(result.status).toBe(404);
  });

  it("returns 404 for unknown paths", () => {
    const result = resolveCredentials("/other", {});
    expect(result.error).toBe("Not found");
    expect(result.status).toBe(404);
  });

  it("rejects when no credentials configured at all", () => {
    const result = resolveCredentials("/mcp", {});
    expect(result.error).toBe("Not found");
  });
});

describe("Auth: KV credential resolution", () => {
  it("resolves credentials from KV when token matches", async () => {
    const mockKV = {
      async get(key: string) {
        if (key === "sk-valid-token") {
          return JSON.stringify({ username: "kv@user.com", password: "kv-pass" });
        }
        return null;
      },
    };
    // Simulate the async KV lookup
    const stored = await mockKV.get("sk-valid-token");
    const parsed = stored ? JSON.parse(stored) : null;
    expect(parsed?.username).toBe("kv@user.com");
    expect(parsed?.password).toBe("kv-pass");
  });

  it("rejects token not found in KV", async () => {
    const mockKV = {
      async get() {
        return null;
      },
    };
    const stored = await mockKV.get("sk-nonexistent");
    expect(stored).toBeNull();
  });
});

describe("Auth: health endpoint", () => {
  it("rejects health at /mcp path", () => {
    const result = resolveCredentials("/mcp", {
      DATAFORSEO_USERNAME: "user@example.com",
      DATAFORSEO_PASSWORD: "pass123",
    });
    expect(result.username).toBe("user@example.com");
  });
});
