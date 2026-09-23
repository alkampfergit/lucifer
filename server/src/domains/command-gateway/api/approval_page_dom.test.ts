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

interface LoadedPage {
  window: DOMWindow;
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
async function loadPage(options: { route?: Route; cookie?: string } = {}): Promise<LoadedPage> {
  const route = options.route ?? happyRoutes;
  const calls: FetchCall[] = [];
  const navigations: string[] = [];

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
        addEventListener = vi.fn();
        onerror: (() => void) | null = null;
      } as unknown as typeof EventSource;
    },
  });

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await settle();

  return {
    window: dom.window,
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
}

function globals(page: LoadedPage): PageGlobals {
  return page.window as unknown as PageGlobals;
}

describe('approval page session flow', () => {
  let open: LoadedPage | undefined;

  async function load(options: { route?: Route; cookie?: string } = {}): Promise<LoadedPage> {
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
});
