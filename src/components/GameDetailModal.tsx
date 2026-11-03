// `Explanation` comes from `../predictor-ui`, and only from there. `../api/client`
// used to re-export it as a second door onto the same type and no longer does --
// its own header says so, and it now carries a deliberate comment explaining
// that the modal and the explain call sites import the type from the panel that
// declares it. So ours' import line is not a preference, it is a door that is no
// longer there; theirs' is the only one that resolves.
import { BoxScore, FixtureExplainer, PicksList, SignalRows, spread, TeamToggle, WeatherChip } from "../predictor-ui";
import type { Signal } from "../predictor-ui";
// `FlowState` comes from the package too, for the same reason: the flow's states
// are the package's vocabulary, and this file picks between them rather than
// inventing a parallel set of names for the same three values.
import type { Explanation, FlowState, MatchupContext } from "../predictor-ui";
// The v2 panel's figures, derived rather than fetched, from the SHARED adapter:
// the panel renders no figure of its own, so this mapping is where the
// explanation meets this site's prediction response. The pick translation the
// bar depends on lives in the shared component now, applied against the same
// segments it draws.
import { panelFacts } from "../predictor-ui/lib/panelFacts";
import { useEffect, useMemo, useState } from "react";
import type { GamePrediction, GameSummary, GameVerdict, HeadToHead as HeadToHeadData, OutPlayerEntry, PlayerPropPrediction, PlayerPropsTrackRecord, PropGrading, SportApi, TeamForm, WeekPrediction } from "../types";
// The ranking itself: which rows, under which heading, and what each row says
// about itself. `PicksList` renders; this decides the words.
import { buildPicksPanel, eligiblePlayers, NO_GRADED_RECORD } from "../lib/picksPanel";
import { LineChecker } from "./LineChecker";
import GamePropGrading from "./GamePropGrading";
import type { MarketLine } from "../lib/lineCheck";
import { TeamName } from "./TeamName";
import { MarketBar } from "./MarketBar";
import { FormStrip } from "./FormStrip";
import { HeadToHead } from "./HeadToHead";
import { boxScoreColumnsFor, buildBoxScoreGroups } from "../lib/boxScoreRows";
// `hasStarted` is the LIST CARD's own rule (`weekCards.ts:76`), imported rather
// than re-derived, and `weekTally` is the same function the week navigator uses
// for the record line. Two functions, one definition each: the card and the
// modal cannot decide "started" or "the record" differently, because that
// divergence IS the 68/72 bug.
import { hasStarted, weekTally } from "../lib/weekCards";

export const MARKET_LABEL = {
  passing_yards: "Pass yds",
  rushing_yards: "Rush yds",
  receiving_yards: "Rec yds",
} as const;

export interface YardageMarketBreakdown {
  market: keyof typeof MARKET_LABEL;
  yards: number;
  n: number;
}

/** Yardage projected for one roster, grouped by the market it was projected in.
 *
 * Kept per market and never summed. `POSITION_MARKETS` (NFL/CFB
 * `models/player_props.py`) is a dict of *lists* -- its own comment says "each
 * position can have multiple markets", RB gets both rushing_yards and carries --
 * so the earlier claim that the model projects exactly one market per position was
 * wrong, and it was wrong in a customer-visible sentence as well as in a comment.
 *
 * The arithmetic still holds, for a different and verified reason: summing the
 * roster's yardage fields adds a QB's passing to an RB's rushing and a WR's
 * receiving, and the total is not any real quantity. On a full roster it ran
 * 800-1400 yards against a real figure of roughly 300-450.
 *
 * What is *not* safe is to rely on each player having at most one yardage field. If
 * `POSITION_MARKETS` ever gives a position two yardage markets, the parts still do not
 * sum to the old single-field total, and the correct rendering is one row per market
 * with the player counted in both -- which is what this does, and which
 * `test_binds_each_market_label_to_its_own_value` and its sibling now pin.
 * Team total yards is `rushing + receiving` across every player, which needs a
 * team-level model that does not exist yet -- so this reports what is actually
 * projected and says so, rather than publishing a number nobody can reproduce.
 */
export function yardageBreakdown(props: PlayerPropPrediction[]): YardageMarketBreakdown[] {
  const totals = new Map<string, { yards: number; n: number }>();
  for (const prop of props) {
    for (const market of Object.keys(MARKET_LABEL) as (keyof typeof MARKET_LABEL)[]) {
      const value = prop[market];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const entry = totals.get(market) ?? { yards: 0, n: 0 };
      entry.yards += value;
      entry.n += 1;
      totals.set(market, entry);
    }
  }
  return (Object.keys(MARKET_LABEL) as (keyof typeof MARKET_LABEL)[])
    .filter(market => totals.has(market))
    .map(market => ({ market, yards: totals.get(market)!.yards, n: totals.get(market)!.n }));
}

export function filterPlayerPropsForGame(
  props: PlayerPropPrediction[],
  game: Pick<GameSummary, "home_team" | "away_team">,
): PlayerPropPrediction[] {
  return props.filter((prop) => prop.recent_team === game.home_team || prop.recent_team === game.away_team);
}

function VerdictBadge({ label, hit }: { label: string; hit: boolean }) {
  return (
    <span className="flex items-center gap-1.5 rounded-lg bg-sp-850/60 px-2.5 py-1 text-sm">
      <span className="text-sp-text-dim">{label}</span>
      <span className={`rounded px-1.5 py-0.5 text-[12px] font-bold ${hit ? "bg-win/20 text-win" : "bg-loss/20 text-loss"}`}>
        {hit ? "HIT" : "MISS"}
      </span>
    </span>
  );
}

