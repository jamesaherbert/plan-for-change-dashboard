import type { MediaArticle } from "@/lib/types";

interface ArticleCardProps {
  article: MediaArticle;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  return (
    <div className="flex gap-3 py-3 border-b border-[var(--border)] last:border-0">
      {article.thumbnailUrl && (
        <img
          src={article.thumbnailUrl}
          alt=""
          className="w-16 h-16 rounded object-cover shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors line-clamp-2"
        >
          {article.title}
        </a>
        {article.excerpt && (
          <p className="text-xs text-[var(--muted)] mt-1 line-clamp-2">
            {article.excerpt}
          </p>
        )}
        <div className="flex items-center gap-2 mt-1 text-xs text-[var(--muted)]">
          <span className="font-medium">{article.source}</span>
          <span>
            {new Date(article.publishedDate).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
