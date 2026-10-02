import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deviceLoginArgs,
  parseAgentDeviceLoginOutput,
  resetAgentDeviceLoginForTests,
  startAgentDeviceLogin,
} from '../../src/runtimes/device-login.js';

class FakeLoginChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  killed = false;

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

const codexTranscript = [
  'Follow these steps to sign in with ChatGPT using device code ABCD-EFGHI',
  'https://auth.openai.com/codex/device',
  'Enter this one-time code',
  'ABCD-EFGHI',
].join('\n');

describe('parseAgentDeviceLoginOutput', () => {
  it('reads the Codex device-auth code and URL', () => {
    expect(parseAgentDeviceLoginOutput(codexTranscript)).toEqual({
      userCode: 'ABCD-EFGHI',
      verificationUrl: 'https://auth.openai.com/codex/device',
    });
  });

  it('reads a Code: line when the CLI does not say device code', () => {
    expect(parseAgentDeviceLoginOutput('Open this URL:\nhttps://example.test/device\n\nCode: WXYZ-12345\n')).toEqual({
      userCode: 'WXYZ-12345',
      verificationUrl: 'https://example.test/device',
    });
  });

  it('returns nulls before the CLI has printed a code', () => {
    expect(parseAgentDeviceLoginOutput('')).toEqual({ userCode: null, verificationUrl: null });
  });
});

describe('deviceLoginArgs', () => {
  it('uses the vendor device-login argv and nothing else', () => {
    expect(deviceLoginArgs('codex')).toEqual(['login', '--device-auth']);
    expect(deviceLoginArgs('claude')).toEqual(['auth', 'login']);
  });
});

describe('startAgentDeviceLogin', () => {
  afterEach(() => {
    resetAgentDeviceLoginForTests();
  });

  it('returns the code once chunked stdout has printed it and leaves the login running', async () => {
    const child = new FakeLoginChild();
    let spawns = 0;
    const started = startAgentDeviceLogin('codex', {
      resolveLaunch: () => ({ launchPath: '/usr/bin/codex', childPathPrepend: [] }),
      spawnLogin: (command, args) => {
        spawns += 1;
        expect(command).toBe('/usr/bin/codex');
        expect(args).toEqual(['login', '--device-auth']);
        queueMicrotask(() => {
          child.stdout.emit('data', 'Follow these steps to sign in with ChatGPT using device code ');
          child.stdout.emit('data', 'ABCD-EFGHI\nhttps://auth.openai.com/codex/device\n');
        });
        return child as unknown as ChildProcess;
      },
    });

    await expect(started).resolves.toEqual({
      ok: true,
      userCode: 'ABCD-EFGHI',
      verificationUrl: 'https://auth.openai.com/codex/device',
    });
    expect(child.killed).toBe(false);

    const again = await startAgentDeviceLogin('codex', {
      resolveLaunch: () => ({ launchPath: '/usr/bin/codex', childPathPrepend: [] }),
      spawnLogin: () => {
        spawns += 1;
        return child as unknown as ChildProcess;
      },
    });
    expect(again).toMatchObject({ ok: true, userCode: 'ABCD-EFGHI' });
    expect(spawns).toBe(1);
  });

  it('rejects agents other than Claude Code and Codex', async () => {
    const result = await startAgentDeviceLogin('amr');
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('reports when the CLI is not installed', async () => {
    const result = await startAgentDeviceLogin('codex', {
      resolveLaunch: () => ({ launchPath: null, childPathPrepend: [] }),
    });
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      error: expect.stringMatching(/not installed/i),
    });
  });

  it('reports when the CLI exits without a code', async () => {
    const child = new FakeLoginChild();
    const result = await startAgentDeviceLogin('claude', {
      resolveLaunch: () => ({ launchPath: '/usr/bin/claude', childPathPrepend: [] }),
      spawnLogin: () => {
        queueMicrotask(() => {
          child.exitCode = 1;
          child.emit('exit', 1);
        });
        return child as unknown as ChildProcess;
      },
    });
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(child.killed).toBe(false);
  });
});