// weekPrediction: the week's row for this game — the stored pick, and whether
// it was recorded at or after this game's own kickoff (`rebuilt`). A final is
// judged on that stored pick, never on today's model, and a pick made after
// kickoff is disclosed and counted rather than withheld.
// explain: fetches the plain-English summary. Optional on purpose — a site
// deployed before the explainer exists, or a game it has no summary for, must
// still open this modal and show everything else in it.
// weekPredictions: every row of the week, for the record strip. The list page
// has already fetched them (`GamesPage.tsx:86`); the modal is handed the same
// array rather than asking again, so opening a game costs no second week fetch.
interface Props { game: GameSummary; api: SportApi; weekPrediction?: WeekPrediction; weekPredictions?: WeekPrediction[]; onClose: () => void; explain?: (sport: string, id: string) => Promise<Explanation>; loadContext?: (id: string) => Promise<MatchupContext>; sport?: string; }

/** The moment a Sports pick must beat. Both sports here start at kickoff. */
const MOMENT = "kickoff" as const;

/** One number per pick, chosen by when the game started.
 *
 *  The list card reads the stored pre-kickoff snapshot; the modal used to read
 *  today's freshly computed prediction, so the same pick read 68% on the card
 *  and 72% in the tile — and the tile's `win · {team}` sub made the fresh
 *  number read as the pick. The record judges the snapshot, so once a game has
 *  started the snapshot is the only figure that may be called the pick. Before
 *  kickoff there is no snapshot to disagree with, and the live model number is
 *  the pick.
 *
 *  `started` is the card's own rule, imported from `weekCards.ts`, so the two
 *  surfaces cannot define "started" differently — that divergence was the bug.
 *
 *  A started game with no stored snapshot has NO pick, and says so. The fresh
 *  number is real, but it is not a pick made before kickoff and must not be
 *  promoted into the pick's place wearing the pick's label.
 */
export function pickProbability(
  game: GameSummary,
  prediction: GamePrediction | null,
  week: WeekPrediction | null,
): number | null {
  const snapshot = week && week.status !== "untracked" ? week.home_win_prob ?? null : null;
  if (hasStarted(game)) return snapshot;
  return prediction?.home_win_prob ?? snapshot;
}

/**
 * The fixture's name, for the states where the flow has a sentence to put under it.
 *
 * **This is the empty-heading fix, and it is measured rather than assumed.**
 * `FixtureFlow` (vendored, `src/predictor-ui/` — unchanged by this PR) builds
 * its pre-game rows as exactly ONE heading: `${home_team} vs ${away_team}` and
 * nothing else. Every sentence that used to sit under it moved into the instant
 * block as a figure, one of them, which left the live pre-kickoff modal with a
 * bare `CLE vs PIT` heading above the AI button and no text under it at all.
 * The `finished` branch is a different story and still carries real rows (the
 * result, and the pick's rightness once the verdict has reconciled), and
 * `in-play` carries the score and the standing — so the name is NOT deleted from
 * the flow; it is withheld only from the one state that renders it alone.
 *
 * The rule this implements: **the heading appears only where a row can follow
 * it.** Pre-game there is no row to follow, so the bundle carries no name and
 * `FixtureFlow` renders an empty flow — the honest reading the package's own
 * header describes ("A state with nothing to say renders an empty flow"). That
 * is also what it already does for a sport with no home and away side, so this
 * is the same path rather than a new one.
 *
 * It costs nothing else. `InstantBlock` names the pick through
 * `bundleFacts.fullTeamName`, which falls back to the pick's own label when the
 * bundle has no `home_team` to match it against — and this site's label is
 * already the full team name — so the block's verdict line, its tiles, its bar
 * and its record are unchanged. The `score`, `result` and `pick.was_right` rows
 * that the two other states word never read the name from these two fields on
 * this path either: `resultSentence` names the side off `score`, which is where
 * the name comes from on a final. `GameDetailModal.leftovers.test.tsx` asserts
 * all of it on the live payloads, per state and per sport.
 */
export function flowName(
  game: Pick<GameSummary, "home_team" | "away_team">,
  state: FlowState,
): { home_team?: string; away_team?: string } {
  // Pre-game: no row under the heading, so no heading. See above.
  if (state === "pre-game") return {};
  return { home_team: game.home_team, away_team: game.away_team };
}

/** The away side of the same pair, from the same source, for the bar's two segments. */
function pickProbabilities(
  game: GameSummary,
  prediction: GamePrediction | null,
  week: WeekPrediction | null,
): { home: number; away: number } | null {
  const home = pickProbability(game, prediction, week);
  if (home == null) return null;
  const snapshotAway = week && week.status !== "untracked" ? week.away_win_prob ?? null : null;
  const away =
    hasStarted(game) ? snapshotAway ?? 1 - home : prediction?.away_win_prob ?? snapshotAway ?? 1 - home;
  return { home, away };
}

/**
 * The prediction object the adapter reads, carrying the ONE chosen moneyline
 * pair. Everything else the tiles draw — the model's own margin and total — is
 * today's fresh run, and stays so: the spread tile's `model` sub says which run
 * it is, so a reader can see they are different numbers for different questions
 * without either being restated as the pick.
 *
 * A started game reads from the snapshot even with no fresh response at all: the
 * stored pick is the one figure the page may state, and a request that failed or
 * has not landed is not a reason to state no number when the number is already
 * held. The spread and total tiles need the fresh run, so with none they are
 * simply absent — a market the facts do not carry is not passed at all.
 */
function panelInput(game: GameSummary, prediction: GamePrediction | null, week: WeekPrediction | null) {
  const pair = pickProbabilities(game, prediction, week);
  if (!prediction && !pair) return null;
  return {
    ...prediction,
    home_win_prob: pair?.home ?? null,
    away_win_prob: pair?.away ?? null,
    predicted_margin: prediction?.predicted_margin ?? null,
    predicted_total: prediction?.predicted_total ?? null,
  };
}

