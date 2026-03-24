#!/bin/bash
# UI 리디자인 파일 적용 스크립트
# ~/work-autopilot 디렉토리에서 실행하세요

set -e
REPO="$HOME/work-autopilot"

if [ ! -d "$REPO" ]; then
  echo "❌ $REPO 디렉토리가 없습니다"
  exit 1
fi

cd "$REPO"
echo "📁 작업 디렉토리: $REPO"
cat > "$REPO/package.json" << 'EOF'
{
  "name": "work-autopilot",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint"
  },
  "dependencies": {
    "@libsql/client": "^0.17.2",
    "drizzle-orm": "^0.45.1",
    "framer-motion": "^12.0.0",
    "lucide-react": "^0.483.0",
    "next": "16.2.1",
    "node-cron": "^4.2.1",
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "sonner": "^2.0.0",
    "uuid": "^13.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/better-sqlite3": "^7.6.13",
    "@types/node": "^20",
    "@types/node-cron": "^3.0.11",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/uuid": "^10.0.0",
    "drizzle-kit": "^0.31.10",
    "eslint": "^9",
    "eslint-config-next": "16.2.1",
    "tailwindcss": "^4",
    "typescript": "^5"
  }
}
EOF
echo "✅ package.json"

cat > "$REPO/src/app/globals.css" << 'EOF'
@import "tailwindcss";

:root {
  --background: #0a0f1e;
  --foreground: #e2e8f0;
  --surface: #111827;
  --surface2: #1e293b;
  --surface3: #243044;
  --border: #1e293b;
  --border2: #2d3f55;
  --accent: #3b82f6;
  --accent2: #8b5cf6;
  --accent-glow: rgba(59, 130, 246, 0.15);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Custom scrollbar */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #3d5270; }

/* Sonner toast override */
[data-sonner-toaster] {
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif !important;
}

/* Gradient text utility */
.gradient-text {
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Glass surface */
.glass {
  background: rgba(17, 24, 39, 0.8);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

/* Glow effects */
.glow-blue {
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.15), 0 0 40px rgba(59, 130, 246, 0.05);
}

.glow-amber {
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.15), 0 0 40px rgba(245, 158, 11, 0.05);
}
EOF
echo "✅ globals.css"

cat > "$REPO/src/app/layout.tsx" << 'EOF'
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
EOF
echo "✅ layout.tsx"

cat > "$REPO/src/components/Dashboard.tsx" << 'EOF'
"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ScanLine,
  Zap,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Link2Off,
  Bell,
  ListTodo,
  Bot,
  CircleDot,
  RefreshCw,
} from "lucide-react";
import TaskForm from "./TaskForm";
import TaskCard from "./TaskCard";
import ActionCard from "./ActionCard";

type TaskWithLinks = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  sourceType: string;
  dueDate?: string | null;
  createdAt: string;
  completedAt?: string | null;
  links?: any[];
};

type ActionWithTask = {
  id: string;
  taskId: string;
  actionType: string;
  description: string;
  payload?: string | null;
  status: string;
  proposedAt: string;
  executedAt?: string | null;
  resultLink?: string | null;
  task?: { id: string; title: string; status: string } | null;
};

type ScanStatus = {
  jira: boolean;
  slack: boolean;
  scheduler: boolean;
};

const FILTER_TABS = [
  { key: "active", label: "진행 중", filter: (t: TaskWithLinks) => t.status !== "done" && t.status !== "cancelled" },
  { key: "all", label: "전체", filter: () => true },
  { key: "done", label: "완료", filter: (t: TaskWithLinks) => t.status === "done" },
] as const;

const ACTION_FILTER_TABS = [
  { key: "proposed", label: "대기", filter: (a: ActionWithTask) => a.status === "proposed" },
  { key: "all", label: "전체", filter: () => true },
  { key: "executed", label: "실행됨", filter: (a: ActionWithTask) => a.status === "executed" || a.status === "cancelled" || a.status === "rejected" },
] as const;

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15 } },
};

