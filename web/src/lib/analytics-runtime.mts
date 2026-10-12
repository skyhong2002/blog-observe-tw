// The browser side of GA4 on blog.observe.tw, written against injected
// globals so node --test can drive it (SiteAnalytics passes the real ones).
//
// Page views: the one `config` sends the landing page_view; later SPA and
// back/forward views are GA enhanced measurement's history events. This code
// never sends page_view or config again. It only keeps what those hits may
// say safe, synchronously, before the URL changes: history.pushState/
// replaceState are wrapped (and popstate captured) before gtag.js loads, so
// each navigation first updates `ga-disable-<ID>` and the global page fields
// (`set`: canonical origin + public path, fixed title, origin-only referrer).
// The script itself is inserted on the first public page.
//
// Privacy taint: once `config` has been sent, the first navigation to a
// private, query, noindex or unparsable URL turns hits off for the rest of
// the document, even back on public pages. Seen in production: GA enhanced
// measurement's history events overwrite page_referrer with the previous full
// URL whatever `set` or `config` say, so /articles/?q=x -> back -> /articles/
// sent dr=...?q=x. A pure mock cannot reproduce Google's engine; this is the
// conservative rule. Navigations while no instance is mounted (StrictMode
// remount) count the same way when the URL moved. A new full page load starts
// clean (document.referrer is cut to its origin); nothing reloads by itself.
// A document that never sent `config` may still start on its first public
// page: Google saw none of its history.
//
// Custom events are only handed to gtag once gtag.js has loaded; until then
// they wait here, and any suppression (opt-out, private or query page,
// taint) discards them, so nothing queued on an eligible page replays later.
import {
  ACTION_EVENT,
  type AnalyticsAction,
  classifyClick,
  loginCompleted,
  OPT_OUT_EVENT,
  OPT_OUT_KEY,
  type PublicPage,
  pageFields,
  publicPage,
  readOptOut,
} from './analytics-consent.mts';

