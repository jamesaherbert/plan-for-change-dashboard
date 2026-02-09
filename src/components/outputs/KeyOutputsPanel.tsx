"use client";

import type { Output, BillStage, MediaArticle } from "@/lib/types";
import KeyOutputCard from "./KeyOutputCard";

interface KeyOutputsPanelProps {
  outputs: Output[];
  billStagesMap: Map<string, BillStage[]>;
  latestArticlesMap: Map<string, MediaArticle>;
}

export default function KeyOutputsPanel({
  outputs,
  billStagesMap,
  latestArticlesMap,
}: KeyOutputsPanelProps) {
  if (outputs.length === 0) return null;

  // Split into enacted (Royal Assent bills, published key papers) and in-progress
  const enacted: Output[] = [];
  const inProgress: Output[] = [];

  for (const output of outputs) {
    const stages = billStagesMap.get(output.id);
    const hasRoyalAssent = stages?.some(
      (s) => s.name.toLowerCase().includes("royal assent") && s.completed
    );

    if (hasRoyalAssent) {
      enacted.push(output);
    } else {
      inProgress.push(output);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-[var(--border)] p-5">
      <h3 className="text-base font-semibold text-[var(--foreground)] mb-1">
        Key Outputs
      </h3>
      <p className="text-xs text-[var(--muted)] mb-4">
        The most significant government actions for this milestone, scored by
        type, legislative progress, and media coverage.
      </p>

      {enacted.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-green-700 mb-2">
            Enacted
          </h4>
          <div className="space-y-2">
            {enacted.map((output) => (
              <KeyOutputCard
                key={output.id}
                output={output}
                billStages={billStagesMap.get(output.id)}
                latestArticle={latestArticlesMap.get(output.id)}
              />
            ))}
          </div>
        </div>
      )}

      {inProgress.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-700 mb-2">
            In Progress
          </h4>
          <div className="space-y-2">
            {inProgress.map((output) => (
              <KeyOutputCard
                key={output.id}
                output={output}
                billStages={billStagesMap.get(output.id)}
                latestArticle={latestArticlesMap.get(output.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
