import { describe, it, expect } from "vitest";

interface TokenEntry {
  username: string;
  password: string;
  name: string;
  created_at: string;
  expires_at: string | null;
}

interface MockKV {
  get: (key: string) => Promise<TokenEntry | null>;
}

function expired(e: TokenEntry): boolean {
  return !!e.expires_at && new Date(e.expires_at).getTime() < Date.now();
}

function isTokenEntry(v: unknown): v is TokenEntry {
  const r = v as Partial<TokenEntry> | null;
  return !!r && typeof r === "object" && typeof r.username === "string" && typeof r.password === "string" && typeof r.name === "string";
}

async function resolveCredentials(path: string, kv?: MockKV): Promise<{ username?: string; password?: string; error?: string; status?: number }> {
  if (path.startsWith("/mcp/")) {
    const token = path.slice(5);
    if (!token) return { error: "Not found", status: 404 };
    if (!kv) return { error: "Credential store is not configured", status: 500 };

    const stored = await kv.get(token);
    if (!isTokenEntry(stored)) return { error: "Invalid access token", status: 401 };
    if (expired(stored)) return { error: "Token has expired", status: 401 };

    return { username: stored.username, password: stored.password };
  }

  if (path === "/mcp") {
    return { error: "Access token required", status: 401 };
  }

  return { error: "Not found", status: 404 };
}

const validEntry: TokenEntry = {
  username: "kv@user.com",
  password: "kv-pass",
  name: "Test Token",
  created_at: new Date().toISOString(),
  expires_at: null,
};

describe("Auth: admin-created KV token resolution", () => {
  it("resolves credentials from KV when /mcp/<token> matches", async () => {
    const kv: MockKV = { get: async (key) => key === "sk-valid-token" ? validEntry : null };
    const result = await resolveCredentials("/mcp/sk-valid-token", kv);
    expect(result.username).toBe("kv@user.com");
    expect(result.password).toBe("kv-pass");
  });

  it("rejects token not found in KV", async () => {
    const kv: MockKV = { get: async () => null };
    const result = await resolveCredentials("/mcp/sk-nonexistent", kv);
    expect(result.error).toBe("Invalid access token");
    expect(result.status).toBe(401);
  });

  it("rejects expired KV tokens", async () => {
    const kv: MockKV = { get: async () => ({ ...validEntry, expires_at: new Date(Date.now() - 1000).toISOString() }) };
    const result = await resolveCredentials("/mcp/sk-expired", kv);
    expect(result.error).toBe("Token has expired");
    expect(result.status).toBe(401);
  });

  it("rejects malformed KV values", async () => {
    const kv = { get: async () => ({ username: "bad" }) } as unknown as MockKV;
    const result = await resolveCredentials("/mcp/sk-bad", kv);
    expect(result.error).toBe("Invalid access token");
    expect(result.status).toBe(401);
  });

  it("rejects /mcp/<token> when KV is missing", async () => {
    const result = await resolveCredentials("/mcp/sk-token");
    expect(result.error).toBe("Credential store is not configured");
    expect(result.status).toBe(500);
  });

  it("rejects plain /mcp because admin-created tokens are required", async () => {
    const result = await resolveCredentials("/mcp");
    expect(result.error).toBe("Access token required");
    expect(result.status).toBe(401);
  });

  it("returns 404 for /mcp/<empty-token>", async () => {
    const result = await resolveCredentials("/mcp/");
    expect(result.error).toBe("Not found");
    expect(result.status).toBe(404);
  });

  it("returns 404 for unknown paths", async () => {
    const result = await resolveCredentials("/other");
    expect(result.error).toBe("Not found");
    expect(result.status).toBe(404);
  });
});
