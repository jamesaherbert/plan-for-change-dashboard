import type { Milestone, KpiSnapshot } from "@/lib/types";
import SparklineChart from "./SparklineChart";
import TrafficLight from "./TrafficLight";

interface KpiDetailProps {
  milestone: Milestone;
  kpiHistory: KpiSnapshot[];
}

function getTargetDescription(milestone: Milestone): string {
  switch (milestone.slug) {
    case "economic-growth":
      return `${milestone.kpiLabel} — Highest sustained growth in the G7 by ${milestone.targetDate}`;
    case "policing":
      return `${milestone.kpiLabel} — Target: 13,000 additional officers by ${milestone.targetDate}`;
    case "housing":
      return `${milestone.kpiLabel} — Target: 1.5M homes by ${milestone.targetDate} (300k/yr needed)`;
    default:
      if (milestone.targetValue > 0) {
        return `${milestone.kpiLabel} — Target: ${formatValue(milestone.targetValue, milestone.targetUnit)} by ${milestone.targetDate}`;
      }
      return milestone.kpiLabel;
  }
}

function getEffectiveRatio(milestone: Milestone, currentValue: number): number | undefined {
  if (milestone.slug === "housing") {
    const requiredAnnual = milestone.targetValue / 5;
    return currentValue / requiredAnnual;
  }
  return undefined;
}

function shouldShowTrafficLight(milestone: Milestone): boolean {
  return milestone.slug !== "policing" && milestone.slug !== "economic-growth";
}

export default function KpiDetail({ milestone, kpiHistory }: KpiDetailProps) {
  const latest = kpiHistory.length > 0 ? kpiHistory[kpiHistory.length - 1] : null;
  const hasData = latest !== null;

  return (
    <div className="bg-white rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            {milestone.title}
          </h2>
          <p className="text-sm text-[var(--muted)] mt-0.5">
            {getTargetDescription(milestone)}
          </p>
        </div>
        {hasData && shouldShowTrafficLight(milestone) && (
          <TrafficLight
            current={latest.value}
            target={milestone.targetValue}
            higherIsBetter={milestone.higherIsBetter}
            effectiveRatio={getEffectiveRatio(milestone, latest.value)}
          />
        )}
      </div>

      <div className="mb-4">
        <SparklineChart data={kpiHistory} height={100} showTooltip />
      </div>

      <div className="flex items-end justify-between">
        {hasData ? (
          <div>
            <span className="text-3xl font-bold text-[var(--foreground)]">
              {formatValue(latest.value, milestone.targetUnit)}
            </span>
            {milestone.targetValue > 0 && milestone.slug !== "policing" && (
              <span className="text-sm text-[var(--muted)] ml-2">
                / {formatValue(milestone.targetValue, milestone.targetUnit)} target
              </span>
            )}
            {milestone.slug === "policing" && (
              <span className="text-sm text-[var(--muted)] ml-2">
                total workforce (FTE)
              </span>
            )}
            <p className="text-xs text-[var(--muted)] mt-1">
              Latest data: {latest.label || latest.date}
            </p>
          </div>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No KPI data yet. Run the data refresh script to fetch latest figures.
          </p>
        )}
      </div>
    </div>
  );
}

function formatValue(value: number, unit: string): string {
  if (unit === "%" || unit === "% clean power") {
    return `${value.toFixed(1)}%`;
  }
  if (unit === "homes") {
    return value >= 1000000
      ? `${(value / 1000000).toFixed(1)}M`
      : value >= 1000
        ? `${Math.round(value / 1000)}k`
        : value.toString();
  }
  if (unit === "additional officers") {
    return Math.round(value).toLocaleString();
  }
  if (unit === "index") {
    return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString();
}