export default function Dashboard() {
  const [tasks, setTasks] = useState<TaskWithLinks[]>([]);
  const [actions, setActions] = useState<ActionWithTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("active");
  const [activeActionTab, setActiveActionTab] = useState<string>("proposed");
  const [activeSection, setActiveSection] = useState<"tasks" | "actions">("tasks");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?includeLinks=true");
      if (res.ok) setTasks(await res.json());
    } catch {
      toast.error("할일 목록 로드 실패");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch("/api/actions");
      if (res.ok) setActions(await res.json());
    } catch {
      toast.error("액션 목록 로드 실패");
    }
  }, []);

  const fetchScanStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/scan");
      if (res.ok) setScanStatus(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchActions();
    fetchScanStatus();
  }, [fetchTasks, fetchActions, fetchScanStatus]);

  const handleRefreshAll = useCallback(() => {
    fetchTasks();
    fetchActions();
  }, [fetchTasks, fetchActions]);

  const handleScanNow = async () => {
    setIsScanning(true);
    const toastId = toast.loading("Jira · Slack 스캔 중...");
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("스캔 완료! Slack DM을 확인하세요.", { id: toastId });
        handleRefreshAll();
      } else {
        toast.error("스캔 실패: " + (data.error || "알 수 없는 오류"), { id: toastId });
      }
    } catch {
      toast.error("스캔 실패: 서버 연결 오류", { id: toastId });
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteNow = async () => {
    setIsScanning(true);
    const toastId = toast.loading("승인된 액션 실행 중...");
    try {
      const res = await fetch("/api/scan?type=execute", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("액션 실행 완료!", { id: toastId });
        handleRefreshAll();
      } else {
        toast.error("실행 실패: " + (data.error || "알 수 없는 오류"), { id: toastId });
      }
    } catch {
      toast.error("실행 실패: 서버 연결 오류", { id: toastId });
    } finally {
      setIsScanning(false);
    }
  };

  const currentFilter = FILTER_TABS.find((t) => t.key === activeTab) || FILTER_TABS[0];
  const filteredTasks = tasks.filter(currentFilter.filter);
  const currentActionFilter = ACTION_FILTER_TABS.find((t) => t.key === activeActionTab) || ACTION_FILTER_TABS[0];
  const filteredActions = actions.filter(currentActionFilter.filter);

  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: tasks.filter(
      (t) => t.dueDate && t.status !== "done" && t.status !== "cancelled" && new Date(t.dueDate) < new Date()
    ).length,
    noLink: tasks.filter((t) => !t.links || t.links.length === 0).length,
    pendingActions: actions.filter((a) => a.status === "proposed").length,
  };

  return (
    <div className="space-y-5">
      {/* 상단 컨트롤 바 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 연결 상태 */}
        <div className="flex items-center gap-4">
          <ConnStatus label="Jira" connected={scanStatus?.jira} />
          <ConnStatus label="Slack" connected={scanStatus?.slack} />
          <ConnStatus label="Scheduler" connected={scanStatus?.scheduler} />
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefreshAll}
            disabled={isScanning}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-[var(--surface2)] rounded-lg transition-all cursor-pointer"
            title="새로고침"
          >
            <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleExecuteNow}
            disabled={isScanning || stats.pendingActions === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-500/50 text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all cursor-pointer"
          >
            <Zap size={12} />
            액션 실행
            {stats.pendingActions > 0 && (
              <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">
                {stats.pendingActions}
              </span>
            )}
          </button>
          <button
            onClick={handleScanNow}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 hover:border-blue-500/60 text-blue-400 disabled:opacity-50 rounded-lg transition-all cursor-pointer glow-blue"
          >
            <ScanLine size={12} />
            {isScanning ? "스캔 중..." : "지금 스캔"}
          </button>
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
        <KpiCard icon={<Clock size={14} />} label="대기" value={stats.pending} color="text-slate-300" borderColor="border-slate-700/50" />
        <KpiCard icon={<CircleDot size={14} />} label="진행 중" value={stats.inProgress} color="text-blue-400" borderColor="border-blue-700/40" />
        <KpiCard icon={<CheckCircle2 size={14} />} label="완료" value={stats.done} color="text-emerald-400" borderColor="border-emerald-800/40" />
        <KpiCard
          icon={<AlertTriangle size={14} />}
          label="기한 초과"
          value={stats.overdue}
          color={stats.overdue > 0 ? "text-red-400" : "text-slate-600"}
          borderColor={stats.overdue > 0 ? "border-red-700/50" : "border-slate-800"}
          alert={stats.overdue > 0}
        />
        <KpiCard
          icon={<Link2Off size={14} />}
          label="연결 없음"
          value={stats.noLink}
          color={stats.noLink > 0 ? "text-yellow-400" : "text-slate-600"}
          borderColor={stats.noLink > 0 ? "border-yellow-700/40" : "border-slate-800"}
        />
        <KpiCard
          icon={<Bell size={14} />}
          label="승인 대기"
          value={stats.pendingActions}
          color={stats.pendingActions > 0 ? "text-amber-400" : "text-slate-600"}
          borderColor={stats.pendingActions > 0 ? "border-amber-700/50" : "border-slate-800"}
          alert={stats.pendingActions > 0}
          onClick={() => setActiveSection("actions")}
        />
      </div>

      {/* 섹션 탭 */}
      <div className="flex items-center gap-0.5 border-b border-[var(--border2)]">
        <SectionTab
          active={activeSection === "tasks"}
          onClick={() => setActiveSection("tasks")}
          icon={<ListTodo size={14} />}
          label="TO-DO"
          count={tasks.length}
          activeColor="text-blue-400 border-blue-500"
        />
        <SectionTab
          active={activeSection === "actions"}
          onClick={() => setActiveSection("actions")}
          icon={<Bot size={14} />}
          label="자동 액션"
          count={stats.pendingActions > 0 ? stats.pendingActions : undefined}
          badge={stats.pendingActions > 0}
          activeColor="text-amber-400 border-amber-500"
        />
      </div>

      {/* TO-DO 섹션 */}
      <AnimatePresence mode="wait">
        {activeSection === "tasks" && (
          <motion.div
            key="tasks"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <TaskForm onCreated={handleRefreshAll} />

            <FilterBar
              tabs={FILTER_TABS}
              active={activeTab}
              onSelect={setActiveTab}
              counts={FILTER_TABS.reduce((acc, t) => ({ ...acc, [t.key]: tasks.filter(t.filter).length }), {} as Record<string, number>)}
              activeColor="bg-blue-600"
            />

            {isLoading ? (
              <LoadingSpinner />
            ) : filteredTasks.length === 0 ? (
              <EmptyState
                icon={<ListTodo size={32} className="text-slate-700" />}
                message={activeTab === "active" ? "진행 중인 할일이 없습니다" : "할일이 없습니다"}
                sub={activeTab === "active" ? "위의 '+ 새 할일 추가' 버튼으로 시작하세요" : undefined}
              />
            ) : (
              <motion.div
                className="space-y-2.5"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <AnimatePresence>
                  {filteredTasks.map((task) => (
                    <motion.div key={task.id} variants={itemVariants} layout exit="exit">
                      <TaskCard task={task} onUpdate={handleRefreshAll} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}

        {/* 자동 액션 섹션 */}
        {activeSection === "actions" && (
          <motion.div
            key="actions"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            <FilterBar
              tabs={ACTION_FILTER_TABS}
              active={activeActionTab}
              onSelect={setActiveActionTab}
              counts={ACTION_FILTER_TABS.reduce((acc, t) => ({ ...acc, [t.key]: actions.filter(t.filter).length }), {} as Record<string, number>)}
              activeColor="bg-amber-600"
            />

            {filteredActions.length === 0 ? (
              <EmptyState
                icon={<Bot size={32} className="text-slate-700" />}
                message={activeActionTab === "proposed" ? "대기 중인 액션이 없습니다" : "액션 기록이 없습니다"}
                sub="매일 17:30 자동 스캔 또는 '지금 스캔' 버튼으로 생성됩니다"
              />
            ) : (
              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 gap-2.5"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                <AnimatePresence>
                  {filteredActions.map((action) => (
                    <motion.div key={action.id} variants={itemVariants} layout exit="exit">
                      <ActionCard action={action} onUpdate={handleRefreshAll} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ===== 서브 컴포넌트 =====

function KpiCard({
  icon, label, value, color, borderColor, alert, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: string;
  borderColor: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.div
      whileHover={onClick ? { scale: 1.03 } : {}}
      whileTap={onClick ? { scale: 0.97 } : {}}
      onClick={onClick}
      className={`relative bg-[var(--surface)] border ${borderColor} rounded-xl px-3 py-3 transition-all ${
        onClick ? "cursor-pointer hover:border-opacity-80" : ""
      } ${alert ? "glow-amber" : ""}`}
    >
      <div className={`flex items-center gap-1.5 mb-1.5 ${color} opacity-60`}>
        {icon}
        <span className="text-[10px] font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
      {alert && value > 0 && (
        <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      )}
    </motion.div>
  );
}

function ConnStatus({ label, connected }: { label: string; connected?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full transition-colors ${
        connected === undefined ? "bg-slate-600" : connected ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-red-500"
      }`} />
      <span className="text-[11px] text-slate-500">{label}</span>
    </div>
  );
}

function SectionTab({
  active, onClick, icon, label, count, badge, activeColor,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: boolean;
  activeColor: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 pb-2.5 pt-1 text-sm font-medium transition-all border-b-2 cursor-pointer ${
        active
          ? `${activeColor} border-current`
          : "border-transparent text-slate-500 hover:text-slate-300"
      }`}
    >
      {icon}
      {label}
      {count !== undefined && (
        badge ? (
          <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded-full leading-none">
            {count}
          </span>
        ) : (
          <span className="text-xs opacity-50">{count}</span>
        )
      )}
    </button>
  );
}

function FilterBar({
  tabs, active, onSelect, counts, activeColor,
}: {
  tabs: readonly { key: string; label: string }[];
  active: string;
  onSelect: (key: string) => void;
  counts: Record<string, number>;
  activeColor: string;
}) {
  return (
    <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border2)] rounded-xl p-1 w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          className={`px-4 py-1.5 text-sm rounded-lg transition-all cursor-pointer font-medium ${
            active === tab.key
              ? `${activeColor} text-white shadow-sm`
              : "text-slate-400 hover:text-slate-200 hover:bg-[var(--surface2)]"
          }`}
        >
          {tab.label}
          <span className="ml-1.5 text-xs opacity-60">{counts[tab.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="w-6 h-6 border-2 border-[var(--border2)] border-t-blue-400 rounded-full animate-spin" />
      <span className="text-sm text-slate-600">로딩 중...</span>
    </div>
  );
}

function EmptyState({ icon, message, sub }: { icon: React.ReactNode; message: string; sub?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 gap-3"
    >
      {icon}
      <div className="text-sm text-slate-500 font-medium">{message}</div>
      {sub && <div className="text-xs text-slate-600">{sub}</div>}
    </motion.div>
  );
}
EOF
echo "✅ Dashboard.tsx"

cat > "$REPO/src/components/TaskCard.tsx" << 'EOF'
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Trash2,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  Link2Off,
  ChevronDown,
  ChevronUp,
  Flag,
} from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS, PRIORITY_COLORS, cn } from "@/lib/utils";

interface TaskLink {
  id: string;
  linkType: string;
  jiraIssueKey?: string | null;
  jiraIssueUrl?: string | null;
  jiraStatus?: string | null;
  slackThreadUrl?: string | null;
  slackChannelName?: string | null;
}

interface TaskCardProps {
  task: {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    sourceType: string;
    dueDate?: string | null;
    createdAt: string;
    completedAt?: string | null;
    links?: TaskLink[];
  };
  onUpdate: () => void;
}

const STATUSES = ["pending", "in_progress", "done", "cancelled"] as const;

const STATUS_DOT: Record<string, string> = {
  pending: "bg-slate-500",
  in_progress: "bg-blue-500",
  done: "bg-emerald-500",
  cancelled: "bg-gray-600",
};

const PRIORITY_ICON_COLOR: Record<string, string> = {
  high: "text-red-400",
  medium: "text-amber-400",
  low: "text-slate-500",
};

export default function TaskCard({ task, onUpdate }: TaskCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    if (task.status === newStatus) return;
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast.success(`상태 변경: ${STATUS_LABELS[newStatus]}`);
        onUpdate();
      }
    } catch {
      toast.error("상태 변경 실패");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      toast.success("할일 삭제됨");
      onUpdate();
    } catch {
      toast.error("삭제 실패");
    }
  };

  const isDue =
    task.dueDate &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    new Date(task.dueDate) < new Date();

  const isDueSoon =
    task.dueDate &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    !isDue &&
    new Date(task.dueDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const jiraLink = task.links?.find((l) => l.linkType === "jira");
  const slackLink = task.links?.find((l) => l.linkType === "slack_thread");
  const hasNoLinks = !jiraLink && !slackLink;
  const isDone = task.status === "done";

  return (
    <motion.div
      layout
      className={cn(
        "group relative bg-[var(--surface)] border rounded-xl overflow-hidden transition-all duration-200",
        isDone
          ? "border-[var(--border)] opacity-60"
          : isDue
          ? "border-red-500/40 shadow-sm shadow-red-500/10"
          : isDueSoon
          ? "border-amber-500/30"
          : "border-[var(--border2)] hover:border-blue-500/30 hover:shadow-sm hover:shadow-blue-500/5"
      )}
    >
      {/* 왼쪽 우선순위 바 */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-0.5",
        task.priority === "high" ? "bg-red-500" : task.priority === "medium" ? "bg-amber-500" : "bg-slate-600"
      )} />

      <div className="px-4 py-3.5 pl-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* 상태 닷 + 제목 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className={cn("w-2 h-2 rounded-full flex-shrink-0 mt-0.5", STATUS_DOT[task.status] || "bg-slate-500")} />
              <h3 className={cn(
                "text-sm font-medium leading-snug truncate",
                isDone ? "line-through text-slate-500" : "text-slate-100"
              )}>
                {task.title}
              </h3>
              {task.priority === "high" && (
                <Flag size={11} className="text-red-400 flex-shrink-0" />
              )}
            </div>

            {/* 메타 정보 */}
            <div className="flex items-center gap-3 ml-4">
              {isDue && (
                <span className="flex items-center gap-1 text-[11px] text-red-400 font-medium">
                  <AlertCircle size={10} />
                  기한 초과 {task.dueDate}
                </span>
              )}
              {isDueSoon && !isDue && (
                <span className="text-[11px] text-amber-400">⏰ {task.dueDate}</span>
              )}
              {!isDue && !isDueSoon && task.dueDate && (
                <span className="text-[11px] text-slate-600">{task.dueDate}</span>
              )}
              {hasNoLinks && (
                <span className="flex items-center gap-1 text-[11px] text-slate-600">
                  <Link2Off size={10} />연결 없음
                </span>
              )}
            </div>
          </div>

          {/* 우측 액션 */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {task.description && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1.5 text-slate-600 hover:text-slate-300 hover:bg-[var(--surface2)] rounded-lg transition-all cursor-pointer"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* 설명 (접기/펼치기) */}
        {expanded && task.description && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-slate-500 ml-4 mt-2 leading-relaxed"
          >
            {task.description}
          </motion.p>
        )}

        {/* 상태 버튼 + 링크 */}
        <div className="flex items-center justify-between mt-3 ml-4 gap-2">
          {/* 상태 토글 */}
          <div className="flex gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={isUpdating}
                className={cn(
                  "px-2.5 py-1 text-[11px] rounded-full font-medium transition-all cursor-pointer",
                  task.status === s
                    ? cn(STATUS_COLORS[s], "text-white shadow-sm")
                    : "bg-[var(--surface2)] text-slate-500 hover:text-slate-200 hover:bg-[var(--surface3)]"
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* 링크 뱃지 */}
          <div className="flex items-center gap-1.5">
            {jiraLink && (
              <a
                href={jiraLink.jiraIssueUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-[11px] rounded-md transition-colors"
              >
                <span className="w-3 h-3 rounded bg-blue-600 flex items-center justify-center text-[8px] font-bold text-white">J</span>
                {jiraLink.jiraIssueKey}
                {jiraLink.jiraStatus && <span className="text-blue-300/50">· {jiraLink.jiraStatus}</span>}
                <ExternalLink size={9} className="opacity-50" />
              </a>
            )}
            {slackLink && (
              <a
                href={slackLink.slackThreadUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 text-[11px] rounded-md transition-colors"
              >
                <MessageSquare size={9} />
                Slack
                <ExternalLink size={9} className="opacity-50" />
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
EOF
echo "✅ TaskCard.tsx"

cat > "$REPO/src/components/ActionCard.tsx" << 'EOF'
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  MessageSquare,
  PlusSquare,
  CheckSquare,
  RefreshCcw,
  Check,
  X,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActionCardProps {
  action: {
    id: string;
    taskId: string;
    actionType: string;
    description: string;
    payload?: string | null;
    status: string;
    proposedAt: string;
    executedAt?: string | null;
    resultLink?: string | null;
    task?: { id: string; title: string; status: string } | null;
  };
  onUpdate: () => void;
}

const ACTION_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  jira_transition: {
    label: "Jira 전환",
    icon: <ArrowRightLeft size={11} />,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  slack_reply: {
    label: "Slack 답글",
    icon: <MessageSquare size={11} />,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
  jira_create: {
    label: "Jira 생성",
    icon: <PlusSquare size={11} />,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
  todo_create: {
    label: "TO-DO 생성",
    icon: <PlusSquare size={11} />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  todo_complete: {
    label: "TO-DO 완료",
    icon: <CheckSquare size={11} />,
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  todo_status_change: {
    label: "TO-DO 상태 변경",
    icon: <RefreshCcw size={11} />,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  proposed: { label: "대기", icon: <Clock size={10} />, color: "text-amber-400" },
  approved: { label: "승인됨", icon: <CheckCircle2 size={10} />, color: "text-blue-400" },
  executed: { label: "완료", icon: <CheckCircle2 size={10} />, color: "text-emerald-400" },
  rejected: { label: "거절", icon: <XCircle size={10} />, color: "text-slate-500" },
  cancelled: { label: "자동 취소", icon: <Ban size={10} />, color: "text-orange-400" },
};

export default function ActionCard({ action, onUpdate }: ActionCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (newStatus: "approved" | "rejected") => {
    setIsProcessing(true);
    const toastId = toast.loading(newStatus === "approved" ? "승인 후 실행 중..." : "거절 처리 중...");
    try {
      await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(newStatus === "approved" ? "승인 후 실행됨!" : "거절 완료", { id: toastId });
      onUpdate();
    } catch {
      toast.error("처리 실패", { id: toastId });
    } finally {
      setIsProcessing(false);
    }
  };

  let payload: Record<string, any> | null = null;
  try {
    payload = action.payload ? JSON.parse(action.payload) : null;
  } catch {
    payload = null;
  }

  const typeConfig = ACTION_TYPE_CONFIG[action.actionType] || {
    label: action.actionType,
    icon: <RefreshCcw size={11} />,
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
  };
  const statusConfig = STATUS_CONFIG[action.status] || STATUS_CONFIG.proposed;
  const isProposed = action.status === "proposed";
  const isCancelled = action.status === "cancelled" || action.status === "rejected";

  return (
    <motion.div
      layout
      className={cn(
        "relative bg-[var(--surface)] border rounded-xl p-4 transition-all overflow-hidden",
        isProposed
          ? "border-amber-500/30 hover:border-amber-400/50 shadow-sm shadow-amber-500/5"
          : isCancelled
          ? "border-[var(--border)] opacity-50"
          : "border-emerald-800/30 opacity-70"
      )}
    >
      {/* 상단 액션 타입 바 */}
      <div className={cn("absolute top-0 left-0 right-0 h-0.5", isProposed ? "bg-gradient-to-r from-amber-500/50 to-orange-500/30" : "bg-transparent")} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border", typeConfig.color, typeConfig.bg, typeConfig.border)}>
            {typeConfig.icon}
            {typeConfig.label}
          </span>
          <span className={cn("flex items-center gap-1 text-[11px]", statusConfig.color)}>
            {statusConfig.icon}
            {statusConfig.label}
          </span>
        </div>
        <span className="text-[10px] text-slate-600 flex-shrink-0">
          {action.proposedAt?.split("T")[0]}
        </span>
      </div>

      {/* 설명 */}
      <p className="text-xs text-slate-300 leading-relaxed mb-2.5">{action.description}</p>

      {/* 연결된 TO-DO */}
      {action.task && (
        <div className="text-[11px] text-slate-600 mb-2.5 flex items-center gap-1">
          <span>→</span>
          <span className="text-slate-500 truncate">{action.task.title}</span>
        </div>
      )}

      {/* Payload 미리보기 */}
      {payload && (
        <div className="bg-[var(--surface2)] border border-[var(--border2)] rounded-lg px-3 py-2 mb-3 space-y-1">
          {payload.jiraIssueKey && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">J</span>
              <span className="text-blue-400">{payload.jiraIssueKey}</span>
              {payload.targetStatus && (
                <span className="text-slate-500">→ <span className="text-slate-300">{payload.targetStatus}</span></span>
              )}
            </div>
          )}
          {payload.targetTodoStatus && (
            <div className="text-[11px] text-slate-400">
              TO-DO → <span className="text-amber-400">{payload.targetTodoStatus}</span>
            </div>
          )}
          {payload.summary && (
            <div className="text-[11px] text-slate-400 truncate">
              "{payload.summary}"
            </div>
          )}
          {payload.threadUrl && (
            <a
              href={payload.threadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
            >
              <MessageSquare size={10} />
              Slack 스레드 보기
              <ExternalLink size={9} />
            </a>
          )}
        </div>
      )}

      {/* 실행 결과 */}
      {action.resultLink && (
        <a
          href={action.resultLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-emerald-400 hover:underline mb-2"
        >
          <ExternalLink size={10} />
          실행 결과 보기
        </a>
      )}

      {/* 승인/거절 버튼 */}
      {isProposed && (
        <div className="flex gap-2 pt-2.5 border-t border-[var(--border2)]">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => handleAction("approved")}
            disabled={isProcessing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
          >
            <Check size={12} />
            {isProcessing ? "처리 중..." : "승인 · 실행"}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => handleAction("rejected")}
            disabled={isProcessing}
            className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--surface2)] hover:bg-[var(--surface3)] border border-[var(--border2)] text-slate-400 hover:text-slate-200 rounded-lg transition-all cursor-pointer"
          >
            <X size={12} />
            거절
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}
EOF
echo "✅ ActionCard.tsx"

echo ""
echo "📦 npm install 실행 중..."
npm install --legacy-peer-deps

echo ""
echo "📋 변경 파일 목록:"
git diff --stat

echo ""
echo "🚀 커밋 & 푸쉬 준비:"
echo "  git add package.json package-lock.json src/app/globals.css src/app/layout.tsx src/components/Dashboard.tsx src/components/TaskCard.tsx src/components/ActionCard.tsx"
echo "  git commit -m \"feat: UI 리디자인 — lucide-react, framer-motion, sonner 적용\""
echo "  git push"

echo ""
echo "📦 npm install 실행 중..."
npm install --legacy-peer-deps

echo ""
echo "📋 변경 파일 목록:"
git diff --stat

echo ""
echo "🚀 커밋 준비 완료! 아래 명령 실행:"
echo "  git add package.json package-lock.json src/app/globals.css src/app/layout.tsx src/components/Dashboard.tsx src/components/TaskCard.tsx src/components/ActionCard.tsx"
echo '  git commit -m "feat: UI 리디자인 — lucide-react, framer-motion, sonner 적용"'"
echo "  git push"
