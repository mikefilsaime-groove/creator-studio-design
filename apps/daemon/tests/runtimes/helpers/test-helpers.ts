import { afterEach } from 'vitest';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AGENT_DEFS,
  applyAgentLaunchEnv,
  buildLiveArtifactsMcpServersForAgent,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  detectAgents,
  detectAgentsStream,
  inspectAgentExecutableResolution,
  resolveAgentLaunch,
  resolveAgentExecutable,
  spawnEnvForAgent,
} from '../../../src/agents.js';
import type { RuntimeAgentDef } from '../../../src/runtimes/types.js';
import { aiderAgentDef } from '../../../src/runtimes/defs/aider.js';
import { amrAgentDef } from '../../../src/runtimes/defs/amr.js';
import { ampAgentDef } from '../../../src/runtimes/defs/amp.js';
import { antigravityAgentDef } from '../../../src/runtimes/defs/antigravity.js';
import { claudeAgentDef } from '../../../src/runtimes/defs/claude.js';
import { codebuddyAgentDef } from '../../../src/runtimes/defs/codebuddy.js';
import { codexAgentDef } from '../../../src/runtimes/defs/codex.js';
import { copilotAgentDef } from '../../../src/runtimes/defs/copilot.js';
import { cursorAgentDef as cursorRuntimeAgentDef } from '../../../src/runtimes/defs/cursor-agent.js';
import { deepseekAgentDef } from '../../../src/runtimes/defs/deepseek.js';
import { devinAgentDef } from '../../../src/runtimes/defs/devin.js';
import { grokBuildAgentDef } from '../../../src/runtimes/defs/grok-build.js';
import { hermesAgentDef } from '../../../src/runtimes/defs/hermes.js';
import { kiroAgentDef } from '../../../src/runtimes/defs/kiro.js';
import { kiloAgentDef } from '../../../src/runtimes/defs/kilo.js';
import { kimiAgentDef } from '../../../src/runtimes/defs/kimi.js';
import { mimoAgentDef } from '../../../src/runtimes/defs/mimo.js';
import { opencodeAgentDef } from '../../../src/runtimes/defs/opencode.js';
import { piAgentDef } from '../../../src/runtimes/defs/pi.js';
import { qoderAgentDef } from '../../../src/runtimes/defs/qoder.js';
import { qwenAgentDef } from '../../../src/runtimes/defs/qwen.js';
import { vibeAgentDef } from '../../../src/runtimes/defs/vibe.js';

export {
  assert,
  AGENT_DEFS,
  applyAgentLaunchEnv,
  buildLiveArtifactsMcpServersForAgent,
  checkPromptArgvBudget,
  checkWindowsCmdShimCommandLineBudget,
  checkWindowsDirectExeCommandLineBudget,
  chmodSync,
  detectAgents,
  detectAgentsStream,
  inspectAgentExecutableResolution,
  join,
  mkdirSync,
  mkdtempSync,
  resolveAgentExecutable,
  resolveAgentLaunch,
  rmSync,
  spawnEnvForAgent,
  tmpdir,
  writeFileSync,
};

export type TestAgentDef = RuntimeAgentDef;

const TEST_AGENT_DEFS: TestAgentDef[] = [
  aiderAgentDef,
  amrAgentDef,
  ampAgentDef,
  antigravityAgentDef,
  claudeAgentDef,
  codebuddyAgentDef,
  codexAgentDef,
  copilotAgentDef,
  cursorRuntimeAgentDef,
  deepseekAgentDef,
  devinAgentDef,
  grokBuildAgentDef,
  hermesAgentDef,
  kiroAgentDef,
  kiloAgentDef,
  kimiAgentDef,
  mimoAgentDef,
  opencodeAgentDef,
  piAgentDef,
  qoderAgentDef,
  qwenAgentDef,
  vibeAgentDef,
];

export function requireAgent(id: string): TestAgentDef {
  const agent = TEST_AGENT_DEFS.find((candidate) => candidate.id === id);
  assert.ok(agent, `missing agent definition for ${id}`);
  return agent;
}

