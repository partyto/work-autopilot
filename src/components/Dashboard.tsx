"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  ScanLine,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Link2Off,
  Bell,
  ListTodo,
  Bot,
  CircleDot,
  History,
  CalendarDays,
  ExternalLink,
  MessageSquare,
  X,
  Sunrise,
  Sunset,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import TaskForm from "./TaskForm";
import TaskCard from "./TaskCard";
import ActionCard from "./ActionCard";
import WorkflowSODModal from "./WorkflowSODModal";
import WorkflowEODModal from "./WorkflowEODModal";

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

type DailyReport = {
  id: string;
  date: string;
  summary: string | null;
  pendingActions: string | null;
  slackMessageTs: string | null;
  createdAt: string;
};

type ScanStatus = {
  jira: boolean;
  slack: boolean;
  scheduler: boolean;
};

type WorkflowStatus = {
  lastEod: { date: string; createdAt: string; summary: { completed: number; carriedOver: number; overdue: number } | null } | null;
  lastSod: { date: string; createdAt: string; summary: { carriedOverCount: number; newTodayCount: number; dueTodayCount: number } | null } | null;
  nextEodDate: string;
  nextEodTime: string;
  nextSodDate: string;
  nextSodTime: string;
  nextAction: "eod" | "sod";
};

type ScanResultItem =
  | { type: "jira"; key: string; summary: string; status: string; url: string }
  | { type: "slack"; channel: string; preview: string; url: string };

const ACTION_FILTER_TABS = [
  { key: "proposed", label: "대기", filter: (a: ActionWithTask) => a.status === "proposed" },
  { key: "all", label: "전체", filter: () => true },
  { key: "executed", label: "실행됨", filter: (a: ActionWithTask) => a.status === "executed" || a.status === "cancelled" || a.status === "rejected" },
] as const;

const SOURCE_FILTERS = [
  { key: "jira_sync",      label: "JIRA",  color: "text-slate-500 bg-slate-50 border-slate-200 hover:bg-[var(--accent-glow)] hover:border-[var(--accent-border)]", activeColor: "bg-[var(--accent)] text-white border-[var(--accent)]" },
  { key: "slack_detected", label: "SLACK", color: "text-slate-500 bg-slate-50 border-slate-200 hover:bg-[var(--accent-glow)] hover:border-[var(--accent-border)]", activeColor: "bg-[var(--accent)] text-white border-[var(--accent)]" },
  { key: "manual",         label: "SELF",  color: "text-slate-500 bg-slate-50 border-slate-200 hover:bg-[var(--accent-glow)] hover:border-[var(--accent-border)]", activeColor: "bg-[var(--accent)] text-white border-[var(--accent)]" },
] as const;

// 모듈 스코프 상수 (렌더링마다 재생성 방지)
const todayStr = () => new Date().toISOString().slice(0, 10);

const KPI_FILTERS: Record<string, (t: TaskWithLinks) => boolean> = {
  pending: (t) => t.status === "pending",
  in_progress: (t) => t.status === "in_progress" || t.status === "in_qa",
  done: (t) => t.status === "done",
  dueToday: (t) => !!t.dueDate && t.status !== "done" && t.status !== "cancelled" && t.dueDate.slice(0, 10) === todayStr(),
  overdue: (t) => !!t.dueDate && t.status !== "done" && t.status !== "cancelled" && t.dueDate.slice(0, 10) < todayStr(),
  noLink: (t) => !t.links || t.links.length === 0,
};

const PRIORITY_LEVEL: Record<string, number> = { high: 0, medium: 1, low: 2 };

