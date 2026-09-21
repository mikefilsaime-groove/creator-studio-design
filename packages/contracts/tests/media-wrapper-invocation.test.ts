import { describe, expect, it } from 'vitest';

import {
  MEDIA_MISSING_RUNTIME_USER_SENTENCE_EN,
  MEDIA_MISSING_RUNTIME_USER_SENTENCE_ZH,
  MEDIA_WRAPPER_CMD,
  MEDIA_WRAPPER_POSIX,
  MEDIA_WRAPPER_POWERSHELL,
  renderMediaGenerateWaitLoopRecipes,
  renderMediaShellInvocationNotes,
  renderMediaWaitHandoffHint,
  renderMediaWrapperCommandRecipes,
} from '../src/prompts/media-wrapper.js';

/**
 * Windows video generation died with the generic Creator Studio Design
 * support sentence after PowerShell checked `OD_NODE_BIN` / `OD_BIN`.
 * The POSIX `$OD_NODE_BIN` form is empty in PowerShell even when the
 * daemon injected `$env:OD_NODE_BIN`, so the agent never dispatched and
 * never ran `media wait` on the slow-video handoff.
 */
describe('media wrapper invocation recipes', () => {
  it('keeps POSIX, PowerShell, and cmd.exe forms distinct', () => {
    expect(MEDIA_WRAPPER_POSIX).toBe('"$OD_NODE_BIN" "$OD_BIN"');
    expect(MEDIA_WRAPPER_POWERSHELL).toBe('& $env:OD_NODE_BIN $env:OD_BIN');
    expect(MEDIA_WRAPPER_CMD).toBe('"%OD_NODE_BIN%" "%OD_BIN%"');
    expect(MEDIA_WRAPPER_POWERSHELL.startsWith('$OD_NODE_BIN')).toBe(false);
    expect(MEDIA_WRAPPER_POWERSHELL).toContain('$env:OD_NODE_BIN');
  });

  it('prints all three shells for a media generate command', () => {
    const recipes = renderMediaWrapperCommandRecipes(
      'media generate --surface video --model veo-3-fal',
    );
    expect(recipes).toContain(
      '"$OD_NODE_BIN" "$OD_BIN" media generate --surface video --model veo-3-fal',
    );
    expect(recipes).toContain(
      '& $env:OD_NODE_BIN $env:OD_BIN media generate --surface video --model veo-3-fal',
    );
    expect(recipes).toContain(
      '"%OD_NODE_BIN%" "%OD_BIN%" media generate --surface video --model veo-3-fal',
    );
  });

  it('prints a PowerShell wait handoff instead of POSIX-only stderr', () => {
    const hint = renderMediaWaitHandoffHint('task-123', 7);
    expect(hint).toContain(
      '"$OD_NODE_BIN" "$OD_BIN" media wait task-123 --since 7',
    );
    expect(hint).toContain(
      '& $env:OD_NODE_BIN $env:OD_BIN media wait task-123 --since 7',
    );
    expect(hint).toContain(
      '"%OD_NODE_BIN%" "%OD_BIN%" media wait task-123 --since 7',
    );
  });

  it('teaches PowerShell env syntax and refuses python3 on Windows', () => {
    const notes = renderMediaShellInvocationNotes();
    expect(notes).toContain('$env:OD_NODE_BIN');
    expect(notes).toContain('`$OD_NODE_BIN` is always empty');
    expect(notes).toContain('Do not use `python3`');
    expect(notes).toContain('missing-runtime user sentence');
    expect(notes).toContain('Do not use `contact-support` for a missing runtime');
  });

  it('ships a PowerShell generate→wait loop that does not need python3', () => {
    const loops = renderMediaGenerateWaitLoopRecipes();
    expect(loops).toContain('IMAGE_MODEL=IMAGE_MODEL_VALUE');
    expect(loops).toContain('$env:OD_NODE_BIN');
    expect(loops).toContain('ConvertFrom-Json');
    expect(loops).toContain('media wait');
    expect(loops).not.toContain('python3');
    expect(loops).toContain('"$OD_NODE_BIN" -e');
  });

  it('keeps the missing-runtime user sentence free of env-var names', () => {
    expect(MEDIA_MISSING_RUNTIME_USER_SENTENCE_EN).toContain('Node runtime');
    expect(MEDIA_MISSING_RUNTIME_USER_SENTENCE_EN).toContain('Quit and reopen');
    expect(MEDIA_MISSING_RUNTIME_USER_SENTENCE_EN).not.toContain('OD_NODE_BIN');
    expect(MEDIA_MISSING_RUNTIME_USER_SENTENCE_EN).not.toContain('OD_BIN');
    expect(MEDIA_MISSING_RUNTIME_USER_SENTENCE_ZH).toContain('Node 运行时');
    expect(MEDIA_MISSING_RUNTIME_USER_SENTENCE_ZH).not.toContain('OD_NODE_BIN');
  });
});
