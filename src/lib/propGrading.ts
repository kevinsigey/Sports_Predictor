// Prop grading arithmetic, shared by the two surfaces that read the
// `/prop-grading` payload.
//
// The payload's per-line rows live in exactly one place: each day's `games`
// list. `most_confident` and `biggest_surprises` are SUBSETS of those same
// rows (the day's own highlights), never extra rows — so every aggregate
// below reads `games[].rows` and only `games[].rows`, or the highlights
// would be counted twice.
//
// The population rule is the track record's: a graded line counts when it
// was made before kickoff. The backend's rows are already the counted
// (earliest recorded) projection per player and stat; the aggregates here
// apply the pre-kickoff half of "counted" on top, and the fixture view is
// the one place late lines still show — labelled, in their game's context.
//
// Sign conventions, stated once because two different deltas meet here:
//  - a row's `delta` is actual − projected and follows the PLAYER
//    (positive: he beat the projection);
//  - an aggregate's `bias` is mean(projected − actual), the model's signed
//    error, so it reads with the yardage tiles' vocabulary: positive means
//    the projections run high. `bias` is `-mean(delta)` by construction.

import type { PropGrade, PropGrading, PropGradingGame, PropGradingRow } from "../types";

export const GRADE_ORDER: PropGrade[] = ["On the number", "Close", "Off", "Way off"];

const STAT_LABELS: Record<string, string> = {
  passing_yards: "Passing yards",
  rushing_yards: "Rushing yards",
  receiving_yards: "Receiving yards",
  receptions: "Receptions",
  carries: "Carries",
  anytime_td: "Anytime TD",
};

/** The order stats are listed in, everywhere they are listed. */
export const STAT_ORDER = [
  "passing_yards",
  "rushing_yards",
  "receiving_yards",
  "receptions",
  "carries",
  "anytime_td",
];

export function statLabel(stat: string): string {
  return STAT_LABELS[stat] ?? stat;
}

/** The unit a stat's errors are measured in, for MAE and bias lines. */
export function statUnit(stat: string): string {
  return stat.endsWith("_yards") ? "yards" : "";
}

function statRank(stat: string): number {
  const i = STAT_ORDER.indexOf(stat);
  return i === -1 ? STAT_ORDER.length : i;
}

/** Every graded row, with the day it belongs to — games rows only (see the
 *  header: the day's highlight lists are subsets of these, not additions). */
export function gradedGameRows(grading: PropGrading): { date: string; row: PropGradingRow }[] {
  const out: { date: string; row: PropGradingRow }[] = [];
  for (const day of grading.days) {
    for (const game of day.games) {
      for (const row of game.rows) out.push({ date: day.date, row });
    }
  }
  return out;
}

/** The counted population: graded rows made before kickoff. */
export function countedRows(grading: PropGrading): { date: string; row: PropGradingRow }[] {
  return gradedGameRows(grading).filter(({ row }) => row.made_before_kickoff);
}

export interface PropBandShare {
  grade: PropGrade;
  n: number;
  /** Share of the stat's GRADED rows (rows carrying a grade), 0..1. */
  pct: number;
}

export interface PropStatAggregate {
  stat: string;
  /** Counted (pre-kickoff) graded lines for this stat. */
  n: number;
  /** Mean |delta| over the counted rows. */
  mae: number;
  /** Mean signed error, projected − actual: positive runs high. */
  bias: number;
  /** The backend's own holdout MAE for the stat, when it records one. */
  holdoutMae: number | null;
  naiveMae: number | null;
  /** Band distribution over the rows that carry a grade, in GRADE_ORDER.
   *  `null` when no row of this stat carries a grade (today: CFB, whose
   *  backend records no holdout error to grade against) — the block then
   *  shows n / MAE / bias and no band bar, rather than a bar of nothing. */
  bands: PropBandShare[] | null;
  /** Share of graded rows within one holdout error (On the number or
   *  Close), 0..1; `null` exactly when `bands` is. */
  withinHoldout: number | null;
}

