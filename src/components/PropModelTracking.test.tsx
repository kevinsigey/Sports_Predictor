// Player prop model tracking — the rules this file exists to hold:
//
//  - The record page tracks the model in AGGREGATE: per stat, the counted
//    lines, the mean miss, the lean, and the grade bands. The per-line
//    grades themselves are in the fixtures, never here.
//  - The population is the counted lines only: a row made after kickoff is
//    excluded from every figure (it is labelled in its fixture instead).
//  - Percent-forward where a scale exists: the share of graded lines
//    within one holdout error leads the card, its bar under it, the count
//    beside it.
//  - A stat with no grades (no honest holdout error recorded — CFB today)
//    shows its count, MAE and bias and NO band bar: there is no scale to
//    grade it on, and a bar of nothing would be a fake measurement.
//  - Absence is silent: a failed request, a payload with no counted lines,
//    or a client without the method renders NOTHING.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import PropModelTracking from "./PropModelTracking";
import type { PropGrading, PropGradingRow, SportApi } from "../types";

const propGrading = vi.fn();
const holder: { api: SportApi } = { api: { propGrading } as unknown as SportApi };

vi.mock("../context/SportContext", () => ({
  useSport: () => ({ sport: "nfl", setSport: () => {}, api: holder.api }),
}));

const row = (over: Partial<PropGradingRow>): PropGradingRow => ({
  player: "Patrick Mahomes",
  team: "KC",
  opponent: "BUF",
  stat: "passing_yards",
  projected: 250,
  actual: 260,
  delta: 10,
  grade: "Close",
  made_before_kickoff: true,
  kickoff: "2026-11-01T18:00:00Z",
  ...over,
});

/** NFL shape: real holdout errors, grades on the yardage lines. */
const NFL_PAYLOAD: PropGrading = {
  generated_at: "2026-11-03T06:00:00Z",
  stats: {
    passing_yards: { holdout_mae: 38.2, naive_mae: 41.0 },
    rushing_yards: { holdout_mae: 15.0, naive_mae: 18.5 },
    receptions: { holdout_mae: null, naive_mae: null },
  },
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
            row({}), // passing +10 Close
            row({ player: "Josh Allen", team: "BUF", opponent: "KC", projected: 240, actual: 200, delta: -40, grade: "Off" }),
            row({ player: "Isiah Pacheco", stat: "rushing_yards", projected: 60, actual: 90, delta: 30, grade: "Way off" }),
            row({ player: "Late Line", projected: 100, actual: 300, delta: 200, grade: "On the number", made_before_kickoff: false }),
          ],
        },
      ],
    },
    {
      date: "2026-11-02",
      most_confident: [],
      biggest_surprises: [],
      games: [
        {
          game_id: "401548",
          label: "DAL @ PHI",
          rows: [
            row({ player: "Dak Prescott", team: "DAL", opponent: "PHI", projected: 270, actual: 250, delta: -20, grade: "On the number" }),
            row({ player: "CeeDee Lamb", team: "DAL", opponent: "PHI", stat: "receptions", projected: 7, actual: 5, delta: -2, grade: null }),
          ],
        },
      ],
    },
  ],
};

/** CFB shape: deltas only — no holdout errors, every grade null. */
const CFB_PAYLOAD: PropGrading = {
  generated_at: "2026-11-03T06:00:00Z",
  stats: { passing_yards: { holdout_mae: null, naive_mae: null } },
  days: [
    {
      date: "2026-11-01",
      most_confident: [],
      biggest_surprises: [],
      games: [
        {
          game_id: "401600",
          label: "ALA @ UGA",
          rows: [
            row({ player: "Ty Simpson", team: "ALA", opponent: "UGA", projected: 260, actual: 230, delta: -30, grade: null }),
            row({ player: "Gunner Stockton", team: "UGA", opponent: "ALA", projected: 240, actual: 255, delta: 15, grade: null }),
          ],
        },
      ],
    },
  ],
};

