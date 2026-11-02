// B6 — the track record page, rebuilt on the shared kit.
//
// The rules this file exists to hold:
//
//  - Every rate carries the count behind it, and the count is the count of
//    THAT market's graded subset.
//  - Volume and accuracy never fuse.
//  - Nothing missing ever prints as a number, and a 0 is never printed for
//    an absent value.
//  - Market words come from the shared vocabulary (`Spread`, `Total`): raw
//    `ats`/`totals` never reach the page, and verdicts are `Right`/`Wrong`,
//    never `hit`/`miss`.
//  - The per-pick table is collapsed and shows team names, never raw game ids.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TrackRecordPage } from "./TrackRecordPage";
import type { SportApi, TrackRecord } from "../types";

/** NFL's `/track-record` AFTER #25. */
const NFL_RECORD: TrackRecord = {
  games: {
    n_resolved: 6,
    n_rebuilt: 2,
    n_moneyline: 6,
    n_ats: 4,
    n_totals: 3,
    pct_moneyline_correct: 0.667,
    pct_ats_correct: 0.5,
    pct_totals_correct: 0.333,
    pre_kickoff: {
      n_resolved: 4,
      n_moneyline: 4,
      n_ats: 3,
      n_totals: 2,
      pct_moneyline_correct: 0.5,
      pct_ats_correct: 0.667,
      pct_totals_correct: 0.5,
    },
    all_picks: {
      n_resolved: 6,
      pct_moneyline_correct: 0.667,
      pct_ats_correct: 0.5,
      pct_totals_correct: 0.333,
    },
    per_pick: [
      { game_id: "401547", gameday: "2026-09-06T17:00:00Z", market: "moneyline", pick: "KC", actual: "KC", hit: true, made_before_kickoff: true, snapshotted_at: "2026-09-06T14:00:00Z", counted: true },
      { game_id: "401548", gameday: "2026-09-13T17:00:00Z", market: "moneyline", pick: "BAL", actual: "NE", hit: false, made_before_kickoff: true, snapshotted_at: "2026-09-13T14:00:00Z", counted: true },
      { game_id: "401549", gameday: "2026-09-20T17:00:00Z", market: "moneyline", pick: "DET", actual: "DET", hit: true, made_before_kickoff: false, snapshotted_at: "2026-09-20T19:30:00Z", counted: true },
    ],
    weekly: [
      { week: 1, tracked: true, n_games: 4, n_moneyline: 3, pct_moneyline_correct: 0.667, n_ats: 2, pct_ats_correct: 1.0, n_totals: 1, pct_totals_correct: 0.0 },
      { week: 2, tracked: true, n_games: 1, n_moneyline: 1, pct_moneyline_correct: 1.0, n_ats: 1, pct_ats_correct: 0.0, n_totals: 1, pct_totals_correct: 0.0 },
      { week: 3, tracked: false, n_games: 0, n_moneyline: 0, pct_moneyline_correct: null, n_ats: 0, pct_ats_correct: null, n_totals: 0, pct_totals_correct: null },
    ],
  },
  player_props: {
    anytime_td: {
      n_resolved: 4,
      n_called: 3,
      hit_rate_when_called: 0.667,
      brier_score: 0.18,
      confidence_buckets: [
        { label: "50-60%", n: 1, hit_rate: 0.0 },
        { label: "60-70%", n: 0, hit_rate: null },
        { label: "70%+", n: 2, hit_rate: 1.0 },
      ],
    },
    passing_yards: { n_resolved: 2, mean_absolute_error: 39.5, mean_signed_error: -20.5, by_position: [{ position: "QB", n_resolved: 2, mean_absolute_error: 39.5 }] },
    rushing_yards: { n_resolved: 2, mean_absolute_error: 18.0, mean_signed_error: -3.0, by_position: [{ position: "RB", n_resolved: 2, mean_absolute_error: 18.0 }] },
    receiving_yards: { n_resolved: 1, mean_absolute_error: 13.0, mean_signed_error: 2.0, by_position: [{ position: "WR", n_resolved: 1, mean_absolute_error: 13.0 }] },
    receptions: { n_resolved: 0, mean_absolute_error: null, mean_signed_error: null },
    carries: { n_resolved: 1, mean_absolute_error: 3.0, mean_signed_error: -3.0 },
  },
};

/** CFB's `/track-record` AFTER #27: no `n_rebuilt`, `n_pre_kickoff` instead,
 *  `counted` flag on per-pick rows. */
