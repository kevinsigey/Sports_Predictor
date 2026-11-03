// The track record page, rebuilt on the shared Track Record kit.
//
// Every sport maps its own API onto one `RecordModel` and the kit renders it,
// so this page no longer owns the counting arithmetic, the Wilson range, the
// week strip, the calibration chart or the verdict words. Sports uses the kit
// blocks with its own markets plugged in.
//
// What changed vs the previous page:
//
//  - The headline is `RecordHeadline` in `counted` mode: every recorded pick
//    leads, and the pre-kickoff subset is printed beside it (PRODUCT.md).
//  - The per-pick table moved into a collapsed `<details>` at the bottom so
//    the page opens on the summary, not a 240-row table.
//  - Recent picks are `RecentPicks` (<= 10 rows), not another table.
//  - "How this is counted" is `HowCounted`, stated once.
//  - Market words come from `marketLabel` (`Spread`, `Total`, never raw
//    `ats`/`totals`); verdicts are `Right`/`Wrong` (never `hit`/`miss`).
//  - `track-record.css` and the ad-hoc section nav are gone; sections are
//    `RecordBlock`s.
//
// The open question from the kit rebuild — whether yardage, position, points
// and the vs-market comparison belong on this page as sport-specific plugs —
// is answered: they stay, as plugs. "Against the odds" is a first-class
// `RecordBlock` (the payload has carried `vs_market` all along; the page
// simply never rendered it), the yardage tiles carry the signed bias beside
// the MAE (NBA parity), and the prop blocks stay folded below. The
// vs-market method text is stated in "How this is counted", once, like
// everything else about how these numbers are made.
//
// Row-level picks are no longer part of the summary payload: the client
// asks for `picks=deferred`, and the every-pick rows are fetched from
// `/track-record/picks` only when the reader opens that fold (which also
// fills the latest-picks strip). A backend older than the split ignores
// the parameter and inlines the rows; the page reads them from there and
// never calls the picks route.
//
// Prop grading's aggregates sit between "Against the odds" and the folded
// prop blocks: the per-line grades moved into each fixture's detail (a line
// is meaningless scrolled past without its match), and this page keeps what
// the lines add up to — per-stat MAE, bias, grade bands and a daily trend,
// computed from the graded lines on their own route (`/prop-grading`). The
// block renders nothing until a backend serves counted lines.

import { useEffect, useRef, useState } from "react";
import type { PerPickRow, TrackRecord, VsMarket, VsMarketMethod, YardageTrackRecord } from "../types";
import { useSport } from "../context/SportContext";
import {
  CalibrationBlock,
  HowCounted,
  RecordBlock,
  RecordHeadline,
  RecentPicks,
  StatTable,
  StatTile,
  WeekStrip,
  momentFor,
} from "../predictor-ui";
import PropModelTracking from "../components/PropModelTracking";
import { brier, edgeWord, plural, rate, signedPoints } from "../lib/trackFormat";
import { labelFor, toRecordModel } from "../lib/recordModel";
import "./track-record.css";

const n0 = (x: number) => x.toLocaleString("en-US");

