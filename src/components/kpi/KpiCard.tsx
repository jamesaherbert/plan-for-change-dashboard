import type { Milestone, KpiSnapshot } from "@/lib/types";
import SparklineChart from "./SparklineChart";
import TrafficLight from "./TrafficLight";
import Link from "next/link";

interface KpiCardProps {
  milestone: Milestone;
  latestKpi?: KpiSnapshot;
  kpiHistory: KpiSnapshot[];
  outputCount: number;
  recentMediaCount: number;
}

/**
 * Get the appropriate subtitle to show beneath the main KPI value.
 * Some milestones have straightforward "current / target" displays,
 * while others need contextual descriptions.
 */
function getKpiSubtitle(
  milestone: Milestone,
  currentValue: number
): { subtitle: string; showTrafficLight: boolean } {
  switch (milestone.slug) {
    case "policing":
      // Value is total workforce FTE; target is 13,000 *additional* officers
      return {
        subtitle: "total workforce (FTE)",
        showTrafficLight: false,
      };
    case "economic-growth":
      // RHDI per head index; target is "highest sustained G7 growth"
      return {
        subtitle: "RHDI per head index",
        showTrafficLight: false,
      };
    case "housing":
      // Annual net additions vs 1.5M cumulative target
      return {
        subtitle: `/yr — need ${formatValue(Math.round(milestone.targetValue / 5), "homes")}/yr`,
        showTrafficLight: true,
      };
    default:
      if (milestone.targetValue > 0) {
        return {
          subtitle: `/ ${formatValue(milestone.targetValue, milestone.targetUnit)}`,
          showTrafficLight: true,
        };
      }
      return { subtitle: "", showTrafficLight: false };
  }
}

/**
 * Compute effective ratio for traffic light.
 * Housing uses annualised rate vs required annual rate.
 */
function getEffectiveRatio(milestone: Milestone, currentValue: number): number {
  if (milestone.slug === "housing") {
    const requiredAnnual = milestone.targetValue / 5;
    return currentValue / requiredAnnual;
  }
  if (milestone.targetValue <= 0) return 0;
  return milestone.higherIsBetter
    ? currentValue / milestone.targetValue
    : milestone.targetValue / currentValue;
}

export default function KpiCard({
  milestone,
  latestKpi,
  kpiHistory,
  outputCount,
  recentMediaCount,
}: KpiCardProps) {
  const currentValue = latestKpi?.value;
  const hasData = currentValue !== undefined;
  const kpiInfo = hasData
    ? getKpiSubtitle(milestone, currentValue)
    : null;

  return (
    <Link
      href={`/milestone/${milestone.slug}`}
      className="block bg-white rounded-xl border border-[var(--border)] p-5 hover:shadow-md transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-[var(--foreground)]">
            {milestone.shortTitle}
          </h3>
          <p className="text-xs text-[var(--muted)] mt-0.5 line-clamp-1">
            {milestone.description}
          </p>
        </div>
        {hasData && kpiInfo?.showTrafficLight && (
          <TrafficLight
            current={currentValue}
            target={milestone.targetValue}
            higherIsBetter={milestone.higherIsBetter}
            effectiveRatio={getEffectiveRatio(milestone, currentValue)}
          />
        )}
      </div>

      <div className="mb-3">
        <SparklineChart data={kpiHistory} height={48} showTooltip={false} />
      </div>

      <div className="flex items-end justify-between">
        <div>
          {hasData ? (
            <>
              <span className="text-2xl font-bold text-[var(--foreground)]">
                {formatValue(currentValue, milestone.targetUnit)}
              </span>
              {kpiInfo?.subtitle && (
                <span className="text-xs text-[var(--muted)] ml-1.5">
                  {kpiInfo.subtitle}
                </span>
              )}
            </>
          ) : (
            <span className="text-sm text-[var(--muted)]">
              Awaiting data...
            </span>
          )}
        </div>
        <div className="flex gap-3 text-xs text-[var(--muted)]">
          <span>{outputCount} outputs</span>
          <span>{recentMediaCount} articles</span>
        </div>
      </div>

      {latestKpi?.label && (
        <p className="text-xs text-[var(--muted)] mt-2">
          Latest: {latestKpi.label}
        </p>
      )}
    </Link>
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
  return value.toFixed(1);
}
