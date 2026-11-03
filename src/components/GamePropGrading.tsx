import type { PropGrading, PropGradingRow } from "../types";
import { findGradedGame, gameSurprises, groupRowsByPlayer, statLabel } from "../lib/propGrading";

/**
 * Prop grading inside the fixture: this game's counted player projections,
 * graded against its own box score.
 *
 * The per-line grades live HERE, with the match they came from — on the
 * track record page they scrolled past without the game around them, which
 * made them useless; the record side keeps only the aggregates the lines
 * add up to. The rows are the backend's counted projection per player and
 * stat (the earliest recorded — the line the track record counts), matched
 * to this fixture by its own `game_id` out of the `/prop-grading` payload.
 *
 * The delta is actual minus projected, and the chip follows the PLAYER:
 * ▲ when he beat the projection, ▼ when he fell short. The grade judges
 * the model instead, in units of its own holdout error for the stat; a row
 * with no grade chip has no honest holdout error recorded for its stat, so
 * it carries the delta only. A row that cannot prove it was made before
 * kickoff is graded and labelled ("Made after kickoff"), never dropped.
 *
 * Absence is graceful by design: no payload yet, a payload that does not
 * carry this game, or a game with no graded lines renders NOTHING — no
 * placeholder, no error. The modal asks only for finals, so an unplayed
 * fixture never reaches the fetch at all.
 */
export default function GamePropGrading({
  grading,
  gameId,
}: {
  grading: PropGrading | null;
  gameId: string;
}) {
  const found = grading ? findGradedGame(grading, gameId) : null;
  if (!found || found.game.rows.length === 0) return null;
  const { game } = found;
  const surprises = gameSurprises(game.rows, 3);
  const byPlayer = groupRowsByPlayer(game.rows);

  return (
    <section aria-label="Prop grading" data-testid="game-prop-grading">
      <div className="mb-2">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-sp-text-faint">
          Prop grading
        </h3>
        <p className="text-sm text-sp-text-dim">
          This game&apos;s player projections, graded against the box score. Grades judge the model,
          in units of its own holdout error for the stat.
        </p>
      </div>

      {/* The game's own biggest misses first — both directions, since a
          beat and a shortfall are both surprises — when the game has more
          lines than the surprise list holds. With three or fewer there is
          nothing to surface: the full list below IS the surprises. */}
      {game.rows.length > surprises.length && (
        <div className="mb-4">
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-sp-text-faint">
            Biggest surprises
          </h4>
          <GradedList rows={surprises} />
        </div>
      )}

      <div className="flex flex-col gap-4">
        {byPlayer.map(({ player, rows }) => (
          <div key={player}>
            <h4 className="mb-2 text-sm font-semibold text-sp-text">{player}</h4>
            <GradedList rows={rows} />
          </div>
        ))}
      </div>
    </section>
  );
}

function GradedList({ rows }: { rows: PropGradingRow[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li
          key={`${row.player}-${row.stat}-${row.kickoff}`}
          className="flex items-center gap-3 rounded-lg border border-sp-border/40 bg-sp-850/40 px-3 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-sp-text">
              {row.player}
              {!row.made_before_kickoff && (
                <span className="ml-2 text-[12px] font-normal uppercase tracking-wide text-pr-lean">
                  Made after kickoff
                </span>
              )}
            </span>
            <span className="block text-sm text-sp-text-dim">
              Proj {row.projected.toFixed(1)} {"\u2192"} {row.actual} actual {"\u00b7"} {statLabel(row.stat)} {"\u00b7"}{" "}
              {row.team} vs {row.opponent}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <DeltaChip delta={row.delta} />
            {row.grade !== null && (
              <span className="rounded border border-sp-border px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-wide text-sp-text-dim">
                {row.grade}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The delta chip: direction is the player against the number. ▲ and the win
 *  colour when he beat the projection, ▼ and the loss colour when he fell
 *  short. An exact hit is neither, and says so. */
function DeltaChip({ delta }: { delta: number }) {
  if (delta === 0)
    return <span className="text-sm font-semibold tabular-nums text-sp-text-dim">0.0 vs proj</span>;
  const beat = delta > 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${beat ? "text-win" : "text-loss"}`}>
      {beat ? "\u25b2" : "\u25bc"} {beat ? "+" : "\u2212"}
      {Math.abs(delta).toFixed(1)} vs proj
    </span>
  );
}
