import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CreatorStudioDesignAuthStatus } from "@open-design/host";

const DEFAULT_AUTH_BASE_URL =
  "https://clickcampaigns.ai/api/godmode/v1/apps/creator-studio-design";
const EXPECTED_LEASE_AUDIENCE = "creator-studio-design";
const EXPECTED_LEASE_ISSUER = "https://clickcampaigns.ai";

type PairingSession = {
  id: string;
  userCode: string;
  pollSecret: string;
  expiresAt: string;
};

type StoredCredential = {
  accessToken: string;
  lease?: string;
  leaseJwk?: JsonWebKey;
};

export type CreatorStudioDesignCredentialStorage = {
  read(): Promise<StoredCredential | null>;
  write(value: StoredCredential): Promise<void>;
  clear(): Promise<void>;
};

export type CreatorStudioDesignAuth = {
  status(): Promise<CreatorStudioDesignAuthStatus>;
  startPairing(): Promise<CreatorStudioDesignAuthStatus>;
  pollPairing(): Promise<CreatorStudioDesignAuthStatus>;
  logout(): Promise<CreatorStudioDesignAuthStatus>;
};

type AuthOptions = {
  storage: CreatorStudioDesignCredentialStorage;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

type ApiError = {
  code?: string;
  message?: string;
  retryable?: boolean;
};

type EntitlementResponse = ApiError & {
  active?: boolean;
  godmode?: boolean;
  suspended?: boolean;
  reason?: string;
  lease?: string;
};

function authError(message: string, reason = "authentication_unavailable"): CreatorStudioDesignAuthStatus {
  return { active: false, message, reason, state: "error" };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value != null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function apiMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.message === "string" && body.message.length > 0
    ? body.message
    : fallback;
}

function parsePairingSession(value: Record<string, unknown>): PairingSession | null {
  if (
    typeof value.id !== "string"
    || typeof value.userCode !== "string"
    || typeof value.pollSecret !== "string"
    || typeof value.expiresAt !== "string"
  ) return null;
  return {
    id: value.id,
    userCode: value.userCode,
    pollSecret: value.pollSecret,
    expiresAt: value.expiresAt,
  };
}

function decodeJsonSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value != null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function verifyCreatorStudioDesignLease(
  lease: string,
  jwk: JsonWebKey,
  now = Date.now(),
): boolean {
  const parts = lease.split(".");
  if (parts.length !== 3) return false;
  const header = decodeJsonSegment(parts[0]);
  const claims = decodeJsonSegment(parts[1]);
  if (header?.alg !== "EdDSA" || claims == null) return false;
  const audience = claims.aud;
  const audienceMatches = audience === EXPECTED_LEASE_AUDIENCE
    || (Array.isArray(audience) && audience.includes(EXPECTED_LEASE_AUDIENCE));
  if (
    !audienceMatches
    || claims.iss !== EXPECTED_LEASE_ISSUER
    || claims.godmode !== true
    || typeof claims.exp !== "number"
    || claims.exp * 1000 <= now
  ) return false;
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      key,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    return false;
  }
}

