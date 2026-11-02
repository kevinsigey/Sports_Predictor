import { beforeEach, describe, expect, it, vi } from "vitest";
import { cfbContext, nflContext, createApiClient, preloadAll, NFL_BASE_URL, CFB_BASE_URL, REQUEST_TIMEOUT_MS } from "./client";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function okJson(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

describe("createApiClient new endpoints", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({}));
  });

  it("powerRankings hits /power-rankings with the season", async () => {
    const api = createApiClient("https://example.test/api/");
    await api.powerRankings(2026);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/power-rankings?season=2026", expect.anything());
  });

  it("predictionsBatch hits the batch route for the season and week", async () => {
    const api = createApiClient("https://example.test/api/");
    await api.predictionsBatch(2026, 7);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/predictions/2026/7/batch", expect.anything());
  });

  it("teamForm hits /teams/{team}/form with season and n, URL-encoding the team", async () => {
    const api = createApiClient("https://example.test/api/");
    await api.teamForm("Ohio State", 2026);
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/teams/Ohio%20State/form?season=2026&n=5", expect.anything());
  });

  it("headToHead hits /games/{id}/head-to-head with season, week and n_seasons", async () => {
    const api = createApiClient("https://example.test/api/");
    await api.headToHead("2026_01_KC_BAL", 2026, 1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api/games/2026_01_KC_BAL/head-to-head?season=2026&week=1&n_seasons=8",
      expect.anything(),
    );
  });

  it("trackRecord asks for the summary with picks deferred, never the bare route", async () => {
    const api = createApiClient("https://example.test/api/");
    await api.trackRecord();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.test/api/track-record?picks=deferred",
      expect.anything(),
    );
    expect(fetchMock).not.toHaveBeenCalledWith("https://example.test/api/track-record", expect.anything());
  });

  it("trackRecordPicks hits the split picks route", async () => {
    const api = createApiClient("https://example.test/api/");
    // Optional in SportApi (an older backend may not serve the route); the
    // real client always provides it.
    expect(api.trackRecordPicks).toBeDefined();
    await api.trackRecordPicks!();
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/track-record/picks", expect.anything());
  });

  it("propGrading hits the prop-grading route", async () => {
    const api = createApiClient("https://example.test/api/");
    // Optional in SportApi (the route is newer than the frontend); the real
    // client always provides it.
    expect(api.propGrading).toBeDefined();
    await api.propGrading!();
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/api/prop-grading", expect.anything());
  });
});

describe("createApiClient TTL cache", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson([]));
  });

  it("dedupes concurrent and repeated GETs within the 10-minute TTL", async () => {
    vi.useFakeTimers();
    try {
      const api = createApiClient("https://example.test/api/");
      const p1 = api.games(2026, 1);
      const p2 = api.games(2026, 1);
      await p1; await p2;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(9 * 60_000 + 59_000);
      await api.games(2026, 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000); // past the 10-minute TTL
      await api.games(2026, 1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("caches currentWeek for an hour since it only changes weekly", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue(okJson({ season: 2026, week: 7 }));
      const api = createApiClient("https://example.test/api/");
      await api.currentWeek();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(59 * 60_000);
      await api.currentWeek();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(61_000); // past the hour
      await api.currentWeek();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not share cache entries between clients (NFL vs CFB isolation)", async () => {
    const nfl = createApiClient("https://nfl.test/api");
    const cfb = createApiClient("https://cfb.test/api");
    await nfl.games(2026, 1);
    await cfb.games(2026, 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "https://nfl.test/api/games?season=2026&week=1", expect.anything());
    expect(fetchMock).toHaveBeenNthCalledWith(2, "https://cfb.test/api/games?season=2026&week=1", expect.anything());
  });

  it("does not cache rejected requests", async () => {
    fetchMock.mockRejectedValueOnce(new Error("down"));
    const api = createApiClient("https://example.test/api/");
    await expect(api.games(2026, 1)).rejects.toThrow("down");
    await api.games(2026, 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("preloadAll", () => {
  it("warms current-week then the main endpoints for both sports", async () => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith("/current-week")
        ? Promise.resolve(okJson({ season: 2026, week: 7 }))
        : Promise.resolve(okJson([])),
    );
    await preloadAll();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/nfl/current-week");
    expect(urls).toContain("/api/cfb/current-week");
    expect(urls).toContain("/api/nfl/predictions/2026/7/batch");
    expect(urls).toContain("/api/cfb/predictions/2026/7/batch");
    expect(urls).toContain("/api/nfl/power-rankings?season=2026");
    expect(urls).toContain("/api/cfb/power-rankings?season=2026");
  });

  it("warms both sports concurrently instead of one after the other", async () => {
    vi.useFakeTimers();
    try {
      // Expire anything the earlier preload test cached in the shared clients.
      // The clock must stay fake while preloadAll runs: expiry is evaluated
      // with Date.now(), so flipping back to real timers would un-expire it.
      vi.advanceTimersByTime(61 * 60_000);

      fetchMock.mockReset();
      let resolveNflWeek!: () => void;
      const nflWeekGate = new Promise<void>((resolve) => { resolveNflWeek = resolve; });
      fetchMock.mockImplementation((url: string) => {
        const u = String(url);
        if (u === "/api/nfl/current-week") {
          return nflWeekGate.then(() => okJson({ season: 2026, week: 7 }));
        }
        return Promise.resolve(okJson(u.endsWith("/current-week") ? { season: 2026, week: 7 } : []));
      });
      const warming = preloadAll();
      for (let i = 0; i < 50; i++) await Promise.resolve();
      // The NFL week request is still hanging, yet CFB warming already started.
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls).toContain("/api/cfb/current-week");
      resolveNflWeek();
      await warming;
      const urlsAfter = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urlsAfter).toContain("/api/nfl/predictions/2026/7/batch");
      expect(urlsAfter).toContain("/api/cfb/predictions/2026/7/batch");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("API base URLs", () => {
  it("default to same-origin paths so the page works on any host", () => {
    expect(NFL_BASE_URL).toBe("/api/nfl");
    expect(CFB_BASE_URL).toBe("/api/cfb");
  });
});

describe("request timeout", () => {
  it("rejects a request the server never answers, so the page can show its error state", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockReset();
      fetchMock.mockImplementation((_u: string, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "AbortError"))),
        ));
      const api = createApiClient("https://example.test/api");
      const assertion = expect(api.games(2026, 1)).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 1);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("matchup context loaders", () => {
  it("use the same per-sport explain base as the explainers", async () => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(okJson({ matchups: [] }));
    await nflContext("2026_05_BAL_KC");
    await cfbContext("401635");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "/api/explain/nfl/2026_05_BAL_KC/context",
      "/api/explain/cfb/401635/context",
    ]);
  });
});
