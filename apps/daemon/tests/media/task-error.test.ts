import { describe, expect, it } from 'vitest';

import {
  OPAQUE_MEDIA_FAILURE_MESSAGE,
  mediaGenerateFailureBody,
  mediaTaskErrorFromFailure,
} from '../../src/media/task-error.js';

describe('media failure messages stay readable', () => {
  it('replaces null, undefined, and object stringifications with a sentence', () => {
    expect(mediaTaskErrorFromFailure(null).message).toBe(OPAQUE_MEDIA_FAILURE_MESSAGE);
    expect(mediaTaskErrorFromFailure(undefined).message).toBe(OPAQUE_MEDIA_FAILURE_MESSAGE);
    expect(mediaTaskErrorFromFailure({}).message).toBe(OPAQUE_MEDIA_FAILURE_MESSAGE);
    expect(mediaTaskErrorFromFailure({ message: '   ' }).message).toBe(OPAQUE_MEDIA_FAILURE_MESSAGE);
    expect(mediaTaskErrorFromFailure(null).code).toBeUndefined();
  });

  it('does not persist a numeric exit status as a product code', () => {
    const error = mediaTaskErrorFromFailure(
      Object.assign(new Error('spawn failed'), { code: '1' }),
    );
    expect(error.code).toBeUndefined();
    expect(error.message).toBe('spawn failed');

    const numeric = mediaTaskErrorFromFailure(
      Object.assign(new Error('spawn failed'), { code: 1 }),
    );
    expect(numeric.code).toBeUndefined();
  });

  it('keeps a real OS message beside a string errno', () => {
    const error = mediaTaskErrorFromFailure(
      Object.assign(new Error('spawn vela ENOENT'), { code: 'ENOENT' }),
    );
    expect(error.code).toBe('ENOENT');
    expect(error.message).toBe('spawn vela ENOENT');
  });

  it('answers a thrown generate failure with the sentence the CLI already knows how to keep', () => {
    const { status, body } = mediaGenerateFailureBody(
      Object.assign(new Error('unknown model: vela/gpt-image-2'), { code: 'BAD_REQUEST', status: 400 }),
    );
    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'unknown model: vela/gpt-image-2',
    });
    expect(body.error.message).not.toBe('media dispatcher failed before generation started');
  });
});
