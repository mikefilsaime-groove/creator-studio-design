import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../../src/prompts/system.js';
import { MEDIA_USER_REPLY_CONTRACT } from '../../src/prompts/media-contract.js';

/**
 * Windows video generation failed three times with no file, then the
 * agent emitted the Creator Studio Design support sentence. Activity
 * showed PowerShell checking OD_NODE_BIN / OD_BIN. POSIX `$OD_NODE_BIN`
 * is empty in PowerShell even when `$env:OD_NODE_BIN` is injected.
 */
describe('Windows media wrapper prompt contract', () => {
  it('ships PowerShell recipes on media projects and mid-session hints', () => {
    const media = composeSystemPrompt({
      agentId: 'codex',
      metadata: { kind: 'video', videoModel: 'veo-3-fal' } as any,
    });
    const hint = composeSystemPrompt({
      agentId: 'codex',
      metadata: { kind: 'prototype' } as any,
    });

    for (const prompt of [media, hint]) {
      expect(prompt).toContain('& $env:OD_NODE_BIN $env:OD_BIN');
      expect(prompt).toContain('$env:OD_NODE_BIN');
      expect(prompt).toContain('is always empty');
      expect(prompt).toContain('ConvertFrom-Json');
      expect(prompt).not.toContain('do NOT convert to PowerShell');
      expect(prompt).not.toContain('do NOT translate to PowerShell');
      expect(prompt).not.toContain('parse JSON with python3');
      expect(prompt).not.toContain('python3 -c');
    }
  });

  it('does not send a missing Windows runtime to contact-support', () => {
    expect(MEDIA_USER_REPLY_CONTRACT).toContain(
      "Creator Studio Design couldn't find its Node runtime, so the image wasn't generated. Quit and reopen the desktop app, then try again.",
    );
    expect(MEDIA_USER_REPLY_CONTRACT).toContain(
      'Creator Studio Design 找不到 Node 运行时，图片没生成。请完全退出并重新打开桌面应用后再试。',
    );
    expect(MEDIA_USER_REPLY_CONTRACT).toContain('This is not `contact-support`');
    expect(MEDIA_USER_REPLY_CONTRACT).toContain('echo $env:OD_NODE_BIN');
  });
});