const CFB_RECORD: TrackRecord = {
  games: {
    n_resolved: 12,
    pct_moneyline_correct: 0.5833333333333334,
    pct_ats_correct: 0.5,
    pct_totals_correct: null,
    n_pre_kickoff: 9,
    pre_kickoff: {
      n_resolved: 9,
      pct_moneyline_correct: 0.4444444444444444,
      pct_ats_correct: 0.25,
      pct_totals_correct: null,
    },
    per_pick: [
      { game_id: "cfb1", gameday: "2026-09-05T19:00:00Z", market: "moneyline", pick: "ALA", actual: "ALA", hit: true, made_before_kickoff: true, snapshotted_at: "2026-09-05T15:00:00Z", counted: true },
      { game_id: "cfb2", gameday: "2026-09-12T19:00:00Z", market: "moneyline", pick: "FSU", actual: "FSU", hit: true, made_before_kickoff: true, snapshotted_at: "2026-09-12T15:00:00Z", counted: true },
      { game_id: "cfb3", gameday: "2026-09-19T19:00:00Z", market: "moneyline", pick: "UGA", actual: "AUB", hit: false, made_before_kickoff: true, snapshotted_at: "2026-09-19T15:00:00Z", counted: true },
      { game_id: "cfb3", gameday: "2026-09-19T19:00:00Z", market: "moneyline", pick: "AUB", actual: "AUB", hit: true, made_before_kickoff: false, snapshotted_at: "2026-09-19T21:40:00Z", counted: false },
    ],
  },
  player_props: {
    anytime_td: {
      n_resolved: 30,
      n_called: 20,
      hit_rate_when_called: 0.55,
      brier_score: 0.21794000000000002,
      confidence_buckets: [
        { label: "50-60%", n: 4, hit_rate: 0.5 },
        { label: "60-70%", n: 6, hit_rate: 0.5 },
        { label: "70%+", n: 10, hit_rate: 0.6 },
      ],
    },
    passing_yards: { n_resolved: 40, mean_absolute_error: 25.5, mean_signed_error: 4.25 },
    rushing_yards: { n_resolved: 40, mean_absolute_error: 15.0, mean_signed_error: -7.0 },
    receiving_yards: { n_resolved: 40, mean_absolute_error: 18.0, mean_signed_error: 5.65 },
    receptions: { n_resolved: 0, mean_absolute_error: null, mean_signed_error: null },
    carries: { n_resolved: 0, mean_absolute_error: null, mean_signed_error: null },
  },
} as unknown as TrackRecord;

/** NFL with a `vs_market` block: the disagreement cohort is 2 of 3 over 6
 *  priced games. Method strings are the backend's own, verbatim — the page
 *  prints them, it does not paraphrase them. */
const NFL_RECORD_VS: TrackRecord = {
  ...NFL_RECORD,
  games: {
    ...NFL_RECORD.games,
    vs_market: {
      n: 6,
      mean_implied_home_cover_prob: 0.45,
      mean_model_home_cover_prob: 0.5,
      mean_edge_points: 5.7,
      disagreement_n: 3,
      disagreement_hit_rate: 0.667,
      disagreement: { n: 3, hit_rate: 0.667, games: ["2026_01_KC_BAL", "2026_02_BUF_MIA", "2026_03_DAL_PHI"] },
      weekly: [],
      scope: { population: "all_seasons", weekly_season: 2026, weekly_last_week: 3, n_games_total: 6, n_games_in_weekly: 6, n_games_outside_weekly: 0 },
      method: {
        sigma_league_points: 13.5,
        sigma_league_meaning: "NFL final margin is treated as roughly Normal with a standard deviation of 13.5 points. That single number is what turns a closing spread into a probability.",
        implied_probability: "The closing line is a margin — the home team's expected margin — so the probability that the home side covers it is Φ(−spread / 13.5).",
        edge: "Edge is the model's cover probability minus the probability the closing line implies, in percentage points, positive when the model likes a side more than the price does. It measures disagreement with a price, not superiority.",
        disagreement: "The disagreement cohort is the games where the model backed the side the line did not favour — a pick against the price.",
        not_a_profit_claim: "This is agreement with a price, not a profit claim. No figure here is a return, a yield, a stake or a cent.",
        population: "The headline figure covers every game the tracker holds a line, both cover probabilities and a final score for, in every season.",
      },
    },
  },
};

