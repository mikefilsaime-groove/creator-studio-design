import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCreatorStudioDesignAuth,
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
  it("keeps pairing secrets and the app access token out of renderer-visible status", async () => {
    const now = Date.now();
    const { jwk, lease } = signedLease(now);
    const responses = [
      new Response(JSON.stringify({
        expiresAt: new Date(now + 600_000).toISOString(),
        id: "pair-1",
        pollSecret: "poll-secret",
        userCode: "ABCD-EFGH",
      }), { status: 201 }),
      new Response(JSON.stringify({ accessToken: "cliauth-secret", status: "approved" }), { status: 200 }),
      new Response(JSON.stringify({ active: true, godmode: true, lease }), { status: 200 }),
      new Response(JSON.stringify({ keys: [jwk] }), { status: 200 }),
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
    expect(memory.read()).toEqual(expect.objectContaining({ accessToken: "cliauth-secret", lease }));
  });

  it("accepts a valid app-bound offline lease after a network failure", async () => {
    const now = Date.now();
    const { jwk, lease } = signedLease(now);
    const memory = memoryStorage({ accessToken: "cliauth-secret", lease, leaseJwk: jwk });
    const auth = createCreatorStudioDesignAuth({
      fetchImpl: vi.fn(async () => { throw new Error("offline"); }),
      now: () => now,
      storage: memory.storage,
    });

    await expect(auth.status()).resolves.toEqual(expect.objectContaining({
      active: true,
      offline: true,
      state: "active",
    }));
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

  it("fails closed when Mastermind is inactive", async () => {
    const memory = memoryStorage({ accessToken: "cliauth-secret" });
    const auth = createCreatorStudioDesignAuth({
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        active: false,
        godmode: false,
        reason: "inactive",
      }), { status: 200 })),
      storage: memory.storage,
    });

    await expect(auth.status()).resolves.toEqual(expect.objectContaining({
      active: false,
      reason: "inactive",
      state: "inactive",
    }));
  });
});