type Listener = (event: Event) => void;
interface Target {
  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions): void;
}
type HistoryMethod = (data: unknown, unused: string, url?: string | URL | null) => void;
interface HistoryLike {
  pushState: HistoryMethod;
  replaceState: HistoryMethod;
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AnalyticsDeps {
  id: string;
  /** location.origin */
  origin: string;
  /** The current location.href. */
  href: () => string;
  /** document.referrer at load. */
  referrer: string;
  history: HistoryLike;
  /** window: listeners plus the `ga-disable-<ID>`, dataLayer and state slots. */
  win: Target & Record<string, unknown>;
  /** document: click delegation. */
  doc: Target;
  /** May return null or throw when storage is unavailable. */
  localStorage: () => StorageLike | null;
  /** Inserts the gtag.js script element; `onload` runs once it has executed. */
  loadScript: (src: string, onload: () => void) => void;
  /** document.cookie, read for the gateway's login marker only. */
  cookie: () => string;
  /** Deletes the login marker. */
  clearLoginReceipt: () => void;
  /**
   * Whether the server-rendered document carries a robots noindex. Checked
   * for the landing document only (after a client navigation the metadata
   * still describes the previous page); an extra guard, not the main one.
   */
  noindex: () => boolean;
}

type Navigate = (url: string | URL) => void;
interface Hooks {
  handler: Navigate | null;
  push: HistoryMethod | null;
  replace: HistoryMethod | null;
  /** The popstate watcher stays for the document, like the wrappers. */
  popstate: boolean;
}
interface State {
  configured: boolean;
  loaded: boolean;
  optedOut: boolean;
  loginSent: boolean;
  /** The landing URL (no fragment) when its document was noindex. */
  noindexPage: string | null;
  landingChecked: boolean;
  /** The last URL (no fragment) seen by any instance. */
  current: string | null;
  /** Configured, then on a non-measurable URL: off for this document. */
  tainted: boolean;
  onLoad: (() => void) | null;
  hooks: Hooks;
}

const STATE = '__blogAnalytics';

const withoutHash = (href: string, base: string) => new URL(href, base).href.replace(/#.*$/, '');

/** A navigation no instance judged: after `config`, any move taints. */
function unobserved(state: State, href: string, base: string) {
  if (!state.configured || state.tainted) return;
  let url: string | null = null;
  try {
    url = withoutHash(href, base);
  } catch {}
  if (url !== state.current) state.tainted = true;
}

/** Installs the guards and listeners (idempotent per window); returns their cleanup. */
export function installAnalytics(deps: AnalyticsDeps): () => void {
  const { id, origin, win } = deps;
  const disableKey = `ga-disable-${id}`;
  win[STATE] ??= {
    configured: false,
    loaded: false,
    optedOut: false,
    loginSent: false,
    noindexPage: null,
    landingChecked: false,
    current: null,
    tainted: false,
    onLoad: null,
    hooks: { handler: null, push: null, replace: null, popstate: false },
  } satisfies State;
  win.dataLayer ??= [];
  const state = win[STATE] as State;
  const dataLayer = win.dataLayer as unknown[];
  // gtag.js reads Arguments objects, not arrays.
  function gtag(..._args: unknown[]) {
    // biome-ignore lint/complexity/noArguments: the documented gtag shape.
    dataLayer.push(arguments);
  }
  const storage = (pick: () => StorageLike | null) => {
    try {
      return pick();
    } catch {
      return null;
    }
  };
  let disposed = false;
  let page: PublicPage | null = null;
  let current = '';
  /** Custom events from eligible pages, waiting for gtag.js. */
  let pending: Array<[string, Record<string, string | undefined>?]> = [];
  // Off until this page is known to be public.
  win[disableKey] = true;

  /** Opting out (or losing access to the choice) is final for this document. */
  const optedOut = () => {
    if (!state.optedOut && readOptOut(storage(deps.localStorage)) !== false) state.optedOut = true;
    return state.optedOut;
  };
  const disable = () => {
    page = null;
    pending = [];
    win[disableKey] = true;
  };
  /** Leaving for a URL that is not measured: after `config`, for good. */
  const leave = () => {
    if (state.configured) state.tainted = true;
    disable();
  };
  const eligible = () => !disposed && page !== null && state.configured && !state.tainted && win[disableKey] === false && !optedOut();

  const emit = (name: string, params?: Record<string, string | undefined>) => {
    if (params) gtag('event', name, params);
    else gtag('event', name);
  };
  const send = (name: string, params?: Record<string, string | undefined>) => {
    if (!eligible()) return;
    if (state.loaded) emit(name, params);
    else pending.push([name, params]);
  };

  /**
   * One `login` per completed Google sign-in, from the gateway's marker
   * cookie alone, sent from a public page once gtag.js runs. After a return
   * to a private page (/my/) it waits for the next public one within the
   * marker's 5 minutes. Deleted right after the event, never before.
   */
  const sendLogin = () => {
    if (state.loginSent || !state.loaded || !eligible()) return;
    let marker = false;
    try {
      marker = loginCompleted(deps.cookie());
    } catch {}
    if (!marker) return;
    state.loginSent = true;
    emit('login', { method: 'google' });
    deps.clearLoginReceipt();
  };

  const loaded = () => {
    if (!eligible()) return disable();
    const queued = pending;
    pending = [];
    for (const [name, params] of queued) emit(name, params);
    sendLogin();
  };
  state.onLoad = loaded;

  /** Called with the URL about to be (or just) shown, before GA can see it. */
  const apply = (href: string) => {
    let next: string;
    try {
      next = new URL(href, deps.href()).href;
    } catch {
      return leave();
    }
    const url = withoutHash(next, next);
    if (url === current) return;
    const referrer = current ? origin : deps.referrer;
    current = url;
    state.current = url;
    if (!state.landingChecked) {
      state.landingChecked = true;
      let noindex = true;
      try {
        noindex = deps.noindex();
      } catch {}
      if (noindex) state.noindexPage = url;
    }
    const found = optedOut() || url === state.noindexPage ? null : publicPage(next, origin);
    if (!found) return leave();
    if (state.tainted) return disable();
    page = found;
    if (!state.configured) gtag('js', new Date());
    // Page fields go through `set` only, before `config`: values passed to
    // `config` would shadow later updates for history page_views.
    gtag('set', pageFields(origin, found, referrer));
    win[disableKey] = false;
    if (!state.configured) {
      state.configured = true;
      gtag('config', id);
      deps.loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`, () => {
        state.loaded = true;
        state.onLoad?.();
      });
    }
    sendLogin();
  };

  const navigate: Navigate = (url) => {
    try {
      apply(String(url));
    } catch {
      leave();
    }
  };
  const hooks = state.hooks;
  hooks.handler = navigate;
  const wrap = (original: HistoryMethod): HistoryMethod => {
    const wrapper = function (this: unknown, _data: unknown, _unused: string, url?: string | URL | null) {
      // A state-only call (no URL) keeps the page.
      if (url !== undefined && url !== null) {
        if (hooks.handler) hooks.handler(url);
        else unobserved(state, String(url), deps.href());
      }
      // biome-ignore lint/complexity/noArguments: pass the call through unchanged.
      return original.apply(this, arguments as unknown as Parameters<HistoryMethod>);
    };
    return Object.assign(wrapper, { __original: original });
  };
  // A wrapper left in place by an earlier cleanup (gtag.js or another script
  // wrapped it since) is still in the chain and only needs the new handler.
  if (!hooks.push) deps.history.pushState = hooks.push = wrap(deps.history.pushState);
  if (!hooks.replace) deps.history.replaceState = hooks.replace = wrap(deps.history.replaceState);

  if (!hooks.popstate) {
    hooks.popstate = true;
    const popstate = () => (hooks.handler ? hooks.handler(deps.href()) : unobserved(state, deps.href(), deps.href()));
    deps.win.addEventListener('popstate', popstate, true);
  }
  const choice = (event: Event) => {
    // `storage` with key null is another tab's localStorage.clear(): re-read.
    const key = (event as StorageEvent).key;
    if (event.type === 'storage' && key !== OPT_OUT_KEY && key !== null) return;
    if (optedOut()) disable();
  };
  const click = (event: Event) => {
    const mouse = event as MouseEvent;
    if (mouse.type === 'auxclick' && mouse.button !== 1) return;
    const target = mouse.target as Element | null;
    // Word-cloud links live inside SVG, lists use HTML anchors.
    const anchor = typeof target?.closest === 'function' ? target.closest('a[href]') : null;
    const href = anchor?.getAttribute('href');
    if (!anchor || !href || !page) return;
    const found = classifyClick(
      href,
      anchor.getAttribute('data-analytics') ?? undefined,
      origin,
      page.type,
      anchor.getAttribute('data-analytics-content-id') ?? undefined,
    );
    if (!found) return;
    if (found.name === 'rss_click') send('rss_click');
    else send(found.name, found.params);
  };
  const action = (event: Event) => {
    if ((event as CustomEvent<AnalyticsAction>).detail === 'follow') send('follow');
  };
  const installed = () => send('app_installed');

  deps.win.addEventListener(OPT_OUT_EVENT, choice);
  deps.win.addEventListener('storage', choice);
  deps.win.addEventListener(ACTION_EVENT, action);
  deps.win.addEventListener('appinstalled', installed);
  deps.doc.addEventListener('click', click, true);
  deps.doc.addEventListener('auxclick', click, true);
  // Mounted again on another URL: navigations in between went unjudged.
  unobserved(state, deps.href(), deps.href());
  navigate(deps.href());

  return () => {
    disposed = true;
    deps.win.removeEventListener(OPT_OUT_EVENT, choice);
    deps.win.removeEventListener('storage', choice);
    deps.win.removeEventListener(ACTION_EVENT, action);
    deps.win.removeEventListener('appinstalled', installed);
    deps.doc.removeEventListener('click', click, true);
    deps.doc.removeEventListener('auxclick', click, true);
    // Unguarded until the next mount: hits stay off.
    disable();
    if (hooks.handler === navigate) hooks.handler = null;
    if (state.onLoad === loaded) state.onLoad = null;
    // Restore only our own wrappers, and only while nothing has wrapped them;
    // otherwise they stay in the chain and pass calls straight through.
    const original = (wrapper: HistoryMethod) => (wrapper as HistoryMethod & { __original: HistoryMethod }).__original;
    if (hooks.push && deps.history.pushState === hooks.push) {
      deps.history.pushState = original(hooks.push);
      hooks.push = null;
    }
    if (hooks.replace && deps.history.replaceState === hooks.replace) {
      deps.history.replaceState = original(hooks.replace);
      hooks.replace = null;
    }
  };
}