/** Render snapshotted_at as a real time, not a raw ISO string. */
function formatPickTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function TrackRecordPage() {
  const { api, sport } = useSport();
  const [record, setRecord] = useState<TrackRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Row-level picks, when they did NOT arrive inside the summary payload.
  // `null` = not fetched yet; the fetch fires only when the every-pick fold
  // is first opened (see the header note on the payload split).
  const [loadedPicks, setLoadedPicks] = useState<PerPickRow[] | null>(null);
  const [picksFailed, setPicksFailed] = useState(false);
  const picksRequested = useRef(false);

  useEffect(() => {
    setRecord(null);
    setError(null);
    setLoadedPicks(null);
    setPicksFailed(false);
    picksRequested.current = false;
    api.trackRecord().then(setRecord).catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [api, sport]);

  if (error) return <p role="alert" className="text-sm text-loss">{error}</p>;
  if (!record) return <p className="text-sm text-sp-text-faint">Loading…</p>;

  const { games, player_props } = record;
  const { passing_yards, rushing_yards, receiving_yards } = player_props;

  // An older backend inlines the rows in the summary; a split backend omits
  // them and serves /track-record/picks instead. Either way the page below
  // reads one list, and the model (whose latest-picks strip derives from
  // the rows) is built over the merged record.
  const inlinePicks = games.per_pick;
  const per_pick = loadedPicks ?? inlinePicks ?? [];
  const modelRecord =
    loadedPicks && !inlinePicks ? { ...record, games: { ...games, per_pick: loadedPicks } } : record;
  const model = toRecordModel(modelRecord);
  const moment = momentFor(sport);

  const loadPicks = () => {
    if (inlinePicks || loadedPicks || picksRequested.current || !api.trackRecordPicks) return;
    picksRequested.current = true;
    api
      .trackRecordPicks()
      .then((r) => setLoadedPicks(r.per_pick ?? []))
      .catch(() => setPicksFailed(true));
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="mb-1 font-display text-2xl font-semibold uppercase tracking-wide text-sp-text">Track Record</h2>
        <p className="mb-4 text-xs text-sp-text-faint">
          How good the model actually is, in aggregate — not a game-by-game log.
        </p>
      </div>

      {/* Calibration chart as hero: full width under the header, above the record. */}
      <CalibrationBlock series={model.calibration ?? []} markets={model.markets} />

      <RecordBlock id="tr-record" title="Record">
        {games.n_resolved === 0 ? (
          <p className="text-sm text-pr-text-faint">No resolved games yet — check back once this week's games are final.</p>
        ) : (
          <>
            <RecordHeadline markets={model.markets} mode={model.headline} lead={model.lead} moment={moment} />
            <p className="max-w-prose text-sm text-pr-text-dim" data-testid="rebuilt-note">
              {games.n_rebuilt != null && games.n_rebuilt > 0
                ? `${n0(games.n_resolved)} counted picks in this record, of which ${n0(
                    games.n_rebuilt,
                  )} were made at or after their own kickoff and are counted like any other. The figure beside each
                  market is the pre-kickoff subset.`
                : games.n_pre_kickoff != null
                  ? `${n0(games.n_pre_kickoff)} of ${n0(games.n_resolved)} counted picks were made before their own
                      kickoff.`
                  : `Every pick in this record is counted here. The figure beside each market is the pre-kickoff subset.`}
            </p>
          </>
        )}
      </RecordBlock>

      <RecordBlock id="tr-week" title="By week">
        <WeekStrip weeks={model.weeks ?? []} />
      </RecordBlock>

      <RecordBlock id="tr-recent" title="Latest counted picks">
        <RecentPicks picks={model.recent ?? []} limit={10} moment={moment} />
      </RecordBlock>

      {/* Against the odds: the model against the closing line. First-class —
          above the folded prop blocks — because whether the model adds
          anything over the price is the first question a reader asks of a
          record. The method is stated in "How this is counted", once. */}
      <RecordBlock
        id="tr-vs-market"
        title="Against the odds"
        caption="The model against the closing line: the games where the two disagreed, and how those calls went."
      >
        {games.vs_market ? (
          <VsMarketBlock games={games} />
        ) : (
          <NotRecorded why="No market comparison is recorded for this sport yet — the tracker holds no closing lines to compare the model against." />
        )}
      </RecordBlock>

      {/* Player prop model: the graded lines' aggregates — how good the
          model is at predicting player outcomes, per stat, with the daily
          trend. The per-line grades themselves are in each fixture's
          detail, where the match gives them their context. The block
          fetches its own route and renders nothing at all until a backend
          serves counted lines — no chrome, no empty state — so its place
          in the flow is safe before the backends land. */}
      <PropModelTracking />

      {/* Yardage markets: how far off the projected yardage was, per market. */}
      <details className="rounded-pr border border-pr-rule bg-pr-panel px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-pr-text">Yardage markets</summary>
        <div className="mt-3">
          <RecordBlock
            id="tr-yardage"
            title="Yardage markets"
            caption="Mean absolute error: how far off the projected yardage was, per market, in yards."
          >
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
              <StatTile label="Passing yards" value={maeText(passing_yards)} sub={biasSub(passing_yards)} />
              <StatTile label="Rushing yards" value={maeText(rushing_yards)} sub={biasSub(rushing_yards)} />
              <StatTile label="Receiving yards" value={maeText(receiving_yards)} sub={biasSub(receiving_yards)} />
            </div>
          </RecordBlock>
        </div>
      </details>

      {/* By position: error by position group. */}
      <details className="rounded-pr border border-pr-rule bg-pr-panel px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-pr-text">By position</summary>
        <div className="mt-3">
          <RecordBlock id="tr-position" title="By position" caption="Mean absolute error by position group.">
            <StatTable
              rows={positionRows(player_props)}
              rowKey={(r) => `${r.market}-${r.position}`}
              caption="Position groups with resolved props."
              columns={[
                { key: "market", label: "Market", value: (r) => r.market },
                { key: "position", label: "Position", value: (r) => r.position },
                { key: "mae", label: "MAE (yards)", numeric: true, value: (r) => r.mae },
              ]}
            />
          </RecordBlock>
        </div>
      </details>

      {/* Points: anytime-TD scoring accuracy. */}
      <details className="rounded-pr border border-pr-rule bg-pr-panel px-4 py-3 text-sm">
        <summary className="cursor-pointer font-semibold text-pr-text">Points</summary>
        <div className="mt-3">{renderPoints(player_props)}</div>
      </details>

      {(per_pick.length > 0 || (!inlinePicks && api.trackRecordPicks)) && (
        <details
          className="rounded-pr border border-pr-rule bg-pr-panel px-4 py-3 text-sm"
          onToggle={(e) => {
            if ((e.currentTarget as HTMLDetailsElement).open) loadPicks();
          }}
        >
          <summary className="cursor-pointer font-semibold text-pr-text">Every recorded pick</summary>
          <div className="mt-3">
            {per_pick.length === 0 ? (
              picksFailed ? (
                <p className="text-sm text-pr-text-dim">We couldn&apos;t load the pick-by-pick detail. Close and reopen to try again.</p>
              ) : (
                <p className="text-sm text-pr-text-dim">Loading every recorded pick…</p>
              )
            ) : (
            <StatTable
              rows={[...per_pick].sort((a, b) => b.snapshotted_at.localeCompare(a.snapshotted_at))}
              rowKey={(r) => `${r.market}-${r.game_id}-${r.snapshotted_at}`}
              caption="Per-pick detail: market, pick, result and when it was made"
              columns={[
                { key: "market", label: "Market", value: (r) => labelFor(r.market) },
                { key: "pick", label: "Pick", value: (r) => r.pick },
                { key: "actual", label: "Actual", value: (r) => r.actual },
                {
                  key: "hit",
                  label: "Result",
                  value: (r) => (r.hit ? 1 : 0),
                  render: (r) => (r.hit ? <span className="font-semibold text-pr-win">Right</span> : <span className="font-semibold text-pr-loss">Wrong</span>),
                },
                {
                  key: "when",
                  label: "Made",
                  value: (r) => (r.made_before_kickoff ? 1 : 0),
                  render: (r) => (r.made_before_kickoff ? "Before kickoff" : "After kickoff"),
                },
                ...(per_pick.some((r) => r.counted !== undefined)
                  ? [{
                      key: "counted",
                      label: "In the record",
                      value: (r: { counted?: boolean }) => (r.counted ? 1 : 0),
                      render: (r: { counted?: boolean }) => (r.counted ? "counted" : "history, not the counted pick"),
                    }]
                  : []),
                { key: "time", label: "Time made", value: (r) => formatPickTime(r.snapshotted_at) },
              ]}
            />
            )}
          </div>
        </details>
      )}

      <HowCounted moment={moment} headline={model.headline}>
        {games.vs_market?.method && <VsMarketMethodNote method={games.vs_market.method} scope={games.vs_market.scope} />}
      </HowCounted>
    </div>
  );
}

function maeText(yardage: YardageTrackRecord): string {
  const mae = yardage.mean_absolute_error;
  return mae == null ? "—" : `${mae.toLocaleString("en-US")} yards`;
}

/**
 * The yardage tile's second line: the count, then which way the error leans.
 * `mean_signed_error` is mean(predicted − actual) on both backends (their
 * stores say so in as many words), so a positive value means the projections
 * run high. The words and the ±0.05 deadband are NBA's, verbatim, so a bias
 * reads the same on both sites.
 */
function biasSub(yardage: YardageTrackRecord): string {
  const count = `${yardage.n_resolved.toLocaleString("en-US")} props`;
  const bias = yardage.mean_signed_error;
  if (bias == null || !Number.isFinite(bias)) return `${count} · bias not measured`;
  if (bias > 0.05) return `${count} · runs high by ${bias.toFixed(1)} yards`;
  if (bias < -0.05) return `${count} · runs low by ${Math.abs(bias).toFixed(1)} yards`;
  return `${count} · no lean`;
}

/**
 * The model against the closing line, percent-forward: how often the model's
 * side covered when it disagreed with the price, beside its overall spread
 * record over the same priced games, and the average edge as a calibration
 * check. The disagreement cohort is the payload's own object (never the
 * loose `disagreement_n` re-derived), so the figure cannot drift from the
 * games list the backend publishes with it.
 */
function VsMarketBlock({ games }: { games: TrackRecord["games"] }) {
  const vm = games.vs_market!;
  const cohort = vm.disagreement ?? { n: vm.disagreement_n, hit_rate: vm.disagreement_hit_rate, games: [] };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <AccuracyCard
          label="When the model disagrees"
          accuracy={cohort.hit_rate}
          graded={`${plural(cohort.n, "disagreement")} of ${plural(vm.n, "priced game")}`}
          testId="vs-market-disagreement"
        />
        <AccuracyCard
          label="Against the spread, overall"
          accuracy={games.pct_ats_correct}
          graded={games.n_ats == null ? "grade count not reported" : `${plural(games.n_ats, "game")} graded`}
          testId="vs-market-overall"
        />
        <StatTile
          label="Average edge"
          value={vm.mean_edge_points == null ? "—" : `${signedPoints(vm.mean_edge_points)} pts`}
          sub={edgeWord(vm.mean_edge_points)}
        />
      </div>
      {(vm.mean_implied_home_cover_prob != null || vm.mean_model_home_cover_prob != null) && (
        <p className="max-w-prose text-sm text-pr-text-dim" data-testid="vs-market-cover-line">
          On average the closing line priced the home side at {rate(vm.mean_implied_home_cover_prob)} to cover; the
          model said {rate(vm.mean_model_home_cover_prob)}.
        </p>
      )}
    </div>
  );
}