/** The split payload shape: the same record with NO inlined per-pick rows.
 *  The rows arrive from `/track-record/picks` when the fold opens. */
const NFL_RECORD_SPLIT: TrackRecord = {
  ...NFL_RECORD,
  games: { ...NFL_RECORD.games, per_pick: undefined },
};

const trackRecord = vi.fn(async (): Promise<TrackRecord> => NFL_RECORD);
const trackRecordPicks = vi.fn(async () => ({ per_pick: NFL_RECORD.games.per_pick ?? [] }));
const api = {
  trackRecord,
  trackRecordPicks,
  games: vi.fn(), gamePrediction: vi.fn(), playerProps: vi.fn(),
  retrain: vi.fn(), gameVerdict: vi.fn(), predictionsForWeek: vi.fn(),
  currentWeek: vi.fn(), standings: vi.fn(), powerRankings: vi.fn(),
  predictionsBatch: vi.fn(), teamForm: vi.fn(), headToHead: vi.fn(),
} as unknown as SportApi;

vi.mock("../context/SportContext", () => ({
  useSport: () => ({ sport: "nfl", setSport: () => {}, api }),
}));

beforeEach(() => {
  trackRecord.mockReset();
  trackRecord.mockResolvedValue(NFL_RECORD);
  trackRecordPicks.mockReset();
  trackRecordPicks.mockResolvedValue({ per_pick: NFL_RECORD.games.per_pick ?? [] });
});

async function renderPage() {
  const result = render(<TrackRecordPage />);
  await screen.findByTestId("tally-moneyline");
  return result;
}

// --- 1. the headline --------------------------------------------------------

describe("headline", () => {
  it("gives each market the count of ITS OWN graded games, not the row count", async () => {
    await renderPage();
    // 6 resolved, 4 ATS grades, 3 total grades. Three different denominators.
    const tally = (label: string) =>
      within(document.getElementById("tr-record")!).getByText(label).closest("[data-testid^='tally-']")!;
    expect(tally("Moneyline")).toHaveTextContent("4 of 6");
    expect(tally("Moneyline")).toHaveTextContent("67%");
    expect(tally("Spread")).toHaveTextContent("2 of 4");
    expect(tally("Spread")).toHaveTextContent("50%");
    expect(tally("Total")).toHaveTextContent("1 of 3");
    expect(tally("Total")).toHaveTextContent("33%");
  });

  it("counts every counted pick in the headline and prints the pre-kickoff subset beside it", async () => {
    await renderPage();
    const record = document.getElementById("tr-record")!;
    expect(record).toHaveTextContent("2 of 4 made before kickoff");
    expect(record.textContent).not.toMatch(/not counted/i);
    expect(record.textContent).not.toMatch(/held out/i);
  });

  it("never claims a post-kickoff pick is held out of the record, on any payload", async () => {
    await renderPage();
    expect(document.body.textContent).not.toMatch(/not\s+counted/i);
    expect(document.body.textContent).not.toMatch(/for\s+reference/i);
    trackRecord.mockResolvedValue(CFB_RECORD);
    await renderPage();
    expect(document.body.textContent).not.toMatch(/not\s+counted/i);
  });

  it("shows the pre-kickoff subset beside the headline, with its own n", async () => {
    await renderPage();
    const record = document.getElementById("tr-record")!;
    expect(record).toHaveTextContent("2 of 4 made before kickoff");
    expect(record).toHaveTextContent("2 of 3 made before kickoff");
    expect(record).toHaveTextContent("1 of 2 made before kickoff");
  });

  it("does not use raw market keys on the page", async () => {
    await renderPage();
    expect(document.body.textContent).not.toMatch(/\bats\b/i);
    expect(document.body.textContent).not.toMatch(/\btotals\b/i);
    expect(document.body.textContent).not.toMatch(/\bhit\b/i);
    expect(document.body.textContent).not.toMatch(/\bmiss\b/i);
  });
});

// --- 2. by week -------------------------------------------------------------

describe("by week", () => {
  it("renders the week strip with one cell per week", async () => {
    await renderPage();
    const strip = document.getElementById("tr-week")!;
    expect(within(strip).getAllByTestId("week-cell")).toHaveLength(3);
  });
});

// --- 3. calibration ---------------------------------------------------------

