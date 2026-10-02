import type { AgentInfo } from './registry.js';

export type AgentCompanionSetupAction = 'already-compatible' | 'installed' | 'repaired';

export interface AgentCompanionSetupResponse {
  action: AgentCompanionSetupAction;
  agent: AgentInfo;
  ok: true;
  packageVersion: string;
}

/** Agents whose install choice can start a vendor device-code sign-in. */
export type AgentDeviceLoginAgentId = 'claude' | 'codex';

/**
 * Body of POST /api/agents/:agentId/device-login.
 * `userCode` is the one-time code the CLI printed; the login process keeps
 * running after this response so the code stays valid.
 */
export type AgentDeviceLoginResponse =
  | {
      ok: true;
      userCode: string;
      verificationUrl: string | null;
    }
  | {
      ok: false;
      error: string;
    };
