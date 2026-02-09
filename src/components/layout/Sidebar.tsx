"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

const milestones = [
  { slug: "economic-growth", shortTitle: "Growth", icon: "📈" },
  { slug: "housing", shortTitle: "Housing", icon: "🏠" },
  { slug: "nhs", shortTitle: "NHS", icon: "🏥" },
  { slug: "policing", shortTitle: "Policing", icon: "👮" },
  { slug: "education", shortTitle: "Education", icon: "📚" },
  { slug: "clean-energy", shortTitle: "Energy", icon: "⚡" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close mobile menu on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const navContent = (
    <>
      <div className="p-5 border-b border-[var(--border)]">
        <Link href="/" className="block">
          <h1 className="text-lg font-bold text-[var(--foreground)]">
            Plan for Change
          </h1>
          <p className="text-xs text-[var(--muted)] mt-1">
            UK Gov Milestones Dashboard
          </p>
        </Link>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto">
        <ul className="space-y-1">
          <li>
            <Link
              href="/"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                pathname === "/"
                  ? "bg-[var(--accent-light)] text-[var(--accent)]"
                  : "text-[var(--muted)] hover:bg-gray-50 hover:text-[var(--foreground)]"
              }`}
            >
              <span className="text-base">📊</span>
              Overview
            </Link>
          </li>

          <li className="pt-3 pb-1">
            <span className="px-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
              Milestones
            </span>
          </li>

          {milestones.map((m) => {
            const isActive = pathname === `/milestone/${m.slug}`;
            return (
              <li key={m.slug}>
                <Link
                  href={`/milestone/${m.slug}`}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-[var(--accent-light)] text-[var(--accent)]"
                      : "text-[var(--muted)] hover:bg-gray-50 hover:text-[var(--foreground)]"
                  }`}
                >
                  <span className="text-base">{m.icon}</span>
                  {m.shortTitle}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="p-4 border-t border-[var(--border)]">
        <p className="text-xs text-[var(--muted)]">
          Data refreshed periodically from ONS, NHS England, Parliament, GOV.UK,
          and The Guardian.
        </p>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 flex items-center gap-3 px-4 h-14 bg-white border-b border-[var(--border)]">
        <button
          onClick={() => setOpen(true)}
          className="p-1.5 -ml-1.5 rounded-md hover:bg-gray-100 transition-colors"
          aria-label="Open navigation menu"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/" className="text-sm font-bold text-[var(--foreground)]">
          Plan for Change
        </Link>
      </div>

      {/* Mobile backdrop */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/30"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-over sidebar */}
      <aside
        className={`lg:hidden fixed top-0 left-0 z-50 w-64 h-screen bg-white border-r border-[var(--border)] flex flex-col transform transition-transform duration-200 ease-in-out ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <button
          onClick={() => setOpen(false)}
          className="absolute top-4 right-3 p-1 rounded-md hover:bg-gray-100 transition-colors"
          aria-label="Close navigation menu"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {navContent}
      </aside>

      {/* Desktop sidebar — always visible on lg+ */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-[var(--border)] h-screen sticky top-0 flex-col">
        {navContent}
      </aside>
    </>
  );
}