export function minimalAgentDef(
  partial: Pick<TestAgentDef, 'bin'> & Partial<TestAgentDef>,
): TestAgentDef {
  const { bin, ...rest } = partial;
  return {
    id: partial.id ?? `test-${bin}`,
    name: partial.name ?? bin,
    bin,
    versionArgs: partial.versionArgs ?? ['--version'],
    fallbackModels: partial.fallbackModels ?? [{ id: 'default', label: 'Default' }],
    buildArgs: partial.buildArgs ?? (() => []),
    streamFormat: partial.streamFormat ?? 'plain',
    ...rest,
  };
}

export const amp = requireAgent('amp');
export const claude = requireAgent('claude');
export const codex = requireAgent('codex');
export const hermes = requireAgent('hermes');
export const kimi = requireAgent('kimi');
export const copilot = requireAgent('copilot');
export const cursorAgent = requireAgent('cursor-agent');
export const kiro = requireAgent('kiro');
export const kilo = requireAgent('kilo');
export const vibe = requireAgent('vibe');
export const devin = requireAgent('devin');
export const pi = requireAgent('pi');
export const deepseek = requireAgent('deepseek');
export const qoder = requireAgent('qoder');
export const qwen = requireAgent('qwen');
export const opencode = requireAgent('opencode');
export const mimo = requireAgent('mimo');
export const grokBuild = requireAgent('grok-build');
export const aider = requireAgent('aider');
export const antigravity = requireAgent('antigravity');
export const codebuddy = requireAgent('codebuddy');
export const deepseekMaxPromptArgBytes = (() => {
  assert.ok(
    deepseek.maxPromptArgBytes !== undefined,
    'deepseek must define maxPromptArgBytes for argv budget tests',
  );
  return deepseek.maxPromptArgBytes;
})();
const originalDisablePlugins = process.env.OD_CODEX_DISABLE_PLUGINS;
const originalPath = process.env.PATH;
const originalHome = process.env.HOME;
const originalAgentHome = process.env.OD_AGENT_HOME;
const originalDaemonUrl = process.env.OD_DAEMON_URL;
const originalToolToken = process.env.OD_TOOL_TOKEN;
const originalNpmConfigPrefix = process.env.NPM_CONFIG_PREFIX;
const originalPathExt = process.env.PATHEXT;
const originalVpHome = process.env.VP_HOME;
const originalFetch = globalThis.fetch;
const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

afterEach(() => {
  if (originalDisablePlugins == null) {
    delete process.env.OD_CODEX_DISABLE_PLUGINS;
  } else {
    process.env.OD_CODEX_DISABLE_PLUGINS = originalDisablePlugins;
  }
  process.env.PATH = originalPath;
  if (originalHome == null) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  if (originalAgentHome == null) {
    delete process.env.OD_AGENT_HOME;
  } else {
    process.env.OD_AGENT_HOME = originalAgentHome;
  }
  if (originalDaemonUrl == null) {
    delete process.env.OD_DAEMON_URL;
  } else {
    process.env.OD_DAEMON_URL = originalDaemonUrl;
  }
  if (originalToolToken == null) {
    delete process.env.OD_TOOL_TOKEN;
  } else {
    process.env.OD_TOOL_TOKEN = originalToolToken;
  }
  if (originalNpmConfigPrefix == null) {
    delete process.env.NPM_CONFIG_PREFIX;
  } else {
    process.env.NPM_CONFIG_PREFIX = originalNpmConfigPrefix;
  }
  if (originalPathExt == null) {
    delete process.env.PATHEXT;
  } else {
    process.env.PATHEXT = originalPathExt;
  }
  if (originalVpHome == null) {
    delete process.env.VP_HOME;
  } else {
    process.env.VP_HOME = originalVpHome;
  }
  globalThis.fetch = originalFetch;
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
});

export function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform,
  });
  return run();
}

export function withEnvSnapshot<T>(
  keys: readonly string[],
  run: () => T | Promise<T>,
): T | Promise<T> {
  const snapshot = new Map(keys.map((key) => [key, process.env[key]]));
  const restore = () => {
    for (const key of keys) {
      const value = snapshot.get(key);
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };

  let result: T | Promise<T>;
  try {
    result = run();
  } catch (error) {
    restore();
    throw error;
  }
  if (result instanceof Promise) {
    return result.finally(restore);
  }
  restore();
  return result;
}
