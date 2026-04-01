"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const GNB_TABS = [
  { hash: "overview", label: "Overview" },
  { hash: "workflow", label: "Workflow" },
  { hash: "calendar", label: "Calendar" },
];

const PAGE_TITLES: Record<string, string> = {
  overview: "대시보드",
  workflow: "워크플로",
  calendar: "리포트",
  settings: "설정",
};

export default function TopNav() {
  const [activeHash, setActiveHash] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const update = () => {
      const h = window.location.hash.replace("#", "");
      setActiveHash(h || "overview");
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const pageTitle = PAGE_TITLES[activeHash] ?? "대시보드";

  return (
    <header className="glass sticky top-0 z-50 flex items-center justify-between px-8 py-0 h-[54px]">
      {/* 왼쪽: 탭 네비게이션 */}
      <div className="flex items-center h-full">
        {/* 페이지 타이틀 */}
        <span className="text-[13px] font-bold text-[var(--foreground)] mr-6 tracking-tight">
          {pageTitle}
        </span>
        {/* GNB 탭 (overview/workflow/calendar만 표시) */}
        {["overview", "workflow", "calendar"].includes(activeHash) && (
          <nav className="flex items-center h-full gap-0">
            {GNB_TABS.map((tab) => {
              const isActive = activeHash === tab.hash;
              return (
                <Link
                  key={tab.hash}
                  href={`/#${tab.hash}`}
                  className={cn(
                    "relative flex items-center h-full px-4 text-[13px] transition-all duration-200",
                    isActive
                      ? "text-[var(--accent)] font-semibold"
                      : "text-slate-400 hover:text-slate-600"
                  )}
                >
                  {tab.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-4 right-4 h-[2px] bg-[var(--accent)] rounded-t-full" />
                  )}
                </Link>
              );
            })}
          </nav>
        )}
      </div>

      {/* 오른쪽: 검색 + 알림 + 아바타 */}
      <div className="flex items-center gap-2">
        {/* 검색 */}
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 transition-all focus-within:border-[var(--accent)]/40 focus-within:bg-white">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400 flex-shrink-0">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="text-[13px] text-slate-600 bg-transparent outline-none w-28 placeholder:text-slate-400"
          />
        </div>

        {/* 알림 */}
        <button className="relative p-2 text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] rounded-full transition-colors">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
        </button>

        {/* 유저 아바타 */}
        <div className="w-8 h-8 rounded-full bg-[var(--accent)] flex items-center justify-center text-white text-[12px] font-bold cursor-pointer select-none hover:opacity-90 transition-opacity">
          주
        </div>
      </div>
    </header>
  );
}
