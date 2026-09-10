import { test } from 'vitest';
import { copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseCodexPackageLocations, windowsCodexAppCandidates } from '../../src/runtimes/codex-windows-app.js';
import { inspectAgentExecutableResolution } from '../../src/runtimes/executables.js';
import { buildExecutableDiagnostic, buildNotInvocableDiagnostic } from '../../src/runtimes/diagnostics.js';
import { assert, codex, join, mkdirSync, mkdtempSync, resolveAgentExecutable, rmSync, tmpdir, withEnvSnapshot, withPlatform, writeFileSync } from './helpers/test-helpers.js';

const scopedEnv = ['PATH', 'PATHEXT', 'OD_AGENT_HOME', 'OD_SANDBOX_MODE', 'OD_DATA_DIR', 'LOCALAPPDATA', 'CODEX_BIN'];
function withWindowsApp(run: (home: string, executable: string) => void) {
  const home = mkdtempSync(join(tmpdir(), 'od-codex-windows-'));
  try {
    return withEnvSnapshot(scopedEnv, () => withPlatform('win32', () => {
      delete process.env.OD_SANDBOX_MODE;
      delete process.env.OD_DATA_DIR;
      delete process.env.CODEX_BIN;
      process.env.OD_AGENT_HOME = home;
      process.env.LOCALAPPDATA = join(home, 'outside-home-override');
      process.env.PATH = '';
      process.env.PATHEXT = '.EXE;.CMD;.BAT';
      const bin = join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'installed-build');
      mkdirSync(bin, { recursive: true });
      const executable = join(bin, 'codex.exe');
      writeFileSync(executable, 'fixture');
      run(home, executable);
    }));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test('Windows app-only Codex installation resolves without a PATH entry', () => {
  withWindowsApp((_home, executable) => assert.equal(resolveAgentExecutable(codex), executable));
});

test('Windows Codex keeps an explicit CLI path ahead of desktop discovery', () => {
  withWindowsApp((home) => {
    const explicit = join(home, 'explicit-codex.exe');
    writeFileSync(explicit, 'fixture');
    assert.equal(resolveAgentExecutable(codex, { CODEX_BIN: explicit }), explicit);
  });
});

test.skipIf(process.platform !== 'win32')('Windows-discovered runtime launches directly with spaces in its path', () => {
  withWindowsApp((home, executable) => {
    const withSpaces = join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'build with spaces', 'codex.exe');
    mkdirSync(join(withSpaces, '..'), { recursive: true });
    rmSync(executable);
    copyFileSync(process.execPath, withSpaces);
    const selected = resolveAgentExecutable(codex);
    assert.equal(selected, withSpaces);
    assert.equal(execFileSync(selected!, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }).trim(), process.version);
  });
});


test('Store install locations resolve the bundled CLI, never the desktop executable', () => {
  withWindowsApp((home) => {
    const root = join(home, 'WindowsApps', 'OpenAI.Codex_version_x64');
    const candidates = windowsCodexAppCandidates(home, false, () => [root]);
    assert.ok(candidates.includes(join(root, 'app', 'resources', 'codex.exe')));
    assert.ok(!candidates.includes(join(root, 'app', 'Codex.exe')));
    assert.deepEqual(parseCodexPackageLocations(`\uFEFF${JSON.stringify([root, 'relative/path', null])}`), [root]);
    assert.deepEqual(parseCodexPackageLocations('not json'), []);
  });
});

test('isolated homes never query the host Store registration or LOCALAPPDATA', () => {
  withWindowsApp((home, executable) => {
    const candidates = windowsCodexAppCandidates(home, true, () => { throw new Error('Host Store must not be queried'); });
    assert.ok(candidates.includes(executable));
    assert.ok(candidates.every(candidate => !candidate.includes('outside-home-override')));
  });
});

test('a broken cached executable can be skipped without losing another installed build', () => {
  withWindowsApp((home, executable) => {
    const second = join(home, 'AppData', 'Local', 'OpenAI', 'Codex', 'bin', 'other-build', 'codex.exe');
    mkdirSync(join(second, '..'), { recursive: true });
    writeFileSync(second, 'fixture');
    const result = inspectAgentExecutableResolution(codex, {}, { skipPathCandidates: [executable] });
    assert.equal(result.selectedPath, second);
  });
});

test('Windows diagnostics offer installation and path recovery without Unix permission advice', () => {
  withWindowsApp(() => {
    const missing = buildExecutableDiagnostic(codex);
    assert.match(missing.message, /Codex desktop installation/);
    assert.ok(missing.fixActions?.some(action => action.kind === 'openInstall'));
    const blocked = buildNotInvocableDiagnostic(codex, { selectedPath: 'codex.exe', launchPath: 'codex.exe' }, 'not-executable');
    assert.match(blocked.message, /Windows blocked/);
    assert.doesNotMatch(blocked.message, /execute permission/);
    assert.ok(blocked.fixActions?.some(action => action.kind === 'openInstall'));
  });
});


test.skipIf(process.platform !== 'win32')('Windows Store lookup returns without requiring an installed Store package', () => {
  withWindowsApp(home => {
    const candidates = windowsCodexAppCandidates(home, false);
    assert.ok(candidates.every(candidate => candidate.endsWith('codex.exe')));
  });
});
