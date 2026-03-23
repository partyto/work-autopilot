import type { Metadata } from "next";
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
        <header className="border-b border-[var(--border)] bg-[var(--surface)]">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white">
                W
              </div>
              <h1 className="text-lg font-semibold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
                Work Autopilot
              </h1>
            </div>
            <div className="text-sm text-slate-400">
              주현우 · B2B서비스
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6 flex-1 w-full">
          {children}
        </main>
      </body>
    </html>
  );
}