const sortTasks = (list: TaskWithLinks[]) =>
  [...list].sort((a, b) => {
    const pa = PRIORITY_LEVEL[a.priority] ?? 2;
    const pb = PRIORITY_LEVEL[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const dbTime = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    if (da !== dbTime) return da - dbTime;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

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
  const [activeActionTab, setActiveActionTab] = useState<string>("proposed");
  const [activeHash, setActiveHash] = useState<string>("");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [lastScanItems, setLastScanItems] = useState<ScanResultItem[] | null>(null);
  const [kpiFilters, setKpiFilters] = useState<Set<string>>(new Set());
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());
  const [workflowStatus, setWorkflowStatus] = useState<WorkflowStatus | null>(null);
  const [workflowRunning, setWorkflowRunning] = useState<"eod" | "sod" | null>(null);
  const [sodModalOpen, setSodModalOpen] = useState(false);
  const [eodModalOpen, setEodModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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
    } catch (err) {
      console.warn("[Dashboard] Scan status fetch failed:", err);
    }
  }, []);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports?limit=10");
      if (res.ok) setReports(await res.json());
    } catch (err) {
      console.warn("[Dashboard] Reports fetch failed:", err);
    }
  }, []);

  const fetchWorkflowStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/daily");
      if (res.ok) setWorkflowStatus(await res.json());
    } catch (err) {
      console.warn("[Dashboard] Workflow status fetch failed:", err);
    }
  }, []);

  const handleWorkflow = (type: "eod" | "sod") => {
    if (type === "sod") setSodModalOpen(true);
    else setEodModalOpen(true);
  };

  const handleWorkflowSent = useCallback(() => {
    setSodModalOpen(false);
    setEodModalOpen(false);
    fetchWorkflowStatus();
    handleRefreshAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchWorkflowStatus]);

  // hash → 뷰 라우팅 (LNB 연동)
  useEffect(() => {
    const update = () => {
      const h = window.location.hash.replace("#", "");
      setActiveHash(h);
    };
    update();
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  useEffect(() => {
    Promise.all([fetchTasks(), fetchActions(), fetchScanStatus(), fetchReports(), fetchWorkflowStatus()]);
  }, [fetchTasks, fetchActions, fetchScanStatus, fetchReports, fetchWorkflowStatus]);

  const handleRefreshAll = useCallback(() => {
    Promise.all([fetchTasks(), fetchActions(), fetchReports()]);
  }, [fetchTasks, fetchActions, fetchReports]);

  const handleScanNow = async () => {
    setIsScanning(true);
    const toastId = toast.loading("Jira · Slack 스캔 중...");
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success("스캔 완료!", { id: toastId });
        if (data.scanItems?.length > 0) {
          setLastScanItems(data.scanItems);
          window.location.hash = "history";
        }
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

  const applyColumnFilters = useCallback((base: TaskWithLinks[]) => {
    let result = base;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description ?? "").toLowerCase().includes(q)
      );
    }
    if (kpiFilters.size > 0) {
      result = result.filter((t) => Array.from(kpiFilters).some((k) => (KPI_FILTERS[k] ?? (() => false))(t)));
    }
    if (sourceFilters.size > 0) {
      result = result.filter((t) => sourceFilters.has(t.sourceType));
    }
    return sortTasks(result);
  }, [kpiFilters, sourceFilters, searchQuery]);

  const kanbanPending = useMemo(() =>
    applyColumnFilters(tasks.filter((t) => t.status === "pending")),
  [tasks, applyColumnFilters]);

  const kanbanActive = useMemo(() =>
    applyColumnFilters(tasks.filter((t) => t.status === "in_progress" || t.status === "in_qa")),
  [tasks, applyColumnFilters]);

  // 마지막 EOD 전송 이후 완료된 태스크만 칸반에 표시 (이전 것은 완료 이력 탭에서 확인)
  const kanbanDone = useMemo(() => {
    const lastEodAt = workflowStatus?.lastEod?.createdAt;
    const base = tasks.filter((t) => {
      if (t.status !== "done") return false;
      if (!lastEodAt) return true; // EOD 미전송이면 전부 표시
      const completedAt = t.completedAt ?? t.createdAt;
      return completedAt > lastEodAt; // EOD 이후 완료된 것만
    });
    return applyColumnFilters(base);
  }, [tasks, applyColumnFilters, workflowStatus]);

  const handleKpiClick = (key: string) => {
    setKpiFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (activeHash !== "" && activeHash !== "dashboard") {
      window.location.hash = "";
    }
  };
  const filteredActions = useMemo(() => {
    const tab = ACTION_FILTER_TABS.find((t) => t.key === activeActionTab) || ACTION_FILTER_TABS[0];
    return actions.filter(tab.filter);
  }, [actions, activeActionTab]);

  const stats = useMemo(() => ({
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    inProgress: tasks.filter((t) => t.status === "in_progress" || t.status === "in_qa").length,
    done: tasks.filter((t) => t.status === "done").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length,
    dueToday: tasks.filter(
      (t) => t.dueDate && t.status !== "done" && t.status !== "cancelled" && t.dueDate.slice(0, 10) === todayStr()
    ).length,
    overdue: tasks.filter(
      (t) => t.dueDate && t.status !== "done" && t.status !== "cancelled" && t.dueDate.slice(0, 10) < todayStr()
    ).length,
    noLink: tasks.filter((t) => !t.links || t.links.length === 0).length,
    pendingActions: actions.filter((a) => a.status === "proposed").length,
  }), [tasks, actions]);

  return (
    <div className="space-y-5">

      {/* ── 상단 컨트롤 바 ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2">
          <ConnStatus label="Jira" connected={scanStatus?.jira} />
          <div className="w-px h-3 bg-slate-200 mx-1" />
          <ConnStatus label="Slack" connected={scanStatus?.slack} />
          <div className="w-px h-3 bg-slate-200 mx-1" />
          <ConnStatus label="Scheduler" connected={scanStatus?.scheduler} />
        </div>
        <div className="flex items-center gap-2">
          <TaskForm onCreated={handleRefreshAll} />
          <button
            onClick={handleScanNow}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[var(--accent)] hover:bg-[var(--accent-dim)] text-white disabled:opacity-50 rounded-xl transition-all cursor-pointer"
          >
            <ScanLine size={13} />
            {isScanning ? "스캔 중..." : "지금 스캔"}
          </button>
        </div>
      </div>

      {/* ── 모달 ── */}
      <AnimatePresence>
        {sodModalOpen && (
          <WorkflowSODModal onClose={() => setSodModalOpen(false)} onSent={handleWorkflowSent} />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {eodModalOpen && (
          <WorkflowEODModal onClose={() => setEodModalOpen(false)} onSent={handleWorkflowSent} />
        )}
      </AnimatePresence>

      {/* ── 대시보드 뷰 ── */}
      {(!activeHash || activeHash === "dashboard") && (
        <>
          {/* 하루 플로우 — 컴팩트 스트립 */}
          <CompactWorkflowStrip
            status={workflowStatus}
            running={workflowRunning}
            onTrigger={handleWorkflow}
          />

          {/* 상태 필터 chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">필터</span>
            {[
              { key: "all",      label: "전체",     count: stats.total },
              { key: "pending",  label: "대기",      count: stats.pending },
              { key: "in_progress", label: "진행 중", count: stats.inProgress },
              { key: "dueToday", label: "오늘 마감", count: stats.dueToday, alert: stats.dueToday > 0 },
              { key: "overdue",  label: "기한 초과", count: stats.overdue, alert: stats.overdue > 0 },
            ].map(({ key, label, count, alert }) => {
              const isActive = key === "all" ? kpiFilters.size === 0 : kpiFilters.has(key);
              return (
                <button
                  key={key}
                  onClick={() => {
                    if (key === "all") {
                      setKpiFilters(new Set());
                    } else {
                      handleKpiClick(key);
                    }
                  }}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all",
                    isActive
                      ? "bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:border-[var(--accent-border)]"
                  )}
                >
                  {label}
                  <span className={cn("text-[11px] font-bold tabular-nums", isActive ? "text-white/80" : "text-[var(--accent)]")}>
                    {count}
                  </span>
                  {alert && !isActive && count > 0 && (
                    <span className="w-1 h-1 rounded-full bg-[var(--accent)] animate-soft-pulse" />
                  )}
                </button>
              );
            })}
          </div>

          {/* 소스 필터 + 검색 */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5">
              {SOURCE_FILTERS.map((sf) => {
                const isActive = sourceFilters.has(sf.key);
                return (
                  <button
                    key={sf.key}
                    onClick={() => setSourceFilters((prev) => {
                      const next = new Set(prev);
                      if (next.has(sf.key)) next.delete(sf.key); else next.add(sf.key);
                      return next;
                    })}
                    className={cn(
                      "px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer tracking-wide",
                      isActive ? sf.activeColor : sf.color
                    )}
                  >
                    {sf.label}
                  </button>
                );
              })}
              {sourceFilters.size > 0 && (
                <button
                  onClick={() => setSourceFilters(new Set())}
                  className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 cursor-pointer px-1"
                >
                  <X size={11} /> 해제
                </button>
              )}
            </div>
            {/* 검색 */}
            <div className="relative flex items-center">
              <svg className="absolute left-3 text-slate-400 pointer-events-none" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                placeholder="제목·내용 검색..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-7 py-1.5 text-[13px] bg-white border border-slate-200 rounded-xl outline-none w-44 placeholder:text-slate-400 text-slate-700 transition-all focus:border-[var(--accent)]/40 focus:shadow-[0_0_0_3px_var(--accent-glow)]"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* 활성 필터 요약 */}
          {(kpiFilters.size > 0 || searchQuery.trim()) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--accent-glow)] border border-[var(--accent-border)] rounded-xl text-sm flex-wrap">
              {Array.from(kpiFilters).map((k) => {
                const label = { pending: "대기", in_progress: "진행 중", done: "완료", dueToday: "오늘 마감", overdue: "기한 초과" }[k];
                return (
                  <span key={k} className="flex items-center gap-1 bg-white border border-[var(--accent-border)] px-2 py-0.5 rounded-lg text-xs font-semibold text-[var(--accent)]">
                    {label}
                    <button onClick={() => handleKpiClick(k)}><X size={9} /></button>
                  </span>
                );
              })}
              {searchQuery.trim() && (
                <span className="flex items-center gap-1 bg-white border border-[var(--accent-border)] px-2 py-0.5 rounded-lg text-xs font-semibold text-[var(--accent)]">
                  "{searchQuery}"
                  <button onClick={() => setSearchQuery("")}><X size={9} /></button>
                </span>
              )}
              <span className="text-xs text-[var(--accent)]/60 ml-1">{kanbanPending.length + kanbanActive.length + kanbanDone.length}건</span>
              <button
                onClick={() => { setKpiFilters(new Set()); setSearchQuery(""); }}
                className="ml-auto text-xs text-[var(--accent)] hover:underline"
              >
                전체 해제
              </button>
            </div>
          )}

          {/* 칸반 */}
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
              <KanbanColumn title="대기" tasks={kanbanPending} onUpdate={handleRefreshAll} dotColor="bg-slate-300" headerColor="text-slate-500" emptyLabel="대기 중인 할일 없음" />
              <KanbanColumn title="진행 중 · IN-QA" tasks={kanbanActive} onUpdate={handleRefreshAll} dotColor="bg-[var(--accent)]" headerColor="text-[var(--accent)]" emptyLabel="진행 중인 할일 없음" />
              <KanbanColumn title="완료" tasks={kanbanDone} onUpdate={handleRefreshAll} dotColor="bg-slate-400" headerColor="text-slate-500" emptyLabel="완료된 할일 없음" />
            </div>
          )}
        </>
      )}

      {/* ── 자동 액션 뷰 ── */}
      {activeHash === "actions" && (
        <motion.div key="actions" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
          <FilterBar
            tabs={ACTION_FILTER_TABS}
            active={activeActionTab}
            onSelect={setActiveActionTab}
            counts={ACTION_FILTER_TABS.reduce((acc, t) => ({ ...acc, [t.key]: actions.filter(t.filter).length }), {} as Record<string, number>)}
            activeColor="bg-[var(--accent)]"
          />
          {filteredActions.length === 0 ? (
            <EmptyState icon={<Bot size={32} className="text-slate-300" />} message="대기 중인 액션이 없습니다" sub="30분 간격 자동 스캔 또는 '지금 스캔' 버튼으로 생성됩니다" />
          ) : (
            <motion.div className="grid grid-cols-1 md:grid-cols-2 gap-4" variants={containerVariants} initial="hidden" animate="visible">
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

      {/* ── 완료 이력 뷰 ── */}
      {activeHash === "completed" && (
        <motion.div key="completed" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <CompletedHistory tasks={tasks} onUpdate={handleRefreshAll} />
        </motion.div>
      )}

      {/* ── 스캔 이력 뷰 ── */}
      {activeHash === "history" && (
        <motion.div key="history" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="space-y-4">
          {lastScanItems && lastScanItems.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="bg-white border border-[var(--accent-border)] rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-soft-pulse" />
                  <span className="text-sm font-semibold text-slate-700">이번 스캔 결과 <span className="text-[var(--accent)]">({lastScanItems.length}건)</span></span>
                </div>
                <button onClick={() => setLastScanItems(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100"><X size={13} /></button>
              </div>
              <div className="space-y-1">
                {lastScanItems.map((item, i) => (
                  <a key={i} href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--surface2)] transition-colors group overflow-hidden">
                    {item.type === "jira" ? (
                      <>
                        <span className="w-4 h-4 rounded bg-[var(--accent)] flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">J</span>
                        <span className="text-xs font-medium text-[var(--accent)] flex-shrink-0">{item.key}</span>
                        <span className="text-xs text-slate-600 truncate flex-1">{item.summary}</span>
                        <span className="text-[10px] text-slate-400 flex-shrink-0">{item.status}</span>
                      </>
                    ) : (
                      <>
                        <MessageSquare size={12} className="text-[var(--accent)] flex-shrink-0" />
                        <span className="text-xs font-medium text-[var(--accent)] flex-shrink-0">#{item.channel}</span>
                        <span className="text-xs text-slate-600 truncate flex-1">{item.preview}</span>
                      </>
                    )}
                    <ExternalLink size={10} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                  </a>
                ))}
              </div>
            </motion.div>
          )}
          {reports.length === 0 ? (
            <EmptyState icon={<History size={32} className="text-slate-300" />} message="스캔 이력이 없습니다" sub="'지금 스캔' 버튼을 눌러 첫 번째 스캔을 실행하세요" />
          ) : (
            <motion.div className="space-y-2" variants={containerVariants} initial="hidden" animate="visible">
              {reports.map((report) => (
                <motion.div key={report.id} variants={itemVariants}><ReportCard report={report} /></motion.div>
              ))}
            </motion.div>
          )}
        </motion.div>
      )}

      {/* ── 설정 뷰 ── */}
      {activeHash === "settings" && (
        <motion.div key="settings" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
          <SettingsView scanStatus={scanStatus} />
        </motion.div>
      )}

    </div>
  );
}

// ===== 설정 뷰 =====
function SettingsView({ scanStatus }: { scanStatus: ScanStatus | null }) {
  const integrations = [
    {
      key: "jira",
      name: "Jira",
      abbr: "J",
      connected: scanStatus?.jira,
      detail1Label: "사이트",
      detail1: "catchtable.atlassian.net",
      detail2Label: "프로젝트",
      detail2: "BIZWAIT",
    },
    {
      key: "slack",
      name: "Slack",
      abbr: "S",
      connected: scanStatus?.slack,
      detail1Label: "워크스페이스",
      detail1: "wad-hq.slack.com",
      detail2Label: "유저",
      detail2: "U042YQ0RUAY",
    },
  ];

  return (
    <div className="max-w-2xl space-y-6">
      {/* 섹션: 연동 상태 */}
      <div>
        <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-widest mb-3">연동 상태</h2>
        <div className="grid grid-cols-2 gap-3">
          {integrations.map((intg) => (
            <div key={intg.key} className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[var(--shadow-card)]">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white text-[11px] font-bold flex-shrink-0">
                    {intg.abbr}
                  </div>
                  <span className="text-[14px] font-semibold text-slate-700">{intg.name}</span>
                </div>
                <div className={cn(
                  "flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-semibold",
                  intg.connected === undefined
                    ? "bg-slate-50 text-slate-400"
                    : intg.connected
                    ? "bg-emerald-50 text-emerald-600"
                    : "bg-red-50 text-red-500"
                )}>
                  <div className={cn(
                    "w-1.5 h-1.5 rounded-full",
                    intg.connected === undefined ? "bg-slate-300" : intg.connected ? "bg-emerald-500 animate-soft-pulse" : "bg-red-400"
                  )} />
                  {intg.connected === undefined ? "확인 중" : intg.connected ? "연결됨" : "연결 안됨"}
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{intg.detail1Label}</span>
                  <span className="text-[11px] font-medium text-slate-600 truncate max-w-[140px]">{intg.detail1}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400">{intg.detail2Label}</span>
                  <span className="text-[11px] font-medium text-slate-600">{intg.detail2}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 섹션: 스캔 설정 */}
      <div>
        <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-widest mb-3">스캔 설정</h2>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[var(--shadow-card)]">
          <div className="space-y-3">
            {[
              { label: "자동 스캔 주기", value: "30분 간격", note: "크론 스케줄러 (cron)" },
              { label: "Jira 스캔 범위", value: "할당된 이슈 전체", note: "assignee = currentUser()" },
              { label: "Slack 스캔 범위", value: "멘션 + DM", note: "최근 7일 기준" },
              { label: "AI 액션 제안", value: "자동 생성", note: "Anthropic Claude 기반" },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div>
                  <span className="text-[13px] font-medium text-slate-600">{row.label}</span>
                  <span className="text-[11px] text-slate-400 ml-2">({row.note})</span>
                </div>
                <span className="text-[12px] font-semibold text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent-border)] px-2.5 py-1 rounded-full">
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 섹션: 사용자 */}
      <div>
        <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-widest mb-3">사용자</h2>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[var(--shadow-card)] flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent)] flex items-center justify-center text-white text-[15px] font-bold flex-shrink-0">주</div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-slate-700">주현우</p>
            <p className="text-[12px] text-slate-400">B2B서비스</p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 rounded-full">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-soft-pulse" />
            <span className="text-[10px] font-semibold text-emerald-600">온라인</span>
          </div>
        </div>
      </div>

      {/* 섹션: 데이터베이스 */}
      <div>
        <h2 className="text-[13px] font-semibold text-slate-500 uppercase tracking-widest mb-3">데이터</h2>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[var(--shadow-card)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[13px] font-medium text-slate-600">로컬 SQLite DB</p>
              <p className="text-[11px] text-slate-400 mt-0.5">data/autopilot.db · Prisma ORM</p>
            </div>
            <span className="text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent-border)] px-2.5 py-1 rounded-full">로컬 전용</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ===== 서브 컴포넌트 =====

function KpiCard({
  icon, label, value, alert, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  alert?: boolean;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -1, transition: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        "relative bg-white rounded-xl p-3.5 cursor-pointer transition-all border",
        active
          ? "border-l-[3px] border-[var(--accent)] shadow-[var(--shadow-card-hover)]"
          : "border-slate-100 hover:border-slate-200 hover:shadow-[var(--shadow-card)]"
      )}
    >
      <div className={cn(
        "w-6 h-6 rounded-lg flex items-center justify-center mb-2.5 transition-all",
        active ? "bg-[var(--accent)] text-white" : "bg-slate-100 text-slate-400"
      )}>
        {icon}
      </div>
      <div className={cn(
        "text-2xl font-bold tracking-tight leading-none",
        active ? "text-[var(--accent)]" : value > 0 ? "text-slate-700" : "text-slate-200"
      )}>
        {value}
      </div>
      <div className="text-[10px] font-medium text-slate-400 mt-1.5">{label}</div>
      {alert && value > 0 && !active && (
        <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-[var(--accent)] opacity-50 animate-soft-pulse" />
      )}
    </motion.div>
  );
}

function ConnStatus({ label, connected }: { label: string; connected?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn(
        "w-1.5 h-1.5 rounded-full transition-colors",
        connected === undefined ? "bg-slate-300" : connected ? "bg-emerald-500" : "bg-red-400"
      )} />
      <span className="text-xs font-medium text-slate-500">{label}</span>
    </div>
  );
}

// ===== 완료 이력 =====
function CompletedHistory({ tasks, onUpdate }: { tasks: TaskWithLinks[]; onUpdate: () => void }) {
  const doneTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status === "done")
      .sort((a, b) => {
        const aDate = a.completedAt ?? a.createdAt;
        const bDate = b.completedAt ?? b.createdAt;
        return bDate.localeCompare(aDate); // 최신순
      });
  }, [tasks]);

  // 날짜별 그룹핑
  const grouped = useMemo(() => {
    const groups: { dateStr: string; label: string; tasks: TaskWithLinks[] }[] = [];
    const map = new Map<string, TaskWithLinks[]>();
    for (const t of doneTasks) {
      const key = (t.completedAt ?? t.createdAt).slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    const todayStr = new Date().toISOString().slice(0, 10);
    const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
    for (const [dateStr, items] of map.entries()) {
      const label = dateStr === todayStr ? "오늘" : dateStr === yesterdayStr ? "어제" : dateStr;
      groups.push({ dateStr, label, tasks: items });
    }
    groups.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    return groups;
  }, [doneTasks]);

  if (doneTasks.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 size={32} className="text-slate-300" />}
        message="완료된 할일이 없습니다"
        sub="할일을 완료 처리하면 여기에 날짜별로 모입니다"
      />
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(({ dateStr, label, tasks: groupTasks }) => (
        <div key={dateStr}>
          {/* 날짜 헤더 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent-border)] px-2 py-0.5 rounded-full">
              {label}
            </span>
            <span className="text-[11px] text-slate-400">{groupTasks.length}건 완료</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          {/* 태스크 목록 */}
          <div className="space-y-2">
            {groupTasks.map((t) => (
              <TaskCard key={t.id} task={t} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SectionTab({
  active, onClick, icon, label, count, badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
  badge?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium rounded-xl cursor-pointer transition-all",
        "duration-200",
        active
          ? "bg-[var(--accent)] text-white shadow-sm shadow-[var(--accent)]/15"
          : "text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--surface2)]"
      )}
      style={{ transition: `background 0.2s var(--spring), color 0.2s var(--spring)` }}
    >
      {icon}
      {label}
      {count !== undefined && (
        badge ? (
          <span className="text-[10px] bg-[var(--accent)] text-white px-1.5 py-0.5 rounded-full leading-none font-bold">
            {count}
          </span>
        ) : (
          <span className="text-[11px] text-slate-400 font-normal ml-0.5">{count}</span>
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
    <div className="flex gap-1 bg-[var(--surface2)] border border-[var(--border2)] rounded-xl p-1.5 w-fit">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelect(tab.key)}
          className={`px-4 py-2 text-sm rounded-lg transition-all cursor-pointer font-medium ${
            active === tab.key
              ? `${activeColor} text-white shadow-md`
              : "text-slate-500 hover:text-slate-800 hover:bg-[var(--surface)]"
          }`}
        >
          {tab.label}
          <span className="ml-1.5 text-xs opacity-50">{counts[tab.key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="w-8 h-8 border-[2.5px] border-[var(--border2)] border-t-[var(--accent)] rounded-full animate-spin" />
      <span className="text-sm text-slate-500">로딩 중...</span>
    </div>
  );
}

function EmptyState({ icon, message, sub }: { icon: React.ReactNode; message: string; sub?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-24 gap-4 border border-dashed border-slate-200 rounded-2xl"
    >
      <motion.div
        animate={{ y: [0, -4, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center"
      >
        {icon}
      </motion.div>
      <div className="text-base text-slate-600 font-medium">{message}</div>
      {sub && <div className="text-sm text-slate-400">{sub}</div>}
    </motion.div>
  );
}

// ===== 칸반 컬럼 =====
function KanbanColumn({
  title, tasks, onUpdate, dotColor, headerColor, emptyLabel,
}: {
  title: string;
  tasks: TaskWithLinks[];
  onUpdate: () => void;
  dotColor: string;
  headerColor: string;
  emptyLabel: string;
}) {
  return (
    <div className="bg-slate-50/80 rounded-2xl p-3 border border-slate-100">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <span className="text-[12px] font-semibold text-slate-600 flex-1">{title}</span>
        <span className={`text-[11px] font-semibold tabular-nums ${headerColor}`}>{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="flex items-center justify-center py-8 text-[11px] text-slate-300">{emptyLabel}</div>
      ) : (
        <motion.div
          className="space-y-2"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          {tasks.map((task) => (
            <motion.div key={task.id} variants={itemVariants}>
              <TaskCard task={task} onUpdate={onUpdate} compact />
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}

// ===== 취소 이력 =====
function CancelledHistory({ tasks, onUpdate }: { tasks: TaskWithLinks[]; onUpdate: () => void }) {
  const cancelledTasks = useMemo(() => {
    return tasks
      .filter((t) => t.status === "cancelled")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [tasks]);

  const grouped = useMemo(() => {
    const groups: { dateStr: string; label: string; tasks: TaskWithLinks[] }[] = [];
    const map = new Map<string, TaskWithLinks[]>();
    for (const t of cancelledTasks) {
      const key = t.createdAt.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); })();
    for (const [dateStr, items] of map.entries()) {
      const label = dateStr === today ? "오늘" : dateStr === yesterday ? "어제" : dateStr;
      groups.push({ dateStr, label, tasks: items });
    }
    groups.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
    return groups;
  }, [cancelledTasks]);

  if (cancelledTasks.length === 0) {
    return (
      <EmptyState
        icon={<Ban size={32} className="text-slate-300" />}
        message="취소된 할일이 없습니다"
        sub="취소 처리된 할일이 여기에 모입니다"
      />
    );
  }

  return (
    <div className="space-y-5">
      {grouped.map(({ dateStr, label, tasks: groupTasks }) => (
        <div key={dateStr}>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
              {label}
            </span>
            <span className="text-[11px] text-slate-400">{groupTasks.length}건 취소</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          <div className="space-y-2">
            {groupTasks.map((t) => (
              <TaskCard key={t.id} task={t} onUpdate={onUpdate} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportCard({ report }: { report: DailyReport }) {
  let summary: Record<string, number> | null = null;
  try {
    if (report.summary) summary = JSON.parse(report.summary);
  } catch {}

  const pendingCount = (() => {
    try {
      return report.pendingActions ? JSON.parse(report.pendingActions).length : 0;
    } catch { return 0; }
  })();

  return (
    <div className="relative bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 hover:border-[var(--accent-border)] hover:shadow-[var(--shadow-card-hover)] transition-all overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-[var(--accent)] rounded-l-xl" />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-[var(--accent)]" />
          <span className="text-[15px] font-medium text-slate-700">{report.date}</span>
          {report.slackMessageTs && (
            <span className="text-xs text-[var(--accent)] bg-[var(--accent-glow)] border border-[var(--accent-border)] px-1.5 py-0.5 rounded-full">
              Slack 발송됨
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{report.createdAt.slice(11, 16)}</span>
      </div>

      {summary ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "진행 중",  value: summary.inProgress ?? 0,  color: "text-[var(--accent)]" },
            { label: "백로그",   value: summary.backlog    ?? 0,  color: "text-slate-500"        },
            { label: "7일 완료", value: summary.done7d     ?? 0,  color: "text-slate-600"        },
            { label: "대기 액션",value: pendingCount,              color: pendingCount > 0 ? "text-[var(--accent)]" : "text-slate-400" },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--surface2)] rounded-xl p-3 text-center">
              <div className={`text-xl font-bold ${item.color}`}>{item.value}</div>
              <div className="text-xs text-slate-400 mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">요약 데이터 없음</p>
      )}
    </div>
  );
}

function CompactWorkflowStrip({
  status, running, onTrigger,
}: {
  status: WorkflowStatus | null;
  running: "eod" | "sod" | null;
  onTrigger: (type: "eod" | "sod") => void;
}) {
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
    } catch { return iso.slice(11, 16); }
  };
  const isSodNext = status?.nextAction === "sod";
  const isEodNext = status?.nextAction === "eod";

  return (
    <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-xl px-4 py-2.5">
      {/* 하루 시작 */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0", isSodNext ? "bg-[var(--accent)] text-white" : "bg-slate-100 text-slate-400")}>
          <Sunrise size={13} />
        </div>
        <div className="min-w-0">
          <span className="text-[12px] font-semibold text-slate-700">하루 시작</span>
          {status?.lastSod ? (
            <span className="text-[11px] text-slate-400 ml-1.5">마지막 {formatTime(status.lastSod.createdAt)}</span>
          ) : (
            <span className="text-[11px] text-slate-400 ml-1.5">미실행 · {status?.nextSodTime ?? "--:--"}</span>
          )}
        </div>
      </div>

      <div className="w-px h-4 bg-slate-100 flex-shrink-0" />

      {/* 하루 마무리 */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0", isEodNext ? "bg-[var(--foreground)] text-white" : "bg-slate-100 text-slate-400")}>
          <Sunset size={13} />
        </div>
        <div className="min-w-0">
          <span className="text-[12px] font-semibold text-slate-700">하루 마무리</span>
          {status?.lastEod ? (
            <span className="text-[11px] text-slate-400 ml-1.5">마지막 {formatTime(status.lastEod.createdAt)}</span>
          ) : (
            <span className="text-[11px] text-slate-400 ml-1.5">미실행 · {status?.nextEodTime ?? "--:--"}</span>
          )}
        </div>
      </div>

      {/* 버튼 */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          onClick={() => onTrigger("sod")}
          disabled={!!running}
          className={cn(
            "px-3 py-1.5 text-[12px] font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50",
            isSodNext
              ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-dim)]"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          )}
        >
          {running === "sod" ? "처리중..." : "시작"}
        </button>
        <button
          onClick={() => onTrigger("eod")}
          disabled={!!running}
          className={cn(
            "px-3 py-1.5 text-[12px] font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50",
            isEodNext
              ? "bg-[var(--foreground)] text-white hover:bg-slate-800"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          )}
        >
          {running === "eod" ? "처리중..." : "마무리"}
        </button>
      </div>
    </div>
  );
}
