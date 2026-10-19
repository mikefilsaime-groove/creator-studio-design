import { mediaFailureNextStep, type MediaFailureNextStep } from '@open-design/contracts';

import type { MediaTaskError } from './tasks.js';

/**
 * Sentence stored when a failure has no message a person can read.
 * `String(null)`, `String(undefined)`, and `String({})` used to land here as
 * `null`, `undefined`, and `[object Object]`, which the chat then showed as
 * the error.
 */
export const OPAQUE_MEDIA_FAILURE_MESSAGE =
  'media generation failed before a result was produced';

const OPAQUE_MEDIA_MESSAGES = new Set([
  'null',
  'undefined',
  '[object Object]',
  'Error',
  OPAQUE_MEDIA_FAILURE_MESSAGE,
]);

/** Product codes are words. Numeric exit statuses (`1`) are not. */
const MEDIA_FAILURE_CODE_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/;

function readFailureMessage(err: unknown): string {
  let text = '';
  if (typeof err === 'string') text = err;
  else if (err && typeof err === 'object' && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') text = message;
  }
  const trimmed = text.trim();
  if (!trimmed || OPAQUE_MEDIA_MESSAGES.has(trimmed)) return OPAQUE_MEDIA_FAILURE_MESSAGE;
  return trimmed;
}

function readFailureCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object' || !('code' in err)) return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string') return undefined;
  const trimmed = code.trim();
  return MEDIA_FAILURE_CODE_RE.test(trimmed) ? trimmed : undefined;
}

/**
 * Build the persisted failure record for a media task.
 *
 * A media failure is the only thing the client has left to explain itself
 * with, so anything the producer proved must survive into the snapshot: the
 * stable `code` triage keys on, the optional `subject` naming what a safety
 * policy objected to, and `retryable` so the UI can stop inviting a retry that
 * cannot succeed. Absent fields stay absent rather than being defaulted —
 * `retryable: false` invented here would tell a user a transient outage is
 * permanent.
 *
 * `nextStep` is the one field this function derives rather than copies, and it
 * is the field a reader is meant to act on. Everything else describes the
 * failure; only `nextStep` answers "so what now?". It is computed from the RAW
 * failure, before `status` is defaulted to 400, so a missing upstream status
 * stays missing instead of being read as a bad request.
 *
 * Lives outside `routes/media.ts` because it is a pure function about media
 * failures, not about HTTP, and callers (tests included) should not have to
 * load the whole route module — and its Express/SQLite/blob-store dependency
 * graph — to classify one error.
 */
export function mediaTaskErrorFromFailure(
  err: any,
  context: { model?: string | undefined } = {},
): MediaTaskError {
  const subject = err?.subject;
  const retryable = err?.retryable;
  const code = readFailureCode(err);
  const message = readFailureMessage(err);
  return {
    message,
    status: typeof err?.status === 'number' ? err.status : 400,
    ...(code ? { code } : {}),
    ...(subject === 'prompt' || subject === 'input_image' || subject === 'output_image'
      ? { subject }
      : {}),
    ...(typeof retryable === 'boolean' ? { retryable } : {}),
    nextStep: mediaFailureNextStep({
      code,
      status: typeof err?.status === 'number' ? err.status : undefined,
      message,
      retryable: typeof retryable === 'boolean' ? retryable : undefined,
      model: context.model,
    }),
  };
}

/**
 * HTTP body for a generate call that threw before the client could poll a task.
 *
 * The CLI only keeps `{ error: { code, message } }`. The previous catch wrote
 * `{ error: "<message>", code }` — a string — and the CLI replaced that with
 * `MEDIA_DISPATCH_FAILED` / "media dispatcher failed before generation started",
 * which is the code users were shown.
 */
export function mediaGenerateFailureBody(
  err: unknown,
  context: { model?: string | undefined } = {},
): {
  status: number;
  body: {
    error: {
      code: string;
      message: string;
      nextStep: MediaFailureNextStep;
      retryable?: boolean;
      subject?: 'prompt' | 'input_image' | 'output_image';
    };
  };
} {
  const failure = mediaTaskErrorFromFailure(err, context);
  return {
    status: typeof failure.status === 'number' ? failure.status : 400,
    body: {
      error: {
        code: failure.code ?? 'MEDIA_DISPATCH_FAILED',
        message: failure.message,
        nextStep: failure.nextStep ?? 'contact-support',
        ...(typeof failure.retryable === 'boolean' ? { retryable: failure.retryable } : {}),
        ...(failure.subject ? { subject: failure.subject } : {}),
      },
    },
  };
}
