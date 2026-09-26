import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole, type DOMWindow } from 'jsdom';

/**
 * Behavioural coverage for the admin page's session flow.
 *
 * The route tests prove the server's half of the contract and the asset test
 * proves the file ships; neither executes a line of the page. This suite loads
 * the real HTML into a DOM and lets its inline script run, so a regression in
 * `doLogin`, the reload probe, the CSRF header wiring or sign-out fails a test
 * instead of only breaking in a browser.
 */

const PAGE = fs.readFileSync(path.join(import.meta.dirname, 'approval_page.html'), 'utf8');

const PAGE_URL = 'http://localhost:3001/admin/approvals';
const CSRF_COOKIE = 'lucifer_admin_csrf';

interface StubResponse {
  status?: number;
  body?: unknown;
}

/** Answers one request. Anything it does not describe gets an empty 200. */
type Route = (url: string) => StubResponse;

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** Routes that let a signed-in page finish loading without hitting a failure path. */
const happyRoutes: Route = (url) => {
  if (url.includes('/pending')) return { body: { pending: [] } };
  if (url.includes('/history')) return { body: { history: [] } };
  if (url.includes('/stream-ticket')) return { body: { ticket: 'ticket-1', ttlSeconds: 10 } };
  return {};
};

/** Answers `/pending` with one status and leaves the rest of the page happy. */
function pendingAnswers(status: number, code: string): Route {
  return (url) => (url.includes('/pending') ? { status, body: { code } } : happyRoutes(url));
}

/** A `new Notification(...)` the page created, as the fake records it. */
interface ShownNotification {
  title: string;
  options: NotificationOptions;
  closed: boolean;
  onclick: (() => void) | null;
  close(): void;
}

/** Browser state the alert code reads: permission, focus and stored preferences. */
interface AlertEnv {
  /** `absent` removes the Notification API altogether. */
  permission: NotificationPermission | 'absent';
  /** What `requestPermission()` resolves to when the page asks. */
  permissionAnswer: NotificationPermission;
  hidden: boolean;
  focused: boolean;
  storage: Record<string, string>;
}

interface PageOptions {
  route?: Route;
  cookie?: string;
  alerts?: Partial<AlertEnv>;
}

interface LoadedPage {
  window: DOMWindow;
  env: AlertEnv;
  notifications: ShownNotification[];
  /** How many alert sounds started (one per `playAlertSound`, which plays two tones). */
  sounds(): number;
  permissionRequests(): number;
  /** Deliver a server-sent event to the page's open stream. */
  emit(type: string, data: unknown): void;
  calls: FetchCall[];
  /** jsdom's report of an attempted navigation, which is how `location.reload()` surfaces. */
  navigations: string[];
  callsTo(fragment: string): FetchCall[];
  isVisible(id: string): boolean;
  input(id: string): HTMLInputElement;
  /** Let the page's promise chain settle. */
  settle(): Promise<void>;
}

/**
 * Load the page with a stubbed network, running its scripts for real.
 *
 * The page starts itself on `DOMContentLoaded`, which jsdom fires while the
 * document is constructed, so `settle()` is awaited before the handle is
 * returned: every assertion sees the page as a user would find it.
 */