describe("PropModelTracking", () => {
  beforeEach(() => {
    propGrading.mockReset();
    propGrading.mockResolvedValue(NFL_PAYLOAD);
    holder.api = { propGrading } as unknown as SportApi;
  });

  it("renders the block with a card per graded stat", async () => {
    render(<PropModelTracking />);
    expect(await screen.findByText("Player prop model")).toBeTruthy();
    expect(screen.getByTestId("prop-stat-passing_yards")).toBeTruthy();
    expect(screen.getByTestId("prop-stat-rushing_yards")).toBeTruthy();
    expect(screen.getByTestId("prop-stat-receptions")).toBeTruthy();
  });

  it("counts only the pre-kickoff lines — the late line is in none of the figures", async () => {
    render(<PropModelTracking />);
    const passing = await screen.findByTestId("prop-stat-passing_yards");
    // 3 counted passing lines (the +200 late line would make 4, and would
    // drag the MAE to 67.5 and the within-holdout share to 75%).
    expect(passing.textContent).toContain("3 graded lines");
    expect(passing.textContent).toContain("MAE 23.3 yards");
    expect(passing.textContent).toContain("67%");
  });

  it("leads a graded stat with its within-holdout share, and shows the bands with counts", async () => {
    render(<PropModelTracking />);
    const passing = await screen.findByTestId("prop-stat-passing_yards");
    expect(within(passing).getByTestId("prop-bandbar-passing_yards")).toBeTruthy();
    expect(passing.textContent).toContain("On the number 33% (1)");
    expect(passing.textContent).toContain("Close 33% (1)");
    expect(passing.textContent).toContain("Off 33% (1)");
    expect(passing.textContent).toContain("Way off 0% (0)");
    expect(passing.textContent).toContain("holdout 38.2 yards");
  });

  it("words the bias as the model's lean: players beating the number means it runs low", async () => {
    render(<PropModelTracking />);
    const rushing = await screen.findByTestId("prop-stat-rushing_yards");
    // The one counted rushing line beat its projection by 30.
    expect(rushing.textContent).toContain("runs low by 30.0 yards");
    const passing = screen.getByTestId("prop-stat-passing_yards");
    expect(passing.textContent).toContain("runs high by 16.7 yards");
  });

  it("tracks a grade-null stat by count, MAE and bias — with no band bar and no holdout figure", async () => {
    render(<PropModelTracking />);
    const receptions = await screen.findByTestId("prop-stat-receptions");
    expect(receptions.textContent).toContain("1 graded line");
    expect(receptions.textContent).toContain("MAE 2.0");
    expect(within(receptions).queryByTestId("prop-bandbar-receptions")).toBeNull();
    expect(receptions.textContent).not.toContain("holdout");
    expect(receptions.textContent).not.toContain("within one holdout error");
  });

  it("shows the mean miss by day as a trend, oldest first, with the lines behind each day", async () => {
    render(<PropModelTracking />);
    const trend = await screen.findByTestId("prop-mae-trend");
    const cols = within(trend).getAllByTestId("prop-trend-day");
    expect(cols).toHaveLength(2);
    expect(cols[0].textContent).toContain("26.7");
    expect(cols[0].textContent).toContain("Nov 1");
    expect(cols[0].textContent).toContain("3 lines");
    expect(cols[1].textContent).toContain("11.0");
    expect(cols[1].textContent).toContain("Nov 2");
  });

  it("renders a grade-null sport (CFB) with no band bar anywhere and no within-holdout figure", async () => {
    propGrading.mockResolvedValue(CFB_PAYLOAD);
    render(<PropModelTracking />);
    const passing = await screen.findByTestId("prop-stat-passing_yards");
    expect(passing.textContent).toContain("2 graded lines");
    expect(passing.textContent).toContain("MAE 22.5 yards");
    expect(screen.queryByTestId("prop-bandbar-passing_yards")).toBeNull();
    expect(passing.textContent).not.toContain("within one holdout error");
  });

  it("renders nothing when the endpoint fails", async () => {
    propGrading.mockRejectedValue(new Error("404 Not Found"));
    const { container } = render(<PropModelTracking />);
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the payload carries no days", async () => {
    propGrading.mockResolvedValue({ ...NFL_PAYLOAD, days: [] });
    const { container } = render(<PropModelTracking />);
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when every graded line was made after kickoff", async () => {
    propGrading.mockResolvedValue({
      ...NFL_PAYLOAD,
      days: [
        {
          date: "2026-11-01",
          most_confident: [],
          biggest_surprises: [],
          games: [
            {
              game_id: "401547",
              label: "BUF @ KC",
              rows: [row({ made_before_kickoff: false })],
            },
          ],
        },
      ],
    });
    const { container } = render(<PropModelTracking />);
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the client has no propGrading method", async () => {
    holder.api = {} as SportApi;
    const { container } = render(<PropModelTracking />);
    expect(container.innerHTML).toBe("");
  });
});
