import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const STORE_QUERY_TIMEOUT_MS = 2500;
let storeCache: { key: string; at: number; roots: string[] } | undefined;

export function clearWindowsCodexAppCache(): void {
  storeCache = undefined;
}

/** Read only the current user's registered Codex package; never enumerate WindowsApps. */
function registeredCodexLocations(): string[] {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT || process.env.WINDIR;
  if (!systemRoot) return [];
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (!existsSync(powershell)) return [];
  const key = `${powershell}:${process.env.USERPROFILE || ''}`;
  if (storeCache?.key === key && Date.now() - storeCache.at < 60_000) return storeCache.roots;
  let roots: string[] = [];
  try {
    const output = execFileSync(powershell, [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); ConvertTo-Json -Compress -InputObject @(Get-AppxPackage -Name OpenAI.Codex -ErrorAction Stop | Sort-Object Version -Descending | Select-Object -First 3 -ExpandProperty InstallLocation)',
    ], { encoding: 'utf8', timeout: STORE_QUERY_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    roots = parseCodexPackageLocations(output);
  } catch {
    // Store/PowerShell may be unavailable under corporate policy. Local CLI
    // detection remains usable and diagnostics expose the normal install/path actions.
  }
  storeCache = { key, at: Date.now(), roots };
  return roots;
}

export function parseCodexPackageLocations(output: string): string[] {
  try {
    const parsed: unknown = JSON.parse(output.replace(/^\uFEFF/, '').trim());
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((value): value is string => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0'))
      .slice(0, 3);
  } catch {
    return [];
  }
}

export function windowsCodexAppCandidates(
  home: string,
  hasOverride: boolean,
  registeredLocations: () => string[] = registeredCodexLocations,
): string[] {
  const local = hasOverride ? path.join(home, 'AppData', 'Local') : process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const binRoot = path.join(local, 'OpenAI', 'Codex', 'bin');
  const candidates = [path.join(binRoot, 'codex.exe')];
  try {
    const builds = readdirSync(binRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).slice(0, 64)
      .map(entry => {
        const root = path.join(binRoot, entry.name);
        try { return { root, modified: statSync(root).mtimeMs }; }
        catch { return { root, modified: 0 }; }
      })
      .sort((a, b) => b.modified - a.modified || a.root.localeCompare(b.root));
    // Prefer the app's runnable user-local CLI over a protected Store resource.
    candidates.push(...builds.slice(0, 8).map(build => path.join(build.root, 'codex.exe')));
  } catch {
    // The app may not have staged a CLI yet; try its registered package below.
  }
  if (!hasOverride) {
    candidates.push(...registeredLocations().map(root => path.join(root, 'app', 'resources', 'codex.exe')));
  }
  return [...new Set(candidates)];
}