export function createEncryptedFileCredentialStorage(options: {
  filePath: string;
  encrypt(plaintext: string): Buffer;
  decrypt(ciphertext: Buffer): string;
}): CreatorStudioDesignCredentialStorage {
  return {
    async read() {
      try {
        const ciphertext = Buffer.from(await readFile(options.filePath, "utf8"), "base64");
        const parsed: unknown = JSON.parse(options.decrypt(ciphertext));
        if (
          parsed == null
          || typeof parsed !== "object"
          || Array.isArray(parsed)
          || typeof (parsed as StoredCredential).accessToken !== "string"
        ) return null;
        return parsed as StoredCredential;
      } catch {
        return null;
      }
    },
    async write(value) {
      await mkdir(dirname(options.filePath), { recursive: true });
      const temporaryPath = `${options.filePath}.tmp`;
      const encrypted = options.encrypt(JSON.stringify(value)).toString("base64");
      await writeFile(temporaryPath, encrypted, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, options.filePath);
    },
    async clear() {
      await unlink(options.filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    },
  };
}

export function createCreatorStudioDesignAuth(options: AuthOptions): CreatorStudioDesignAuth {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_AUTH_BASE_URL).replace(/\/+$/, "");
  const now = options.now ?? Date.now;
  let pairing: PairingSession | null = null;

  const request = (path: string, init?: RequestInit) => fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body == null ? {} : { "content-type": "application/json" }),
      ...init?.headers,
    },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });

  const activeFromCredential = async (
    credential: StoredCredential,
  ): Promise<CreatorStudioDesignAuthStatus> => {
    try {
      const response = await request("/entitlement", {
        headers: { authorization: `Bearer ${credential.accessToken}` },
      });
      const body = await readJson(response) as EntitlementResponse;
      if (response.status === 401) {
        await options.storage.clear();
        return {
          active: false,
          message: apiMessage(body, "Your Creator Studio Design connection expired. Connect again."),
          reason: typeof body.code === "string" ? body.code : "invalid_access_token",
          state: "signed-out",
        };
      }
      if (response.status === 403 || (response.ok && body.active !== true)) {
        return {
          active: false,
          message: apiMessage(body, "An active Mastermind membership is required."),
          reason: typeof body.reason === "string" ? body.reason : "mastermind_inactive",
          state: "inactive",
        };
      }
      if (!response.ok || body.active !== true || body.godmode !== true) {
        throw new Error(apiMessage(body, `Authentication server returned ${response.status}.`));
      }

      let leaseJwk = credential.leaseJwk;
      if (typeof body.lease === "string") {
        const keysResponse = await request("/lease-keys");
        const keysBody = await readJson(keysResponse);
        const keys = Array.isArray(keysBody.keys) ? keysBody.keys : [];
        const firstKey = keys[0];
        if (keysResponse.ok && firstKey != null && typeof firstKey === "object") {
          leaseJwk = firstKey as JsonWebKey;
        }
      }
      await options.storage.write({
        accessToken: credential.accessToken,
        ...(typeof body.lease === "string" ? { lease: body.lease } : {}),
        ...(leaseJwk == null ? {} : { leaseJwk }),
      });
      return { active: true, state: "active" };
    } catch (error) {
      if (
        credential.lease != null
        && credential.leaseJwk != null
        && verifyCreatorStudioDesignLease(credential.lease, credential.leaseJwk, now())
      ) {
        return {
          active: true,
          message: "Mastermind access is verified from the encrypted offline lease.",
          offline: true,
          state: "active",
        };
      }
      return authError(
        error instanceof Error ? error.message : "Mastermind access could not be verified.",
      );
    }
  };

  return {
    async status() {
      const credential = await options.storage.read();
      return credential == null
        ? { active: false, state: "signed-out" }
        : activeFromCredential(credential);
    },
    async startPairing() {
      try {
        const response = await request("/pairing-sessions", { method: "POST" });
        const body = await readJson(response);
        if (!response.ok) return authError(apiMessage(body, "Could not start secure pairing."));
        pairing = parsePairingSession(body);
        if (pairing == null) return authError("The pairing server returned an invalid response.");
        return {
          active: false,
          expiresAt: pairing.expiresAt,
          state: "pairing",
          userCode: pairing.userCode,
        };
      } catch (error) {
        return authError(error instanceof Error ? error.message : "Could not start secure pairing.");
      }
    },
    async pollPairing() {
      if (pairing == null) {
        return authError("Start a new pairing session first.", "pairing_not_started");
      }
      if (Date.parse(pairing.expiresAt) <= now()) {
        pairing = null;
        return authError("The pairing code expired. Start again.", "pairing_expired");
      }
      try {
        const response = await request(`/pairing-sessions/${encodeURIComponent(pairing.id)}/exchange`, {
          body: JSON.stringify({ pollSecret: pairing.pollSecret }),
          method: "POST",
        });
        const body = await readJson(response);
        if (response.status === 202 || body.status === "pending") {
          return {
            active: false,
            expiresAt: pairing.expiresAt,
            state: "pairing",
            userCode: pairing.userCode,
          };
        }
        if (!response.ok || typeof body.accessToken !== "string") {
          return authError(apiMessage(body, "Secure pairing failed."),
            typeof body.code === "string" ? body.code : "pairing_failed");
        }
        const credential = { accessToken: body.accessToken };
        await options.storage.write(credential);
        pairing = null;
        return activeFromCredential(credential);
      } catch (error) {
        return authError(error instanceof Error ? error.message : "Secure pairing failed.");
      }
    },
    async logout() {
      const credential = await options.storage.read();
      if (credential != null) {
        try {
          await request("/logout", {
            headers: { authorization: `Bearer ${credential.accessToken}` },
            method: "POST",
          });
        } catch {
          // Local disconnect remains authoritative even when the server is offline.
        }
      }
      await options.storage.clear();
      pairing = null;
      return { active: false, state: "signed-out" };
    },
  };
}
