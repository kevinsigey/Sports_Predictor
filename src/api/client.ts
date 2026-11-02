// The summary's type belongs to the panel. It is imported here because this
// module fetches one and has to say what it returns, and it is deliberately NOT
// re-exported: the modal, the explain call sites and the tests all import
// `Explanation` from `../predictor-ui` directly. This module used to re-export
// it as a second door onto the same type, and nothing consumed that door — two
// doors onto one type is the same "local copy" mistake the declaration here was
// originally deleted for.
import { createContextLoader, type Explanation } from "../predictor-ui";
import type {
  CurrentWeek,
  GamePrediction,
  GameSummary,
  GameVerdict,
  HeadToHead,
  HubPlayersResponse,
  HubTeamsResponse,
  OutPlayerEntry,
  PlayerPropPrediction,
  PowerRankingsResponse,
  PropGrading,
  RetrainResponse,
  SignalsResponse,
  SportApi,
  StandingsEntry,
  TeamForm,
  TrackRecord,
  TrackRecordPicks,
  WeekPrediction,
} from "../types";

// A backend that accepts the connection but never answers must still end in
// the page's error state (with Try again), never an endless "Loading…".
export const REQUEST_TIMEOUT_MS = 15_000;

function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export function createApiClient(baseUrl: string): SportApi {
  const cleanBase = baseUrl.replace(/\/+$/, "");

  // 10-minute TTL promise cache for GETs. Closure-local per client, so the
  // NFL and CFB clients never share entries even for identical relative
  // paths. Caching the promise (not the payload) also dedupes in-flight
  // requests. 10 minutes (not 45s) because these endpoints change slowly --
  // a short TTL made every tab revisit / sport switch re-fire the whole
  // request chain against the backends.
  const TTL_MS = 10 * 60_000;
  // current-week only flips when the calendar moves to a new week.
  const CURRENT_WEEK_TTL_MS = 60 * 60_000;
  const cache = new Map<string, { promise: Promise<unknown>; expiresAt: number }>();

  function cached<T>(path: string, fetcher: () => Promise<T>, ttlMs: number = TTL_MS): Promise<T> {
    const now = Date.now();
    const hit = cache.get(path);
    if (hit && hit.expiresAt > now) return hit.promise as Promise<T>;
    const promise = fetcher();
    // A rejected request must not poison the cache.
    promise.catch(() => {
      if (cache.get(path)?.promise === promise) cache.delete(path);
    });
    cache.set(path, { promise, expiresAt: now + ttlMs });
    return promise;
  }

  async function get<T>(path: string, ttlMs: number = TTL_MS): Promise<T> {
    return cached(path, async () => {
      const res = await fetchWithTimeout(`${cleanBase}${path}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
      }
      return res.json();
    }, ttlMs);
  }

  async function getOrNull<T>(path: string): Promise<T | null> {
    return cached(path, async () => {
      const res = await fetchWithTimeout(`${cleanBase}${path}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
      }
      return res.json();
    });
  }

  async function post<T>(path: string): Promise<T> {
    const res = await fetch(`${cleanBase}${path}`, { method: "POST" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
    }
    return res.json();
  }

  return {
    games: (season, week) => get<GameSummary[]>(`/games?season=${season}&week=${week}`),
    gamePrediction: (season, week, gameId) =>
      get<GamePrediction>(`/games/${season}/${week}/${gameId}/prediction`),
    playerProps: (season, week) => get<PlayerPropPrediction[]>(`/players/${season}/${week}/props`),
    playerOut: (season, week) => get<OutPlayerEntry[]>(`/players/${season}/${week}/out`),
    marketLines: (season, week) => get(`/players/${season}/${week}/market-lines`),
    // `picks=deferred` is the payload-split contract: a backend that knows it
    // returns the summary with NO row-level picks (CFB's summary was 5.9 MB,
    // almost all of it `player_props.per_pick` rows no surface renders), and
    // the rows are fetched from /track-record/picks only when the reader
    // opens the every-pick fold. A backend older than the split ignores the
    // unknown parameter and returns the full payload, picks inlined — the
    // page detects them and never calls the picks route, so nothing changes
    // in production until the backend half lands.
    trackRecord: () => get<TrackRecord>("/track-record?picks=deferred"),
    trackRecordPicks: () => get<TrackRecordPicks>("/track-record/picks"),
    // Prop grading, NBA parity: counted projections graded against the box
    // score. A backend that does not serve the route yet 404s; the panel
    // swallows every failure and renders nothing (see PropGradingPanel).
    propGrading: () => get<PropGrading>("/prop-grading"),
    retrain: () => post<RetrainResponse>("/retrain"),
    gameVerdict: (gameId) => getOrNull<GameVerdict>(`/games/${gameId}/verdict`),
    /** Spec §3's per-fixture signal payloads. Present on both clients because
     *  `createApiClient` builds them both, but only CFB serves the route today:
     *  NFL has 49 graded game rows and no band over the floor to justify one, so
     *  its 404 is the honest answer and the modal renders no row. Deliberately
     *  NOT `getOrNull`: a signal list has no "missing" middle state — either the
     *  sport has the route or it does not — and swallowing the 404 into `null`
     *  here would make the two indistinguishable to the caller. */
    signals: (gameId) => get<SignalsResponse>(`/signals/${encodeURIComponent(gameId)}`),
    predictionsForWeek: (season, week) => get<WeekPrediction[]>(`/predictions/${season}/${week}`),
    currentWeek: () => get<CurrentWeek>("/current-week", CURRENT_WEEK_TTL_MS),
    standings: (season) => get<StandingsEntry[]>(`/standings?season=${season}`),
    powerRankings: (season) => get<PowerRankingsResponse>(`/power-rankings?season=${season}`),
    predictionsBatch: (season, week) =>
      get<Record<string, GamePrediction>>(`/predictions/${season}/${week}/batch`),
    teamForm: (team, season, n = 5) =>
      get<TeamForm>(`/teams/${encodeURIComponent(team)}/form?season=${season}&n=${n}`),
    headToHead: (gameId, season, week, nSeasons = 8) =>
      get<HeadToHead>(`/games/${gameId}/head-to-head?season=${season}&week=${week}&n_seasons=${nSeasons}`),
    hubTeams: (season) => get<HubTeamsResponse>(`/hub/teams?season=${season}`),
    hubPlayers: (season) => get<HubPlayersResponse>(`/hub/players?season=${season}`),
  };
}

// Same-origin by default: the Caddy in front of this site (see Caddyfile)
// and the Vite dev/preview server (vite.config.ts) both proxy these paths
// to the NFL and CFB APIs. Override per build with VITE_NFL_API_BASE_URL /
// VITE_CFB_API_BASE_URL only when the APIs live on another origin.
export const NFL_BASE_URL: string = import.meta.env.VITE_NFL_API_BASE_URL ?? "/api/nfl";
export const CFB_BASE_URL: string = import.meta.env.VITE_CFB_API_BASE_URL ?? "/api/cfb";

export const NFL_EXPLAIN_BASE_URL: string = import.meta.env.VITE_NFL_EXPLAIN_BASE_URL ?? "/api/explain/nfl";
export const CFB_EXPLAIN_BASE_URL: string = import.meta.env.VITE_CFB_EXPLAIN_BASE_URL ?? "/api/explain/cfb";

/**
 * The plain-English summary for one game. Same-origin like every other call
 * here, on the family's 15 s timeout.
 *
 * It is deliberately NOT cached: the panel's own footer states how long ago
 * the summary was written, and a cached copy would keep showing a stale age
 * beside fresh numbers. The service caches by the facts it was given, so a
 * repeat request is cheap at the other end.
 */
export function createExplainer(baseUrl: string) {
  const cleanBase = baseUrl.replace(/\/+$/, "");
  return async function explain(id: string): Promise<Explanation> {
    const res = await fetchWithTimeout(`${cleanBase}/${encodeURIComponent(id)}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `${res.status} ${res.statusText}`);
    }
    return res.json();
  };
}

export const nflApi = createApiClient(NFL_BASE_URL);
export const cfbApi = createApiClient(CFB_BASE_URL);
export const nflExplain = createExplainer(NFL_EXPLAIN_BASE_URL);
export const cfbExplain = createExplainer(CFB_EXPLAIN_BASE_URL);
// Same base as the explainer above: `<base>/<id>/context`.
export const nflContext = createContextLoader(NFL_EXPLAIN_BASE_URL);
export const cfbContext = createContextLoader(CFB_EXPLAIN_BASE_URL);

/**
 * Best-effort warm of both sport clients: current week first, then the main
 * endpoints in parallel (each call is behind the client's TTL cache).
 * Fire-and-forget from the app shell shortly after first paint, and again
 * whenever the tab becomes visible (device wakeup / tab switch back).
 */
export async function preloadAll(): Promise<void> {
  async function warmSport(api: SportApi): Promise<void> {
    try {
      const cw = await api.currentWeek();
      await Promise.allSettled([
        api.games(cw.season, cw.week),
        api.predictionsBatch(cw.season, cw.week),
        api.playerProps(cw.season, cw.week),
        api.standings(cw.season),
        api.trackRecord(),
        api.powerRankings(cw.season),
      ]);
    } catch {
      // Preload is best-effort; pages fetch for themselves on demand.
    }
  }
  // Warm both sports concurrently: the old sequential loop doubled the time
  // before the second sport's tabs stopped hanging on cold navigation.
  await Promise.allSettled([warmSport(nflApi), warmSport(cfbApi)]);
}