async function loadPage(options: PageOptions = {}): Promise<LoadedPage> {
  const route = options.route ?? happyRoutes;
  const calls: FetchCall[] = [];
  const navigations: string[] = [];
  const env: AlertEnv = {
    permission: 'default',
    permissionAnswer: 'granted',
    hidden: true,
    focused: false,
    storage: {},
    ...options.alerts,
  };
  const notifications: ShownNotification[] = [];
  const listeners = new Map<string, (event: { data: string }) => void>();
  let oscillatorsStarted = 0;
  let permissionRequests = 0;

  const virtualConsole = new VirtualConsole();
  // `window.location.reload()` is not implemented in jsdom and is reported
  // here rather than thrown. Capturing it keeps the output clean and gives
  // sign-out something to assert on.
  virtualConsole.on('jsdomError', (err: Error) => navigations.push(err.message));

  const dom = new JSDOM(PAGE, {
    url: PAGE_URL,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      if (options.cookie) window.document.cookie = `${options.cookie}; Path=/`;

      window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        calls.push({ url, method: init?.method ?? 'GET', headers });

        const { status = 200, body = {} } = route(url);
        return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
      }) as typeof fetch;

      // The page opens an SSE stream as soon as it is authenticated.
      window.EventSource = class {
        close = vi.fn();
        addEventListener = (type: string, listener: (event: { data: string }) => void): void => {
          listeners.set(type, listener);
        };
        onerror: (() => void) | null = null;
      } as unknown as typeof EventSource;

      for (const [key, value] of Object.entries(env.storage)) window.localStorage.setItem(key, value);
      Object.defineProperty(window.document, 'hidden', { get: () => env.hidden, configurable: true });
      Object.defineProperty(window.document, 'hasFocus', { value: () => env.focused, configurable: true });

      if (env.permission !== 'absent') {
        const FakeNotification = class implements ShownNotification {
          static get permission(): NotificationPermission {
            return env.permission as NotificationPermission;
          }
          static async requestPermission(): Promise<NotificationPermission> {
            permissionRequests++;
            env.permission = env.permissionAnswer;
            return env.permissionAnswer;
          }
          closed = false;
          onclick: (() => void) | null = null;
          onclose: (() => void) | null = null;
          constructor(public title: string, public options: NotificationOptions = {}) {
            notifications.push(this);
          }
          close(): void {
            this.closed = true;
            this.onclose?.();
          }
        };
        (window as unknown as { Notification: unknown }).Notification = FakeNotification;
      }

      (window as unknown as { AudioContext: unknown }).AudioContext = class {
        state = 'running';
        currentTime = 0;
        destination = {};
        resume = async (): Promise<void> => {};
        createGain = () => ({
          connect: vi.fn(),
          gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        });
        createOscillator = () => ({
          type: '',
          frequency: { value: 0 },
          connect: vi.fn(),
          start: () => { oscillatorsStarted++; },
          stop: vi.fn(),
        });
      };
    },
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await settle();

  return {
    window: dom.window,
    env,
    notifications,
    sounds: () => oscillatorsStarted / 2,
    permissionRequests: () => permissionRequests,
    emit: (type, data) => listeners.get(type)!({ data: JSON.stringify(data) }),
    calls,
    navigations,
    settle,
    callsTo: (fragment) => calls.filter((call) => call.url.includes(fragment)),
    isVisible: (id) => dom.window.document.getElementById(id)!.style.display !== 'none',
    input: (id) => dom.window.document.getElementById(id) as HTMLInputElement,
  };
}

/** The page functions the markup's inline handlers call. */
interface PageGlobals {
  doLogin(): Promise<void>;
  doSignOut(): Promise<void>;
  decide(requestId: string, action: string, matchType: string, duration: string): Promise<void>;
  toggleAlerts(): Promise<void>;
  toggleSound(): void;
  summarizeCommand(command: string): string;
}

function globals(page: LoadedPage): PageGlobals {
  return page.window as unknown as PageGlobals;
}