/** The order the method reads in: what population, how a price becomes a
 *  probability, what edge is, what the cohort is, the league width behind
 *  it, and — last, where a skim ends — that none of it is a profit claim. */
const METHOD_ORDER: (keyof VsMarketMethod)[] = [
  "population",
  "implied_probability",
  "edge",
  "disagreement",
  "sigma_league_meaning",
  "not_a_profit_claim",
];

/** The vs-market method, stated inside "How this is counted" (the kit's
 *  children slot exists for exactly this: a comparison method a sport has).
 *  Only the backend's own strings are printed — never a paraphrase, which
 *  would be a second copy of the method to drift. */
function VsMarketMethodNote({ method, scope }: { method: VsMarketMethod; scope?: VsMarket["scope"] }) {
  const lines = METHOD_ORDER.map((k) => method[k]).filter(
    (v): v is string => typeof v === "string" && v.length > 0,
  );
  return (
    <>
      {scope && (
        <p>
          Against the odds covers {plural(scope.n_games_total, "priced game")}
          {scope.weekly_season != null &&
            `; its week chart accounts for ${plural(scope.n_games_in_weekly, "game")} from ${scope.weekly_season}` +
              (scope.n_games_outside_weekly > 0
                ? ` and ${plural(scope.n_games_outside_weekly, "game")} outside it.`
                : ".")}
        </p>
      )}
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </>
  );
}

