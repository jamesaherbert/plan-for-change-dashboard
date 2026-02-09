"use client";

import { useState } from "react";

interface CollapsibleProps {
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export default function Collapsible({
  title,
  count,
  defaultOpen = false,
  children,
}: CollapsibleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="bg-white rounded-xl border border-[var(--border)]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-5 text-left"
      >
        <h3 className="text-base font-semibold text-[var(--foreground)]">
          {title}
          {count !== undefined && (
            <span className="ml-2 text-sm font-normal text-[var(--muted)]">
              ({count})
            </span>
          )}
        </h3>
        <span
          className={`text-[var(--muted)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          ▾
        </span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}
