import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { createCommandInvocation } from '@open-design/platform';
import type { AgentDeviceLoginResponse } from '@open-design/contracts';
import { applyAgentLaunchEnv, resolveAgentLaunch, type AgentLaunchResolution } from './launch.js';
import { getAgentDef } from './registry.js';

export type AgentDeviceLoginResult =
  | Extract<AgentDeviceLoginResponse, { ok: true }>
  | (Extract<AgentDeviceLoginResponse, { ok: false }> & { status: 400 | 409 | 502 });

export interface DeviceLoginLaunch {
  launchPath: string | null;
  childPathPrepend: string[];
}

type SpawnLogin = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio: ['ignore', 'pipe', 'pipe'];
    windowsVerbatimArguments?: boolean;
  },
) => ChildProcess;

export interface StartAgentDeviceLoginOptions {
  env?: NodeJS.ProcessEnv;
  resolveLaunch?: (agentId: 'claude' | 'codex') => DeviceLoginLaunch;
  spawnLogin?: SpawnLogin;
  waitMs?: number;
}

interface DeviceLoginSession {
  child: ChildProcess;
  result: Extract<AgentDeviceLoginResult, { ok: true }>;
}

const sessions = new Map<string, DeviceLoginSession>();
const DEFAULT_WAIT_MS = 12_000;

/**
 * Pull the one-time device code and the first verification URL out of a
 * Claude or Codex login transcript. Codex prints `device code ABCD-EFGHI`
 * before the URL; a later `Code:` line is the fallback used by other CLIs.
 */
export function parseAgentDeviceLoginOutput(text: string): {
  userCode: string | null;
  verificationUrl: string | null;
} {
  const urlMatch = text.match(/https?:\/\/[^\s)]+/i);
  const verificationUrl = urlMatch?.[0] ?? null;
  const deviceCode = text.match(/device code\s+([A-Z0-9]+(?:-[A-Z0-9]+)+)/i);
  if (deviceCode?.[1]) return { userCode: deviceCode[1], verificationUrl };
  const oneTime = text.match(/one-time code[^\n]*\n+\s*([A-Z0-9]+(?:-[A-Z0-9]+)+)/i);
  if (oneTime?.[1]) return { userCode: oneTime[1], verificationUrl };
  const codeLine = text.match(/^Code:\s*([A-Z0-9]+(?:-[A-Z0-9]+)+)\s*$/im);
  if (codeLine?.[1]) return { userCode: codeLine[1], verificationUrl };
  return { userCode: null, verificationUrl };
}

/** Fixed argv for a local device-code login. No caller input is interpolated. */
export function deviceLoginArgs(agentId: 'claude' | 'codex'): string[] {
  return agentId === 'codex' ? ['login', '--device-auth'] : ['auth', 'login'];
}

function defaultResolveLaunch(agentId: 'claude' | 'codex'): DeviceLoginLaunch {
  const def = getAgentDef(agentId);
  if (!def) return { launchPath: null, childPathPrepend: [] };
  const launch: AgentLaunchResolution = resolveAgentLaunch(def, {});
  return { launchPath: launch.launchPath, childPathPrepend: launch.childPathPrepend };
}

function agentLabel(agentId: 'claude' | 'codex'): string {
  return agentId === 'codex' ? 'Codex CLI' : 'Claude Code';
}

function sessionStillWaiting(session: DeviceLoginSession): boolean {
  return session.child.exitCode === null && session.child.signalCode === null && !session.child.killed;
}

/**
 * Start `claude auth login` or `codex login --device-auth` and resolve once
 * the one-time code is printed. The child is left running: killing it would
 * invalidate the code the user still has to enter.
 * An in-flight login for the same agent is reused until that child exits.
 */
export async function startAgentDeviceLogin(
  agentId: string,
  options: StartAgentDeviceLoginOptions = {},
): Promise<AgentDeviceLoginResult> {
  if (agentId !== 'claude' && agentId !== 'codex') {
    return {
      ok: false,
      status: 400,
      error: `device-login is only supported for claude and codex, got ${agentId}`,
    };
  }

  const existing = sessions.get(agentId);
  if (existing && sessionStillWaiting(existing)) return existing.result;
  if (existing) sessions.delete(agentId);

  const launch = (options.resolveLaunch ?? defaultResolveLaunch)(agentId);
  if (!launch.launchPath) {
    return {
      ok: false,
      status: 409,
      error: `${agentLabel(agentId)} is not installed. Install it, then choose it again.`,
    };
  }

  const env = applyAgentLaunchEnv({ ...(options.env ?? process.env) }, launch);
  const invocation = createCommandInvocation({
    command: launch.launchPath,
    args: deviceLoginArgs(agentId),
    env,
  });
  const spawnLogin: SpawnLogin = options.spawnLogin ?? ((command, args, spawnOptions) => (
    spawn(command, args, spawnOptions)
  ));

  let child: ChildProcess;
  try {
    child = spawnLogin(invocation.command, invocation.args, {
      cwd: os.tmpdir(),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsVerbatimArguments: invocation.windowsVerbatimArguments === true,
    });
  } catch (error) {
    return {
      ok: false,
      status: 502,
      error: `Could not start ${agentLabel(agentId)} sign-in: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const transcript = await waitForDeviceCode(child, options.waitMs ?? DEFAULT_WAIT_MS);
  const parsed = parseAgentDeviceLoginOutput(transcript);
  if (!parsed.userCode) {
    if (child.exitCode === null && child.signalCode === null && !child.killed) child.kill();
    const hint = parsed.verificationUrl ? ` Open ${parsed.verificationUrl}.` : '';
    return {
      ok: false,
      status: 502,
      error: `${agentLabel(agentId)} did not print a sign-in code.${hint}`,
    };
  }

  const result: Extract<AgentDeviceLoginResult, { ok: true }> = {
    ok: true,
    userCode: parsed.userCode,
    verificationUrl: parsed.verificationUrl,
  };
  sessions.set(agentId, { child, result });
  return result;
}

function waitForDeviceCode(child: ChildProcess, waitMs: number): Promise<string> {
  return new Promise((resolve) => {
    let text = '';
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(text);
    };
    const onData = (chunk: Buffer | string) => {
      text += chunk.toString();
      if (parseAgentDeviceLoginOutput(text).userCode) finish();
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('exit', finish);
    child.once('error', finish);
    const timer = setTimeout(finish, waitMs);
  });
}

/** Drop cached login children. Tests use this so one case cannot leak into the next. */
export function resetAgentDeviceLoginForTests(): void {
  for (const session of sessions.values()) {
    if (session.child.exitCode === null && session.child.signalCode === null && !session.child.killed) {
      session.child.kill();
    }
  }
  sessions.clear();
}
