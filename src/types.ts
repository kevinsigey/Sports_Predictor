// The vendored shared component owns `Signal`, so the contract is read from
// there rather than restated. A local copy would be a second definition that
// could drift from the one the renderer actually accepts.
import type { Conditions, Signal } from "./predictor-ui";

export type Sport = "nfl" | "cfb";
export interface GameSummary {
  game_id: string;
  season: number;
  week: number;
  gameday: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
  // Kickoff-hour forecast for an UPCOMING game, attached by the sport API from
  // Open-Meteo. Absent for finals, for games past the ~16-day forecast horizon,
  // and on any failure -- a missing chip is honest, a guessed one is not. The
  // shape is the shared `Conditions` the vendored WeatherChip draws.
  conditions?: Conditions | null;
  spread_line?: number | null;
  total_line?: number | null;
  home_conference?: string | null;
  away_conference?: string | null;
  // NFL-only context the /games endpoint already returns (schedules.py
  // KEEP_COLUMNS): rest days, roof/surface, weather, divisional flag. CFB
  // responses simply omit these, so everything is optional.
  home_rest?: number | null;
  away_rest?: number | null;
  roof?: string | null;
  surface?: string | null;
  temp?: number | null;
  wind?: number | null;
  div_game?: boolean | null;
}
// `predicted_margin` and `predicted_total` are `number | null`, not `number`:
// the API sends `null` for an absent forecast, and pydantic 2.13.5 serialises
// NaN to `null`, so a widening here is a fix and not a loosening -- a caller
// that narrows it back would re-introduce the type error the wire format
// already avoids. (Taken from origin/v2-wire; the B6 track-record contract
// below is ours.)
export interface GamePrediction { home_win_prob: number; away_win_prob: number; home_cover_prob: number | null; away_cover_prob: number | null; over_prob: number | null; under_prob: number | null; predicted_margin?: number | null; predicted_total?: number | null; sigma?: number; total_sigma?: number; }
// The yardage/count markets are whatever POSITION_MARKETS has for that
// position, so they are optional and a missing one stays missing (an em-dash),
// never 0. `is_starter` is true/false from NFL's depth chart and null where no
// depth chart exists -- CFB has none, and NFL's live payload does not carry
// the field yet. Absent is "unknown", not "not a starter".
// The QB passing-TD market, as NFL_Predictor flattens it onto the same props row
// (`models/player_props.py::predict_props`, `models/qb_passing_td.py`). QB-only
// and optional on two counts: only a QB row carries it, and an artifact
// directory trained before the model existed omits it entirely rather than
// sending a zero row -- so "absent" is a missing model, never a 0% call.
//
// `passing_td_line_source` is `"model_line"` and nothing else. The line is
// derived from the model's own projection (nearest half point to `mu`, floored
// at 0.5), so it is NOT a sportsbook line and there is nothing to have an edge
// against. Nothing on a picks row may present it as a price.
//
// `passing_td_prob` is `call_prob`, i.e. the higher of `passing_td_over_prob`
// and `passing_td_under_prob`, and `passing_td_side` names which of the two it
// is -- server-side, in one place, from one call.
//
// CFB has none of these fields: its `models/player_props.py` has no
// `passing_tds` model, so a CFB row cannot carry one.
export interface PlayerPropPrediction { player_id: string; player_name: string; recent_team: string; position: string; anytime_td_prob: number; passing_yards?: number; rushing_yards?: number; receiving_yards?: number; carries?: number; receptions?: number; is_starter?: boolean | null; depth_slot?: number | null; passing_td_line?: number; passing_td_line_source?: string; passing_td_side?: string; passing_td_mu?: number; passing_td_over_prob?: number; passing_td_under_prob?: number; passing_td_prob?: number; passing_td_distribution?: string; qb_rushing_yards?: number; passing_yards_p_over?: number | null; rushing_yards_p_over?: number | null; receiving_yards_p_over?: number | null; qb_rushing_yards_p_over?: number | null; receptions_p_over?: number | null; passing_yards_line?: number | null; rushing_yards_line?: number | null; receiving_yards_line?: number | null; qb_rushing_yards_line?: number | null; receptions_line?: number | null; receptions_mu_flag?: string | null; line_check?: { yardage?: Record<string, number[]>; counts?: Record<string, Record<string, number>> }; recent_avg?: { games?: number; passing_yards?: number; rushing_yards?: number; receiving_yards?: number; carries?: number; receptions?: number; qb_rushing_yards?: number }; }
// A player the official report lists Out, as NFL_Predictor's sibling route
// `GET /players/{season}/{week}/out` serves it.
//
// A SIBLING route, not a field on `/props`: that body is a bare JSON array and
// three things depend on it staying one (the public snapshot stores it, the
// server-side facts reader calls it, and the frontend client types it as
// `PlayerPropPrediction[]`). A picks list is not a reason to break it.
//
// NFL only. CFB has no injury report and no depth-chart feed at all, so it has
// no such route -- `playerOut` is never called for CFB, which is why the type
// carries no sport discriminator and the caller must know which it is.
//
// `report_status` is optional because the route's own contract is that a status
// meaning "not playing" removes a player and every other status does not; a
// missing status is therefore not grounds for a removal.
export interface OutPlayerEntry {
  player_id: string;
  player_name: string;
  recent_team?: string;
  report_status?: string;
  report_season?: number;
  report_week?: number;
  source?: string;
}
// ---------------------------------------------------------------------------
// Track record (B6)
//
// These are transcribed from what the trackers EMIT, not from the design spec's
// data contract, and the two do not fully agree. Read
// NFL_Predictor/src/nfl_predictor/tracking/store.py::get_track_record and
// _summarize_games before changing anything here -- the spec is a description,
// that function is the contract.
//
// Where they differ, the emitter wins and the difference is named:
//
//  - The spec's `WeeklyRow` carries `pct_total_error`, `total_mae` and
//    `total_bias`. B4 did NOT put them there. Every week of every points
//    forecast lives in its own `totals`/`margin` block with its own `weekly`
//    list, and the field is called `signed_error`, not `bias`. So `WeeklyRow`
//    has none of the three.
//  - The spec's `totals: { n, mae, bias, weekly }` is emitted as
//    `{ n, mae, signed_error, weekly }`.
//  - `weekly_trend` is GONE (B3) and is not kept alongside `weekly` for
//    compatibility. Two shapes for one fact is how this page shipped a
//    `types.ts` that read `{bucket, n_resolved}` against an API emitting
//    `{label, n}`, and rendered a section that had never once appeared in any
//    deploy. The CFB backend is still on the old key -- see the optionality
//    note below.
//
// The new keys are OPTIONAL, and that is not hedging. CFB_Predictor has not
// had B2-B5 applied to it: its `/track-record` still emits `weekly_trend`, no
// per-market counts, no points forecasts and no `vs_market`. This one site
// serves both sports off `?sport=`, so making these required would take the
// CFB tab from "behind" to "throws", which is the failure B6 exists to end.
// A section whose data the payload does not carry renders a visible
// not-recorded state on the page, which is the same rule the backend applies
// to a week with no picks.
// ---------------------------------------------------------------------------

