import { describe, expect, it } from 'vitest';

import { createFailureCopy, isBareErrorCode } from '../../src/runtime/create-failure-copy';

describe('create failure copy', () => {
  it('replaces a thrown internal code with the human fallback', () => {
    expect(isBareErrorCode('AMR_WORKSPACE_GATE_STALE')).toBe(true);
    expect(createFailureCopy('AMR_WORKSPACE_GATE_STALE', 'Failed to start the run. Try again.'))
      .toBe('Failed to start the run. Try again.');
    expect(createFailureCopy('CREATE_REQUEST_FAILED', 'Failed to start the run. Try again.'))
      .toBe('Failed to start the run. Try again.');
  });

  it('keeps a daemon sentence', () => {
    expect(createFailureCopy('project name is required', 'Failed to start the run. Try again.'))
      .toBe('project name is required');
    expect(createFailureCopy('  ', 'Failed to start the run. Try again.'))
      .toBe('Failed to start the run. Try again.');
  });
});