/** Flatten each yardage market's per-position errors into one table. */
function positionRows(player_props: TrackRecord["player_props"]): { market: string; position: string; mae: number | null }[] {
  const rows: { market: string; position: string; mae: number | null }[] = [];
  const markets: { [market: string]: YardageTrackRecord | undefined } = {
    passing_yards: player_props.passing_yards,
    rushing_yards: player_props.rushing_yards,
    receiving_yards: player_props.receiving_yards,
  };
  for (const [market, yardage] of Object.entries(markets)) {
    if (!yardage) continue;
    if (yardage.by_position) {
      for (const row of yardage.by_position) rows.push({ market, position: row.position, mae: row.mean_absolute_error });
    } else if (yardage.mae_by_position) {
      for (const [position, mae] of Object.entries(yardage.mae_by_position)) rows.push({ market, position, mae });
    }
  }
  return rows;
}

function renderPoints(player_props: TrackRecord["player_props"]) {
  const td = player_props.anytime_td;
  const buckets = td.confidence_buckets ?? [];
  const called = td.n_called;

  if (td.n_resolved === 0) {
    return <NotRecorded why="No resolved player props yet — check back once this week's games are final." />;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <AccuracyCard
          label="Anytime-TD rate"
          accuracy={td.hit_rate_when_called}
          graded={called == null ? "call count not reported" : plural(called, "call") + " of " + plural(td.n_resolved, "prop") + " at 50% or better"}
          testId="accuracy-bar-anytime-td"
        />
        <StatTile
          label="Anytime-TD Brier score"
          value={brier(td.brier_score)}
          sub="over N props · lower is better · 0.25 is a coin flip"
        />
        <StatTile
          label="Props resolved"
          value={td.n_resolved.toLocaleString("en-US")}
          sub={called == null ? "call count not reported" : plural(called, "call") + " at 50% or better"}
        />
      </div>

      {buckets.length > 0 && (
        <StatTable
          rows={buckets.map((b, i) => ({ ...b, key: `${b.label}-${i}` }))}
          rowKey={(b) => b.key}
          caption="Anytime-TD rate by predicted-probability band"
          columns={[
            { key: "label", label: "Predicted", value: (b) => b.label },
            {
              key: "hit_rate",
              label: "Actual rate",
              numeric: true,
              firstDir: "desc",
              value: (b) => b.hit_rate,
              render: (b) =>
                b.n > 0 ? (
                  <RateCell value={b.hit_rate} n={b.n} />
                ) : (
                  <span className="text-pr-text-faint">no calls</span>
                ),
            },
            { key: "n", label: "Props", numeric: true, value: (b) => b.n },
          ]}
        />
      )}
    </>
  );
}