/** One elapsed week. Every week 1..current has a row, tracked or not (B3). */
export interface WeeklyRow {
  week: number;
  /** false = no picks recorded that week. Its rates are absent, not zero. */
  tracked: boolean;
  /** Volume. Never multiplied into an accuracy -- see the B2 bar fix. */
  n_games: number;
  n_moneyline: number;
  pct_moneyline_correct: number | null;
  n_ats: number;
  pct_ats_correct: number | null;
  n_totals: number;
  pct_totals_correct: number | null;
}

/** One week of a points forecast: the model's total or margin, in points. */
export interface PointForecastWeek {
  week: number;
  /** false = no pick that week had a points forecast recorded. */
  tracked: boolean;
  n: number;
  mae: number | null;
  signed_error: number | null;
}

/**
 * MAE and signed error for one points forecast, overall and by week (B4).
 * `signed_error` is mean(predicted - actual): positive over-forecast.
 */
export interface PointForecast {
  n: number;
  mae: number | null;
  signed_error: number | null;
  weekly: PointForecastWeek[];
}

/**
 * The words B5 ships with the numbers, so the page cannot forget to print them.
 *
 * The index signature is load-bearing, not laziness. The tracker ADDS keys to
 * this block — `population` arrived after the other six — and the page renders
 * it by enumerating whatever it is sent. A type that closed the set would let
 * the next key compile while the page quietly stopped printing it, which is
 * exactly what happened: the page had a hand-written five-entry list, the
 * tracker added a sixth, and the sixth reached nobody. The declared keys below
 * are the ones the page gives a written heading to; anything else renders
 * under a heading derived from its own name rather than being dropped.
 *
 * `sigma_league_points` is the one NUMERIC value in the block. σ is a width and
 * "13.5" explains nothing on its own, so the page prints it as a number and
 * prints the sentence beside it.
 */
