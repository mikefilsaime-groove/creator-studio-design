import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCreatorStudioDesignAuth,
  createCreatorStudioDesignDevelopmentAuth,
  verifyCreatorStudioDesignLease,
  type CreatorStudioDesignCredentialStorage,
} from "../../src/main/creator-studio-auth.js";

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function signedLease(now: number) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const header = base64url({ alg: "EdDSA", typ: "JWT", kid: "test-key" });
  const claims = base64url({
    aud: "creator-studio-design",
    exp: Math.floor(now / 1000) + 3600,
    godmode: true,
    iss: "https://clickcampaigns.ai",
    sub: "member-1",
  });
  const signingInput = `${header}.${claims}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey).toString("base64url");
  return {
    jwk: publicKey.export({ format: "jwk" }),
    lease: `${signingInput}.${signature}`,
  };
}

function memoryStorage(initial: Awaited<ReturnType<CreatorStudioDesignCredentialStorage["read"]>> = null) {
  let value = initial;
  return {
    storage: {
      async clear() { value = null; },
      async read() { return value; },
      async write(next) { value = next; },
    } satisfies CreatorStudioDesignCredentialStorage,
    read: () => value,
  };
}

describe("Creator Studio Design authentication", () => {
  it("provides an explicit local-development unlock without credentials or network calls", async () => {
    const auth = createCreatorStudioDesignDevelopmentAuth();

    await expect(auth.status()).resolves.toEqual(expect.objectContaining({
      active: true,
      offline: true,
      state: "active",
    }));
    await expect(auth.startPairing()).resolves.toEqual(expect.objectContaining({ active: true }));
    await expect(auth.logout()).resolves.toEqual(expect.objectContaining({ active: true }));
  });

  it("keeps pairing secrets and the app access token out of renderer-visible status", async () => {
    const now = Date.now();
    const responses = [
      new Response(JSON.stringify({
        expiresAt: new Date(now + 600_000).toISOString(),
        id: "pair-1",
        pollSecret: "poll-secret",
        userCode: "ABCD-EFGH",
      }), { status: 201 }),
      new Response(JSON.stringify({ accessToken: "cliauth-secret", status: "approved" }), { status: 200 }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const memory = memoryStorage();
    const auth = createCreatorStudioDesignAuth({ fetchImpl, now: () => now, storage: memory.storage });

    await expect(auth.startPairing()).resolves.toEqual(expect.objectContaining({
      state: "pairing",
      userCode: "ABCD-EFGH",
    }));
    await expect(auth.pollPairing()).resolves.toEqual({ active: true, state: "active" });
    expect(JSON.stringify(await auth.status())).not.toContain("cliauth-secret");
    expect(memory.read()).toEqual({
      accessToken: "cliauth-secret",
      authorizedAt: new Date(now).toISOString(),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps an authenticated device authorized across launches without a network recheck", async () => {
    const memory = memoryStorage({ accessToken: "cliauth-secret" });
    const fetchImpl = vi.fn(async () => { throw new Error("offline"); });
    const auth = createCreatorStudioDesignAuth({
      fetchImpl,
      storage: memory.storage,
    });

    await expect(auth.status()).resolves.toEqual({ active: true, state: "active" });
    await expect(auth.status()).resolves.toEqual({ active: true, state: "active" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(memory.read()).toEqual({ accessToken: "cliauth-secret" });
  });

  it("rejects a lease for another audience", () => {
    const now = Date.now();
    const { jwk, lease } = signedLease(now);
    const parts = lease.split(".");
    const wrongClaims = base64url({
      aud: "creatorstudio-editor",
      exp: Math.floor(now / 1000) + 3600,
      godmode: true,
      iss: "https://clickcampaigns.ai",
    });
    expect(verifyCreatorStudioDesignLease(`${parts[0]}.${wrongClaims}.${parts[2]}`, jwk, now)).toBe(false);
  });

  it("clears durable authorization only when the user explicitly disconnects", async () => {
    const memory = memoryStorage({ accessToken: "cliauth-secret" });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => new Response(null, { status: 204 }));
    const auth = createCreatorStudioDesignAuth({
      fetchImpl,
      storage: memory.storage,
    });

    await expect(auth.status()).resolves.toEqual({ active: true, state: "active" });
    await expect(auth.logout()).resolves.toEqual({ active: false, state: "signed-out" });
    await expect(auth.status()).resolves.toEqual({ active: false, state: "signed-out" });
    expect(memory.read()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0]).toContain("/logout");
  });
});
