'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@open-design/components';
import {
  getOpenDesignHost,
  type CreatorStudioDesignAuthStatus,
} from '@open-design/host';

import styles from './CreatorStudioAuthGate.module.css';

const CHECKING_STATUS: CreatorStudioDesignAuthStatus = {
  active: false,
  state: 'checking',
};

export function CreatorStudioAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CreatorStudioDesignAuthStatus>(CHECKING_STATUS);
  const [busy, setBusy] = useState(false);
  const host = typeof window === 'undefined' ? null : getOpenDesignHost();
  const auth = host?.creatorStudioAuth;

  // The entitlement screen is a complete first paint, even though the main App
  // stays intentionally unmounted until access is verified. Signal Electron's
  // splash gate here so first-time members are not held behind the splash until
  // its hard timeout.
  useEffect(() => {
    document.documentElement.setAttribute('data-od-app-mounted', '1');
    document.querySelectorAll('.od-loading-shell').forEach((node) => node.remove());
  }, []);

  const refresh = useCallback(async () => {
    if (auth == null) {
      setStatus(host?.client.type === 'desktop'
        ? {
          active: false,
          message: 'This desktop build is too old to verify Creator Studio Design access. Update the app and try again.',
          reason: 'desktop_auth_unavailable',
          state: 'error',
        }
        : { active: true, state: 'active' });
      return;
    }
    setStatus(await auth.status());
  }, [auth, host?.client.type]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (auth == null || status.state !== 'pairing') return undefined;
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling || stopped) return;
      polling = true;
      try {
        const next = await auth.pollPairing();
        if (!stopped) setStatus(next);
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [auth, status.state]);

  const startPairing = async () => {
    if (auth == null || busy) return;
    setBusy(true);
    try {
      setStatus(await auth.startPairing());
    } finally {
      setBusy(false);
    }
  };

  if (status.active) return children;

  const pairing = status.state === 'pairing' && status.userCode != null;
  return (
    <main className={styles.page} data-testid="creator-studio-auth-gate">
      <section className={styles.card} aria-live="polite">
        <img className={styles.logo} src="/app-icon.png" alt="" />
        <div className={styles.eyebrow}>CREATOR STUDIO</div>
        <h1>Creator Studio Design</h1>
        {status.state === 'checking' ? (
          <p>Verifying your Mastermind access…</p>
        ) : pairing ? (
          <>
            <p>Use your authenticated ClickCampaigns GodMode connection in Claude Code or Codex and say:</p>
            <div className={styles.instruction}>
              Authorize Creator Studio Design code
              <strong>{status.userCode}</strong>
            </div>
            <p className={styles.note}>This window will unlock automatically. The code expires in ten minutes.</p>
          </>
        ) : (
          <>
            <p>
              Creator Studio Design is available to active Mastermind members through ClickCampaigns GodMode.
            </p>
            {status.message ? <p className={styles.error}>{status.message}</p> : null}
            <Button onClick={() => void startPairing()} disabled={busy || auth == null}>
              {busy ? 'Creating secure code…' : 'Connect ClickCampaigns GodMode'}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
