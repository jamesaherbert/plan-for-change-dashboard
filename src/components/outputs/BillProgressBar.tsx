"use client";

import type { BillStage } from "@/lib/types";

interface BillProgressBarProps {
  stages: BillStage[];
}

const STANDARD_STAGES = [
  "1st reading",
  "2nd reading",
  "Committee stage",
  "Report stage",
  "3rd reading",
];

export default function BillProgressBar({ stages }: BillProgressBarProps) {
  if (stages.length === 0) return null;

  // Group stages by house
  const commonsStages = stages.filter((s) => s.house === "Commons");
  const lordsStages = stages.filter((s) => s.house === "Lords");
  const hasRoyalAssent = stages.some(
    (s) => s.name.toLowerCase().includes("royal assent") && s.completed
  );

  // Count completed standard stages per house
  const commonsCompleted = STANDARD_STAGES.filter((name) =>
    commonsStages.some(
      (s) => s.name.toLowerCase().includes(name.toLowerCase()) && s.completed
    )
  ).length;

  const lordsCompleted = STANDARD_STAGES.filter((name) =>
    lordsStages.some(
      (s) => s.name.toLowerCase().includes(name.toLowerCase()) && s.completed
    )
  ).length;

  // Total progress: 5 Commons stages + 5 Lords stages + Royal Assent = 11 steps
  const totalSteps = 11;
  const completedSteps = commonsCompleted + lordsCompleted + (hasRoyalAssent ? 1 : 0);
  const progressPct = Math.round((completedSteps / totalSteps) * 100);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-xs text-[var(--muted)] mb-1">
        <span>
          {commonsCompleted > 0 && `Commons: ${commonsCompleted}/5`}
          {commonsCompleted > 0 && lordsCompleted > 0 && " · "}
          {lordsCompleted > 0 && `Lords: ${lordsCompleted}/5`}
          {hasRoyalAssent && " · Royal Assent"}
        </span>
      </div>
      <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            hasRoyalAssent
              ? "bg-green-500"
              : progressPct > 50
                ? "bg-blue-500"
                : "bg-blue-300"
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
