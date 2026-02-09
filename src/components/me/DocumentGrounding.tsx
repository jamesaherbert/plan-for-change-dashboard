import type { MEFramework } from "@/lib/types";

interface DocumentGroundingProps {
  framework: MEFramework;
  latestKpiValue?: number;
}

export default function DocumentGrounding({
  framework,
  latestKpiValue,
}: DocumentGroundingProps) {
  const baseline = framework.baseline;
  const target = framework.target;
  const trajectory = framework.requiredTrajectory;

  return (
    <div className="bg-white rounded-xl border border-[var(--border)] p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            Plan for Change
          </h3>
          <p className="text-xs text-[var(--muted)]">
            Mission: {framework.mission}
          </p>
        </div>
        <span className="text-xs text-[var(--muted)] bg-gray-50 px-2 py-1 rounded">
          {framework.documentSource}
        </span>
      </div>

      {/* Baseline → Target */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div className="bg-gray-50 rounded-lg p-3">
          <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-1">
            Starting Point
          </div>
          <p className="text-sm text-[var(--foreground)]">
            {baseline.description}
          </p>
          {baseline.metrics.map((metric, i) => (
            <div key={i} className="mt-1.5">
              {metric.value !== null && (
                <span className="text-lg font-bold text-[var(--foreground)]">
                  {formatMetricValue(metric.value, metric.unit)}
                </span>
              )}
              <span className="text-xs text-[var(--muted)] ml-1">
                {metric.label} ({baseline.date})
              </span>
            </div>
          ))}
        </div>

        <div className="bg-blue-50 rounded-lg p-3">
          <div className="text-xs font-medium text-blue-600 uppercase tracking-wide mb-1">
            Target
          </div>
          <p className="text-sm text-[var(--foreground)]">
            {target.description}
          </p>
          <div className="mt-1.5">
            {target.value !== null && (
              <span className="text-lg font-bold text-blue-700">
                {formatMetricValue(target.value, target.unit)}
              </span>
            )}
            <span className="text-xs text-[var(--muted)] ml-1">
              by {target.date}
            </span>
          </div>
        </div>
      </div>

      {/* Required Trajectory */}
      <div className="bg-amber-50 rounded-lg p-3 mb-4">
        <div className="text-xs font-medium text-amber-700 uppercase tracking-wide mb-1">
          Required Trajectory
        </div>
        <p className="text-sm text-[var(--foreground)]">
          {trajectory.description}
        </p>
        {trajectory.note && (
          <p className="text-xs text-[var(--muted)] mt-1">
            {trajectory.note}
          </p>
        )}
      </div>

      {/* Theory of Change + Pillars */}
      <div>
        <div className="text-xs font-medium text-[var(--muted)] uppercase tracking-wide mb-2">
          Theory of Change
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {framework.pillars.map((pillar) => (
            <span
              key={pillar}
              className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700"
            >
              {pillar}
            </span>
          ))}
        </div>
        <p className="text-sm text-[var(--muted)] leading-relaxed">
          {framework.theoryOfChange}
        </p>
      </div>
    </div>
  );
}

function formatMetricValue(value: number, unit: string): string {
  if (unit === "%" || unit === "% clean power") {
    return `${value.toFixed(1)}%`;
  }
  if (unit === "homes" || unit === "patients" || unit === "children") {
    if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
    if (value >= 1000) return `${Math.round(value / 1000).toLocaleString()}k`;
    return value.toLocaleString();
  }
  if (unit === "additional officers" || unit === "officers") {
    return Math.round(value).toLocaleString();
  }
  return value.toLocaleString();
}
