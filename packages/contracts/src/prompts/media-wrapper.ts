/**
 * Cross-shell recipes for Creator Studio Design media wrapper calls.
 *
 * Windows Codex (and Claude Code when Git Bash is absent) uses PowerShell.
 * `$OD_NODE_BIN` is a PowerShell *variable* and expands empty even when the
 * daemon injected `$env:OD_NODE_BIN`. Agents that echo the POSIX form then
 * never reach `media generate` / `media wait`, so video handoffs die with the
 * generic Creator Studio Design support sentence.
 *
 * This module is the single source for POSIX / PowerShell / cmd.exe forms so
 * prompts, CLI help, and the wait handoff cannot drift.
 */

export const MEDIA_WRAPPER_POSIX = '"$OD_NODE_BIN" "$OD_BIN"';
export const MEDIA_WRAPPER_POWERSHELL = '& $env:OD_NODE_BIN $env:OD_BIN';
export const MEDIA_WRAPPER_CMD = '"%OD_NODE_BIN%" "%OD_BIN%"';

/** Visible assistant sentence when the matching-shell wrapper env is empty. */
export const MEDIA_MISSING_RUNTIME_USER_SENTENCE_EN =
  "Creator Studio Design couldn't find its Node runtime, so the image wasn't generated. Quit and reopen the desktop app, then try again.";

export const MEDIA_MISSING_RUNTIME_USER_SENTENCE_ZH =
  'Creator Studio Design 找不到 Node 运行时，图片没生成。请完全退出并重新打开桌面应用后再试。';

export function renderMediaWrapperCommandRecipes(subcommand: string): string {
  const cmd = subcommand.trim();
  return [
    '```bash',
    `${MEDIA_WRAPPER_POSIX} ${cmd}`,
    '```',
    '',
    '```powershell',
    `${MEDIA_WRAPPER_POWERSHELL} ${cmd}`,
    '```',
    '',
    '```cmd',
    `${MEDIA_WRAPPER_CMD} ${cmd}`,
    '```',
  ].join('\n');
}

export function renderMediaWaitHandoffHint(taskId: string, since: number): string {
  const suffix = `media wait ${taskId} --since ${since}`;
  return (
    `POSIX: ${MEDIA_WRAPPER_POSIX} ${suffix}. ` +
    `PowerShell: ${MEDIA_WRAPPER_POWERSHELL} ${suffix}. ` +
    `cmd.exe: ${MEDIA_WRAPPER_CMD} ${suffix}.`
  );
}

/**
 * Agent-facing notes that sit next to the generate→wait recipes.
 * These are prompt/help text, not user-visible chat copy.
 */
export function renderMediaShellInvocationNotes(): string {
  return [
    'Choose the form that matches your shell. Do not guess a translation:',
    'in PowerShell `$OD_NODE_BIN` is always empty — that is a PowerShell variable, not the injected environment value. Use `$env:OD_NODE_BIN` and `$env:OD_BIN`.',
    'On cmd.exe use `%OD_NODE_BIN%` and `%OD_BIN%`.',
    'Parse JSON with the injected Node runtime (`"$OD_NODE_BIN" -e …`) or PowerShell `ConvertFrom-Json`. Do not use `python3` or `jq`; neither is guaranteed on Windows.',
    'If the matching-shell check shows `OD_NODE_BIN` or `OD_BIN` empty, keep those names in the tool trace and use the missing-runtime user sentence. Do not use `contact-support` for a missing runtime.',
  ].join('\n');
}

export function renderMediaGenerateWaitLoopRecipes(): string {
  return [
    '```bash',
    '# POSIX bash / Git Bash',
    'IMAGE_MODEL=IMAGE_MODEL_VALUE',
    `out=$(${MEDIA_WRAPPER_POSIX} media generate \\`,
    '  --project "$OD_PROJECT_ID" \\',
    '  --surface image \\',
    '  --model "$IMAGE_MODEL" \\',
    '  --prompt "..." \\',
    '  --aspect 16:9)',
    'ec=$?',
    'if [ "$ec" -ne 0 ]; then echo "$out" >&2; exit "$ec"; fi',
    'last=$(printf \'%s\\n\' "$out" | tail -1)',
    'task_id=$("$OD_NODE_BIN" -e "const d=JSON.parse(process.argv[1]||\'{}\');process.stdout.write(d.taskId||\'\')" -- "$last")',
    'since=$("$OD_NODE_BIN" -e "const d=JSON.parse(process.argv[1]||\'{}\');process.stdout.write(String(d.nextSince||0))" -- "$last")',
    'since="${since:-0}"',
    'while [ -n "$task_id" ]; do',
    `  out=$(${MEDIA_WRAPPER_POSIX} media wait "$task_id" --since "$since")`,
    '  ec=$?',
    '  last=$(printf \'%s\\n\' "$out" | tail -1)',
    '  since=$("$OD_NODE_BIN" -e "const d=JSON.parse(process.argv[1]||\'{}\');process.stdout.write(String(d.nextSince||0))" -- "$last")',
    '  since="${since:-0}"',
    '  if [ "$ec" -eq 0 ]; then',
    '    task_id=""',
    '  elif [ "$ec" -ne 2 ]; then',
    '    echo "$out" >&2; exit "$ec"',
    '  fi',
    'done',
    'printf \'%s\\n\' "$last"',
    '```',
    '',
    '```powershell',
    '# PowerShell — $env:VAR, not $VAR',
    'if (-not $env:OD_NODE_BIN -or -not $env:OD_BIN) { throw \'OD_NODE_BIN/OD_BIN missing in this shell\' }',
    '$IMAGE_MODEL = IMAGE_MODEL_VALUE',
    '$out = & $env:OD_NODE_BIN $env:OD_BIN media generate --project $env:OD_PROJECT_ID --surface image --model $IMAGE_MODEL --prompt "..." --aspect 16:9 | Out-String',
    'if ($LASTEXITCODE -ne 0) { Write-Error $out; exit $LASTEXITCODE }',
    '$last = ($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)',
    '$parsed = $last | ConvertFrom-Json',
    'while ($parsed.taskId) {',
    '  $out = & $env:OD_NODE_BIN $env:OD_BIN media wait $parsed.taskId --since $parsed.nextSince | Out-String',
    '  $ec = $LASTEXITCODE',
    '  $last = ($out -split "`n" | Where-Object { $_.Trim() } | Select-Object -Last 1)',
    '  $parsed = $last | ConvertFrom-Json',
    '  if ($ec -eq 0) { break }',
    '  if ($ec -ne 2) { Write-Error $out; exit $ec }',
    '}',
    'Write-Output $last',
    '```',
  ].join('\n');
}
