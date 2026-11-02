// Prop grading, NBA parity — the rules this file exists to hold:
//
//  - The delta chip follows the PLAYER: ▲ and "vs proj" in the win colour
//    when he beat the projection, ▼ in the loss colour when he fell short.
//  - A grade of null (no honest holdout MAE for the stat) renders the delta
//    chip ONLY — no grade chip is invented for it.
//  - A row that cannot prove pre-kickoff is graded and labelled, never
//    dropped; the day's headline counts ALL graded lines, with the
//    pre-kickoff count beside it.
//  - Absence is silent: a failed request, a payload with no days, or a
//    client without the method renders NOTHING — no box, no banner.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import PropGradingPanel from "./PropGradingPanel";
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
      games: [{ game_id: "401547", label: "BUF @ KC", rows: [row({}), ALLEN, KELCE] }],
    },
  ],
};

describe("PropGradingPanel", () => {
  beforeEach(() => {
    propGrading.mockReset();
    propGrading.mockResolvedValue(PAYLOAD);
    holder.api = { propGrading } as unknown as SportApi;
  });

  it("renders the day's sections from the contract shape", async () => {
    render(<PropGradingPanel />);
    expect(await screen.findByText("Prop grading")).toBeTruthy();
    expect(screen.getByText("Most confident")).toBeTruthy();
    expect(screen.getByText("Biggest surprises")).toBeTruthy();
    expect(screen.getByText(/Every graded line/)).toBeTruthy();
    expect(screen.getByText("BUF @ KC")).toBeTruthy();
    expect(screen.getByText("2026-11-01")).toBeTruthy();
  });

  it("leads the day with both counts side by side: all graded, then pre-kickoff", async () => {
    render(<PropGradingPanel />);
    const header = (await screen.findByText("2026-11-01")).closest("header")!;
    expect(header.textContent).toContain("3 player lines graded");
    expect(header.textContent).toContain("2 made before kickoff");
  });

  it("shows the delta chip direction as the player against the number", async () => {
    render(<PropGradingPanel />);
    expect((await screen.findAllByText("▲ +26.5 vs proj")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("▼ −91.5 vs proj").length).toBeGreaterThan(0);
    expect(screen.getAllByText("▼ −2.5 vs proj").length).toBeGreaterThan(0);
  });

  it("prints the projection line in the Proj X to Y actual form, with the stat and the grade", async () => {
    render(<PropGradingPanel />);
    expect((await screen.findAllByText(/Proj 274\.5 → 301 actual/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Passing yards/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Close").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Way off").length).toBeGreaterThan(0);
  });

  it("renders a grade-null row with the delta chip only — no grade chip", async () => {
    render(<PropGradingPanel />);
    const name = await screen.findByText("Travis Kelce");
    const li = name.closest("li")!;
    expect(within(li).getByText("▼ −2.5 vs proj")).toBeTruthy();
    expect(within(li).getByText(/Receptions/)).toBeTruthy();
    for (const grade of ["On the number", "Close", "Off", "Way off"]) {
      expect(within(li).queryByText(grade)).toBeNull();
    }
  });

  it("labels a row that cannot prove pre-kickoff instead of dropping it", async () => {
    render(<PropGradingPanel />);
    expect((await screen.findAllByText("Made after kickoff")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Josh Allen").length).toBeGreaterThan(0);
  });

  it("renders nothing when the endpoint fails (a backend without the route yet)", async () => {
    propGrading.mockRejectedValue(new Error("404 Not Found"));
    const { container } = render(<PropGradingPanel />);
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the payload carries no days", async () => {
    propGrading.mockResolvedValue({ ...PAYLOAD, days: [] });
    const { container } = render(<PropGradingPanel />);
    await waitFor(() => expect(propGrading).toHaveBeenCalledTimes(1));
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when the client has no propGrading method", async () => {
    holder.api = {} as SportApi;
    const { container } = render(<PropGradingPanel />);
    expect(container.innerHTML).toBe("");
  });
});
