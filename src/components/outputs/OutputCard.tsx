import type { Output, BillStage } from "@/lib/types";
import BillProgressBar from "./BillProgressBar";

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  bill: { label: "Bill", color: "bg-purple-100 text-purple-700" },
  policy_paper: {
    label: "Policy Paper",
    color: "bg-blue-100 text-blue-700",
  },
  consultation: {
    label: "Consultation",
    color: "bg-amber-100 text-amber-700",
  },
  guidance: { label: "Guidance", color: "bg-green-100 text-green-700" },
  statutory_instrument: { label: "SI", color: "bg-red-100 text-red-700" },
  framework: { label: "Framework", color: "bg-indigo-100 text-indigo-700" },
  action_plan: {
    label: "Action Plan",
    color: "bg-teal-100 text-teal-700",
  },
  committee_report: {
    label: "Committee Report",
    color: "bg-orange-100 text-orange-700",
  },
  government_response: {
    label: "Gov Response",
    color: "bg-cyan-100 text-cyan-700",
  },
  white_paper: {
    label: "White Paper",
    color: "bg-violet-100 text-violet-700",
  },
  impact_assessment: {
    label: "Impact Assessment",
    color: "bg-gray-100 text-gray-700",
  },
};

interface OutputCardProps {
  output: Output;
  billStages?: BillStage[];
}

export default function OutputCard({ output, billStages }: OutputCardProps) {
  const badge = TYPE_BADGES[output.type] || {
    label: output.type,
    color: "bg-gray-100 text-gray-700",
  };

  return (
    <div className="bg-white rounded-lg border border-[var(--border)] p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}
            >
              {badge.label}
            </span>
            {output.status && (
              <span className="text-xs text-[var(--muted)]">
                {output.status}
              </span>
            )}
          </div>

          <a
            href={output.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors line-clamp-2"
          >
            {output.title}
            <span className="inline-block ml-1 text-[var(--muted)]">↗</span>
          </a>

          {output.description && (
            <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">
              {output.description}
            </p>
          )}

          {output.type === "bill" && billStages && billStages.length > 0 && (
            <BillProgressBar stages={billStages} />
          )}

          <div className="flex items-center gap-3 mt-2 text-xs text-[var(--muted)]">
            {output.department && <span>{output.department}</span>}
            {output.publishedDate && (
              <span>
                {new Date(output.publishedDate).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            )}
          </div>
        </div>

        {(output.mediaArticleCount ?? 0) > 0 && (
          <div className="flex items-center gap-1 shrink-0">
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                (output.recentMediaCount ?? 0) > 0
                  ? "bg-orange-100 text-orange-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {output.mediaArticleCount} article
              {output.mediaArticleCount !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
