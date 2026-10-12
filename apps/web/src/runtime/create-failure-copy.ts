/**
 * Home create failures sometimes throw the internal code as the Error message
 * (`AMR_WORKSPACE_GATE_STALE`, `CREATE_REQUEST_FAILED`). That string is what
 * the toast used to show. A sentence from the daemon stays; a bare code does
 * not.
 */
const BARE_ERROR_CODE = /^[A-Z][A-Z0-9_]{2,64}$/;

export function isBareErrorCode(text: string): boolean {
  return BARE_ERROR_CODE.test(text.trim());
}

export function createFailureCopy(
  message: string | null | undefined,
  fallback: string,
): string {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text || isBareErrorCode(text)) return fallback;
  return text;
}
