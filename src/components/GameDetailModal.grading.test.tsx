// Prop grading in the fixture detail, at the modal level — the rules this
// file exists to hold:
//
//  - A completed fixture whose game the `/prop-grading` payload carries
//    gets the graded-lines section, matched by the fixture's own game_id.
//  - A completed fixture the payload does NOT carry gets no section —
//    no placeholder, no error — and neither does a payload that fails.
//  - An unplayed fixture never even asks: grading exists only for finals.
//  - A client without the propGrading method (a stub, an older build)
//    leaves the modal exactly as it was.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GameDetailModal } from "./GameDetailModal";
import type { GamePrediction, GameSummary, PropGrading, SportApi } from "../types";

vi.mock("../context/SportContext", () => ({
  useSport: () => ({ sport: "nfl", setSport: () => {}, api: {} }),
}));

const FINAL: GameSummary = {
  game_id: "401547",
  season: 2026,
  week: 9,
  gameday: "2026-11-01T18:00:00Z",
  home_team: "Chiefs",
  away_team: "Bills",
  home_score: 28,
  away_score: 24,
};

const UNPLAYED: GameSummary = { ...FINAL, home_score: null, away_score: null };

const PAYLOAD: PropGrading = {
  generated_at: "2026-11-02T06:00:00Z",
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

function mockApi(overrides: Partial<SportApi> = {}): SportApi {
  return {
    games: vi.fn(),
    gamePrediction: vi.fn().mockResolvedValue({ home_win_prob: 0.6, away_win_prob: 0.4, home_cover_prob: null, away_cover_prob: null, over_prob: null, under_prob: null } satisfies GamePrediction),
    playerProps: vi.fn().mockResolvedValue([]),
    playerOut: vi.fn().mockResolvedValue([]),
    trackRecord: vi.fn(),
    retrain: vi.fn(),
    gameVerdict: vi.fn().mockResolvedValue(null),
    predictionsForWeek: vi.fn(),
    currentWeek: vi.fn(),
    hubTeams: vi.fn(),
    hubPlayers: vi.fn(),
    standings: vi.fn(),
    powerRankings: vi.fn(),
    predictionsBatch: vi.fn(),
    teamForm: vi.fn().mockResolvedValue({ team: "", recent_form: [] }),
    headToHead: vi.fn().mockResolvedValue({ game_id: "", meetings: [] }),
    ...overrides,
  };
}

describe("GameDetailModal's prop grading section", () => {
  it("renders the graded lines for a completed fixture the payload carries", async () => {
    const propGrading = vi.fn().mockResolvedValue(PAYLOAD);
    render(<GameDetailModal game={FINAL} api={mockApi({ propGrading })} onClose={() => {}} />);
    const section = await screen.findByTestId("game-prop-grading");
    expect(section.textContent).toContain("Patrick Mahomes");
    expect(section.textContent).toContain("▲ +26.5 vs proj");
    expect(propGrading).toHaveBeenCalledTimes(1);
  });

  it("renders no section when the payload does not carry this game", async () => {
    const propGrading = vi.fn().mockResolvedValue({ ...PAYLOAD, days: [] });
    render(<GameDetailModal game={FINAL} api={mockApi({ propGrading })} onClose={() => {}} />);
    await screen.findByText("Game Detail & Model Projections");
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("game-prop-grading")).toBeNull();
  });

  it("renders no section — and no error — when the grading request fails", async () => {
    const propGrading = vi.fn().mockRejectedValue(new Error("404 Not Found"));
    render(<GameDetailModal game={FINAL} api={mockApi({ propGrading })} onClose={() => {}} />);
    await screen.findByText("Game Detail & Model Projections");
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("game-prop-grading")).toBeNull();
  });

  it("never asks for grading on an unplayed fixture", async () => {
    const propGrading = vi.fn().mockResolvedValue(PAYLOAD);
    render(<GameDetailModal game={UNPLAYED} api={mockApi({ propGrading })} onClose={() => {}} />);
    await screen.findByText("Game Detail & Model Projections");
    expect(propGrading).not.toHaveBeenCalled();
    expect(screen.queryByTestId("game-prop-grading")).toBeNull();
  });

  it("opens as before when the client has no propGrading method", async () => {
    render(<GameDetailModal game={FINAL} api={mockApi()} onClose={() => {}} />);
    await screen.findByText("Game Detail & Model Projections");
    expect(screen.queryByTestId("game-prop-grading")).toBeNull();
  });
});
