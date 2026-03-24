import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Work Autopilot",
  description: "TO-DO 중심 업무 자동 관리 시스템",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col" style={{ fontFamily: "'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        <header className="sticky top-0 z-50 border-b border-[var(--border2)] glass">
          <div className="max-w-7xl mx-auto px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <span className="text-sm font-bold text-white">W</span>
              </div>
              <div>
                <h1 className="text-base font-bold gradient-text leading-none">Work Autopilot</h1>
                <p className="text-[10px] text-slate-500 mt-0.5">업무 자동화 대시보드</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-slate-400">주현우 · B2B서비스</span>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-5 py-6 flex-1 w-full">
          {children}
        </main>
        <Toaster
          position="bottom-right"
          theme="dark"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--surface2)",
              border: "1px solid var(--border2)",
              color: "var(--foreground)",
            },
          }}
        />
      </body>
    </html>
  );
}
