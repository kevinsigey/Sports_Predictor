import { useEffect, useState } from "react";
import { useSport } from "../context/SportContext";
import { RecordBlock } from "../predictor-ui";
import type { PropGrading } from "../types";
import {
  aggregatePropsByStat,
  dailyPropMae,
  propBiasText,
  statLabel,
  statUnit,
  type PropStatAggregate,
} from "../lib/propGrading";
import { plural, rate } from "../lib/trackFormat";

/**
 * Player prop model tracking: how good the model is at predicting player
 * outcomes, aggregated from the graded lines themselves.
 *
 * The per-line grades moved into each fixture's detail — a line means
 * something next to its match, and on this page it scrolled past without
 * one. What the record keeps is what the lines add up to, per stat: how
 * many counted lines, the mean miss (MAE), which way the misses lean, and —
 * where the backend records an honest holdout error to grade against — how
 * the grades distribute over the four bands. A per-day MAE trend closes the
 * block, so the tracking reads as form over time, not one static number.
 *
 * The population is the record's: the counted lines — the earliest recorded
 * projection per player and stat, made before kickoff — and only those.
 * Lines made after kickoff are excluded here (they are labelled in their
 * fixture instead), and the day's highlight lists are never read: they are
 * subsets of the same rows, and reading them would count them twice. The
 * arithmetic lives in `lib/propGrading.ts`; this component only renders it.
 *
 * A stat whose backend records no holdout error (today: CFB) is tracked in
 * full — count, MAE, bias — with NO band bar and no within-holdout figure:
 * there is no honest scale to grade it on, and a bar of nothing would be a
 * measurement the tracker never made.
 *
 * Absence is graceful by design, as it was for the panel before it: the
 * `/prop-grading` route is newer than this frontend, so a 404, any request
 * failure, or a payload with no counted lines renders NOTHING.
 */
export default function PropModelTracking() {
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
  const stats = aggregatePropsByStat(grading);
  if (stats.length === 0) return null;
  const days = dailyPropMae(grading);

  return (
    <RecordBlock
      id="tr-prop-model"
      title="Player prop model"
      caption="How close the model's player projections land, tracked from the graded lines: the earliest recorded projection per player and stat, made before kickoff — the counted lines, and only those. Each miss is graded in units of the model's own holdout error for the stat where one is recorded; the line-by-line grades live in each fixture's detail."
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((agg) => (
          <PropStatCard key={agg.stat} agg={agg} />
        ))}
      </div>
      {days.length > 1 && <PropMaeTrend days={days} />}
    </RecordBlock>
  );
}

function PropStatCard({ agg }: { agg: PropStatAggregate }) {
  const unit = statUnit(agg.stat);
  const gradedLines = plural(agg.n, "graded line");
  return (
    <div
      className="flex flex-col gap-1.5 rounded-pr border border-pr-rule bg-pr-panel p-4"
      data-testid={`prop-stat-${agg.stat}`}
    >
      <span className="text-xs font-semibold uppercase tracking-wide text-pr-text-dim">
        {statLabel(agg.stat)}
      </span>
      {agg.withinHoldout != null ? (
        <>
          <span className="font-pr-display text-2xl font-semibold text-pr-text">{rate(agg.withinHoldout)}</span>
          <span className="tr-bar" aria-hidden="true">
            <span className="tr-bar-fill" style={{ width: `${Math.round(agg.withinHoldout * 100)}%` }} />
            <span className="tr-bar-marker" />
          </span>
          <span className="text-xs text-pr-text-faint">within one holdout error · {gradedLines}</span>
        </>
      ) : (
        <>
          <span className="font-pr-display text-2xl font-semibold text-pr-text">
            {agg.mae.toFixed(1)}
            {unit && <span className="text-base font-medium text-pr-text-dim"> {unit}</span>}
          </span>
          <span className="text-xs text-pr-text-faint">mean miss · {gradedLines}</span>
        </>
      )}
      <span className="text-sm text-pr-text-dim">
        MAE {agg.mae.toFixed(1)}
        {unit ? ` ${unit}` : ""}
        {agg.holdoutMae != null && (
          <>
            {" · "}holdout {agg.holdoutMae.toFixed(1)}
            {unit ? ` ${unit}` : ""}
          </>
        )}
      </span>
      <span className="text-sm text-pr-text-dim">{propBiasText(agg.bias, unit)}</span>
      {agg.bands && (
        <>
          <span className="tr-bandbar mt-1" data-testid={`prop-bandbar-${agg.stat}`} aria-hidden="true">
            {agg.bands.map((band, i) => (
              <span
                key={band.grade}
                className={`tr-bandbar-seg tr-band-${i}`}
                style={{ width: `${band.pct * 100}%` }}
              />
            ))}
          </span>
          <span className="text-xs text-pr-text-faint">
            {agg.bands.map((band) => `${band.grade} ${rate(band.pct)} (${band.n})`).join(" · ")}
          </span>
        </>
      )}
    </div>
  );
}

/** The mean miss by day, oldest first: bars for shape, the figures printed
 *  above (the day's MAE) and below (the day, and the lines behind it). */
function PropMaeTrend({ days }: { days: ReturnType<typeof dailyPropMae> }) {
  const max = Math.max(...days.map((d) => d.mae));
  return (
    <div data-testid="prop-mae-trend">
      <h4 className="mb-2 text-sm font-semibold text-pr-text">Mean miss by day</h4>
      <div className="flex gap-2">
        {days.map((day) => (
          <div key={day.date} className="flex min-w-0 flex-1 flex-col items-center gap-1" data-testid="prop-trend-day">
            <span className="text-xs font-semibold tabular-nums text-pr-text">{day.mae.toFixed(1)}</span>
            <span className="tr-trend-track">
              <span
                className="tr-trend-bar"
                style={{ height: `${max > 0 ? Math.max(4, (day.mae / max) * 100) : 0}%` }}
              />
            </span>
            <span className="text-xs text-pr-text-dim">{dayLabel(day.date)}</span>
            <span className="text-xs text-pr-text-faint">{plural(day.n, "line")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "2026-11-01" as "Nov 1", read at midday UTC so no timezone moves the day. */
function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
