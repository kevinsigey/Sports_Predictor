// Prop grading in the fixture detail — the rules this file exists to hold:
//
//  - The per-line grades render HERE, matched to the fixture by its own
//    game_id, with the match around them — never on the track record page.
//  - The delta chip follows the PLAYER: ▲ and "vs proj" in the win colour
//    when he beat the projection, ▼ in the loss colour when he fell short.
//  - A grade of null (no honest holdout MAE for the stat) renders the delta
//    chip ONLY — no grade chip is invented for it.
//  - A row that cannot prove pre-kickoff is graded and labelled, never
//    dropped.
//  - The game's own biggest surprises surface before the full list.
//  - Absence is silent: no payload, a payload without this game, or a game
//    with no graded lines renders NOTHING — no box, no banner.

import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import GamePropGrading from "./GamePropGrading";
import type { PropGrading, PropGradingRow } from "../types";

const row = (over: Partial<PropGradingRow>): PropGradingRow => ({
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
  ...over,
});

const ALLEN = row({
  player: "Josh Allen",
  team: "BUF",
  opponent: "KC",
  projected: 288.5,
  actual: 197,
  delta: -91.5,
  grade: "Way off",
  made_before_kickoff: false,
});

const KELCE = row({
  player: "Travis Kelce",
  stat: "receptions",
  projected: 6.5,
  actual: 4,
  delta: -2.5,
  grade: null,
});

const PACHECO = row({
  player: "Isiah Pacheco",
  stat: "rushing_yards",
  projected: 60,
  actual: 90,
  delta: 30,
  grade: "Off",
});

const PAYLOAD: PropGrading = {
  generated_at: "2026-11-02T06:00:00Z",
  stats: {
    passing_yards: { holdout_mae: 38.2, naive_mae: 41.0 },
    receptions: { holdout_mae: null, naive_mae: null },
  },
  days: [
    {
      date: "2026-11-01",
      most_confident: [row({})],
      biggest_surprises: [ALLEN],
      games: [
        { game_id: "401547", label: "BUF @ KC", rows: [row({}), ALLEN, KELCE, PACHECO] },
        { game_id: "401548", label: "DAL @ PHI", rows: [row({ player: "Dak Prescott", team: "DAL", opponent: "PHI" })] },
      ],
    },
  ],
};

describe("GamePropGrading", () => {
  it("renders the matched game's rows, and only that game's", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    expect(screen.getByTestId("game-prop-grading")).toBeTruthy();
    expect(screen.getAllByText("Patrick Mahomes").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Josh Allen").length).toBeGreaterThan(0);
    expect(screen.queryByText("Dak Prescott")).toBeNull();
  });

  it("shows the delta chip direction as the player against the number", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    expect(screen.getAllByText("▲ +26.5 vs proj").length).toBeGreaterThan(0);
    expect(screen.getAllByText("▼ −91.5 vs proj").length).toBeGreaterThan(0);
  });

  it("prints the projection line in the Proj X to Y actual form, with the stat and the grade", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    expect(screen.getAllByText(/Proj 274\.5 → 301 actual/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Passing yards/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Close").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Way off").length).toBeGreaterThan(0);
  });

  it("renders a grade-null row with the delta chip only — no grade chip", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    // The name appears in the group heading as well as the row; the row is
    // the one inside an <li>.
    const li = screen.getAllByText("Travis Kelce").find((el) => el.closest("li"))!.closest("li")!;
    expect(within(li).getByText("▼ −2.5 vs proj")).toBeTruthy();
    for (const grade of ["On the number", "Close", "Off", "Way off"]) {
      expect(within(li).queryByText(grade)).toBeNull();
    }
  });

  it("labels a row that cannot prove pre-kickoff instead of dropping it", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    const allen = screen.getAllByText("Josh Allen")[0].closest("li")!;
    expect(within(allen).getByText("Made after kickoff")).toBeTruthy();
  });

  it("surfaces the game's own biggest surprises before the full list", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    const section = screen.getByTestId("game-prop-grading");
    const headings = [...section.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings[0]).toBe("Biggest surprises");
    // The surprises lead with the largest miss in the game (Allen, |−91.5|).
    const surprisesList = section.querySelectorAll("ul")[0];
    expect(within(surprisesList as HTMLElement).getByText("Josh Allen")).toBeTruthy();
  });

  it("groups the full list by player", () => {
    render(<GamePropGrading grading={PAYLOAD} gameId="401547" />);
    const section = screen.getByTestId("game-prop-grading");
    const headings = [...section.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toContain("Patrick Mahomes");
    expect(headings).toContain("Travis Kelce");
  });

  it("renders nothing without a payload", () => {
    const { container } = render(<GamePropGrading grading={null} gameId="401547" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a game the payload does not carry", () => {
    const { container } = render(<GamePropGrading grading={PAYLOAD} gameId="999999" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a game with no graded lines", () => {
    const empty: PropGrading = {
      ...PAYLOAD,
      days: [{ ...PAYLOAD.days[0], games: [{ game_id: "401547", label: "BUF @ KC", rows: [] }] }],
    };
    const { container } = render(<GamePropGrading grading={empty} gameId="401547" />);
    expect(container.innerHTML).toBe("");
  });
});