export function GameDetailModal({ game, api, weekPrediction, weekPredictions, onClose, explain, loadContext, sport = "nfl" }: Props) {
  const [prediction, setPrediction] = useState<GamePrediction | null>(null);
  // Spec §3's signal rows for this fixture. `[]` is the resting state and means
  // "nothing to show", which is also what an empty answer and a rejected request
  // both leave behind — see the effect below for why that conflation is
  // deliberate.
  const [signals, setSignals] = useState<Signal[]>([]);
  // The panel's figures, derived rather than fetched. Memoised because
  // `panelFacts` allocates a new array on every call and the panel takes those
  // arrays as props — without this the tiles and segments are a fresh identity on
  // every render, which re-renders the whole panel whenever anything else moves.
  //
  // The prediction it reads is `panelInput`, not the raw response: that is where
  // the moneyline pair is replaced by the ONE pair this page may state (see
  // `pickProbability`). Passing the raw response here is what let the tile and
  // the list card disagree.
  const panelInputFor = useMemo(() => panelInput(game, prediction, weekPrediction ?? null), [game, prediction, weekPrediction]);
  const panel = useMemo(() => panelFacts({ kind: "SP", game, prediction: panelInputFor }), [game, panelInputFor]);
  // The moneyline tile's sub is dropped rather than rewritten. `panelFacts` gives
  // it `win · {team}`, and that sub is what dressed the number up as the pick;
  // without it `KeyNumberTile` falls back to the market's own label, so the tile
  // reads "moneyline" under the figure and the block's verdict line is the only
  // place the pick is named. The spread and total tiles keep their subs — those
  // are the model's own run against the market's line, which is a different
  // question from which side is the pick.
  const tiles = useMemo(
    () => panel.tiles.map((t) => (t.market === "moneyline" ? { ...t, sub: undefined } : t)),
    [panel.tiles],
  );
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [allProps, setAllProps] = useState<PlayerPropPrediction[] | null>(null);
  const [marketLines, setMarketLines] = useState<MarketLine[] | null>(null);
  const [propsLoading, setPropsLoading] = useState(true);
  // Phase 2 task 4: the model's own ranked calls, plus the availability facts
  // behind them. `null` until both have landed, and a REJECTION stays distinct
  // from an empty list -- "the report failed, so nobody was removed" and "the
  // report ran and listed nobody" are different sentences and only one of them
  // is safe to show. `picksError` is what keeps them apart.
  const [outPlayers, setOutPlayers] = useState<OutPlayerEntry[]>([]);
  const [outUnavailable, setOutUnavailable] = useState(false);
  // Whether the injury list has ANSWERED (a list, an error, or "no feed for this sport").
  // `outPlayers` starts as [] and the props can land first, so a picks panel keyed only
  // on the props ranked an out player until /out answered. The panel waits for this.
  const [outResolved, setOutResolved] = useState(false);
  const [propsTrack, setPropsTrack] = useState<PlayerPropsTrackRecord | null>(null);
  // This fixture's graded prop lines, out of the `/prop-grading` payload.
  // `null` until the payload lands, and it stays `null` on any failure: the
  // section it feeds renders nothing rather than an error (see the fetch).
  const [propGrading, setPropGrading] = useState<PropGrading | null>(null);
  const [verdict, setVerdict] = useState<GameVerdict | null>(null);
  const [homeForm, setHomeForm] = useState<TeamForm | null>(null);
  const [awayForm, setAwayForm] = useState<TeamForm | null>(null);
  const [h2h, setH2h] = useState<HeadToHeadData | null>(null);
  const isFinal = game.home_score != null && game.away_score != null;

  // Which of the package's three flow states this fixture is in. Only two are
  // reachable from here, and the choice is what `flowName` below keys on: a
  // `finished` flow words a sentence under its heading, a pre-game one has
  // nothing to word.
  const flowState: FlowState = isFinal ? "finished" : "pre-game";

  // The flow's facts: what this site already has, no request. The pick is the
  // leading side of the site's own probabilities — reading the numbers, not
  // grading them — and every field the flow can word is present only when the
  // data carries it: no score before there is one, no result before the final,
  // no rightness before the verdict is reconciled. The flow never claims more
  // than the bundle holds, because a sentence it cannot support is not rendered
  // at all.
  const finite = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const flowBundle = useMemo(() => {
    // The SAME pair the tiles draw. The flow and the block read one bundle, so
    // they cannot state two different probabilities for the same pick — which is
    // exactly the 68/72 defect, in a different component.
    const pair = pickProbabilities(game, prediction, weekPrediction ?? null);
    const hw = pair?.home;
    const aw = pair?.away;
    // Rightness arrives with the reconciled verdict, which loads after the
    // modal opens; until then the finished flow states the result and says
    // nothing about the pick, rather than grading unreconciled numbers.
    const wasRight = verdict?.moneyline?.hit;
    const pick =
      hw !== undefined && aw !== undefined
        ? {
            label: hw >= aw ? game.home_team : game.away_team,
            prob: hw >= aw ? hw : aw,
            ...(typeof wasRight === "boolean" ? { was_right: wasRight } : {}),
          }
        : undefined;
    const score =
      game.home_score != null && game.away_score != null
        ? { home: game.home_score, away: game.away_score }
        : undefined;
    return {
      ...flowName(game, flowState),
      market_line: finite(game.spread_line) ?? null,
      home_win_prob: hw,
      away_win_prob: aw,
      pick,
      // A pick snapshotted at or after kickoff is DISCLOSED and still counted
      // (predictor-hub #66, decided 2026-10-01): `rebuilt` here means "made at
      // or after this game's kickoff" and nothing else. The badge that says when
      // it was made belongs to the block, so the bundle carries the flag and
      // nothing words it a second time.
      ...(weekPrediction?.rebuilt ? { pick_timing: "rebuilt" as const } : {}),
      score,
      result: !score
        ? undefined
        : score.home === score.away
          ? "draw"
          : score.home > score.away
            ? "home_win"
            : "away_win",
    };
  }, [game, prediction, verdict, weekPrediction, flowState]);

  // The record: this week's COUNTED picks, and the pre-kickoff subset beside
  // them, from the same `weekTally` the week navigator uses, over the rows the
  // list page already fetched.
  //
  // The LABEL is this site's copy, because `RecordStrip` is the hub's component
  // and the strip it fills is wordless apart from the label. The label used to
  // say "Picks made before kickoff correct", which was true only under the
  // pre-2026-10-01 rule that left a post-kickoff pick out of the count; the
  // count includes those picks now, so the label says what the count is and
  // states the subset beside it.
  //
  // `null` rather than a zeroed tally while the rows are absent, so the strip
  // never flashes 0/0 — "0/0" is a claim about a record that does not exist.
  const record = useMemo(
    () =>
      weekPredictions
        ? (() => {
            const { hits, settled, preKickoff } = weekTally(weekPredictions);
            const sub = `${preKickoff.hits} of ${preKickoff.settled} made before ${MOMENT}`;
            return {
              label: `Picks counted correct · ${sub}`,
              hits,
              settled,
            };
          })()
        : null,
    [weekPredictions],
  );

  useEffect(() => {
    let cancelled = false;
    setPrediction(null); setPredictionError(null); setAllProps(null); setPropsLoading(true); setVerdict(null);
    setHomeForm(null); setAwayForm(null); setH2h(null);
    setOutPlayers([]); setOutUnavailable(false); setOutResolved(false); setPropsTrack(null);
    setPropGrading(null);
    // The team filter belongs to the fixture, not the session: reopening the
    // default (home) with every game, or Away would hide the next game's home box score.
    setTeamPick(null);

    // Fetch main game prediction
    api.gamePrediction(game.season, game.week, game.game_id)
      .then((r) => { if (!cancelled) setPrediction(r); })
      .catch((e) => { if (!cancelled) setPredictionError(e instanceof Error ? e.message : String(e)); });

    // Kalshi's live lines for the line checker. NFL only, and any failure is silence: it only decorates the checker.
    if (sport !== "cfb") {
      api.marketLines?.(game.season, game.week)
        .then((r) => { if (!cancelled) setMarketLines(r?.lines ?? []); })
        .catch(() => { if (!cancelled) setMarketLines([]); });
    }

    // Fetch player props safely (fails silently to an empty array so it doesn't break UI)
    api.playerProps(game.season, game.week)
      .then((r) => { if (!cancelled) setAllProps(r); })
      .catch(() => { if (!cancelled) setAllProps([]); })
      .finally(() => { if (!cancelled) setPropsLoading(false); });

    // The signal rows (spec §4). Fetched here, on open, rather than from behind
    // the summary button: §2 makes signals INSTANT — computed from stored data,
    // "no model call" — and "the signals add none" of the AI's cost, so putting
    // them behind a paid click would make a free computed row a paid one.
    //
    // EVERY failure is silence, and the two are deliberately indistinguishable:
    // a missing `signals` method (NFL has no route and no band over the floor to
    // justify one), a 404, a network error and an honest empty list all leave
    // `[]`. Spec §2's "no data, no row" forbids a placeholder, and a signal is an
    // enhancement on this page — it must never become its error state. Nothing
    // here can distinguish "the sport has no such feed" from "the feed is down",
    // and nothing needs to: both mean the same thing to a reader, which is that
    // there is nothing to add.
    setSignals([]);
    if (typeof api.signals === "function") {
      api.signals(game.game_id)
        .then((r) => { if (!cancelled) setSignals(r?.signals ?? []); })
        .catch(() => { if (!cancelled) setSignals([]); });
    }

    // The out list, for NFL only. CFB has no injury report and no depth-chart
    // feed, so it has no such route -- asking for one there would produce a 404
    // per fixture and, worse, tempt a reader into thinking CFB had checked and
    // found nobody. Decision 5: CFB says "no availability check" instead.
    //
    // A failure here is NOT turned into an empty list. NFL#24 serves 200 `[]` for
    // an unreadable feed by design, so a rejection reaching this client means the
    // route itself is absent -- which is the live state today, since #24 is open.
    // Either way the ranking below is still true, just ungated, so the panel
    // renders and the availability line says which case it is.
    if (sport === "cfb") {
      setOutPlayers([]);
      setOutUnavailable(true);
      setOutResolved(true);
    } else if (typeof api.playerOut !== "function") {
      // A client without the route at all. `playerOut` was added to `SportApi`
      // alongside NFL#24, and this modal is handed whatever api the page has --
      // including a stub in a test, or a client from an older build. Calling it
      // unconditionally turns a missing route into a crash that takes the whole
      // modal down, including the box score, over an optional feature. Absent is
      // exactly the "no check ran" case, which is what the sentence already says.
      setOutPlayers([]);
      setOutUnavailable(true);
      setOutResolved(true);
    } else {
      api.playerOut(game.season, game.week)
        .then((r) => { if (!cancelled) { setOutPlayers(Array.isArray(r) ? r : []); setOutUnavailable(false); setOutResolved(true); } })
        .catch(() => { if (!cancelled) { setOutPlayers([]); setOutUnavailable(true); setOutResolved(true); } });
    }

    // The graded record, for the provenance line under each row. It fails soft
    // to a flag rather than to a record: with none, a row says "no graded record
    // yet", which is a true statement about an arm nothing has scored yet.
    // Same guard as `playerOut`, for the same reason: this modal is handed whatever
    // api object the page has, and a stub returning undefined must not crash a
    // modal that has nothing else to do with the track record but cite it.
    const trackRecord = typeof api.trackRecord === "function" ? api.trackRecord() : null;
    Promise.resolve(trackRecord)
      .then((r) => { if (!cancelled) setPropsTrack(r?.player_props ?? null); })
      .catch(() => { if (!cancelled) setPropsTrack(null); });

    // Post-match verdict: only meaningful once the game has a final score,
    // and a missing verdict (not yet reconciled) is not an error.
    if (isFinal) {
      api.gameVerdict(game.game_id)
        .then((r) => { if (!cancelled) setVerdict(r); })
        .catch(() => { if (!cancelled) setVerdict(null); });
    }

    // Prop grading for THIS fixture: the whole payload, from which the
    // section below picks this game's rows by its own id. Finals only — an
    // unplayed fixture has no graded lines, and asking would spend a request
    // to learn nothing. Every failure is silence, like the signal rows:
    // a missing method (a client or stub from before the route), a 404 and
    // a network error all leave `null`, and the section renders nothing.
    // The per-line grades live here, in the match's context; the track
    // record keeps only the aggregates they add up to.
    if (isFinal && typeof api.propGrading === "function") {
      api.propGrading()
        .then((r) => { if (!cancelled) setPropGrading(r ?? null); })
        .catch(() => { if (!cancelled) setPropGrading(null); });
    }

    // Recent form for both teams + head-to-head history. Missing data is
    // not an error -- the section simply renders whatever resolved.
    api.teamForm(game.home_team, game.season)
      .then((r) => { if (!cancelled) setHomeForm(r); })
      .catch(() => { if (!cancelled) setHomeForm(null); });
    api.teamForm(game.away_team, game.season)
      .then((r) => { if (!cancelled) setAwayForm(r); })
      .catch(() => { if (!cancelled) setAwayForm(null); });
    api.headToHead(game.game_id, game.season, game.week)
      .then((r) => { if (!cancelled) setH2h(r); })
      .catch(() => { if (!cancelled) setH2h(null); });

    return () => { cancelled = true; };
  }, [api, game.season, game.week, game.game_id, game.home_team, game.away_team, isFinal, sport]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const gameProps = allProps ? filterPlayerPropsForGame(allProps, game) : null;

  // One team at a time (phone box score): Home / Away, defaulting to Home.
  // Reset per game alongside the rest of the modal state in the fetch effect
  // below — a filter left over from another fixture would hide half of this
  // one's box score.
  // null = the user has not chosen: home, unless only the away team has rows.
  const [teamPick, setTeamPick] = useState<"away" | "home" | null>(null);
  const onlyAway =
    !!gameProps &&
    !gameProps.some((p) => p.recent_team === game.home_team) &&
    gameProps.some((p) => p.recent_team === game.away_team);
  const teamFilter: "away" | "home" = teamPick ?? (onlyAway ? "away" : "home");

  // The one team the control leaves visible.
  const visibleTeams = useMemo(
    () => [teamFilter === "away" ? game.away_team : game.home_team],
    [teamFilter, game.away_team, game.home_team],
  );
  const visibleProps = useMemo(() => {
    if (!gameProps) return null;
    const team = teamFilter === "away" ? game.away_team : game.home_team;
    return gameProps.filter((prop) => prop.recent_team === team);
  }, [gameProps, teamFilter, game.away_team, game.home_team]);

  // Grouped by team then position: one section per visible team, each with its
  // own position tables, each table already ordered starters-then-bench by
  // buildBoxScoreGroups. The per-position subtotal rows are stripped — each
  // team's total is rendered ONCE, in the strip at the end of the section, so
  // no number is encoded twice. (buildBoxScoreGroups still computes them; the
  // lib is untouched, the modal just does not render them.)
  const boxScoreByTeam = useMemo(
    () =>
      visibleTeams
        .map((team) => ({
          team,
          groups: visibleProps
            ? buildBoxScoreGroups(
                visibleProps.filter((prop) => prop.recent_team === team),
                [team],
              ).map((group) => ({ ...group, subtotals: null }))
            : [],
        }))
        .filter((entry) => entry.groups.length > 0),
    [visibleProps, visibleTeams],
  );
  const hasBoxScore = boxScoreByTeam.length > 0;
  // Whether the team control is on screen, decided by the GAME and never by the
  // scope currently selected: `hasBoxScore` goes false the moment a team with
  // no projections is selected, and gating the control on it took the only way
  // back to Both with it. A user who lands on an empty Away or Home must still
  // be able to press Both, so the control asks the unscoped question — does this
  // game have any player props to filter at all? (With none there is nothing to
  // switch between, and the control stays hidden.)
  const hasTeamFilter = (gameProps?.length ?? 0) > 0;
  // The "Projected order" note, once on the section. BoxScore only prints it
  // under its own title, and no table carries one now, so the section says it —
  // with the same meaning: no visible row has a real starter flag.
  const showProjectedNote =
    hasBoxScore &&
    !(visibleProps ?? []).some((prop) => prop.is_starter === true) &&
    (visibleProps ?? []).some((prop) => prop.is_starter == null);

  // Each visible team's total, once: the per-market sums (with the counts they
  // were summed from) that the removed yardage cards used to carry. Same
  // numbers, one home — which is what makes removing the cards a dedup rather
  // than a deletion.
  const teamTotals = useMemo(
    () =>
      visibleTeams.map((team) => ({
        team,
        markets: yardageBreakdown((visibleProps ?? []).filter((prop) => prop.recent_team === team)),
      })),
    [visibleProps, visibleTeams],
  );
  const showTeamTotals = teamTotals.some((row) => row.markets.length > 0);
  // Kept from origin/v2-wire, not from A4. Theirs' `visibleProps` memo is NOT
  // carried over: it filtered by the `positionFilter` state and sorted by
  // `keyYardage`, and A4 deleted the filter buttons (the box score groups by
  // position instead) along with the `playerRank` import, so the memo has
  // nothing left to read. `keyYardage` still exists -- `lib/boxScoreRows.ts`
  // uses it for the box score's row order -- but not as a modal-level sort.
  const emptyScope = teamFilter === "away" ? game.away_team : game.home_team;

  // The model's own ranked calls (Phase 2 task 4), built by `buildPicksPanel` and
  // rendered by the SHARED `PicksList`. This file holds no ranking rule of its
  // own -- the three-row cap, the one-category-per-list rule, the refusal of a
  // row whose visual cannot match its number and the refusal of an out player
  // passed as a ranked row all live in the package, so a second implementation
  // here is a second set of rules to drift.
  //
  // Built from the week's full props rather than `visibleProps`, so the team
  // filter (which exists for the box score) cannot silently halve the ranking.
  //
  // It renders only once there is something to rank, and never before the track
  // record has had its chance: showing rows with no provenance and then adding
  // one would put a figure on screen that a moment later reads differently.
  const picksPanel = useMemo(() => {
    if (!allProps || propsLoading || !outResolved) return null;
    // Deliberately NOT gated on the track record having loaded. A
    // `/track-record` that will not answer leaves the graded context missing,
    // and the honest row then reads "no graded record yet" -- which is true,
    // because nothing grades it. Waiting for it (or hiding the list until it
    // arrives) would mean a failing record endpoint silently removes the
    // model's picks from the page, which is a worse lie than an uncontextualised
    // number: the reader would conclude there are no calls to make at all.
    //
    // `NO_GRADED_RECORD` is the same shape the backends themselves serve for a
    // market with nothing resolved, so the wording comes from one place rather
    // than from a special case here.
    const record = propsTrack ?? NO_GRADED_RECORD;
    // Named `built`, not `panel`: `panel` is already the explainer's facts above
    // and shadowing it inside this callback made the explainer read this object's
    // shape instead -- which is an "over is not iterable" at render time, several
    // hundred lines away from the cause.
    const built = buildPicksPanel({
      sport: sport === "cfb" ? "cfb" : "nfl",
      props: allProps,
      out: outPlayers,
      track: record,
      game,
    });
    return built.categories.length > 0 ? built : null;
  }, [allProps, propsTrack, propsLoading, outResolved, outPlayers, sport, game.home_team, game.away_team]);

  // The line checker offers the same players the ranked lists do (this game, not Out, no benched backup QB).
  const lineCheckPlayers = useMemo(
    () => (sport === "cfb" || !allProps || propsLoading || !outResolved ? [] : eligiblePlayers(allProps, outPlayers, game)),
    [allProps, propsLoading, outResolved, outPlayers, sport, game.home_team, game.away_team],
  );

  // The availability sentence, worded from WHICH case we are in rather than
  // whether a list is empty. An empty `out` array is ambiguous on its own --
  // "the report ran and listed nobody" and "there was no report to run" are
  // different facts -- so the panel's own sentence is overridden here whenever
  // the route could not be read at all, which for NFL is today's live state
  // because NFL#24 is still open.
  const picksAvailability = useMemo(() => {
    if (!picksPanel) return null;
    if (sport === "cfb") return picksPanel.availability;
    if (outUnavailable) {
      return "Availability not checked for this week: the injury report could not be read, so nobody has been removed from these lists. That is a missing check, not a claim that everyone is available.";
    }
    return picksPanel.availability;
  }, [picksPanel, outUnavailable, sport]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="animate-modal-in relative flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-sp-border bg-sp-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-sp-border px-6 py-4">
          <span className="text-sm font-semibold text-sp-text-dim">Game Detail & Model Projections</span>
          <div className="flex items-center gap-3">
            {/* Kickoff conditions, when the API has a forecast for this game. */}
            <WeatherChip conditions={game.conditions} />
            <button onClick={onClose} className="rounded-full p-1.5 text-sp-text-dim transition hover:bg-sp-800 hover:text-sp-text" aria-label="Close">✕</button>
          </div>
        </div>
        <div className="overflow-y-auto px-6 py-6 space-y-6">

          {/* The signal rows, ABOVE the summary rather than below it: they are
              computed from stored data and cost nothing, so they belong with the
              instant facts. Spec §6 puts them "under the facts block" — this is
              that block, and it sits above the one thing on this page that waits
              for a reader and a model. `SignalRows` renders nothing for an empty
              list; the guard keeps the wrapper from leaving a gap. */}
          {signals.length > 0 && <SignalRows signals={signals} />}

          {/* In plain English — first, because it is the one-screen answer.
              The flow renders from facts this modal already holds, with no
              request; the AI summary sits behind the button and costs nothing
              until a reader asks. Hidden entirely when there is no explainer,
              rather than shown empty. */}
          {explain && (
            <FixtureExplainer
              sport={sport}
              state={flowState}
              bundle={flowBundle}
              request={() => explain(sport, game.game_id)}
              loadContext={loadContext}
              fixtureId={game.game_id}
              // The figures the block draws — and the figures the summary draws
              // underneath it — from this site's OWN prediction response rather
              // than from the explanation. The panel is handed numbers and
              // renders them; it must never be the thing that decides what the
              // numbers are, or the explanation and the prediction could
              // disagree on screen.
              //
              // `record` is the one thing the block adds that the list view held
              // on the other side of the click, so the modal no longer has to
              // fetch the week a second time to show it: the rows arrive as a
              // prop from the page that already has them.
              extras={{ tiles, segments: panel.segments, record: record ?? undefined, moment: MOMENT }}
            />
          )}

          {/* Header Matchup */}
          <div className="flex items-center justify-center gap-10">
            <div className="flex flex-col items-center gap-1">
              <TeamName team={game.away_team} size="lg" />
              {isFinal && <span className="font-mono text-xl font-bold text-sp-text">{game.away_score}</span>}
            </div>
            <span className="text-2xl font-black text-sp-text-faint">at</span>
            <div className="flex flex-col items-center gap-1">
              <TeamName team={game.home_team} size="lg" />
              {isFinal && <span className="font-mono text-xl font-bold text-sp-text">{game.home_score}</span>}
            </div>
          </div>

          {/* Post-match verdict — did the model call it right? */}
          {isFinal && (
            <section>
              <div className="mb-2">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-sp-text-faint">Result &amp; verdict</h3>
                <p className="text-sm text-sp-text-dim">Whether the model's pregame call matched what actually happened.</p>
              </div>
              {/* No pick sentence here. The block above already badges the
                  timing and names the pick, and this section's whole subject is
                  whether that call was right — restating which pick was made
                  would state the same figure a second time. */}
              {verdict ? (
                <div className="flex flex-col gap-2">
                  <p className="font-display text-lg font-semibold tracking-wide text-sp-text">
                    {`Final: ${verdict.actual_home_score ?? game.home_score}–${verdict.actual_away_score ?? game.away_score}`}
                    {verdict.home_spread_line != null && <span className="ml-2">{`Line ${verdict.home_spread_line}`}</span>}
                    {verdict.total_line != null && <span className="ml-2">{`Total ${verdict.total_line}`}</span>}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <VerdictBadge label="Moneyline" hit={verdict.moneyline.hit} />
                    {verdict.ats && <VerdictBadge label="Spread" hit={verdict.ats.hit} />}
                    {verdict.totals && <VerdictBadge label="Total" hit={verdict.totals.hit} />}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-sp-text-faint rounded-lg bg-sp-850/40 p-3 border border-sp-border/40">
                  This game's final result hasn't been reconciled against the model's prediction yet.
                </p>
              )}
            </section>
          )}

          {/* Prop grading: this game's counted player projections against
              its box score, right under the verdict — the per-line grades
              belong to the match, so they live here and not on the track
              record page. Renders nothing until the payload carries this
              game's rows, and nothing at all for an unplayed fixture. */}
          {isFinal && <GamePropGrading grading={propGrading} gameId={game.game_id} />}

          {/* Recent form & head-to-head — renders whatever resolved; missing
              data is not an error. */}
          {((homeForm && homeForm.recent_form.length > 0) || (awayForm && awayForm.recent_form.length > 0) || (h2h && h2h.meetings.length > 0)) && (
            <section>
              <div className="mb-2">
                <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-sp-text-faint">Recent form &amp; head-to-head</h3>
                <p className="text-[12px] text-sp-text-dim">Last five results for each team, plus recent meetings between them.</p>
              </div>
              <div className="flex flex-col gap-3">
                {homeForm && homeForm.recent_form.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm font-medium text-sp-text">{game.home_team}</span>
                    <FormStrip entries={homeForm.recent_form} />
                  </div>
                )}
                {awayForm && awayForm.recent_form.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-sm font-medium text-sp-text">{game.away_team}</span>
                    <FormStrip entries={awayForm.recent_form} />
                  </div>
                )}
                {h2h && h2h.meetings.length > 0 && <HeadToHead meetings={h2h.meetings} />}
              </div>
            </section>
          )}

          {/* The model's OTHER markets — today's fresh run, not the pick.
              The two win-probability bars that used to head this section are
              gone: the block's tile and bar already state that one pair, and
              stating it twice is how this page came to read 68% and 72% at
              once. What stays is the part the tiles do not draw at all —
              cover chance, over/under, and the margin's own spread — so nothing
              is lost with the duplicate. */}
          <section>
            <div className="mb-2">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-sp-text-faint">Other model markets</h3>
              <p className="text-sm text-sp-text-dim">
                {isFinal
                  ? "Today's model, for reference: the verdict above is judged on the pick made before kickoff."
                  : "Point spread cover chance and total points line, from today's run."}
              </p>
            </div>
            {predictionError && <p className="text-sm text-loss">{predictionError}</p>}
            {!prediction && !predictionError && <p className="text-sm text-sp-text-faint">Loading match markets…</p>}
            {/* The market's own lines, restated ONLY when no tile will carry
                them. `panelFacts` draws the spread tile from `spread_line` and
                the total tile's sub from `total_line`, but only when the model
                also has a margin and a total for that game; with no forecast
                there is no tile, and dropping the line then would lose a figure
                the page can still state honestly. A line that IS on a tile is
                not restated here, so no figure appears twice. */}
            {(() => {
              const parts: string[] = [];
              if (game.spread_line != null && prediction?.predicted_margin == null) {
                parts.push(spread(game.home_team, -game.spread_line));
              }
              if (game.total_line != null && prediction?.predicted_total == null) {
                parts.push(`Total ${game.total_line}`);
              }
              return parts.length > 0 ? (
                <p className="text-sm text-sp-text-dim">{parts.join(" · ")}</p>
              ) : null;
            })()}
            {prediction && prediction.predicted_margin != null && prediction.sigma != null && (
              <p className="text-sm text-sp-text-dim">
                {`Projected margin: ${prediction.predicted_margin >= 0 ? game.home_team : game.away_team} by ${Math.abs(prediction.predicted_margin).toFixed(1)} ± ${prediction.sigma.toFixed(1)} pts`}
              </p>
            )}
            {prediction && <div className="flex flex-col gap-1.5">
              {prediction.home_cover_prob != null && <MarketBar label={`${game.home_team} covers spread`} prob={prediction.home_cover_prob} />}
              {prediction.away_cover_prob != null && <MarketBar label={`${game.away_team} covers spread`} prob={prediction.away_cover_prob} />}
              {prediction.over_prob != null && <MarketBar label="Over total points" prob={prediction.over_prob} />}
              {prediction.under_prob != null && <MarketBar label="Under total points" prob={prediction.under_prob} />}
            </div>}
          </section>

          {/* The model's own top calls, before the box score: a ranked list is the
              answer to "who should I watch", and the box score below is the
              roster-wide detail that answers "who is projected to do what". */}
          {picksPanel && (
            <section aria-label="Model's top calls" className="flex flex-col gap-3">
              <PicksList title={picksPanel.title} categories={picksPanel.categories} out={picksPanel.out} />
              {/* Said once, here, and not folded into any row. It is a fact about
                  the whole list -- whether anyone was removed from it at all --
                  and repeating it per row would be three copies of a statement
                  that is not about any one player. */}
              <p data-testid="picks-availability" className="text-sm leading-snug text-sp-text-faint">
                {picksAvailability}
              </p>
            </section>
          )}
          {lineCheckPlayers.length > 0 && <LineChecker players={lineCheckPlayers} marketLines={marketLines} />}

          {/* Predicted box score — the model's own markets, grouped by team then
              position (A4). The three-state team control sits on the header
              line and defaults to Both; switching re-groups in place (one
              state update, same scroll container, nothing remounts), so there
              is no scroll jump.

              Team totals appear ONCE per team, in the strip at the end: the
              per-market sums with the counts they were summed from. Those are
              the numbers the old side-by-side yardage cards carried — same
              numbers, one home — which is why the cards are gone and no figure
              is encoded twice. */}
          <section aria-label="Predicted box score">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-sp-text-faint">Predicted box score</h3>
              {hasTeamFilter && (
                <div data-testid="box-score-team-filter" className="shrink-0">
                  <TeamToggle
                    label="Filter box score by team"
                    teams={[{ key: "home", label: game.home_team }, { key: "away", label: game.away_team }]}
                    value={teamFilter}
                    onChange={(k) => setTeamPick(k as "away" | "home")}
                  />
                </div>
              )}
            </div>
            {/* The "Projected order" note, once on the section rather than once
                per table: no table carries a title anymore, and BoxScore only
                prints the note under its title. */}
            {showProjectedNote && (
              <p className="mb-1 text-sm text-sp-text-dim" data-testid="box-score-projected-note">
                Projected order — no depth-chart feed for this sport
              </p>
            )}
            {propsLoading && <p className="text-sm text-sp-text-faint">Loading player projections…</p>}
            {/* Two different gaps, two different sentences, because the game
                either has no props at all or has props the model does not
                project. When the filter hides a team, the sentence names the
                team it is about rather than the game. */}
            {!propsLoading && !hasBoxScore && (
              <p className="text-sm text-sp-text-faint rounded-lg bg-sp-850/40 p-3 border border-sp-border/40">
                {visibleProps && visibleProps.length > 0
                  ? emptyScope
                    ? `No modelled positions for ${emptyScope} in this game. Every ${emptyScope} player the feed returned is at a position the model does not project (kicker, offensive or defensive line), and the box score only covers QB, RB, WR and TE.`
                    : "No modelled positions for this game. Every player the feed returned is at a position the model does not project (kicker, offensive or defensive line), and the box score only covers QB, RB, WR and TE."
                  : hasTeamFilter
                    ? `No box score for ${emptyScope} yet`
                    : "No player projection props available for this specific game yet."}
              </p>
            )}
            {/* A table per position, per team: each position has its own
                markets, and each team its own section, away first. */}
            {boxScoreByTeam.map(({ team, groups }, ti) => (
              <div key={team} className={ti === 0 ? "mt-3" : "mt-6"}>
                <h4 data-testid="box-score-team-section" className="font-display text-xs font-bold uppercase tracking-wider text-sp-text">{team}</h4>
                {groups.map((group) => (
                  <BoxScore
                    key={group.position}
                    columns={boxScoreColumnsFor(group.position)}
                    groups={[group]}
                  />
                ))}
              </div>
            ))}
            {/* Each visible team's total, once. A rate has no total and a
                missing market is a dash, exactly like the per-position cells
                above; the counts travel with the sums. */}
            {showTeamTotals && (
              <div data-testid="box-score-team-totals" className="mt-5">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Projected yardage by team and market</caption>
                    <thead>
                      <tr className="border-b border-sp-border text-[0.6875rem] uppercase tracking-wide text-sp-text-dim">
                        <th scope="col" className="px-2 py-1.5 text-left font-semibold">Team</th>
                        {(Object.keys(MARKET_LABEL) as (keyof typeof MARKET_LABEL)[]).map((market) => (
                          <th key={market} scope="col" className="px-2 py-1.5 text-right font-semibold">
                            {MARKET_LABEL[market]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {teamTotals.map((row) => (
                        <tr key={row.team} data-testid="box-score-team-total" className="border-b border-sp-border/60">
                          <th scope="row" className="px-2 py-1.5 text-left font-semibold">{`${row.team} total`}</th>
                          {(Object.keys(MARKET_LABEL) as (keyof typeof MARKET_LABEL)[]).map((market) => {
                            const entry = row.markets.find((m) => m.market === market);
                            return (
                              <td key={market} className="px-2 py-1.5 text-right tabular-nums">
                                {entry ? (
                                  <>
                                    <span className="font-mono">{Math.round(entry.yards)}</span> <span className="text-sp-text-faint">({entry.n})</span>
                                  </>
                                ) : (
                                  "—"
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-sm leading-snug text-sp-text-faint">
                  Position-market projections, not team total yards. These cover the whole
                  roster rather than the expected on-field lineup, and the model projects one
                  yardage market per position, so QB rushing and RB receiving are missing.
                  A team yardage total needs a team-level model that does not exist yet.
                </p>
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
