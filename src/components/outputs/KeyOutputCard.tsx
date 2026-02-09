import type { Output, BillStage, MediaArticle } from "@/lib/types";
import BillProgressBar from "./BillProgressBar";

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  bill: { label: "Bill", color: "bg-purple-100 text-purple-700" },
  policy_paper: { label: "Policy Paper", color: "bg-blue-100 text-blue-700" },
  white_paper: { label: "White Paper", color: "bg-violet-100 text-violet-700" },
  consultation: { label: "Consultation", color: "bg-amber-100 text-amber-700" },
  framework: { label: "Framework", color: "bg-indigo-100 text-indigo-700" },
  action_plan: { label: "Action Plan", color: "bg-teal-100 text-teal-700" },
  government_response: { label: "Gov Response", color: "bg-cyan-100 text-cyan-700" },
  committee_report: { label: "Committee Report", color: "bg-orange-100 text-orange-700" },
};

interface KeyOutputCardProps {
  output: Output;
  billStages?: BillStage[];
  latestArticle?: MediaArticle;
}

export default function KeyOutputCard({
  output,
  billStages,
  latestArticle,
}: KeyOutputCardProps) {
  const badge = TYPE_BADGES[output.type] || {
    label: output.type,
    color: "bg-gray-100 text-gray-700",
  };

  return (
    <div className="bg-white rounded-lg border border-[var(--border)] p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}
            >
              {badge.label}
            </span>
            {output.department && (
              <span className="text-xs text-[var(--muted)]">
                {output.department}
              </span>
            )}
          </div>

          <a
            href={output.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold text-[var(--foreground)] hover:text-[var(--accent)] transition-colors line-clamp-2"
          >
            {output.title}
            <span className="inline-block ml-1 text-[var(--muted)]">↗</span>
          </a>

          {output.rationale && (
            <p className="text-sm text-[var(--muted)] mt-1 italic">
              {output.rationale}
            </p>
          )}

          {output.type === "bill" && billStages && billStages.length > 0 && (
            <BillProgressBar stages={billStages} />
          )}

          {latestArticle && (
            <a
              href={latestArticle.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 mt-2 text-xs text-[var(--accent)] hover:underline"
            >
              <span className="shrink-0">📰</span>
              <span className="line-clamp-1">{latestArticle.title}</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