describe("calibration", () => {
  it("plots the anytime-TD confidence buckets", async () => {
    await renderPage();
    const chart = document.getElementById("tr-calibration")!;
    expect(within(chart).getAllByTestId("calibration-point")).toHaveLength(2); // 50-60% and 70%+, the 60-70% band has n=0
  });
});

// --- 4. recent picks --------------------------------------------------------

describe("recent picks", () => {
  it("lists at most 10 counted pre-kickoff picks as rows, newest first", async () => {
    await renderPage();
    const block = document.getElementById("tr-recent")!;
    const rows = within(block).getAllByTestId("recent-pick");
    expect(rows.length).toBeLessThanOrEqual(10);
    expect(rows).toHaveLength(2);
    // Newest first: Sep 13 (BAL) before Sep 6 (KC).
    expect(rows[0]).toHaveTextContent("BAL");
    expect(rows[1]).toHaveTextContent("KC");
    expect(rows[0]).toHaveTextContent("Moneyline");
    expect(rows[0]).toHaveTextContent("Wrong");
    expect(rows[1]).toHaveTextContent("Right");
  });
});

// --- 5. per-pick detail -----------------------------------------------------

describe("per-pick detail", () => {
  it("is collapsed into a details block at the bottom", async () => {
    await renderPage();
    const summary = screen.getByText("Every recorded pick");
    const details = summary.parentElement as HTMLDetailsElement;
    expect(details.getAttribute("open")).toBeNull(); // closed by default
    summary.click();
    expect(details.getAttribute("open")).not.toBeNull();
    const table = screen.getByRole("table", { name: /per-pick detail/i });
    const rows = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(rows).toHaveLength(3);
  });

  it("shows team names and Right/Wrong, never raw game ids or hit/miss", async () => {
    await renderPage();
    const summary = screen.getByText("Every recorded pick");
    summary.click();
    const table = screen.getByRole("table", { name: /per-pick detail/i });
    const rows = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(rows).toHaveLength(3);
    // No raw game ids anywhere on the page.
    expect(document.body.textContent).not.toContain("401547");
    expect(document.body.textContent).not.toContain("401548");
    expect(document.body.textContent).not.toContain("401549");
    // Team names (pick / actual) and Right/Wrong appear.
    const allText = rows.map((r) => r.textContent ?? "").join(" ");
    expect(allText).toContain("KC");
    expect(allText).toContain("DET");
    expect(allText).toContain("Right");
    expect(allText).toContain("Wrong");
    // Timing: one row was made after its own kickoff.
    expect(allText).toContain("After kickoff");
    expect(allText).toContain("Before kickoff");
    const afterRow = rows.find((r) => r.textContent?.includes("After kickoff"));
    expect(afterRow).toBeTruthy();
    expect(afterRow!.textContent).toContain("DET");
    expect(afterRow!.textContent).toContain("Right");
    expect(document.body.textContent).not.toMatch(/\bhit\b/i);
    expect(document.body.textContent).not.toMatch(/\bmiss\b/i);
  });

  it("marks a recorded-but-uncounted row as history, on CFB's longer list", async () => {
    trackRecord.mockResolvedValue(CFB_RECORD);
    await renderPage();
    const summary = screen.getByText("Every recorded pick");
    summary.click();
    const table = screen.getByRole("table", { name: /per-pick detail/i });
    const rows = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(rows).toHaveLength(4);
    expect(document.body.textContent).not.toContain("cfb1");
    expect(document.body.textContent).not.toContain("cfb2");
    expect(document.body.textContent).not.toContain("cfb3");
    // The rerun row (made after kickoff, counted: false) is history.
    const historyRow = rows.find((r) => r.textContent?.includes("history, not the counted pick"));
    expect(historyRow).toBeTruthy();
    expect(within(historyRow!).getByText("After kickoff")).toBeInTheDocument();
  });
});

// --- 6. restored prop blocks: yardage markets, by position, points ---------