export interface VsMarketMethod {
  sigma_league_points: number;
  sigma_league_meaning: string;
  implied_probability: string;
  edge: string;
  disagreement: string;
  not_a_profit_claim: string;
  population: string;
  [key: string]: string | number | undefined;
}

/**
 * Which games the `vs_market` headline covers, and which its week chart does.
 *
 * The two are computed over DIFFERENT populations on purpose: the headline is
 * the whole record (so that it agrees with `n_resolved` and the ATS count two
 * keys above it), and the chart is one season's elapsed weeks. The tracker
 * computes the split rather than leaving it to be discovered, and the identity
 * `n_games_total == n_games_in_weekly + n_games_outside_weekly` is what makes
 * the block auditable.
 *
 * Optional only because the deployed backend can be older than this branch —
 * a missing block must degrade to no note, never to a throw. It is not
 * optional in the emitter.
 */
export interface VsMarketScope {
  /** The population label the headline is over, e.g. "all_seasons". */
  population: string;
  /** The season the week chart is scoped to; null when nothing names one. */
  weekly_season: number | null;
  /** The last week the chart covers; null when the calendar does not say. */
  weekly_last_week: number | null;
  n_games_total: number;
  n_games_in_weekly: number;
  n_games_outside_weekly: number;
}

/** One week of the model-against-the-line comparison. */
export interface VsMarketWeek {
  week: number;
  tracked: boolean;
  n: number;
  mean_implied_home_cover_prob: number | null;
  mean_model_home_cover_prob: number | null;
  mean_edge_points: number | null;
  disagreement_n: number;
  disagreement_hit_rate: number | null;
  games: string[];
}

/**
 * The model against the price (B5). "Edge" is a disagreement between two
 * probabilities in percentage points -- it is never a return, a stake or a
 * cent, and PRODUCT.md forbids reading it as one.
 */
export interface VsMarket {
  n: number;
  mean_implied_home_cover_prob: number | null;
  mean_model_home_cover_prob: number | null;
  mean_edge_points: number | null;
  disagreement_n: number;
  disagreement_hit_rate: number | null;
  /** The cohort as its own object, so `games` cannot read as "every game". */
  disagreement: { n: number; hit_rate: number | null; games: string[] };
  weekly: VsMarketWeek[];
  method: VsMarketMethod;
  /** Absent from a backend older than B5's scope block. See VsMarketScope. */
  scope?: VsMarketScope;
}

// ---------------------------------------------------------------------------
// What the other side of this merge contributed to this file, and why.
//
// origin/v2-wire declared `WeeklyTrendEntry` and changed nothing above it that
// ours needed. `WeeklyTrendEntry` is NOT taken: B3 removed `weekly_trend` from
// the API, and keeping the type is how a second shape for one fact survives in
// the type layer after it has gone from the wire -- the same failure that had
// this page read `{bucket, n_resolved}` against an emitter sending
// `{label, n}` and render a calibration section that had never once appeared in
// a deploy.
//
// What IS taken from origin/v2-wire: the `number | null` widening on
// `GamePrediction` above (pydantic 2.13.5 serialises NaN to `null`, so the wire
// already sends null for an absent forecast), and the removal of the
// `home_total_yards` / `away_total_yards` family from `GameSummary` above,
// which is #8 "stop publishing a team total yards the model cannot compute".
// The CFB backend still emits `weekly_trend`; the CFB fixture in
// TrackRecordPage.test.tsx is dumped rather than typed and asserts the page
// does NOT read it, which is the honest way to carry a payload this contract no
// longer describes.
// ---------------------------------------------------------------------------
export interface GameCalibrationBucket { lo: number; hi: number; n: number; mean_prob: number | null; hit_rate: number | null; }
export interface GameCalibration { n_buckets: number; winner: GameCalibrationBucket[]; spread: GameCalibrationBucket[]; total: GameCalibrationBucket[]; }

