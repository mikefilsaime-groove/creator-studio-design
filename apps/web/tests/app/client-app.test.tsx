// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/dynamic', () => ({
  default: vi.fn(() => () => <div>Design workspace</div>),
}));

vi.mock('../../src/analytics/error-tracking', () => ({
  installErrorHandlers: vi.fn(),
}));

vi.mock('../../src/observability/install', () => ({
  installWebObservability: vi.fn(),
}));

import { ClientApp } from '../../app/[[...slug]]/client-app';

describe('ClientApp', () => {
  afterEach(cleanup);

  it('opens the design workspace without an application authentication gate', () => {
    render(<ClientApp />);

    expect(screen.getByText('Design workspace')).toBeTruthy();
    expect(screen.queryByTestId('creator-studio-auth-gate')).toBeNull();
  });
});
