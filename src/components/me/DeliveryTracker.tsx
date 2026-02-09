"use client";

import { useState } from "react";
import type { MEMilestoneView, EnrichedDeliverable } from "@/lib/types";

interface DeliveryTrackerProps {
  meView: MEMilestoneView;
}

const STATUS_CONFIG = {
  delivered: {
    label: "Delivered",
    bg: "bg-green-100",
    text: "text-green-800",
    dot: "bg-green-500",
  },
  "in-progress": {
    label: "In Progress",
    bg: "bg-blue-100",
    text: "text-blue-800",
    dot: "bg-blue-500",
  },
  "not-started": {
    label: "Not Started",
    bg: "bg-gray-100",
    text: "text-gray-600",
    dot: "bg-gray-400",
  },
  "at-risk": {
    label: "At Risk",
    bg: "bg-amber-100",
    text: "text-amber-800",
    dot: "bg-amber-500",
  },
};

const EVIDENCE_CONFIG = {
  strong: { label: "Strong evidence", className: "text-green-700" },
  moderate: { label: "Moderate evidence", className: "text-blue-700" },
  weak: { label: "Weak evidence", className: "text-amber-700" },
  none: { label: "No evidence", className: "text-gray-500" },
};

export default function DeliveryTracker({ meView }: DeliveryTrackerProps) {
  const { enrichedDeliverables, deliveredCount, overallProgress } = meView;
  const total = enrichedDeliverables.length;

  return (
    <div className="bg-white rounded-xl border border-[var(--border)] p-5">
      {/* Header + Progress */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            Delivery Tracker
          </h3>
          <p className="text-xs text-[var(--muted)]">
            Government commitments from the Plan for Change
          </p>
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold text-[var(--foreground)]">
            {deliveredCount}/{total} delivered
          </span>
          {meView.atRiskCount > 0 && (
            <span className="text-xs text-amber-600 ml-2">
              {meView.atRiskCount} at risk
            </span>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2 bg-gray-100 rounded-full mb-4 overflow-hidden">
        <div className="h-full flex">
          {deliveredCount > 0 && (
            <div
              className="bg-green-500 h-full"
              style={{ width: `${(deliveredCount / total) * 100}%` }}
            />
          )}
          {meView.inProgressCount > 0 && (
            <div
              className="bg-blue-400 h-full"
              style={{
                width: `${(meView.inProgressCount / total) * 100}%`,
              }}
            />
          )}
          {meView.atRiskCount > 0 && (
            <div
              className="bg-amber-400 h-full"
              style={{ width: `${(meView.atRiskCount / total) * 100}%` }}
            />
          )}
        </div>
      </div>

      {/* Status summary */}
      <div className="flex gap-4 mb-4 text-xs">
        {deliveredCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {deliveredCount} delivered
          </span>
        )}
        {meView.inProgressCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            {meView.inProgressCount} in progress
          </span>
        )}
        {meView.atRiskCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            {meView.atRiskCount} at risk
          </span>
        )}
        {meView.notStartedCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-400" />
            {meView.notStartedCount} not started
          </span>
        )}
      </div>

      {/* Deliverable rows */}
      <div className="space-y-1">
        {enrichedDeliverables.map((deliverable) => (
          <DeliverableRow key={deliverable.id} deliverable={deliverable} />
        ))}
      </div>
    </div>
  );
}

function DeliverableRow({
  deliverable,
}: {
  deliverable: EnrichedDeliverable;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusCfg = STATUS_CONFIG[deliverable.computedStatus];
  const evidenceCfg = EVIDENCE_CONFIG[deliverable.evidenceStrength];
  const hasEvidence =
    deliverable.matchedOutputs.length > 0 ||
    deliverable.matchedMedia.length > 0;

  return (
    <div className="border border-[var(--border)] rounded-lg overflow-hidden">
      <button
        onClick={() => hasEvidence && setExpanded(!expanded)}
        className={`w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-gray-50 transition-colors ${
          hasEvidence ? "cursor-pointer" : "cursor-default"
        }`}
      >
        {/* Status badge */}
        <span
          className={`mt-0.5 shrink-0 px-2 py-0.5 rounded text-xs font-medium ${statusCfg.bg} ${statusCfg.text}`}
        >
          {statusCfg.label}
        </span>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-[var(--foreground)] font-medium">
            {deliverable.commitment}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-[var(--muted)]">
              Expected: {deliverable.expectedDate}
            </span>
            {deliverable.evidenceStrength !== "none" && (
              <span className={`text-xs ${evidenceCfg.className}`}>
                {evidenceCfg.label}
              </span>
            )}
          </div>
        </div>

        {/* Expand arrow */}
        {hasEvidence && (
          <svg
            className={`w-4 h-4 mt-1 shrink-0 text-[var(--muted)] transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 5l7 7-7 7"
            />
          </svg>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && hasEvidence && (
        <div className="px-3 pb-3 border-t border-[var(--border)] bg-gray-50">
          {deliverable.matchedOutputs.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-[var(--muted)] mb-1">
                Matched Government Outputs
              </p>
              <div className="space-y-1">
                {deliverable.matchedOutputs.map((output) => (
                  <a
                    key={output.id}
                    href={output.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs hover:underline"
                  >
                    <TypeBadge type={output.type} />
                    <span className="text-[var(--foreground)] truncate">
                      {output.title}
                    </span>
                    {output.status && (
                      <span className="text-[var(--muted)] shrink-0">
                        — {output.status}
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          )}

          {deliverable.matchedMedia.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-[var(--muted)] mb-1">
                Related Media Coverage
              </p>
              <div className="space-y-1">
                {deliverable.matchedMedia.slice(0, 3).map((article) => (
                  <a
                    key={article.id}
                    href={article.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs text-[var(--foreground)] hover:underline truncate"
                  >
                    {article.title}
                    <span className="text-[var(--muted)] ml-1">
                      — {article.source}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    bill: "Bill",
    policy_paper: "Policy",
    white_paper: "White Paper",
    consultation: "Consultation",
    guidance: "Guidance",
    framework: "Framework",
    action_plan: "Action Plan",
    government_response: "Response",
    committee_report: "Committee",
    statutory_instrument: "SI",
    impact_assessment: "IA",
  };

  return (
    <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-700">
      {labels[type] || type}
    </span>
  );
}
