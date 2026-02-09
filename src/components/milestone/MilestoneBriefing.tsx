interface MilestoneBriefingProps {
  content: string; // Paragraphs separated by \n\n
  generatedAt: string; // ISO datetime
}

const SECTION_HEADINGS = [
  "Current Status",
  "What\u2019s Needed",
  "Key Reforms",
  "Challenges",
];

export default function MilestoneBriefing({
  content,
  generatedAt,
}: MilestoneBriefingProps) {
  const paragraphs = content.split("\n\n").filter(Boolean);

  return (
    <div className="bg-white rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--foreground)]">
            AI Analysis
          </h3>
          <p className="text-xs text-[var(--muted)]">
            Generated from dashboard data
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">
          {formatDate(generatedAt)}
        </span>
      </div>
      <div className="space-y-4">
        {paragraphs.map((paragraph, index) => (
          <div key={index}>
            {index < SECTION_HEADINGS.length && (
              <h4 className="text-sm font-semibold text-[var(--foreground)] mb-1">
                {SECTION_HEADINGS[index]}
              </h4>
            )}
            <p className="text-sm text-[var(--muted)] leading-relaxed">
              {paragraph}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(isoDate: string): string {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}