export interface GamesTrackRecord {
  /**
   * EVERY COUNTED PICK in the record: one per (game, market), the earliest
   * recorded one, whenever it was made.
   *
   * Its MEANING changed on 2026-10-01 (predictor-hub #66, spec
   * `2026-10-01-track-record-counts-every-pick.md`) and its NAME did not, so
   * nothing a site reads today breaks. It used to be the pre-kickoff record,
   * with a pick recorded after its own kickoff excluded; Kevin's decision was
   * that a re-run model must not make a past game stop counting, or the record
   * empties out on every model change. `pre_kickoff` below is the subset, with
   * its own n, and it is what a reader quotes for live performance.
   */
  n_resolved: number;
  /**
   * Counted picks made at or after their own kickoff -- the reconciliation
   * between the two figures, NOT an exclusion. NFL retains the key (#25); CFB
   * removed it (#27) rather than rename it into a lie, so it is optional and
   * nothing may depend on it being present.
   */
  n_rebuilt?: number;
  pct_moneyline_correct: number | null;
  pct_ats_correct: number | null;
  pct_totals_correct: number | null;
  // The denominator behind each accuracy above (B2). They differ: a market is
  // only graded when its line and both its probabilities were recorded.
  n_moneyline?: number;
  n_ats?: number;
  n_totals?: number;
  /** Every elapsed week, tracked or not. Replaces `weekly_trend` (B3). */
  weekly?: WeeklyRow[];
  /** Predicted total points, in points. */
  totals?: PointForecast;
  /** Predicted margin, in points. */
  margin?: PointForecast;
  vs_market?: VsMarket;
  /**
   * The pre-kickoff subset, as a block of the same keys: the same summariser run
   * over the counted picks whose OWN timestamps prove they were made before their
   * game's kickoff. Its `n_resolved` is therefore exactly the size of that subset.
   *
   * This is the figure BESIDE the headline, and B8's two figures swapped roles
   * when the rule was reversed: before, the headline was pre-kickoff and this
   * block did not exist; now the headline is every counted pick and this is the
   * honest read of live performance. Absent from an API build older than NFL #25.
   */
  pre_kickoff?: GamesSummary;
  /**
   * `pre_kickoff.n_resolved` at the top level, which CFB publishes (#27) and NFL
   * does not. Optional for exactly that reason.
   */
  n_pre_kickoff?: number;
  /**
   * RETAINED UNDER ITS PUBLISHED NAME, and now meaning "every counted pick" --
   * which is the SAME population as the headline, so `all_picks.n_resolved`
   * equals `n_resolved`.
   *
   * Not rendered as a figure of its own: printing one number twice on a page
   * invites the two copies drifting apart, which is the same defect as the same
   * pick reading two different values on two surfaces. Declared because the wire
   * still carries it, so a payload's shape stays described somewhere.
   */
  /** Per-market reliability buckets (moneyline/spread/total) from the backend. */
  calibration?: GameCalibration;
  all_picks?: AllPicksRecord;
  /** One row per recorded (game, market) pick, hit and miss alike, never filtered. */
  per_pick?: PerPickRow[];
}
/** The keys `pre_kickoff` repeats. Not the whole block: the subset also carries
 *  `weekly` / `vs_market` on NFL, which this page reads from the headline. */
