// The prop grading aggregates — the rules this file exists to hold:
//
//  - Only the games rows count. A day's Most confident and Biggest
//    surprises lists are subsets of the same rows; reading them too would
//    count the highlights twice.
//  - Only pre-kickoff rows count. A late line is labelled in its fixture
//    and excluded here — the aggregates are the record, and the record is
//    the counted (earliest, pre-kickoff) lines.
//  - The aggregate bias is the MODEL's signed error (projected − actual),
//    so its words are the yardage tiles' words: players beating their
//    projections (positive deltas) mean the model runs LOW.
//  - A stat with no graded rows gets no bands and no within-holdout share:
//    null, never a bar of zeros dressed as a measurement.

import { describe, expect, it } from "vitest";
import {
  aggregatePropsByStat,
  countedRows,
  dailyPropMae,
  findGradedGame,
  gameSurprises,
  gradedGameRows,
  groupRowsByPlayer,
  propBiasText,
} from "./propGrading";
import type { PropGrading, PropGradingRow } from "../types";

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

// Two graded days. Day 1's game rows are the population; its highlight
// lists repeat two of them. Day 2 carries a late line and a grade-null
// stat (the CFB shape: deltas, no bands).
const PAYLOAD: PropGrading = {
  generated_at: "2026-11-03T06:00:00Z",
  stats: {
    passing_yards: { holdout_mae: 38.2, naive_mae: 41.0 },
    rushing_yards: { holdout_mae: 15.0, naive_mae: 18.5 },
    receptions: { holdout_mae: null, naive_mae: null },
  },
  days: [
    {
      date: "2026-11-01",
      most_confident: [row({})],
      biggest_surprises: [row({ player: "Josh Allen", team: "BUF", opponent: "KC", delta: -40, grade: "Off" })],
      games: [
        {
          game_id: "401547",
          label: "BUF @ KC",
          rows: [
            row({}), // passing, delta +10, Close
            row({ player: "Josh Allen", team: "BUF", opponent: "KC", projected: 240, actual: 200, delta: -40, grade: "Off" }),
            row({ player: "Isiah Pacheco", stat: "rushing_yards", projected: 60, actual: 90, delta: 30, grade: "Way off" }),
            // Made after kickoff: in the fixture, labelled — never in the aggregates.
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

describe("countedRows", () => {
  it("reads the games rows only — the day's highlight lists are not counted twice", () => {
    expect(gradedGameRows(PAYLOAD)).toHaveLength(6);
    expect(countedRows(PAYLOAD)).toHaveLength(5);
  });

  it("excludes rows made after kickoff, however large their delta", () => {
    const players = countedRows(PAYLOAD).map(({ row: r }) => r.player);
    expect(players).not.toContain("Late Line");
  });
});

describe("aggregatePropsByStat", () => {
  const aggregates = aggregatePropsByStat(PAYLOAD);
  const byStat = new Map(aggregates.map((a) => [a.stat, a]));

  it("lists the stats in the fixed order, with the counted lines behind each", () => {
    expect(aggregates.map((a) => a.stat)).toEqual(["passing_yards", "rushing_yards", "receptions"]);
    expect(byStat.get("passing_yards")!.n).toBe(3);
    expect(byStat.get("rushing_yards")!.n).toBe(1);
    expect(byStat.get("receptions")!.n).toBe(1);
  });

  it("computes MAE as the mean absolute delta over the counted rows", () => {
    // passing deltas: +10, −40, −20 → (10 + 40 + 20) / 3
    expect(byStat.get("passing_yards")!.mae).toBeCloseTo(70 / 3);
    expect(byStat.get("rushing_yards")!.mae).toBeCloseTo(30);
  });

  it("computes the bias as the model's signed error: players beating the number means the model runs low", () => {
    // passing projected − actual: −10, +40, +20 → mean +50/3 (runs high).
    expect(byStat.get("passing_yards")!.bias).toBeCloseTo(50 / 3);
    // rushing: the one counted row has delta +30 (actual above projection),
    // so the model's error is −30 — it runs low.
    expect(byStat.get("rushing_yards")!.bias).toBeCloseTo(-30);
    expect(propBiasText(byStat.get("rushing_yards")!.bias, "yards")).toBe("runs low by 30.0 yards");
    expect(propBiasText(byStat.get("passing_yards")!.bias, "yards")).toBe("runs high by 16.7 yards");
  });

  it("distributes the grades into bands whose percentages are of the graded rows", () => {
    const passing = byStat.get("passing_yards")!;
    expect(passing.bands!.map((b) => b.grade)).toEqual(["On the number", "Close", "Off", "Way off"]);
    expect(passing.bands!.map((b) => b.n)).toEqual([1, 1, 1, 0]);
    expect(passing.bands![0].pct).toBeCloseTo(1 / 3);
    expect(passing.bands!.reduce((s, b) => s + b.pct, 0)).toBeCloseTo(1);
    // Within one holdout error: On the number + Close = 2 of 3.
    expect(passing.withinHoldout).toBeCloseTo(2 / 3);
  });

  it("carries the backend's holdout and naive errors beside the measured ones", () => {
    expect(byStat.get("passing_yards")!.holdoutMae).toBe(38.2);
    expect(byStat.get("passing_yards")!.naiveMae).toBe(41.0);
  });

  it("gives a grade-null stat its n, MAE and bias — and no bands, no share", () => {
    const receptions = byStat.get("receptions")!;
    expect(receptions.n).toBe(1);
    expect(receptions.mae).toBeCloseTo(2);
    expect(receptions.bias).toBeCloseTo(2);
    expect(receptions.bands).toBeNull();
    expect(receptions.withinHoldout).toBeNull();
    expect(receptions.holdoutMae).toBeNull();
  });
});

describe("dailyPropMae", () => {
  it("gives each day's MAE over its counted rows, oldest first", () => {
    const days = dailyPropMae(PAYLOAD);
    expect(days.map((d) => d.date)).toEqual(["2026-11-01", "2026-11-02"]);
    // Day 1 counted deltas: +10, −40, +30 (the +200 late line is out).
    expect(days[0].n).toBe(3);
    expect(days[0].mae).toBeCloseTo(80 / 3);
    // Day 2: −20, −2.
    expect(days[1].n).toBe(2);
    expect(days[1].mae).toBeCloseTo(11);
  });
});

describe("findGradedGame", () => {
  it("finds a game by its fixture id, across days", () => {
    const found = findGradedGame(PAYLOAD, "401548");
    expect(found?.date).toBe("2026-11-02");
    expect(found?.game.label).toBe("DAL @ PHI");
  });

  it("finds nothing for a game the payload does not carry", () => {
    expect(findGradedGame(PAYLOAD, "999999")).toBeNull();
  });
});

describe("gameSurprises and groupRowsByPlayer", () => {
  const game = PAYLOAD.days[0].games[0];

  it("ranks a game's rows by miss size, both directions", () => {
    const surprises = gameSurprises(game.rows, 2);
    expect(surprises.map((r) => r.player)).toEqual(["Late Line", "Josh Allen"]);
  });

  it("groups rows by player in payload order, stats in the fixed order within a player", () => {
    const rows = [
      row({ player: "A", stat: "receptions" }),
      row({ player: "B", stat: "passing_yards" }),
      row({ player: "A", stat: "passing_yards" }),
    ];
    const groups = groupRowsByPlayer(rows);
    expect(groups.map((g) => g.player)).toEqual(["A", "B"]);
    expect(groups[0].rows.map((r) => r.stat)).toEqual(["passing_yards", "receptions"]);
  });
});

describe("propBiasText", () => {
  it("uses the yardage tiles' deadband: inside ±0.05 there is no lean", () => {
    expect(propBiasText(0.04, "yards")).toBe("no lean");
    expect(propBiasText(-0.04, "yards")).toBe("no lean");
    expect(propBiasText(0, "")).toBe("no lean");
  });

  it("prints one decimal and the unit when the stat has one", () => {
    expect(propBiasText(6.26, "yards")).toBe("runs high by 6.3 yards");
    expect(propBiasText(-1.24, "")).toBe("runs low by 1.2");
  });
});
