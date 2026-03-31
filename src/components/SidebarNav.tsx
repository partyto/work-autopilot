"use client";

import { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

const NAV_MAIN = [
  {
    hash: "",
    label: "대시보드",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
      </svg>
    ),
  },
  {
    hash: "actions",
    label: "자동 액션",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/>
      </svg>
    ),
  },
];

const NAV_HISTORY = [
  {
    hash: "completed",
    label: "완료 이력",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    ),
  },
  {
    hash: "history",
    label: "스캔 이력",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    ),
  },
];

const NAV_BOTTOM = [
  {
    hash: "settings",
    label: "설정",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    ),
  },
];

function NavItem({
  item,
  isActive,
  onClick,
  collapsed,
}: {
  item: { hash: string; label: string; icon: React.ReactNode };
  isActive: boolean;
  onClick: (hash: string) => void;
  collapsed: boolean;
}) {
  return (
    <button
      onClick={() => onClick(item.hash)}
      title={collapsed ? item.label : undefined}
      className={cn(
        "w-full flex items-center rounded-xl text-[13px] transition-all duration-150 group cursor-pointer text-left",
        collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2.5",
        isActive
          ? "bg-[var(--accent-glow)] text-[var(--accent)] font-semibold"
          : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
      )}
    >
      <span className={cn("flex-shrink-0", isActive ? "text-[var(--accent)]" : "text-slate-400 group-hover:text-slate-500")}>
        {item.icon}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{item.label}</span>
          {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />}
        </>
      )}
    </button>
  );
}

// 토글 아이콘 (화살표)
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("transition-transform duration-300", collapsed ? "rotate-0" : "rotate-180")}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

interface SidebarNavProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function SidebarNav({ collapsed = false, onToggle }: SidebarNavProps) {
  const [activeHash, setActiveHash] = useState("");

  useEffect(() => {
    const update = () => {
      const h = window.location.hash.replace("#", "");
      setActiveHash(h || "");
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  const handleNav = useCallback((hash: string) => {
    const newHash = hash || "";
    window.location.hash = newHash;
    setActiveHash(newHash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }, []);

  return (
    <aside
      className={cn(
        "h-screen fixed left-0 top-0 flex flex-col bg-white border-r border-slate-100 z-40 transition-all duration-300 overflow-hidden",
        collapsed ? "w-[60px]" : "w-[210px]"
      )}
    >
      {/* 로고 + 토글 버튼 */}
      <div className={cn(
        "py-4 flex items-center border-b border-slate-100 flex-shrink-0 transition-all duration-300",
        collapsed ? "px-3 justify-center" : "px-4 gap-2.5"
      )}>
        <div className="w-8 h-8 rounded-xl bg-[var(--accent)] flex items-center justify-center flex-shrink-0">
          <img src="/icon-192.png" alt="Pavlotrasche" className="w-5 h-5 rounded-lg" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <h1 className="text-[13px] font-extrabold text-[var(--foreground)] leading-tight tracking-tight">Pavlotrasche</h1>
            <p className="text-[9px] uppercase tracking-widest text-[var(--accent)] font-bold opacity-60">Amethyst</p>
          </div>
        )}
        {onToggle && (
          <button
            onClick={onToggle}
            title={collapsed ? "사이드바 열기" : "사이드바 접기"}
            className={cn(
              "flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all cursor-pointer",
              collapsed && "mt-0"
            )}
          >
            <ChevronIcon collapsed={collapsed} />
          </button>
        )}
      </div>

      {/* 네비게이션 */}
      <nav className={cn("flex-1 py-3 space-y-5 overflow-y-auto", collapsed ? "px-1.5" : "px-3")}>
        {/* 메인 */}
        <div className="space-y-0.5">
          {!collapsed && (
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-3 pb-1.5">메인</p>
          )}
          {NAV_MAIN.map((item) => (
            <NavItem key={item.hash} item={item} isActive={activeHash === item.hash} onClick={handleNav} collapsed={collapsed} />
          ))}
        </div>

        {!collapsed && <div className="border-t border-slate-100" />}
        {collapsed && <div className="border-t border-slate-100 mx-1" />}

        {/* 이력 */}
        <div className="space-y-0.5">
          {!collapsed && (
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-3 pb-1.5">이력</p>
          )}
          {NAV_HISTORY.map((item) => (
            <NavItem key={item.hash} item={item} isActive={activeHash === item.hash} onClick={handleNav} collapsed={collapsed} />
          ))}
        </div>

        {!collapsed && <div className="border-t border-slate-100" />}
        {collapsed && <div className="border-t border-slate-100 mx-1" />}

        {/* 기타 */}
        <div className="space-y-0.5">
          {!collapsed && (
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold px-3 pb-1.5">기타</p>
          )}
          {NAV_BOTTOM.map((item) => (
            <NavItem key={item.hash} item={item} isActive={activeHash === item.hash} onClick={handleNav} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {/* 유저 프로필 */}
      <div className={cn("pb-4 pt-2 border-t border-slate-100 flex-shrink-0", collapsed ? "px-1.5" : "px-3")}>
        {collapsed ? (
          <div className="flex justify-center py-1">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white text-[11px] font-bold" title="주현우 · B2B서비스">주</div>
          </div>
        ) : (
          <div className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-50 rounded-xl">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">주</div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-slate-700 truncate">주현우</p>
              <p className="text-[10px] text-slate-400">B2B서비스</p>
            </div>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-soft-pulse flex-shrink-0" />
          </div>
        )}
      </div>
    </aside>
  );
}