export interface GamesSummary {
  n_resolved: number;
  n_moneyline?: number;
  n_ats?: number;
  n_totals?: number;
  pct_moneyline_correct: number | null;
  pct_ats_correct: number | null;
  pct_totals_correct: number | null;
}
export interface AllPicksRecord {
  n_resolved: number;
  pct_moneyline_correct: number | null;
  pct_ats_correct: number | null;
  pct_totals_correct: number | null;
}
export interface PerPickRow {
  game_id: string;
  gameday: string;
  market: "moneyline" | "ats" | "totals";
  pick: string;
  actual: string;
  hit: boolean;
  /**
   * WHEN THIS PICK WAS MADE, derived by the backend from this row's own
   * `snapshotted_at` and `commence_time` compared as UTC instants -- never from
   * a stored flag, and never on the frontend.
   *
   * It is the disclosure that replaced exclusion, so it is the field a surface
   * must render: a pick recorded after kickoff is counted, and saying WHEN is the
   * only thing a reader cannot recover from the number itself. Absent from an
   * older API build, which is why it is optional here.
   */
  made_before_kickoff?: boolean;
  /** NFL retains `rebuilt` as the exact negation of `made_before_kickoff` (#25);
   *  CFB does not send it (#27). Never read it for anything a reader sees. */
  rebuilt?: boolean;
  /** CFB lists every RECORDED pick, not only the counted one, and says which is
   *  counted here (#27). NFL lists counted picks only, and omits the flag. */
  counted?: boolean;
  /** The time the pick was made, beside the flag above so a reader can check it. */
  snapshotted_at: string;
}
export interface ConfidenceBucket { label: string; n: number; hit_rate: number | null; }
export interface AnytimeTdTrackRecord {
  n_resolved: number;
  // Absent, not 0, when nothing resolved: there is no such thing as zero calls
  // on a week with no props in it.
  n_called?: number;
  hit_rate_when_called: number | null;
  brier_score: number | null;
  confidence_buckets?: ConfidenceBucket[];
}
/** One position's error inside a yardage market. */
export interface PositionMaeRow { position: string; n_resolved: number; mean_absolute_error: number | null; }
export interface YardageTrackRecord {
  n_resolved: number; mean_absolute_error: number | null;
  mean_signed_error: number | null;
  /** NFL's shape: a list, with the count beside every position's error. */
  by_position?: PositionMaeRow[];
  /** CFB's shape: a bare map, with no count beside a position's error. */
  mae_by_position?: Record<string, number>;
}
export interface PlayerPropsTrackRecord {
  anytime_td: AnytimeTdTrackRecord;
  passing_yards: YardageTrackRecord;
  rushing_yards: YardageTrackRecord;
  receiving_yards: YardageTrackRecord;
  receptions?: YardageTrackRecord;
  carries?: YardageTrackRecord;
}
export interface TrackRecord {
  games: GamesTrackRecord;
  player_props: PlayerPropsTrackRecord;
  /** Home-side reliability buckets (winner/spread/total). The routes attach them at the TOP level of the response. */
  calibration?: GameCalibration;
}
/**
 * The row-level half of the track record, split out of `/track-record`.
 *
 * CFB's summary payload was 5.9 MB because `player_props.per_pick` alone
 * inlined 18,796 rows the page never renders, and `games.per_pick` added
 * another ~900. The summary response now carries tallies only; the game-pick
 * rows live here, fetched only when the reader opens the every-pick fold.
 * Prop per-pick rows are not served at all: no surface renders them.
 */
export interface TrackRecordPicks {
  per_pick: PerPickRow[];
}
/**
 * `GET /prop-grading` — every counted player projection graded against the
 * box score, NBA's prop grading ported to this site. The grade judges the
 * model in units of the stat's own holdout MAE (On the number ≤ ½×, Close
 * ≤ 1×, Off ≤ 2×, Way off beyond); `grade: null` means the backend holds no
 * honest holdout MAE for the stat, so the row carries its delta chip only.
 * The delta is actual − projected and follows the PLAYER: positive when he
 * beat the projection. `stats` carries the errors the grades were cut from
 * (null where the backend has none to state).
 */
