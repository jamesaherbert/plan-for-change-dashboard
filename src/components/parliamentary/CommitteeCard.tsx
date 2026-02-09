import type { CommitteeInquiry } from "@/lib/types";

interface CommitteeCardProps {
  inquiry: CommitteeInquiry;
}

export default function CommitteeCard({ inquiry }: CommitteeCardProps) {
  return (
    <div className="bg-white rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[var(--accent)]">
            {inquiry.committeeName}
          </p>
          <a
            href={inquiry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors line-clamp-2 mt-0.5"
          >
            {inquiry.inquiryTitle}
          </a>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded font-medium shrink-0 ${
            inquiry.status === "Open"
              ? "bg-green-100 text-green-700"
              : inquiry.status === "Reporting"
                ? "bg-amber-100 text-amber-700"
                : "bg-gray-100 text-gray-600"
          }`}
        >
          {inquiry.status}
        </span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--muted)]">
        <span>{inquiry.evidenceSessions} evidence sessions</span>
        <span>{inquiry.reportsPublished} reports</span>
      </div>
    </div>
  );
}
