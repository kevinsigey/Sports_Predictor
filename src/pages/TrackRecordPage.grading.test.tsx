// The track record page and prop grading, after the move — the rules this
// file exists to hold:
//
//  - The page shows the graded lines' AGGREGATES (the "Player prop model"
//    block) and NO per-line grading: no player rows, no Most confident, no
//    Biggest surprises, no per-day line lists. A graded line means
//    something next to its match, so the lines live in the fixture detail;
//    scrolled past on this page, without the game around them, they were
//    useless (Kevin's call, 2026-11-02).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TrackRecordPage } from "./TrackRecordPage";
import type { PropGrading, SportApi, TrackRecord } from "../types";

const RECORD: TrackRecord = {
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
    ],
    weekly: [
      { week: 1, tracked: true, n_games: 4, n_moneyline: 3, pct_moneyline_correct: 0.667, n_ats: 2, pct_ats_correct: 1.0, n_totals: 1, pct_totals_correct: 0.0 },
    ],
  },
  player_props: {
    anytime_td: { n_resolved: 4, n_called: 3, hit_rate_when_called: 0.667, brier_score: 0.18, confidence_buckets: [] },
    passing_yards: { n_resolved: 2, mean_absolute_error: 39.5, mean_signed_error: -20.5 },
    rushing_yards: { n_resolved: 2, mean_absolute_error: 18.0, mean_signed_error: -3.0 },
    receiving_yards: { n_resolved: 1, mean_absolute_error: 13.0, mean_signed_error: 2.0 },
    receptions: { n_resolved: 0, mean_absolute_error: null, mean_signed_error: null },
    carries: { n_resolved: 1, mean_absolute_error: 3.0, mean_signed_error: -3.0 },
  },
};

const GRADING: PropGrading = {
  generated_at: "2026-11-03T06:00:00Z",
  stats: { passing_yards: { holdout_mae: 38.2, naive_mae: 41.0 } },
  days: [
    {
      date: "2026-11-01",
      most_confident: [],
      biggest_surprises: [],
      games: [
        {
          game_id: "401547",
          label: "BUF @ KC",
          rows: [
            {
              player: "Patrick Mahomes",
              team: "KC",
              opponent: "BUF",
              stat: "passing_yards",
              projected: 274.5,
              actual: 301,
              delta: 26.5,
              grade: "Close",
              made_before_kickoff: true,
              kickoff: "2026-11-01T18:00:00Z",
            },
          ],
        },
      ],
    },
  ],
};

const trackRecord = vi.fn(async (): Promise<TrackRecord> => RECORD);
const propGrading = vi.fn(async (): Promise<PropGrading> => GRADING);
const api = {
  trackRecord,
  propGrading,
  trackRecordPicks: vi.fn(async () => ({ per_pick: RECORD.games.per_pick ?? [] })),
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
  trackRecord.mockResolvedValue(RECORD);
  propGrading.mockReset();
  propGrading.mockResolvedValue(GRADING);
});

describe("TrackRecordPage's prop grading, after the move", () => {
  it("shows the aggregates block, computed from the graded lines", async () => {
    render(<TrackRecordPage />);
    // A generous find timeout: the page is the heaviest render in the
    // suite, and on a loaded machine its two fetches land late — the block
    // either appears or it does not, and ten seconds cannot fake it.
    expect(await screen.findByText("Player prop model", {}, { timeout: 10_000 })).toBeTruthy();
    const card = screen.getByTestId("prop-stat-passing_yards");
    expect(card.textContent).toContain("1 graded line");
    expect(card.textContent).toContain("MAE 26.5 yards");
  });

  it("renders NO per-line grading anywhere on the page", async () => {
    render(<TrackRecordPage />);
    await screen.findByText("Player prop model", {}, { timeout: 10_000 });
    // No graded player is named on this page.
    expect(screen.queryByText(/Patrick Mahomes/)).toBeNull();
    expect(screen.queryByText(/▲ \+26\.5 vs proj/)).toBeNull();
    // None of the old panel's furniture survives.
    expect(screen.queryByText("Prop grading")).toBeNull();
    expect(screen.queryByText("Most confident")).toBeNull();
    expect(screen.queryByText("Biggest surprises")).toBeNull();
    expect(screen.queryByText(/Every graded line/)).toBeNull();
    expect(screen.queryByTestId("game-prop-grading")).toBeNull();
  });
});