describe("restored prop blocks", () => {
  /** Find a `<summary>` by its visible text (jsdom does not expose summary as a button role). */
  const summaryByText = (text: string) =>
    Array.from(document.querySelectorAll("summary")).find((el) => el.textContent === text)!;

  it("each is a closed details block below Player props", async () => {
    await renderPage();
    for (const text of ["Yardage markets", "By position", "Points"]) {
      const summary = summaryByText(text);
      expect(summary).toBeInTheDocument();
      const details = summary.parentElement as HTMLDetailsElement;
      expect(details.getAttribute("open")).toBeNull(); // closed by default
    }
  });

  it("yardage markets render the fixture's MAE per market", async () => {
    await renderPage();
    const summary = summaryByText("Yardage markets");
    summary.click();
    expect(screen.getByText("39.5 yards")).toBeInTheDocument();
    expect(screen.getByText("18 yards")).toBeInTheDocument();
    expect(screen.getByText("13 yards")).toBeInTheDocument();
  });

  it("by position renders the fixture's position errors", async () => {
    await renderPage();
    const summary = summaryByText("By position");
    summary.click();
    expect(screen.getByText("QB")).toBeInTheDocument();
    expect(screen.getByText("RB")).toBeInTheDocument();
    expect(screen.getByText("WR")).toBeInTheDocument();
  });

  it("points renders the anytime-TD rate with its count", async () => {
    await renderPage();
    const summary = summaryByText("Points");
    summary.click();
    expect(screen.getByTestId("accuracy-bar-anytime-td")).toHaveTextContent("67%");
    expect(screen.getByTestId("accuracy-bar-anytime-td")).toHaveTextContent("3 calls of 4 props at 50% or better");
  });
});

// --- 7. how this is counted -------------------------------------------------

describe("how this is counted", () => {
  it("states the counting rule once, collapsed", async () => {
    await renderPage();
    const summary = screen.getByText("How this is counted");
    expect(summary).toBeInTheDocument();
    // Stated exactly once on the page (not repeated in multiple sections).
    const matches = (document.body.textContent ?? "").match(/One counted pick per game and market/g);
    expect(matches).toHaveLength(1);
    // And the meaning of the headline is stated beside it.
    expect(document.body.textContent).toMatch(/The record above counts every recorded pick/i);
  });
});

// --- 8. loading / error -----------------------------------------------------

describe("loading and error", () => {
  it("shows an error state when the record cannot load", async () => {
    trackRecord.mockRejectedValue(new Error("down"));
    render(<TrackRecordPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/down/);
  });
});

// --- 9. against the odds ----------------------------------------------------

describe("against the odds", () => {
  it("leads with the disagreement rate, percent-forward, with its count", async () => {
    trackRecord.mockResolvedValue(NFL_RECORD_VS);
    await renderPage();
    const block = document.getElementById("tr-vs-market")!;
    const card = within(block).getByTestId("vs-market-disagreement");
    // 2 of the 3 disagreements covered: the big number is the percent, and
    // the count behind it sits in the same card.
    expect(card).toHaveTextContent("67%");
    expect(card).toHaveTextContent("3 disagreements of 6 priced games");
    expect(card.querySelector(".tr-bar-fill")).not.toBeNull();
  });

  it("prints the overall spread record beside it, over its own denominator", async () => {
    trackRecord.mockResolvedValue(NFL_RECORD_VS);
    await renderPage();
    const card = within(document.getElementById("tr-vs-market")!).getByTestId("vs-market-overall");
    expect(card).toHaveTextContent("50%"); // the fixture's pct_ats_correct
    expect(card).toHaveTextContent("4 games graded"); // n_ats, not n_resolved
  });

  it("shows the average edge as a signed figure with its meaning in words", async () => {
    trackRecord.mockResolvedValue(NFL_RECORD_VS);
    await renderPage();
    const block = document.getElementById("tr-vs-market")!;
    expect(block).toHaveTextContent("+5.7 pts");
    expect(block).toHaveTextContent("the model's probability sits above the line's");
    expect(within(block).getByTestId("vs-market-cover-line")).toHaveTextContent(
      "the closing line priced the home side at 45% to cover; the model said 50%",
    );
  });

  it("states the backend's method once, inside how this is counted", async () => {
    trackRecord.mockResolvedValue(NFL_RECORD_VS);
    await renderPage();
    const how = screen.getByText("How this is counted").closest("details")!;
    expect(how).toHaveTextContent("not a profit claim");
    expect(how).toHaveTextContent("Against the odds covers 6 priced games");
    expect(how).toHaveTextContent("the games where the model backed the side the line did not favour");
  });

  it("says plainly when a sport records no market comparison", async () => {
    await renderPage(); // the base NFL fixture carries no vs_market block
    const block = document.getElementById("tr-vs-market")!;
    expect(within(block).getByTestId("not-recorded")).toHaveTextContent(/No market comparison is recorded/);
  });
});

