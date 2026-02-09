import type { Debate } from "@/lib/types";

interface DebateItemProps {
  debate: Debate;
}

export default function DebateItem({ debate }: DebateItemProps) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-[var(--muted)] shrink-0 w-20">
        {new Date(debate.date).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })}
      </span>
      <div className="flex-1 min-w-0">
        <a
          href={debate.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--foreground)] hover:text-[var(--accent)] transition-colors line-clamp-1"
        >
          {debate.title}
        </a>
        <span className="text-xs text-[var(--muted)] ml-2">{debate.house}</span>
      </div>
    </div>
  );
}