describe('approval page session flow', () => {
  let open: LoadedPage | undefined;

  async function load(options: PageOptions = {}): Promise<LoadedPage> {
    open = await loadPage(options);
    return open;
  }

  afterEach(() => {
    // Stops the page's one-minute history refresh timer.
    open?.window.close();
    open = undefined;
  });

  // ------------------------------------------------------------------
  // Login
  // ------------------------------------------------------------------
  describe('doLogin', () => {
    it('doLogin_correctSecretWithoutRemember_showsTheAppAndMintsNoSession', async () => {
      const page = await load();
      page.input('secret-input').value = 'luc_admin_secret';

      await globals(page).doLogin();
      await page.settle();

      expect(page.isVisible('app-view')).toBe(true);
      expect(page.isVisible('login-view')).toBe(false);
      // "Remember me" was not ticked, so no cookie may be issued.
      expect(page.callsTo('/approvals/session')).toHaveLength(0);
      expect(page.isVisible('signout-btn')).toBe(false);
      expect(page.callsTo('/pending')[0].headers.Authorization).toBe('Bearer luc_admin_secret');
    });

    it('doLogin_correctSecretWithRemember_exchangesItForACookieAndStopsSendingTheSecret', async () => {
      const page = await load();
      page.input('secret-input').value = 'luc_admin_secret';
      page.input('remember-input').checked = true;

      await globals(page).doLogin();
      await page.settle();

      const session = page.callsTo('/approvals/session');
      expect(session).toHaveLength(1);
      expect(session[0].method).toBe('POST');
      expect(session[0].headers.Authorization).toBe('Bearer luc_admin_secret');

      // From here the cookie carries auth, so the secret must leave the page.
      expect(page.isVisible('app-view')).toBe(true);
      expect(page.isVisible('signout-btn')).toBe(true);
      for (const call of page.callsTo('/history').concat(page.callsTo('/stream-ticket'))) {
        expect(call.headers.Authorization).toBeUndefined();
      }
    });

    it('doLogin_wrongSecret_keepsTheLoginFormAndShowsTheError', async () => {
      const page = await load({ route: pendingAnswers(401, 'UNAUTHORIZED') });
      page.input('secret-input').value = 'wrong';

      await globals(page).doLogin();
      await page.settle();

      expect(page.isVisible('app-view')).toBe(false);
      expect(page.window.document.getElementById('login-error')!.style.display).toBe('block');
      expect(page.callsTo('/approvals/session')).toHaveLength(0);
    });

    it('doLogin_pressingEnterInTheSecretField_submitsTheForm', async () => {
      const page = await load();
      page.input('secret-input').value = 'luc_admin_secret';

      page.input('secret-input').dispatchEvent(
        new page.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
      await page.settle();

      expect(page.isVisible('app-view')).toBe(true);
    });

    it('doLogin_secretAcceptedButSessionMintingFails_stillSignsInForThisTab', async () => {
      const page = await load({
        route: (url) => (url.includes('/approvals/session') ? { status: 500 } : happyRoutes(url)),
      });
      page.input('secret-input').value = 'luc_admin_secret';
      page.input('remember-input').checked = true;

      await globals(page).doLogin();
      await page.settle();

      expect(page.isVisible('app-view')).toBe(true);
      // No cookie session, so the page keeps using the bearer secret.
      expect(page.isVisible('signout-btn')).toBe(false);
      expect(page.callsTo('/history')[0].headers.Authorization).toBe('Bearer luc_admin_secret');
    });
  });

  // ------------------------------------------------------------------
  // Reload probe
  // ------------------------------------------------------------------
  describe('load with no typed secret', () => {
    it('load_noSessionMarkerCookie_showsLoginWithoutSpendingALoginAttempt', async () => {
      // Probing blind would burn a real login attempt on every visit, and five
      // reloads before signing in would lock the IP out.
      const page = await load();

      expect(page.calls).toHaveLength(0);
      expect(page.isVisible('login-view')).toBe(true);
      expect(page.isVisible('app-view')).toBe(false);
    });

    it('load_markerCookieAndValidSession_skipsTheLoginForm', async () => {
      const page = await load({ cookie: `${CSRF_COOKIE}=csrf-token-1` });

      expect(page.isVisible('app-view')).toBe(true);
      expect(page.isVisible('login-view')).toBe(false);
      expect(page.isVisible('signout-btn')).toBe(true);
      expect(page.callsTo('/pending')[0].headers.Authorization).toBeUndefined();
    });

    it('load_markerCookieButSessionNoLongerOpens_clearsTheMarkerAndShowsLogin', async () => {
      // Expired session, or a rotated sealing key: the readable marker outlives
      // the session it stands for, and reloading must not keep retrying.
      const page = await load({
        cookie: `${CSRF_COOKIE}=stale-token`,
        route: pendingAnswers(401, 'UNAUTHORIZED'),
      });

      expect(page.isVisible('login-view')).toBe(true);
      expect(page.window.document.cookie).not.toContain(CSRF_COOKIE);
    });

    it('load_markerCookieAndLockedOut_keepsTheMarkerBecauseA429IsNotASignOut', async () => {
      const page = await load({
        cookie: `${CSRF_COOKIE}=csrf-token-1`,
        route: pendingAnswers(429, 'RATE_LIMITED'),
      });

      expect(page.isVisible('login-view')).toBe(true);
      expect(page.window.document.cookie).toContain(CSRF_COOKIE);
    });
  });

  // ------------------------------------------------------------------
  // CSRF header wiring
  // ------------------------------------------------------------------
  describe('state-changing requests', () => {
    it('decide_cookieSession_echoesTheCsrfTokenAndSendsNoBearer', async () => {
      const page = await load({ cookie: `${CSRF_COOKIE}=csrf-token-1` });

      await globals(page).decide('req-1', 'approve', 'exact', '2');
      await page.settle();

      const decide = page.callsTo('/decide')[0];
      expect(decide.method).toBe('POST');
      expect(decide.headers['X-Lucifer-CSRF']).toBe('csrf-token-1');
      expect(decide.headers.Authorization).toBeUndefined();
    });

    it('decide_bearerSession_sendsTheSecretAndNoCsrfHeader', async () => {
      const page = await load();
      page.input('secret-input').value = 'luc_admin_secret';
      await globals(page).doLogin();
      await page.settle();

      await globals(page).decide('req-1', 'deny', 'exact', '0');
      await page.settle();

      const decide = page.callsTo('/decide')[0];
      expect(decide.headers.Authorization).toBe('Bearer luc_admin_secret');
      expect(decide.headers['X-Lucifer-CSRF']).toBeUndefined();
    });

    it('doSignOut_cookieSession_deletesTheSessionWithTheCsrfTokenAndReloads', async () => {
      const page = await load({ cookie: `${CSRF_COOKIE}=csrf-token-1` });

      await globals(page).doSignOut();
      await page.settle();

      const signOut = page.callsTo('/approvals/session').find((call) => call.method === 'DELETE');
      expect(signOut).toBeDefined();
      expect(signOut!.headers['X-Lucifer-CSRF']).toBe('csrf-token-1');
      // The in-memory secret only goes away with the reload.
      expect(page.navigations.some((message) => message.includes('navigation'))).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // New-request alerts (#62)
  // ------------------------------------------------------------------
  describe('new-request alerts', () => {
    const SIGNED_IN = `${CSRF_COOKIE}=csrf-token-1`;
    const ALERTS_ON = { 'lucifer.alerts': 'on' };

    function request(requestId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return {
        requestId,
        command: 'git push origin main',
        apiKeyName: 'agent-1',
        ip: '127.0.0.1',
        createdAt: '2026-09-26T10:00:00.000Z',
        riskAnalysis: { level: 'warning', warnings: [] },
        ...overrides,
      };
    }

    async function signedIn(alerts: Partial<AlertEnv> = {}): Promise<LoadedPage> {
      const page = await load({
        cookie: SIGNED_IN,
        alerts: { permission: 'granted', storage: ALERTS_ON, ...alerts },
      });
      page.emit('init', { pending: [] });
      return page;
    }

    it('newRequest_tabInBackground_showsANotificationPlaysTheSoundAndCountsInTheTitle', async () => {
      const page = await signedIn();

      page.emit('new_request', request('req-1', { command: 'npm publish --access public' }));

      expect(page.notifications).toHaveLength(1);
      const [shown] = page.notifications;
      expect(shown.title).toBe('Lucifer: approval needed (WARNING)');
      expect(shown.options.body).toBe('npm publish --access public\nKey: agent-1');
      expect(shown.options.tag).toBe('req-1');
      expect(shown.options.requireInteraction).toBe(false);
      expect(page.sounds()).toBe(1);
      expect(page.window.document.title).toBe('(1) Lucifer Approvals');
    });

    it('newRequest_dangerRisk_keepsTheNotificationUntilDismissed', async () => {
      const page = await signedIn();

      page.emit('new_request', request('req-1', { riskAnalysis: { level: 'danger', warnings: ['rm'] } }));

      expect(page.notifications[0].title).toBe('Lucifer: approval needed (DANGER)');
      expect(page.notifications[0].options.requireInteraction).toBe(true);
    });

    it('newRequest_longCommand_notifiesWithASummaryNotTheFullCommand', async () => {
      const page = await signedIn();
      const command = 'curl -H "Authorization: Bearer sk-live-123456789" https://api.example.com/v1/charge';

      page.emit('new_request', request('req-1', { command }));

      const body = page.notifications[0].options.body!;
      expect(body).not.toContain('sk-live-123456789');
      expect(body.split('\n')[0]).toBe('curl -H "Authorization: Bearer …');
    });

    it('newRequest_tabFocused_raisesNoAlert', async () => {
      const page = await signedIn({ hidden: false, focused: true });

      page.emit('new_request', request('req-1'));

      expect(page.notifications).toHaveLength(0);
      expect(page.sounds()).toBe(0);
      expect(page.window.document.title).toBe('Lucifer Approvals');
    });

    it('newRequest_tabVisibleButWindowUnfocused_alerts', async () => {
      const page = await signedIn({ hidden: false, focused: false });

      page.emit('new_request', request('req-1'));

      expect(page.notifications).toHaveLength(1);
    });

    it('init_existingPendingRequests_raisesNoAlert', async () => {
      // `init` is the initial list and every reconnect: nothing in it is new.
      const page = await load({ cookie: SIGNED_IN, alerts: { permission: 'granted', storage: ALERTS_ON } });

      page.emit('init', { pending: [request('req-1'), request('req-2')] });

      expect(page.notifications).toHaveLength(0);
      expect(page.sounds()).toBe(0);
      expect(page.window.document.title).toBe('Lucifer Approvals');
    });

    it('newRequest_sameRequestTwice_alertsOnce', async () => {
      const page = await signedIn();

      page.emit('new_request', request('req-1'));
      page.emit('new_request', request('req-1'));

      expect(page.notifications).toHaveLength(1);
      expect(page.sounds()).toBe(1);
    });

    it('newRequest_alertsNotEnabled_onlyCountsInTheTitle', async () => {
      const page = await signedIn({ storage: {} });

      page.emit('new_request', request('req-1'));

      expect(page.notifications).toHaveLength(0);
      expect(page.sounds()).toBe(0);
      expect(page.window.document.title).toBe('(1) Lucifer Approvals');
    });

    it('newRequest_notificationPermissionDenied_stillPlaysTheSound', async () => {
      const page = await signedIn({ permission: 'denied' });

      page.emit('new_request', request('req-1'));

      expect(page.notifications).toHaveLength(0);
      expect(page.sounds()).toBe(1);
      const button = page.window.document.getElementById('notify-btn')!;
      expect(button.textContent).toBe('🔔 Sound alerts only');
      expect(button.title).toMatch(/blocked/);
    });

    it('newRequest_notificationApiMissing_stillPlaysTheSound', async () => {
      const page = await signedIn({ permission: 'absent' });

      page.emit('new_request', request('req-1'));

      expect(page.sounds()).toBe(1);
      expect(page.window.document.getElementById('notify-btn')!.title).toMatch(/cannot show/);
    });

    it('newRequest_soundMuted_notifiesSilently', async () => {
      const page = await signedIn({ storage: { ...ALERTS_ON, 'lucifer.alerts.muted': 'true' } });

      page.emit('new_request', request('req-1'));

      expect(page.notifications).toHaveLength(1);
      expect(page.sounds()).toBe(0);
      expect(page.window.document.getElementById('sound-btn')!.textContent).toBe('🔇');
    });

    it('requestDecided_closesItsNotificationAndDropsItFromTheTitle', async () => {
      const page = await signedIn();
      page.emit('new_request', request('req-1'));
      page.emit('new_request', request('req-2'));

      page.emit('request_decided', { requestId: 'req-1', decision: 'approved' });

      expect(page.notifications[0].closed).toBe(true);
      expect(page.notifications[1].closed).toBe(false);
      expect(page.window.document.title).toBe('(1) Lucifer Approvals');
    });

    it('focus_afterMissedRequests_resetsTheTitleCounter', async () => {
      const page = await signedIn();
      page.emit('new_request', request('req-1'));

      page.env.hidden = false;
      page.env.focused = true;
      page.window.dispatchEvent(new page.window.Event('focus'));

      expect(page.window.document.title).toBe('Lucifer Approvals');
    });

    it('notificationClick_focusesTheTabAndHighlightsTheCard', async () => {
      const page = await signedIn();
      const focus = vi.spyOn(page.window, 'focus').mockImplementation(() => {});
      page.emit('new_request', request('req-1'));

      page.notifications[0].onclick!();

      expect(focus).toHaveBeenCalled();
      expect(page.window.document.getElementById('card-req-1')!.classList.contains('highlight')).toBe(true);
      expect(page.notifications[0].closed).toBe(true);
    });

    it('toggleAlerts_permissionNotYetAsked_asksTurnsAlertsOnAndPlaysASample', async () => {
      const page = await load({ cookie: SIGNED_IN });
      const button = page.window.document.getElementById('notify-btn')!;
      expect(button.textContent).toBe('🔔 Enable notifications');
      expect(page.isVisible('sound-btn')).toBe(false);

      await globals(page).toggleAlerts();

      expect(page.permissionRequests()).toBe(1);
      expect(page.window.localStorage.getItem('lucifer.alerts')).toBe('on');
      expect(button.textContent).toBe('🔔 Notifications on');
      expect(page.isVisible('sound-btn')).toBe(true);
      expect(page.sounds()).toBe(1);

      await globals(page).toggleAlerts();

      expect(page.window.localStorage.getItem('lucifer.alerts')).toBe('off');
      expect(button.textContent).toBe('🔔 Enable notifications');
    });

    it('toggleSound_mutesAndUnmutesAndRemembersTheChoice', async () => {
      const page = await signedIn();

      globals(page).toggleSound();
      expect(page.window.localStorage.getItem('lucifer.alerts.muted')).toBe('true');
      expect(page.sounds()).toBe(0);

      globals(page).toggleSound();
      expect(page.window.localStorage.getItem('lucifer.alerts.muted')).toBe('false');
      expect(page.sounds()).toBe(1);
    });

    it('summarizeCommand_cutsLongCommandsAtAWordAndKeepsShortOnesWhole', async () => {
      const page = await load();
      const { summarizeCommand } = globals(page);

      expect(summarizeCommand('  ls   -la  ')).toBe('ls -la');
      expect(summarizeCommand('git push origin feature/a-very-long-branch-name-here')).toBe('git push origin …');
      expect(summarizeCommand('x'.repeat(60))).toBe('x'.repeat(39) + '…');
    });
  });
});
