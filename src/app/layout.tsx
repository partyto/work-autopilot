import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Work Pavlotrasche",
  description: "TO-DO 중심 업무 자동 관리 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-[100dvh] flex bg-[var(--background)]" style={{ fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {/* Sidebar */}
        <aside className="h-screen w-60 fixed left-0 top-0 flex flex-col bg-[var(--background)] text-sm tracking-wide z-40 border-r border-[var(--border)]">
          <div className="p-5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[var(--accent)] flex items-center justify-center">
              <img src="/icon-192.png" alt="" className="w-6 h-6 rounded-lg" />
            </div>
            <div>
              <h1 className="text-[15px] font-extrabold text-[var(--foreground)] leading-tight tracking-tight">Pavlotrasche</h1>
              <p className="text-[10px] uppercase tracking-widest text-[var(--accent)] font-bold">Amethyst Edition</p>
            </div>
          </div>
          <nav className="flex flex-col flex-1 px-3 py-2 gap-0.5">
            <a className="sidebar-active flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-all duration-200" href="#">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              <span>대시보드</span>
            </a>
            <a className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-slate-500 hover:text-[var(--accent)] rounded-xl transition-all duration-200 hover:translate-x-0.5" href="#">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span>태스크</span>
            </a>
            <a className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-slate-500 hover:text-[var(--accent)] rounded-xl transition-all duration-200 hover:translate-x-0.5" href="#">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
              <span>팀</span>
            </a>
            <a className="flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-slate-500 hover:text-[var(--accent)] rounded-xl transition-all duration-200 hover:translate-x-0.5" href="#">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              <span>리포트</span>
            </a>
          </nav>
          <div className="px-3 pb-3 mt-auto">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[var(--surface2)] rounded-xl">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-soft-pulse" />
              <span className="text-xs font-medium text-slate-600 truncate">주현우 · B2B서비스</span>
            </div>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 ml-60 min-h-screen flex flex-col">
          {/* Top header */}
          <header className="glass sticky top-0 z-50 flex items-center justify-between px-8 py-3.5">
            <div className="flex items-center gap-6">
              <span className="text-[var(--accent)] font-semibold text-[13px]">Overview</span>
              <span className="text-slate-400 text-[13px] hover:text-[var(--accent)] cursor-pointer transition-colors">Workflow</span>
              <span className="text-slate-400 text-[13px] hover:text-[var(--accent)] cursor-pointer transition-colors">Calendar</span>
            </div>
            <div className="flex items-center gap-3">
              <button className="relative p-2 text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--surface2)] rounded-full transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
                <span className="absolute top-2 right-2 w-2 h-2 bg-[var(--tertiary)] rounded-full" />
              </button>
              <button className="p-2 text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--surface2)] rounded-full transition-colors">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              </button>
            </div>
          </header>

          <main className="px-8 py-6 flex-1">
            {children}
          </main>
        </div>

        <Toaster
          position="bottom-right"
          theme="light"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--surface)",
              border: "1px solid var(--border)",
              color: "var(--foreground)",
            },
          }}
        />
      </body>
    </html>
  );
}