export type PropGrade = "On the number" | "Close" | "Off" | "Way off";
export interface PropGradingRow {
  player: string;
  team: string;
  opponent: string;
  stat: string;
  projected: number;
  actual: number;
  delta: number;
  grade: PropGrade | null;
  made_before_kickoff: boolean;
  kickoff: string;
}
export interface PropGradingGame {
  game_id: string;
  label: string;
  rows: PropGradingRow[];
}
export interface PropGradingDay {
  date: string;
  most_confident: PropGradingRow[];
  biggest_surprises: PropGradingRow[];
  games: PropGradingGame[];
}
export interface PropGrading {
  generated_at: string;
  stats: Record<string, { holdout_mae: number | null; naive_mae: number | null }>;
  days: PropGradingDay[];
}
export interface RetrainResponse { trained_at: string; chosen_candidate: string; }
export interface MarketVerdict { hit: boolean; predicted: string; actual?: string; }
export interface GameVerdict { game_id: string; resolved: boolean; moneyline: MarketVerdict; ats: MarketVerdict | null; totals: MarketVerdict | null; actual_home_score?: number; actual_away_score?: number; home_spread_line?: number | null; total_line?: number | null; }
export type WeekPredictionStatus = "untracked" | "pending" | "resolved";
// rebuilt: snapshotted at or after kickoff (a backfill), so shown but never
// counted as a pre-kickoff call. Absent from older API builds.
export interface WeekPrediction { game_id: string; status: WeekPredictionStatus; rebuilt?: boolean; home_win_prob?: number; away_win_prob?: number; verdict: GameVerdict | null; }
export interface CurrentWeek { season: number; week: number; }
// NFL groups by division (current_division_rank/...), CFB has no fixed
// divisions and groups by conference alone (current_conference_rank/...) --
// a row only ever has one set of rank fields populated, matching whichever
// sport it came from.
export interface StandingsEntry {
  team: string;
  conference: string | null;
  division?: string | null;
  played: number;
  wins: number;
  losses: number;
  ties: number;
  point_diff: number;
  projected_wins: number;
  projected_losses: number;
  projected_point_diff: number;
  current_division_rank?: number;
  projected_division_rank?: number;
  division_rank_delta?: number;
  current_conference_rank?: number;
  projected_conference_rank?: number;
  conference_rank_delta?: number;
}
export interface TeamRanking {
  team: string;
  rating: number;
  rank: number;
  wins: number;
  losses: number;
  ties: number;
  recent_form?: string | null;
  conference?: string | null;
  division?: string | null;
}
export interface PowerRankingsResponse {
  season: number;
  rankings: TeamRanking[];
}
export interface FormEntry {
  game_id: string;
  opponent: string;
  is_home: boolean;
  result: "W" | "L" | "T";
  team_score: number;
  opponent_score: number;
  gameday: string;
}
export interface TeamForm {
  team: string;
  recent_form: FormEntry[];
}
export interface HeadToHeadMeeting {
  game_id: string;
  season: number;
  gameday: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
}
export interface HeadToHead {
  game_id: string;
  meetings: HeadToHeadMeeting[];
}
// Data Hub season tables (/hub/teams, /hub/players). Per-game and rate
// fields are null when a team or player has no games yet, or when the
// advanced feed is down: the UI shows a dash, never a zero.
export interface HubRecentGame {
  gameday: string;
  opponent: string;
  is_home: boolean;
  team_score: number;
  opponent_score: number;
  result: "W" | "L" | "T";
}
export interface HubTeam {
  team: string;
  games: number;
  wins: number;
  losses: number;
  ties: number;
  points_for_pg: number | null;
  points_against_pg: number | null;
  off_epa_play: number | null;
  def_epa_play: number | null;
  off_success_rate: number | null;
  def_success_rate: number | null;
  yards_per_play: number | null;
  pass_rate: number | null;
  turnover_margin: number | null;
  streak: number;
  /** Oldest first, last five. */
  form: ("W" | "L" | "T")[];
  form_trend: "up" | "down" | "steady" | "new";
  /** Newest first, last five. */
  recent_games: HubRecentGame[];
}
export interface HubTeamsResponse {
  season: number;
  teams: HubTeam[];
  /** CFB only: false while the advanced feed is unavailable. */
  advanced_available?: boolean;
}
export interface HubPlayer {
  player_id: string;
  name: string;
  team: string;
  position: string;
  games: number;
  completions: number;
  attempts: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  receptions: number;
  targets: number;
  receiving_yards: number;
  receiving_tds: number;
  /** NFL: EPA summed over the season. CFB: PPA, the same idea. */
  epa_total: number | null;
  target_share: number | null;
  air_yards_share: number | null;
  fantasy_ppr_pg: number | null;
}
export interface HubPlayersResponse {
  season: number;
  players: HubPlayer[];
  leaderboards: Record<string, HubPlayer[]>;
}
export interface SportApi {
  games: (season: number, week: number) => Promise<GameSummary[]>;
  gamePrediction: (season: number, week: number, gameId: string) => Promise<GamePrediction>;
  playerProps: (season: number, week: number) => Promise<PlayerPropPrediction[]>;
  /** NFL only. CFB has no such route and must never call this -- a 404 there is
   *  a missing feed, not an empty list. Resolves to `[]` on an unreadable feed
   *  is the backend's contract; this client does not convert a failure into an
   *  empty list, so a rejected promise stays a rejection the caller can word. */
  playerOut: (season: number, week: number) => Promise<OutPlayerEntry[]>;
  /** NFL only: Kalshi's live per-player ladders (fail-soft on the backend; absent on CFB). */
  marketLines?: (season: number, week: number) => Promise<{ fetched_at: string | null; lines: import("./lib/lineCheck").MarketLine[] }>;
  trackRecord: () => Promise<TrackRecord>;
  /** `GET /track-record/picks` — the row-level game picks, fetched lazily by
   *  the track record page (see TrackRecordPicks). Optional because a backend
   *  older than the payload split does not serve the route: it inlines
   *  `games.per_pick` in `/track-record` instead, and the page reads it from
   *  there and never calls this. */
  trackRecordPicks?: () => Promise<TrackRecordPicks>;
  /** `GET /prop-grading` — counted player projections graded against the box
   *  score (see PropGrading). Optional because the route is newer than this
   *  frontend: a backend that does not serve it yet 404s, and the grading
   *  panel treats any failure — or a payload with no days — as absence and
   *  renders nothing at all. */
  propGrading?: () => Promise<PropGrading>;
  retrain: () => Promise<RetrainResponse>;
  gameVerdict: (gameId: string) => Promise<GameVerdict | null>;
  predictionsForWeek: (season: number, week: number) => Promise<WeekPrediction[]>;
  currentWeek: () => Promise<CurrentWeek>;
  standings: (season: number) => Promise<StandingsEntry[]>;
  powerRankings: (season: number) => Promise<PowerRankingsResponse>;
  predictionsBatch: (season: number, week: number) => Promise<Record<string, GamePrediction>>;
  teamForm: (team: string, season: number, n?: number) => Promise<TeamForm>;
  headToHead: (gameId: string, season: number, week: number, nSeasons?: number) => Promise<HeadToHead>;
  hubTeams: (season: number) => Promise<HubTeamsResponse>;
  hubPlayers: (season: number) => Promise<HubPlayersResponse>;
  /** `GET /signals/{game_id}` — spec §3's signal payloads for one fixture.
   *
   *  Optional because the two sports differ and this is one factory. CFB serves
   *  the route; NFL does not, and has no market that clears the floor to justify
   *  one (49 graded rows, every band under `n = 30`). A sport with no feed is
   *  therefore a missing method as well as a 404, so the modal has to tolerate
   *  both — see the "no signals endpoint at all" test. */
  signals?: (gameId: string) => Promise<SignalsResponse>;
}

/** What `GET /signals/{game_id}` answers. `signals` is empty rather than absent
 *  when the fixture has nothing honest to say — spec §2, "no data, no row". */
export interface SignalsResponse {
  signals: Signal[];
  sport?: string;
  id?: string;
}
