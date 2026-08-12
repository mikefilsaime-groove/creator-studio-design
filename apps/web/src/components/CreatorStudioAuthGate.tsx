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

const GODMODE_SETTINGS_URL = 'https://clickcampaigns.ai/settings?tab=god-mode';

export function CreatorStudioAuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CreatorStudioDesignAuthStatus>(CHECKING_STATUS);
  const [busy, setBusy] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const host = typeof window === 'undefined' ? null : getOpenDesignHost();
  const auth = host?.creatorStudioAuth;
  const authorizationPrompt = status.userCode == null
    ? ''
    : `Authorize Creator Studio Design code ${status.userCode}`;

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
    setCopyState('idle');
    try {
      setStatus(await auth.startPairing());
    } finally {
      setBusy(false);
    }
  };

  const copyAuthorizationPrompt = async () => {
    if (authorizationPrompt.length === 0) return;
    try {
      await navigator.clipboard.writeText(authorizationPrompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
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
            <div className={styles.pairingHeader}>
              <h2>Finish setup in Codex or Claude Code</h2>
              <p>Follow these steps once. Creator Studio Design will stay authorized on this Mac.</p>
            </div>
            <ol className={styles.steps}>
              <li>Open Codex or Claude Code.</li>
              <li>
                Make sure ClickCampaigns GodMode is connected. If it is not, open your{' '}
                <a href={GODMODE_SETTINGS_URL} target="_blank" rel="noreferrer">GodMode settings</a> first.
              </li>
              <li>Copy the message below, paste it into the chat, and send it.</li>
            </ol>
            <div className={styles.instruction}>
              <span>Message to send</span>
              <code>{authorizationPrompt}</code>
              <Button variant="primary" onClick={() => void copyAuthorizationPrompt()}>
                Copy authorization message
              </Button>
              {copyState === 'copied' ? <small>Copied. Paste it into Codex or Claude Code.</small> : null}
              {copyState === 'failed' ? <small>Select the message above and copy it manually.</small> : null}
            </div>
            <p className={styles.note}>
              Return to this window after sending the message. It unlocks automatically, saves the authorization,
              and will not ask you to connect again. The code expires in ten minutes.
            </p>
          </>
        ) : (
          <>
            <p>
              Connect once through ClickCampaigns GodMode to verify your Mastermind access. This Mac will stay
              authorized, so you will not need to repeat these steps.
            </p>
            {status.message ? <p className={styles.error}>{status.message}</p> : null}
            <Button onClick={() => void startPairing()} disabled={busy || auth == null}>
              {busy ? 'Creating secure code…' : 'Connect once with ClickCampaigns GodMode'}
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
