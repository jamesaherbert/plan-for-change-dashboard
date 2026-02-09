"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
      <h2 className="text-2xl font-bold text-[var(--foreground)] mb-2">
        Something went wrong
      </h2>
      <p className="text-sm text-[var(--muted)] mb-6">
        An error occurred while loading this page.
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-lg hover:opacity-90 transition-opacity"
      >
        Try again
      </button>
    </div>
  );
}
