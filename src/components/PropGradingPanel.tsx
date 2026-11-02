import { useEffect, useState } from "react";
import { useSport } from "../context/SportContext";
import { RecordBlock } from "../predictor-ui";
import type { PropGrading, PropGradingDay, PropGradingRow } from "../types";

const STAT_LABELS: Record<string, string> = {
  passing_yards: "Passing yards",
  rushing_yards: "Rushing yards",
  receiving_yards: "Receiving yards",
  receptions: "Receptions",
  carries: "Carries",
  anytime_td: "Anytime TD",
};

/**
 * Prop grading: how close each counted player projection landed, graded
 * against the box score — NBA's panel, ported to this site's record page so
 * both football sports read exactly the same way.
 *
 * Three reads of the same graded rows, all computed by the backend from the
 * recorded predictions and outcomes (the earliest recorded projection per
 * player and stat — the line the track record counts):
 *
 * * **Most confident** — the model's biggest calls, each shown with the
 *   grade it earned after the fact.
 * * **Biggest surprises** — the largest misses in both directions.
 * * **Every graded line**, game by game.
 *
 * The delta is actual minus projected, and the chip follows the PLAYER:
 * ▲ when he beat the projection, ▼ when he fell short. The grade judges the
 * model instead, in units of its own holdout error for the stat; a row with
 * no grade chip has no honest holdout error recorded for its stat, so it
 * carries the delta only. A row that cannot prove it was made before
 * kickoff is graded and labelled, never dropped; the day's two counts sit
 * side by side in its header so the headline cannot quietly become the
 * subset.
 *
 * Absence is graceful by design: the `/prop-grading` route is newer than
 * this frontend, so a 404, any request failure, or a payload with no days
 * renders NOTHING — no empty-state box, no error banner. The panel exists
 * on the page only when there are grades to show.
 */
export default function PropGradingPanel() {
  const { api, sport } = useSport();
  const [grading, setGrading] = useState<PropGrading | null>(null);

  useEffect(() => {
    setGrading(null);
    if (!api.propGrading) return;
    let live = true;
    api
      .propGrading()
      .then((d) => {
        if (live) setGrading(d && Array.isArray(d.days) && d.days.length > 0 ? d : null);
      })
      .catch(() => {
        if (live) setGrading(null);
      });
    return () => {
      live = false;
    };
  }, [api, sport]);

  if (!grading) return null;

  return (
    <RecordBlock
      id="tr-prop-grading"
      title="Prop grading"
      caption="Graded from the recorded projections: the earliest recorded projection per player and stat — the line the track record counts. Grades judge the model, not the player: the miss measured in units of the model's own holdout error for the stat (On the number within half, Close within one, Off within two, Way off beyond). A line with no grade has no honest holdout error recorded for its stat."
    >
      <div className="flex flex-col gap-8">
        {grading.days.map((day) => (
          <GradingDay key={day.date} day={day} />
        ))}
      </div>
    </RecordBlock>
  );
}

function GradingDay({ day }: { day: PropGradingDay }) {
  const rows = day.games.flatMap((g) => g.rows);
  const nPreKickoff = rows.filter((r) => r.made_before_kickoff).length;
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h4 className="font-pr-display text-base font-semibold uppercase tracking-wide text-pr-text">{day.date}</h4>
        {rows.length > 0 && (
          <p className="mt-1 text-sm text-pr-text-dim">
            <span className="tabular-nums">{rows.length}</span> player lines graded {"\u00b7"}{" "}
            <span className="tabular-nums">{nPreKickoff}</span> made before kickoff
          </p>
        )}
      </header>

      <section aria-labelledby={`prop-grading-confident-${day.date}`}>
        <h5
          id={`prop-grading-confident-${day.date}`}
          className="mb-3 font-pr-display text-sm font-semibold uppercase tracking-wide text-pr-text"
        >
          Most confident
        </h5>
        <GradedList rows={day.most_confident} />
      </section>

      <section aria-labelledby={`prop-grading-surprises-${day.date}`}>
        <h5
          id={`prop-grading-surprises-${day.date}`}
          className="mb-3 font-pr-display text-sm font-semibold uppercase tracking-wide text-pr-text"
        >
          Biggest surprises
        </h5>
        <GradedList rows={day.biggest_surprises} />
      </section>

      <section aria-labelledby={`prop-grading-games-${day.date}`}>
        <h5
          id={`prop-grading-games-${day.date}`}
          className="mb-3 font-pr-display text-sm font-semibold uppercase tracking-wide text-pr-text"
        >
          Every graded line {"\u00b7"} {day.date}
        </h5>
        <div className="flex flex-col gap-6">
          {day.games.map((game) => (
            <div key={game.game_id}>
              <h6 className="mb-2 text-sm font-semibold text-pr-text-dim">{game.label}</h6>
              <GradedList rows={game.rows} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function GradedList({ rows }: { rows: PropGradingRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-pr-text-faint">None.</p>;
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {rows.map((row) => (
        <li
          key={`${row.player}-${row.stat}-${row.kickoff}`}
          className="flex items-center gap-3 rounded-pr border border-pr-rule bg-pr-panel px-3 py-2"
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-pr-text">
              {row.player}
              {!row.made_before_kickoff && (
                <span className="ml-2 text-xs font-normal uppercase tracking-wide text-pr-lean">
                  Made after kickoff
                </span>
              )}
            </span>
            <span className="block text-sm text-pr-text-dim">
              Proj {row.projected.toFixed(1)} {"\u2192"} {row.actual} actual {"\u00b7"} {statLabel(row.stat)} {"\u00b7"}{" "}
              {row.team} vs {row.opponent}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <DeltaChip delta={row.delta} />
            {row.grade !== null && (
              <span className="rounded-sm border border-pr-rule px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-pr-text-dim">
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
    return <span className="text-sm font-semibold tabular-nums text-pr-text-dim">0.0 vs proj</span>;
  const beat = delta > 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${beat ? "text-pr-win" : "text-pr-loss"}`}>
      {beat ? "\u25b2" : "\u25bc"} {beat ? "+" : "\u2212"}
      {Math.abs(delta).toFixed(1)} vs proj
    </span>
  );
}

function statLabel(stat: string): string {
  return STAT_LABELS[stat] ?? stat;
}
