// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AmrWalletSnapshot, WorkspaceBillingPreflight } from '@open-design/contracts';
import {
  AMR_HARD_BLOCK_BALANCE_USD,
  HOME_AMR_BALANCE_RETRY_DELAYS_MS,
  amrBalanceGateScopeForWorkspaceContext,
  amrBalanceGateScopesMatch,
  amrWalletBalanceInsufficient,
  amrWalletBalanceUsd,
  checkAmrBalanceGate,
  retryUnavailableAmrBalanceGate,
  amrBalanceGateFromMemory,
  hasAmrFundingRecovered,
  fetchAmrBalanceCardWalletSnapshot,
} from '../../src/runtime/amr-balance-gate';
import {
  fetchAmrWalletSnapshot,
  fetchVelaLoginStatus,
} from '../../src/providers/daemon';

vi.mock('../../src/providers/daemon', () => ({
  fetchAmrWalletSnapshot: vi.fn(),
  fetchVelaLoginStatus: vi.fn(),
}));

const mockedFetch = vi.mocked(fetchAmrWalletSnapshot);
const mockedFetchStatus = vi.mocked(fetchVelaLoginStatus);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function snapshot(overrides: Partial<AmrWalletSnapshot> = {}): AmrWalletSnapshot {
  return {
    status: 'available',
    profile: 'prod',
    user: { id: 'u1', email: 'user@example.com' },
    balanceUsd: '0',
    updatedAt: '2026-07-02T00:00:00.000Z',
    fetchedAt: '2026-07-02T00:00:00.000Z',
    stale: false,
    source: 'vela_api',
    ...overrides,
  };
}