export function aggregatePropsByStat(grading: PropGrading): PropStatAggregate[] {
  const byStat = new Map<string, PropGradingRow[]>();
  for (const { row } of countedRows(grading)) {
    const list = byStat.get(row.stat) ?? [];
    list.push(row);
    byStat.set(row.stat, list);
  }
  const aggregates: PropStatAggregate[] = [];
  for (const [stat, rows] of byStat) {
    const n = rows.length;
    const mae = rows.reduce((sum, r) => sum + Math.abs(r.delta), 0) / n;
    const bias = rows.reduce((sum, r) => sum + (r.projected - r.actual), 0) / n;
    const graded = rows.filter((r) => r.grade !== null);
    let bands: PropBandShare[] | null = null;
    let withinHoldout: number | null = null;
    if (graded.length > 0) {
      bands = GRADE_ORDER.map((grade) => {
        const count = graded.filter((r) => r.grade === grade).length;
        return { grade, n: count, pct: count / graded.length };
      });
      const within = graded.filter((r) => r.grade === "On the number" || r.grade === "Close").length;
      withinHoldout = within / graded.length;
    }
    aggregates.push({
      stat,
      n,
      mae,
      bias,
      holdoutMae: grading.stats[stat]?.holdout_mae ?? null,
      naiveMae: grading.stats[stat]?.naive_mae ?? null,
      bands,
      withinHoldout,
    });
  }
  return aggregates.sort((a, b) => statRank(a.stat) - statRank(b.stat));
}

export interface PropDayMae {
  date: string;
  /** Counted graded lines that day, all stats combined. */
  n: number;
  mae: number;
}

/** MAE per day, oldest first — the trend reads in time order. Days whose
 *  graded lines were all made after kickoff hold no counted rows and are
 *  absent, rather than plotted as a zero. */
export function dailyPropMae(grading: PropGrading): PropDayMae[] {
  const byDate = new Map<string, PropGradingRow[]>();
  for (const { date, row } of countedRows(grading)) {
    const list = byDate.get(date) ?? [];
    list.push(row);
    byDate.set(date, list);
  }
  return [...byDate.entries()]
    .map(([date, rows]) => ({
      date,
      n: rows.length,
      mae: rows.reduce((sum, r) => sum + Math.abs(r.delta), 0) / rows.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** One game's graded rows, found by the fixture's own id. The payload is
 *  grouped by day, so the search crosses days; a game the payload does not
 *  carry (unplayed, unreconciled, another sport's slate) finds nothing. */
export function findGradedGame(
  grading: PropGrading,
  gameId: string,
): { date: string; game: PropGradingGame } | null {
  for (const day of grading.days) {
    const game = day.games.find((g) => g.game_id === gameId);
    if (game) return { date: day.date, game };
  }
  return null;
}

/** A game's own biggest surprises: its rows by miss size, largest first,
 *  both directions — a beat and a shortfall are both surprises. */
export function gameSurprises(rows: PropGradingRow[], limit = 3): PropGradingRow[] {
  return [...rows].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}

/** Rows grouped by player, for the fixture view: players in the order the
 *  payload first names them, each player's lines in STAT_ORDER. */
export function groupRowsByPlayer(rows: PropGradingRow[]): { player: string; rows: PropGradingRow[] }[] {
  const order: string[] = [];
  const byPlayer = new Map<string, PropGradingRow[]>();
  for (const row of rows) {
    if (!byPlayer.has(row.player)) {
      byPlayer.set(row.player, []);
      order.push(row.player);
    }
    byPlayer.get(row.player)!.push(row);
  }
  return order.map((player) => ({
    player,
    rows: [...byPlayer.get(player)!].sort((a, b) => statRank(a.stat) - statRank(b.stat)),
  }));
}

/**
 * Which way a stat's misses lean, in the yardage tiles' words.
 *
 * `bias` is mean(projected − actual) (see the header), so the words are the
 * tiles' words with the tiles' ±0.05 deadband: above it the projections
 * "run high", below it they "run low", inside it there is no lean worth
 * naming. One decimal, like the tiles.
 */
export function propBiasText(bias: number, unit: string): string {
  const u = unit ? ` ${unit}` : "";
  if (bias > 0.05) return `runs high by ${bias.toFixed(1)}${u}`;
  if (bias < -0.05) return `runs low by ${Math.abs(bias).toFixed(1)}${u}`;
  return "no lean";
}
