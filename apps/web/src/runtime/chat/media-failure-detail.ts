/**
 * The sentence a failed image/video/audio generation can show.
 *
 * `od media generate` prints a JSON envelope whose `error.code` is an internal
 * triage key (`MEDIA_DISPATCH_FAILED`, `ENOENT`). The cell used to say only
 * 「失败」, and anything that did quote the tool output quoted that code. A
 * readable `error.message` is the thing to show; a bare code is not.
 */

const OPAQUE_MESSAGES = new Set(['null', 'undefined', '[object Object]', 'Error']);
const BARE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,64}$/;
const DETAIL_MAX = 500;

export function visibleMediaFailureDetail(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  if (!text || text.length > DETAIL_MAX) return null;
  if (OPAQUE_MESSAGES.has(text) || BARE_ERROR_CODE.test(text)) return null;
  if (text.includes('\n') || text.includes('\r')) return null;
  return text;
}

/** Last JSON line of a media-generate tool result, if it carries a sentence. */
export function mediaFailureDetailFromToolOutput(content: string | undefined): string | null {
  if (!content) return null;
  const lines = content.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const text = lines[i]?.trim() ?? '';
    if (!text.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') continue;
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === 'string') {
        const visible = visibleMediaFailureDetail(error);
        if (visible) return visible;
      } else if (error && typeof error === 'object') {
        const visible = visibleMediaFailureDetail(
          (error as { message?: unknown }).message,
        );
        if (visible) return visible;
      }
    } catch {
      continue;
    }
  }
  return null;
}