function AccuracyCard({
  label,
  accuracy,
  graded,
  testId,
}: {
  label: string;
  accuracy: number | null | undefined;
  graded: string;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-pr border border-pr-rule bg-pr-panel p-4" data-testid={testId}>
      <span className="text-xs font-semibold uppercase tracking-wide text-pr-text-dim">{label}</span>
      <span className="font-pr-display text-2xl font-semibold text-pr-text">{rate(accuracy)}</span>
      <AccuracyBar value={accuracy} />
      <span className="text-xs text-pr-text-faint">{graded}</span>
    </div>
  );
}

function AccuracyBar({ value, testId = "accuracy-bar" }: { value: number | null | undefined; testId?: string }) {
  const width = value == null ? 0 : Math.min(100, Math.max(0, value * 100));
  return (
    <span className="tr-bar" data-testid={testId} aria-hidden="true">
      <span className="tr-bar-fill" style={{ width: `${width}%` }} />
      <span className="tr-bar-marker" data-testid="accuracy-50-marker" />
    </span>
  );
}

function RateCell({ value, n }: { value: number | null | undefined; n: number | undefined }) {
  if (value == null) return <span className="text-pr-text-faint">—</span>;
  // Percent-forward, like the cards: the number, its bar on the same 0-100
  // scale (50% marker included), then the count behind it in parens.
  const width = Math.min(100, Math.max(0, value * 100));
  return (
    <span className="tr-ratecell" data-testid="rate">
      <span className="tr-num font-semibold">{rate(value)}</span>
      <span className="tr-bar tr-bar-mini" aria-hidden="true">
        <span className="tr-bar-fill" style={{ width: `${width}%` }} />
        <span className="tr-bar-marker" />
      </span>
      <span className="text-pr-text-faint">({n ?? "—"})</span>
    </span>
  );
}

/** A section whose data this payload does not carry, said plainly. */
function NotRecorded({ why }: { why: string }) {
  return (
    <p className="rounded-pr border border-pr-rule bg-pr-panel px-3 py-2 text-sm text-pr-text-dim" data-testid="not-recorded">
      {why}
    </p>
  );
}