// --- 10. yardage bias ---------------------------------------------------------

describe("yardage bias", () => {
  const summaryByText = (text: string) =>
    Array.from(document.querySelectorAll("summary")).find((el) => el.textContent === text)!;

  it("prints which way each market's error leans, beside the count", async () => {
    await renderPage();
    summaryByText("Yardage markets").click();
    const block = document.getElementById("tr-yardage")!;
    // The fixture's signed errors: passing −20.5, rushing −3.0, receiving +2.0
    // (mean of predicted − actual, so negative runs low).
    expect(block).toHaveTextContent("runs low by 20.5 yards");
    expect(block).toHaveTextContent("runs low by 3.0 yards");
    expect(block).toHaveTextContent("runs high by 2.0 yards");
  });

  it("says no lean inside the deadband, and not measured when the bias is absent", async () => {
    const flat: TrackRecord = {
      ...NFL_RECORD,
      player_props: {
        ...NFL_RECORD.player_props,
        passing_yards: { ...NFL_RECORD.player_props.passing_yards, mean_signed_error: 0.0 },
        rushing_yards: { ...NFL_RECORD.player_props.rushing_yards, mean_signed_error: null },
      },
    };
    trackRecord.mockResolvedValue(flat);
    await renderPage();
    summaryByText("Yardage markets").click();
    const block = document.getElementById("tr-yardage")!;
    expect(block).toHaveTextContent("no lean");
    expect(block).toHaveTextContent("bias not measured");
  });
});

// --- 11. anytime-TD buckets, percent-forward --------------------------------

describe("anytime-TD buckets", () => {
  it("gives each band its actual rate as a percent with a bar and its count", async () => {
    await renderPage();
    const summary = Array.from(document.querySelectorAll("summary")).find((el) => el.textContent === "Points")!;
    summary.click();
    const table = screen.getByRole("table", { name: /anytime-TD rate by predicted-probability band/i });
    const rows = [...table.querySelectorAll<HTMLElement>("tbody tr")];
    expect(rows).toHaveLength(3);
    const top = rows.find((r) => r.textContent?.includes("70%+"))!;
    expect(top).toHaveTextContent("100%");
    expect(top).toHaveTextContent("(2)");
    expect(top.querySelector(".tr-bar-mini")).not.toBeNull();
    // A band with no calls says so instead of printing a rate.
    const empty = rows.find((r) => r.textContent?.includes("60-70%"))!;
    expect(empty).toHaveTextContent("no calls");
  });
});

// --- 12. split payload: picks load when the fold opens ----------------------

describe("split payload", () => {
  it("never calls the picks route when the summary inlines the rows", async () => {
    await renderPage();
    screen.getByText("Every recorded pick").click();
    expect(screen.getByRole("table", { name: /per-pick detail/i })).toBeInTheDocument();
    expect(trackRecordPicks).not.toHaveBeenCalled();
  });

  it("fetches the rows only when the fold opens, then fills the table and the latest strip", async () => {
    trackRecord.mockResolvedValue(NFL_RECORD_SPLIT);
    await renderPage();
    // The fold is offered, nothing has been fetched, and the latest strip is
    // empty until the rows exist — the summary alone cannot invent them.
    expect(trackRecordPicks).not.toHaveBeenCalled();
    expect(within(document.getElementById("tr-recent")!).queryAllByTestId("recent-pick")).toHaveLength(0);

    screen.getByText("Every recorded pick").click();
    const table = await screen.findByRole("table", { name: /per-pick detail/i });
    expect(trackRecordPicks).toHaveBeenCalledTimes(1);
    expect([...table.querySelectorAll("tbody tr")]).toHaveLength(3);
    // The same rows fill the latest-counted-picks strip (2 counted, pre-kickoff).
    expect(within(document.getElementById("tr-recent")!).getAllByTestId("recent-pick")).toHaveLength(2);
  });

  it("says so when the picks route fails, and does not retry on its own", async () => {
    trackRecord.mockResolvedValue(NFL_RECORD_SPLIT);
    trackRecordPicks.mockRejectedValue(new Error("gone"));
    await renderPage();
    screen.getByText("Every recorded pick").click();
    expect(await screen.findByText(/couldn't load the pick-by-pick detail/i)).toBeInTheDocument();
    expect(trackRecordPicks).toHaveBeenCalledTimes(1);
  });
});