function authoritativeWorkspaceBillingResponse(
  workspaceId: string,
  workspaceMemberId: string,
  balanceUsd: string,
) {
  const observedAt = '2026-07-26T00:00:00.000Z';
  return {
    summary: null,
    workspaceBalance: {
      billingScopeVersion: 2,
      workspaceId,
      workspaceMemberId,
      balanceUsd,
      expiresAt: null,
      updatedAt: observedAt,
    },
    workspaceRuntime: {
      workspaceId,
      workspaceMemberId,
      status: 'fresh',
      revision: '4',
      observedAt,
      softExpiresAt: '2099-07-26T00:00:30.000Z',
      hardExpiresAt: '2099-07-26T00:02:00.000Z',
      retryAt: null,
      errorCode: null,
      reason: 'authoritative-action-read',
      sourceGapDetected: false,
    },
    authoritativeWorkspaceRead: {
      workspaceId,
      workspaceMemberId,
      observedAt,
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
  mockedFetchStatus.mockRejectedValue(new Error('status unavailable'));
});

afterEach(() => {
  mockedFetch.mockReset();
  mockedFetchStatus.mockReset();
  vi.unstubAllGlobals();
});

describe('amrWalletBalanceUsd', () => {
  it('parses only definitive answers', () => {
    expect(amrWalletBalanceUsd(snapshot({ balanceUsd: '12.3' }))).toBe(12.3);
    expect(amrWalletBalanceUsd(snapshot({ balanceUsd: '-1.25' }))).toBe(-1.25);
    expect(amrWalletBalanceUsd(null)).toBeNull();
    expect(amrWalletBalanceUsd(snapshot({ balanceUsd: null }))).toBeNull();
    expect(amrWalletBalanceUsd(snapshot({ balanceUsd: 'not-a-number' }))).toBeNull();
    // Number(' ') is 0 — whitespace must stay indefinite, not read as $0.
    expect(amrWalletBalanceUsd(snapshot({ balanceUsd: ' ' }))).toBeNull();
    expect(amrWalletBalanceUsd(snapshot({ balanceUsd: '\n\t' }))).toBeNull();
    expect(amrWalletBalanceUsd(snapshot({ status: 'signed_out', balanceUsd: '0' }))).toBeNull();
    expect(amrWalletBalanceUsd(snapshot({ status: 'unavailable', balanceUsd: '0' }))).toBeNull();
  });
});

describe('amrWalletBalanceInsufficient', () => {
  it('is true only for a definitive balance at or below the hard-block line', () => {
    expect(AMR_HARD_BLOCK_BALANCE_USD).toBe(0);
    expect(amrWalletBalanceInsufficient(snapshot({ balanceUsd: '0' }))).toBe(true);
    expect(amrWalletBalanceInsufficient(snapshot({ balanceUsd: '-1.25' }))).toBe(true);
    expect(amrWalletBalanceInsufficient(snapshot({ balanceUsd: '0.01' }))).toBe(false);
    expect(amrWalletBalanceInsufficient(null)).toBe(false);
    expect(amrWalletBalanceInsufficient(snapshot({ balanceUsd: ' ' }))).toBe(false);
  });
});

describe('AMR balance gate workspace witness', () => {
  const teamA = {
    workspaceType: 'team' as const,
    workspaceId: 'ws-team-a',
    workspaceMemberId: 'wm-a',
  };

  it('matches only the exact workspace and member epoch', () => {
    const witness = amrBalanceGateScopeForWorkspaceContext(teamA);
    expect(witness).toEqual(teamA);
    expect(amrBalanceGateScopesMatch(witness, { ...teamA })).toBe(true);
    expect(
      amrBalanceGateScopesMatch(witness, {
        ...teamA,
        workspaceId: 'ws-team-b',
      }),
    ).toBe(false);
    expect(
      amrBalanceGateScopesMatch(witness, {
        ...teamA,
        workspaceMemberId: 'wm-new-epoch',
      }),
    ).toBe(false);
    expect(amrBalanceGateScopesMatch(witness, undefined)).toBe(false);
  });

  it('does not mint a reusable witness from an unresolved workspace', () => {
    expect(amrBalanceGateScopeForWorkspaceContext(null)).toBeUndefined();
    expect(
      amrBalanceGateScopeForWorkspaceContext({
        ...teamA,
        workspaceMemberId: ' ',
      }),
    ).toBeUndefined();
  });
});

describe('checkAmrBalanceGate', () => {
  it('does not put workspace billing on the send critical path', async () => {
    mockedFetch.mockResolvedValue(snapshot());
    const billing = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', billing);
    const result = checkAmrBalanceGate({
      workspaceType: 'team', workspaceId: 'ws', workspaceMemberId: 'member',
    }, 'model');
    expect(billing).not.toHaveBeenCalled();
    await expect(result).resolves.toEqual({ kind: 'allow' });
  });
  it.each(['0', '-1', '0.001', '1.2', '42'])('leaves funding to Link for wallet %s', async (balanceUsd) => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd }));
    await expect(checkAmrBalanceGate(undefined, 'model')).resolves.toEqual({ kind: 'allow' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith();
  });

  // T66 (2026-09-07): there is no low-balance tier any more. $1.20 used to be a
  // `soft` warn under a $2 line; product retired that whole tier — 「这个要不先
  // 不要了,跟产品说了一下,不要这个了」 — so a positive balance is an ordinary
  // allow. The line itself is gone, not zeroed: `AMR_LOW_BALANCE_WARN_USD` no
  // longer exists, which is why this file no longer imports it.
  it('allows a low but positive balance with no warning and no refresh', async () => {
    mockedFetch.mockResolvedValueOnce(snapshot({ balanceUsd: '1.20' }));
    await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
    // The cache answers on its own — nothing above $0 is worth an upstream read.
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('has no second line: every positive balance lands on the same answer', async () => {
    for (const balanceUsd of ['0.01', '1.20', '2.00', '2.01', '50.00']) {
      mockedFetch.mockReset();
      mockedFetch.mockResolvedValueOnce(snapshot({ balanceUsd }));
      await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
    }
  });

  it('leaves a readable zero-dollar plan to Link without guessing per-model entitlement', async () => {
    const empty = snapshot({
      balanceUsd: '0',
      user: { id: 'u1', email: 'user@example.com', plan: 'go' },
    });
    mockedFetch.mockResolvedValueOnce(empty);
    await expect(checkAmrBalanceGate(undefined, 'new-coding-plan-model')).resolves.toEqual({ kind: 'allow' });
  });

  it.each([
    ['plus', 'kimi-k2.7-code'],
    ['pro', 'glm-5.2'],
    ['max', 'minimax-m2.7'],
  ])('lets a selected %s plan model through at a low positive balance', async (plan, modelId) => {
    const low = snapshot({
      balanceUsd: '1.20',
      user: { id: 'u1', email: 'user@example.com', plan },
    });
    mockedFetch.mockResolvedValueOnce(low);

    await expect(checkAmrBalanceGate(undefined, modelId)).resolves.toEqual({
      kind: 'allow',
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('does not guess whether a selected Pro model is wallet-metered', async () => {
    const low = snapshot({
      balanceUsd: '1.20',
      user: { id: 'u1', email: 'user@example.com', plan: 'pro' },
    });
    mockedFetch.mockResolvedValueOnce(low);

    // Still no metering guess — a positive balance is simply allowed.
    await expect(
      checkAmrBalanceGate(undefined, 'minimax-m2.7'),
    ).resolves.toEqual({ kind: 'allow' });
  });

  // The low-balance reminder used to be permanently mutable from Home's dialog;
  // that opt-out was removed 2026-09-04 because the bit also silenced the project
  // page's upgrade card, and T66 then retired the tier the bit acted on. The
  // stale localStorage bit real users still carry must be inert in both
  // directions. Full coverage of the removal lives in
  // `amr-low-balance-optout-removed.test.ts`.
  it('ignores the retired low-balance opt-out bit left on disk', async () => {
    window.localStorage.setItem('open-design:amr-low-balance-warn-optout:v1', '1');
    mockedFetch.mockResolvedValueOnce(snapshot({ balanceUsd: '1.20' }));
    await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
    mockedFetch.mockReset();
    const empty = snapshot({ balanceUsd: '0' });
    mockedFetch.mockResolvedValueOnce(empty);
    await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
  });

  it('does not confirm a zero-dollar wallet before Link admits the run', async () => {
    mockedFetch.mockResolvedValueOnce(snapshot({ balanceUsd: '0' }));
    await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  // T55: a subscriber's $0 is no longer a reason to stand down. The refresh
  // handshake this case also pins (never block on a cached zero) is unchanged.
  it.each([
    ['go', 'glm-5.2'],
    ['plus', 'kimi-k2.7-code'],
    ['pro', 'glm-5.2'],
    ['max', 'glm-5.1'],
  ])('leaves a selected %s model with a fresh zero-dollar wallet to Link', async (plan, modelId) => {
    const planAccount = snapshot({
      balanceUsd: '0',
      user: { id: 'u1', email: 'user@example.com', plan },
    });
    mockedFetch.mockResolvedValueOnce(planAccount);
    await expect(checkAmrBalanceGate(undefined, modelId)).resolves.toEqual({ kind: 'allow' });
  });

  // The tier is READABLE here — it just comes from the login status rather than
  // the wallet snapshot — so T55 blocks. The unreadable case is separate and
  // still fails open (see the personal fail-open guard below).
  it('reads the tier off the login status when the fresh wallet omits it', async () => {
    const emptyWallet = snapshot({
      balanceUsd: '0',
    });
    mockedFetch.mockResolvedValueOnce(emptyWallet);
    mockedFetchStatus.mockResolvedValue({
      loggedIn: true,
      profile: 'prod',
      user: null,
      account: { plan: 'go', balanceUsd: '0' },
      configPath: '/tmp/vela.json',
    });

    await expect(checkAmrBalanceGate(undefined, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
  });

  // Still no per-model reasoning: the model id changes nothing, only the tier's
  // readability does.
  it('does not infer plan exclusion for a selected model', async () => {
    const plusAccount = snapshot({
      balanceUsd: '0',
      user: { id: 'u1', email: 'user@example.com', plan: 'plus' },
    });
    mockedFetch.mockResolvedValueOnce(plusAccount);
    await expect(checkAmrBalanceGate(undefined, 'glm-5.1')).resolves.toEqual({ kind: 'allow' });
  });

  it('hard-blocks a signed-out account after refresh confirmation', async () => {
    const signedOut = snapshot({ status: 'signed_out', balanceUsd: null, user: null });
    mockedFetch.mockResolvedValueOnce(signedOut).mockResolvedValueOnce(signedOut);
    await expect(checkAmrBalanceGate()).resolves.toEqual({
      kind: 'hard',
      reason: 'signed_out',
      snapshot: signedOut,
    });
  });

  it('lets a just-recharged wallet through (stale-empty cache, healthy refresh)', async () => {
    mockedFetch
      .mockResolvedValueOnce(snapshot({ balanceUsd: '0', source: 'daemon_cache' }))
      .mockResolvedValueOnce(snapshot({ balanceUsd: '20.00' }));
    await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
  });

  it('clears a stale-empty cache when the refresh lands on a positive balance', async () => {
    mockedFetch
      .mockResolvedValueOnce(snapshot({ balanceUsd: '0', source: 'daemon_cache' }))
      .mockResolvedValueOnce(snapshot({ balanceUsd: '2.00' }));
    // The refresh proved there is money. How much is not a question this gate
    // asks any more (T66), so the empty-cache candidate resolves to a plain allow.
    await expect(checkAmrBalanceGate()).resolves.toEqual({ kind: 'allow' });
  });

  it.each(['coding_plan', 'wallet', 'gateway', undefined])('does not turn advisory funding %s into a local rejection', async (funding) => {
    mockedFetch.mockResolvedValue(snapshot());
    const body = authoritativeWorkspaceBillingResponse('ws', 'member', '0');
    const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ ...body, ...(funding ? { preflight: { funding } } : {}) })));
    vi.stubGlobal('fetch', fetcher);
    await expect(checkAmrBalanceGate({ workspaceType: 'team', workspaceId: 'ws', workspaceMemberId: 'member' }, 'model/a+b')).resolves.toEqual({ kind: 'allow' });
    expect(fetcher).not.toHaveBeenCalled();
  });

});

describe('post-failure wallet display authority', () => {
  it('does not display a positive balance from a daemon that cannot prove an authoritative read', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '247.50' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({
        summary: null,
        workspaceBalance: {
          billingScopeVersion: 2,
          workspaceId: 'ws-team-a',
          workspaceMemberId: 'wm-a',
          balanceUsd: '50',
          expiresAt: null,
          updatedAt: '2026-07-26T00:00:00.000Z',
        },
        workspaceRuntime: {
          workspaceId: 'ws-team-a',
          workspaceMemberId: 'wm-a',
          status: 'fresh',
          revision: '3',
          observedAt: '2026-07-26T00:00:00.000Z',
          softExpiresAt: '2099-07-26T00:00:30.000Z',
          hardExpiresAt: '2099-07-26T00:02:00.000Z',
          retryAt: null,
          errorCode: null,
          reason: 'explicit-billing-read',
          sourceGapDetected: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    );

    await expect(fetchAmrBalanceCardWalletSnapshot({
      workspaceType: 'team',
      workspaceId: 'ws-team-a',
      workspaceMemberId: 'wm-a',
    })).resolves.toBeNull();
  });

  it('does not substitute account zero for an unavailable team wallet', async () => {
    const emptyAccount = snapshot({ balanceUsd: '0' });
    mockedFetch.mockResolvedValueOnce(emptyAccount).mockResolvedValueOnce(emptyAccount);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    );

    await expect(
      fetchAmrBalanceCardWalletSnapshot({
        workspaceType: 'team',
        workspaceId: 'ws-team-a',
        workspaceMemberId: 'wm-a',
      }),
    ).resolves.toBeNull();
  });

  it('does not use a last-good balance when the authoritative runtime is in error', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '247.50' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({
          summary: null,
          workspaceBalance: {
            billingScopeVersion: 2,
            workspaceId: 'ws-team-a',
            workspaceMemberId: 'wm-a',
            balanceUsd: '50',
            expiresAt: null,
            updatedAt: '2026-07-26T00:00:00.000Z',
          },
          workspaceRuntime: {
            workspaceId: 'ws-team-a',
            workspaceMemberId: 'wm-a',
            status: 'error',
            revision: '4',
            observedAt: '2026-07-26T00:00:00.000Z',
            softExpiresAt: '2026-07-26T00:00:30.000Z',
            hardExpiresAt: '2026-07-26T00:02:00.000Z',
            retryAt: null,
            errorCode: 'workspace_billing_unavailable',
            reason: 'authoritative-action-read',
            sourceGapDetected: false,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )),
    );

    await expect(fetchAmrBalanceCardWalletSnapshot({
      workspaceType: 'team',
      workspaceId: 'ws-team-a',
      workspaceMemberId: 'wm-a',
    })).resolves.toBeNull();
  });

  it('rejects a response from an older workspace-member epoch', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '247.50' }));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(
        JSON.stringify({
          summary: null,
          workspaceBalance: {
            billingScopeVersion: 2,
            workspaceId: 'ws-team-a',
            workspaceMemberId: 'wm-old',
            balanceUsd: '50',
            expiresAt: null,
            updatedAt: '2026-07-26T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )),
    );

    await expect(fetchAmrBalanceCardWalletSnapshot({
      workspaceType: 'team',
      workspaceId: 'ws-team-a',
      workspaceMemberId: 'wm-new',
    })).resolves.toBeNull();
  });

  it('keeps concurrent team A/B checks keyed by explicit workspace id', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '247.50' }));
    let resolveA!: (response: Response) => void;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes('workspaceId=ws-team-a')) {
        return new Promise<Response>((resolve) => {
          resolveA = resolve;
        });
      }
      if (url.includes('workspaceId=ws-team-b')) {
        return Promise.resolve(
          new Response(
            JSON.stringify(authoritativeWorkspaceBillingResponse(
              'ws-team-b',
              'wm-b',
              '50',
            )),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const teamA = fetchAmrBalanceCardWalletSnapshot({
      workspaceType: 'team',
      workspaceId: 'ws-team-a',
      workspaceMemberId: 'wm-a',
    });
    const teamB = fetchAmrBalanceCardWalletSnapshot({
      workspaceType: 'team',
      workspaceId: 'ws-team-b',
      workspaceMemberId: 'wm-b',
    });

    await expect(teamB).resolves.toMatchObject({ balanceUsd: '50' });
    expect(resolveA).toBeTypeOf('function');
    resolveA(
      new Response(
        JSON.stringify(authoritativeWorkspaceBillingResponse(
          'ws-team-a',
          'wm-a',
          '1.50',
        )),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    await expect(teamA).resolves.toMatchObject({ balanceUsd: '1.50' });
  });
});

/**
 * The Personal fail-open path must not swallow the hard block.
 *
 * #7187 stood the preflight down for a run the wallet was never going to fund,
 * asking two questions: is the caller on a Coding Plan, and is this model
 * unlimited on it. #7544 retired the model half along with the entitlement
 * catalog it read, leaving `modelId?.trim()` — which is true on nearly every
 * send, because an unset model falls back to the agent's default id. That
 * turned "this run does not touch the wallet" into "the user has a model
 * selected", and because $0 <= $2 the early return started eating the $0 hard
 * block too.
 *
 * These cases pin the half that is still knowable: a READABLE tier at $0 has
 * nothing left to spend, so its empty wallet is a real block.
 *
 * OPEND-2600 narrowed WHAT the stand-down is allowed to cancel. It used to end
 * the whole gate in `allow`, which also deleted the soft reminder for every
 * subscriber below the warning line (the reported Pro account at $1.79 saw
 * nothing at all). It now cancels the hard branch only, so the low-balance cases
 * read `soft` where they used to read `allow`.
 *
 * T55 (product 2026-09-06) then overturned #7187's premise itself. "A
 * subscriber's $0 is never blocked" was the invariant this block used to defend;
 * the out-of-credits matrix now governs Personal workspaces, so a readable paid
 * tier blocks exactly like a free one. What remains of the stand-down is
 * `amrPlanTierUnreadable`: a tier we could not read at all still fails open, and
 * that is what the last cases here pin.
 */
describe('checkAmrBalanceGate personal fail-open guard', () => {
  const freeUser = { id: 'u1', email: 'user@example.com', plan: 'free' };

  function workspaceBillingStub(
    workspaceId: string,
    workspaceMemberId: string,
    balanceUsd: string,
  ) {
    return vi.fn(async () => new Response(
      JSON.stringify(authoritativeWorkspaceBillingResponse(
        workspaceId,
        workspaceMemberId,
        balanceUsd,
      )),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
  }

  it('hard-blocks a zero-dollar free account even with a model selected', async () => {
    const freeAccount = snapshot({ balanceUsd: '0', user: freeUser });
    mockedFetch.mockResolvedValueOnce(freeAccount);
    await expect(checkAmrBalanceGate(undefined, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
  });

  it('allows a low-balance free account even with a model selected', async () => {
    mockedFetch.mockResolvedValueOnce(snapshot({ balanceUsd: '1.20', user: freeUser }));

    await expect(
      checkAmrBalanceGate(undefined, 'glm-5.2'),
    ).resolves.toEqual({ kind: 'allow' });
  });

  it('hard-blocks a zero-dollar free-tier Personal workspace', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '0', user: freeUser }));
    vi.stubGlobal('fetch', workspaceBillingStub('ws-free', 'wm-free', '0'));

    await expect(checkAmrBalanceGate({
      workspaceType: 'personal',
      workspaceId: 'ws-free',
      workspaceMemberId: 'wm-free',
    }, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
  });

  it('soft-warns a low-balance free-tier Personal workspace', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '1.20', user: freeUser }));
    vi.stubGlobal('fetch', workspaceBillingStub('ws-free-low', 'wm-free-low', '1.20'));

    await expect(
      checkAmrBalanceGate({
        workspaceType: 'personal',
        workspaceId: 'ws-free-low',
        workspaceMemberId: 'wm-free-low',
      }, 'glm-5.2'),
    ).resolves.toEqual({ kind: 'allow' });
  });

  it('reads the free tier from the live login status when the wallet omits it', async () => {
    const walletWithoutPlan = snapshot({ balanceUsd: '0' });
    mockedFetch.mockResolvedValueOnce(walletWithoutPlan);
    mockedFetchStatus.mockResolvedValue({
      loggedIn: true,
      profile: 'prod',
      user: null,
      account: { plan: 'free', balanceUsd: '0' },
      configPath: '/tmp/vela.json',
    });

    await expect(checkAmrBalanceGate(undefined, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
  });

  // --- Overturned reverse controls (T15 → T55, product 2026-09-06) ---
  //
  // These two used to read "still never blocks a zero-dollar subscriber": a
  // subscribed $0 was treated as a NORMAL state because the day-to-day models
  // are plan-funded. Product ruled on 2026-09-06 that the out-of-credits matrix
  // governs Personal workspaces as well, and the product doc's 四、升级情况 lists
  // Free / Basic / Plus / Pro AND Max as tiers that see the blocked treatment at
  // $0. They are kept (rather than deleted) because they are the cases that will
  // hurt first if the ruling is ever walked back.

  it.each(['go', 'plus', 'pro', 'max'])(
    'leaves a zero-dollar %s subscriber to Link (T66)',
    async (plan) => {
      const planAccount = snapshot({
        balanceUsd: '0',
        user: { id: 'u1', email: 'user@example.com', plan },
      });
      mockedFetch.mockResolvedValueOnce(planAccount);
      await expect(checkAmrBalanceGate(undefined, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
    },
  );

  it('leaves a zero-dollar subscribed Personal workspace to Link', async () => {
    mockedFetch.mockResolvedValue(snapshot({
      balanceUsd: '0',
      user: { id: 'u1', email: 'user@example.com', plan: 'max' },
    }));
    vi.stubGlobal('fetch', workspaceBillingStub('ws-max', 'wm-max', '0'));

    await expect(checkAmrBalanceGate({
      workspaceType: 'personal',
      workspaceId: 'ws-max',
      workspaceMemberId: 'wm-max',
    }, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
  });

  // The half of `cf00c80bd1` that T55 explicitly preserved: an unreadable tier
  // is neither free nor paid, and a failed read must never manufacture a block.
  it('fails open at zero balance when the plan cannot be resolved at all', async () => {
    // An unreadable tier is not free, and it is not paid either — "free" and
    // "paid" are not complements, so this tier needs its own pin. Failing open
    // means "not blocked"; the wallet is still empty and the card still says so,
    // which is exactly what `empty_not_blocked` names (it is NOT the retired
    // low-balance tier — a positive balance can never reach it).
    const unknownPlan = snapshot({ balanceUsd: '0' });
    mockedFetch
      .mockResolvedValueOnce({ ...unknownPlan, source: 'daemon_cache' })
      .mockResolvedValueOnce(unknownPlan);

    const result = await checkAmrBalanceGate(undefined, 'glm-5.2');
    expect(result).toEqual({ kind: 'allow' });
  });

  it('leaves a healthy free-tier balance completely alone', async () => {
    mockedFetch.mockResolvedValueOnce(snapshot({ balanceUsd: '50.00', user: freeUser }));

    await expect(
      checkAmrBalanceGate(undefined, 'glm-5.2'),
    ).resolves.toEqual({ kind: 'allow' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('leaves a free-tier team workspace on the unchanged team path', async () => {
    mockedFetch.mockResolvedValue(snapshot({ balanceUsd: '0', user: freeUser }));
    vi.stubGlobal('fetch', workspaceBillingStub('ws-team-free', 'wm-team-free', '0'));

    await expect(checkAmrBalanceGate({
      workspaceType: 'team',
      workspaceId: 'ws-team-free',
      workspaceMemberId: 'wm-team-free',
    }, 'glm-5.2')).resolves.toEqual({ kind: 'allow' });
  });
});

describe('retryUnavailableAmrBalanceGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps one Home submit pending across the bounded cold-start retries', async () => {
    const check = vi.fn()
      .mockResolvedValueOnce({ kind: 'unavailable' } as const)
      .mockResolvedValueOnce({ kind: 'unavailable' } as const)
      .mockResolvedValueOnce({ kind: 'allow' } as const);

    const result = retryUnavailableAmrBalanceGate(check);
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOME_AMR_BALANCE_RETRY_DELAYS_MS[0] - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(HOME_AMR_BALANCE_RETRY_DELAYS_MS[1] - 1);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);

    await expect(result).resolves.toEqual({ kind: 'allow' });
    expect(check).toHaveBeenCalledTimes(3);
  });

  it('returns a definitive decision immediately without scheduling a retry', async () => {
    const check = vi.fn().mockResolvedValue({ kind: 'allow' } as const);

    await expect(retryUnavailableAmrBalanceGate(check)).resolves.toEqual({ kind: 'allow' });

    expect(check).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns unavailable after exhausting the bounded retry budget', async () => {
    const check = vi.fn().mockResolvedValue({ kind: 'unavailable' } as const);

    const result = retryUnavailableAmrBalanceGate(check);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ kind: 'unavailable' });
    expect(check).toHaveBeenCalledTimes(3);
  });
});

describe('amrBalanceGateFromMemory', () => {
  const scope = { workspaceType: 'personal' as const, workspaceId: 'ws', workspaceMemberId: 'member' };
  function memoryPreflight(): WorkspaceBillingPreflight {
    return {
      schemaVersion: 1, workspaceId: 'ws', workspaceMemberId: 'member', modelId: null,
      generatedAt: new Date().toISOString(), balanceUsd: '0', modelCovered: null, funding: 'gateway',
      codingPlan: { workspaceId: 'ws', generatedAt: new Date().toISOString(), eligible: false, tier: null, windows: [] },
    };
  }
  it('restores the Home memory gate for an empty wallet with no Coding Plan', () => {
    expect(amrBalanceGateFromMemory('0', { scope, preflight: memoryPreflight(), modelId: 'model' }))
      .toMatchObject({ kind: 'hard', reason: 'insufficient', snapshot: { balanceUsd: '0' } });
  });
  it.each(['available', 'wrong-member', 'wrong-workspace', 'wrong-model', 'unknown-plan', 'plan-quota'])(
    'does not block on %s evidence', (scenario) => {
      const preflight = memoryPreflight();
      if (scenario === 'available') preflight.fundingCheck = 'available';
      if (scenario === 'wrong-member') preflight.workspaceMemberId = 'other';
      if (scenario === 'wrong-workspace') preflight.workspaceId = 'other';
      if (scenario === 'wrong-model') preflight.modelId = 'other';
      if (scenario === 'unknown-plan') preflight.codingPlan.eligible = true;
      if (scenario === 'plan-quota') {
        preflight.codingPlan.eligible = true;
        preflight.codingPlan.windows = [{ policyId: '5h', durationSeconds: 18000, resetMode: 'activity_triggered',
          usedCredits: '0', limitCredits: '100', remainingCredits: '100', windowStart: null, resetsAt: null }];
      }
      expect(amrBalanceGateFromMemory('0', { scope, preflight, modelId: 'model' })).toBeNull();
    },
  );
  it('holds an exhausted plan provisionally but allows a window that has reset', () => {
    const preflight = memoryPreflight();
    preflight.codingPlan.eligible = true;
    preflight.codingPlan.windows = [{ policyId: '5h', durationSeconds: 18000, resetMode: 'activity_triggered',
      usedCredits: '100', limitCredits: '100', remainingCredits: '0', windowStart: null,
      resetsAt: new Date(Date.now() + 60_000).toISOString() }];
    expect(amrBalanceGateFromMemory('0', { scope, preflight, modelId: 'model' })).not.toBeNull();
    preflight.codingPlan.windows[0]!.resetsAt = new Date(Date.now() - 1).toISOString();
    expect(amrBalanceGateFromMemory('0', { scope, preflight, modelId: 'model' })).toBeNull();
  });

  it.each(['0', '-1', '1', '', 'bad', null, undefined])('never treats wallet %s as funding authority', (balance) => {
    expect(amrBalanceGateFromMemory(balance)).toBeNull();
  });

  it('has no opinion on a positive, missing, or unparseable reading', () => {
    expect(amrBalanceGateFromMemory('12.50')).toBeNull();
    expect(amrBalanceGateFromMemory('0.01')).toBeNull();
    expect(amrBalanceGateFromMemory(null)).toBeNull();
    expect(amrBalanceGateFromMemory(undefined)).toBeNull();
    expect(amrBalanceGateFromMemory('')).toBeNull();
    expect(amrBalanceGateFromMemory('   ')).toBeNull();
    expect(amrBalanceGateFromMemory('n/a')).toBeNull();
  });
});
