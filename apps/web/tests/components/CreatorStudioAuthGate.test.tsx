// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { installMockOpenDesignHost } from '@open-design/host/testing';

import { CreatorStudioAuthGate } from '../../src/components/CreatorStudioAuthGate';

describe('CreatorStudioAuthGate', () => {
  let restoreHost: (() => void) | null = null;

  afterEach(() => {
    cleanup();
    restoreHost?.();
    restoreHost = null;
  });

  it('renders the application after Mastermind access is verified', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        creatorStudioAuth: {
          logout: vi.fn(async () => ({ active: false, state: 'signed-out' as const })),
          pollPairing: vi.fn(async () => ({ active: true, state: 'active' as const })),
          startPairing: vi.fn(async () => ({ active: true, state: 'active' as const })),
          status: vi.fn(async () => ({ active: true, state: 'active' as const })),
        },
      },
    });

    render(<CreatorStudioAuthGate><div>Design workspace</div></CreatorStudioAuthGate>);

    expect(await screen.findByText('Design workspace')).toBeTruthy();
    expect(screen.queryByTestId('creator-studio-auth-gate')).toBeNull();
  });

  it('creates a short-lived pairing code without exposing an access token', async () => {
    const startPairing = vi.fn(async () => ({
      active: false,
      expiresAt: '2026-08-09T22:00:00.000Z',
      state: 'pairing' as const,
      userCode: 'ABCD-2345',
    }));
    restoreHost = installMockOpenDesignHost({
      host: {
        creatorStudioAuth: {
          logout: vi.fn(async () => ({ active: false, state: 'signed-out' as const })),
          pollPairing: vi.fn(async () => ({ active: false, state: 'pairing' as const })),
          startPairing,
          status: vi.fn(async () => ({ active: false, state: 'signed-out' as const })),
        },
      },
    });

    render(<CreatorStudioAuthGate><div>Design workspace</div></CreatorStudioAuthGate>);
    fireEvent.click(await screen.findByRole('button', { name: 'Connect ClickCampaigns GodMode' }));

    await waitFor(() => expect(startPairing).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('ABCD-2345')).toBeTruthy();
    expect(screen.getByText(/Authorize Creator Studio Design code/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('cliauth-');
  });

  it('fails closed for an older desktop host without the secure bridge', async () => {
    restoreHost = installMockOpenDesignHost({
      host: {
        client: { platform: 'darwin', type: 'desktop' },
      },
    });

    render(<CreatorStudioAuthGate><div>Design workspace</div></CreatorStudioAuthGate>);

    expect(await screen.findByText(/desktop build is too old/i)).toBeTruthy();
    expect(screen.queryByText('Design workspace')).toBeNull();
  });
});
