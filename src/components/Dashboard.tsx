"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ScanLine, Zap, CheckCircle2, Clock, AlertTriangle, Link2Off,
  Bell, ListTodo, Bot, CircleDot, RefreshCw, History, CalendarDays,
  TrendingUp, GripVertical,
} from "lucide-react";
import TaskForm from "./TaskForm";
import TaskCard from "./TaskCard";
import ActionCard from "./ActionCard";

type TaskWithLinks = {
  id: string; title: string; description?: string | null;
  status: string; priority: string; sourceType: string;
  dueDate?: string | null; createdAt: string; completedAt?: string | null;
  links?: any[];
};
type ActionWithTask = {
  id: string; taskId: string; actionType: string; description: string;
  payload?: string | null; status: string; proposedAt: string;
  executedAt?: string | null; resultLink?: string | null;
  task?: { id: string; title: string; status: string } | null;
};
type DailyReport = {
  id: string; date: string; summary: string | null;
  pendingActions: string | null; slackMessageTs: string | null; createdAt: string;
};
type ScanStatus = { jira: boolean; slack: boolean; scheduler: boolean };

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

const containerVariants = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
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
  const [activeSection, setActiveSection] = useState<"tasks" | "actions" | "history">("tasks");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [reports, setReports] = useState<DailyReport[]>([]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?includeLinks=true");
      if (res.ok) setTasks(await res.json());
    } catch { toast.error("할일 목록 로드 실패"); }
    finally { setIsLoading(false); }
  }, []);

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch("/api/actions");
      if (res.ok) setActions(await res.json());
    } catch { toast.error("액션 목록 로드 실패"); }
  }, []);

  const fetchScanStatus = useCallback(async () => {
    try { const res = await fetch("/api/scan"); if (res.ok) setScanStatus(await res.json()); } catch {}
  }, []);

  const fetchReports = useCallback(async () => {
    try { const res = await fetch("/api/reports?limit=10"); if (res.ok) setReports(await res.json()); } catch {}
  }, []);

  useEffect(() => {
    fetchTasks(); fetchActions(); fetchScanStatus(); fetchReports();
  }, [fetchTasks, fetchActions, fetchScanStatus, fetchReports]);

  const handleRefreshAll = useCallback(() => {
    fetchTasks(); fetchActions(); fetchReports();
  }, [fetchTasks, fetchActions, fetchReports]);

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const currentFilter = FILTER_TABS.find((t) => t.key === activeTab) || FILTER_TABS[0];
    const visibleTasks = tasks.filter(currentFilter.filter);
    const oldIndex = visibleTasks.findIndex((t) => t.id === active.id);
    const newIndex = visibleTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(visibleTasks, oldIndex, newIndex);
    const visibleIds = new Set(visibleTasks.map((t) => t.id));
    const nonVisible = tasks.filter((t) => !visibleIds.has(t.id));
    setTasks([...reordered, ...nonVisible]);
    try {
      await fetch("/api/tasks/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((t) => t.id) }),
      });
    } catch {
      toast.error("순서 저장 실패");
      fetchTasks();
    }
  }, [tasks, activeTab, fetchTasks]);

  const handleScanNow = async () => {
    setIsScanning(true);
    const toastId = toast.loading("Jira · Slack 스캔 중...");
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (data.success) { toast.success("스캔 완료! Slack DM을 확인하세요.", { id: toastId }); handleRefreshAll(); }
      else toast.error("스캔 실패: " + (data.error || "알 수 없는 오류"), { id: toastId });
    } catch { toast.error("스캔 실패: 서버 연결 오류", { id: toastId }); }
    finally { setIsScanning(false); }
  };

  const handleExecuteNow = async () => {
    setIsScanning(true);
    const toastId = toast.loading("승인된 액션 실행 중...");
    try {
      const res = await fetch("/api/scan?type=execute", { method: "POST" });
      const data = await res.json();
      if (data.success) { toast.success("액션 실행 완료!", { id: toastId }); handleRefreshAll(); }
      else toast.error("실행 실패: " + (data.error || "알 수 없는 오류"), { id: toastId });
    } catch { toast.error("실행 실패: 서버 연결 오류", { id: toastId }); }
    finally { setIsScanning(false); }
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
    overdue: tasks.filter((t) => t.dueDate && t.status !== "done" && t.status !== "cancelled" && new Date(t.dueDate) < new Date()).length,
    noLink: tasks.filter((t) => !t.links || t.links.length === 0).length,
    pendingActions: actions.filter((a) => a.status === "proposed").length,
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-4">
          <ConnStatus label="Jira" connected={scanStatus?.jira} />
          <ConnStatus label="Slack" connected={scanStatus?.slack} />
          <ConnStatus label="Scheduler" connected={scanStatus?.scheduler} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleRefreshAll} disabled={isScanning}
            className="p-2 text-slate-500 hover:text-slate-300 hover:bg-[var(--surface2)] rounded-lg transition-all cursor-pointer"
            title="새로고침">
            <RefreshCw size={14} className={isScanning ? "animate-spin" : ""} />
          </button>
          <button onClick={handleExecuteNow} disabled={isScanning || stats.pendingActions === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 hover:border-amber-500/50 text-amber-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-all cursor-pointer">
            <Zap size={12} />액션 실행
            {stats.pendingActions > 0 && (
              <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full leading-none">{stats.pendingActions}</span>
            )}
          </button>
          <button onClick={handleScanNow} disabled={isScanning}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 hover:border-blue-500/60 text-blue-400 disabled:opacity-50 rounded-lg transition-all cursor-pointer glow-blue">
            <ScanLine size={12} />{isScanning ? "스캔 중..." : "지금 스캔"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
        <KpiCard icon={<Clock size={14} />} label="대기" value={stats.pending} color="text-slate-300" borderColor="border-slate-700/50" />
        <KpiCard icon={<CircleDot size={14} />} label="진행 중" value={stats.inProgress} color="text-blue-400" borderColor="border-blue-700/40" />
        <KpiCard icon={<CheckCircle2 size={14} />} label="완료" value={stats.done} color="text-emerald-400" borderColor="border-emerald-800/40" />
        <KpiCard icon={<AlertTriangle size={14} />} label="기한 초과" value={stats.overdue}
          color={stats.overdue > 0 ? "text-red-400" : "text-slate-600"}
          borderColor={stats.overdue > 0 ? "border-red-700/50" : "border-slate-800"} alert={stats.overdue > 0} />
        <KpiCard icon={<Link2Off size={14} />} label="연결 없음" value={stats.noLink}
          color={stats.noLink > 0 ? "text-yellow-400" : "text-slate-600"}
          borderColor={stats.noLink > 0 ? "border-yellow-700/40" : "border-slate-800"} />
        <KpiCard icon={<Bell size={14} />} label="승인 대기" value={stats.pendingActions}
          color={stats.pendingActions > 0 ? "text-amber-400" : "text-slate-600"}
          borderColor={stats.pendingActions > 0 ? "border-amber-700/50" : "border-slate-800"}
          alert={stats.pendingActions > 0} onClick={() => setActiveSection("actions")} />
      </div>

      <div className="flex items-center gap-0.5 border-b border-[var(--border2)]">
        <SectionTab active={activeSection === "tasks"} onClick={() => setActiveSection("tasks")}
          icon={<ListTodo size={14} />} label="TO-DO" count={tasks.length} activeColor="text-blue-400 border-blue-500" />
        <SectionTab active={activeSection === "actions"} onClick={() => setActiveSection("actions")}
          icon={<Bot size={14} />} label="자동 액션"
          count={stats.pendingActions > 0 ? stats.pendingActions : undefined}
          badge={stats.pendingActions > 0} activeColor="text-amber-400 border-amber-500" />
        <SectionTab active={activeSection === "history"} onClick={() => setActiveSection("history")}
          icon={<History size={14} />} label="스캔 이력" activeColor="text-purple-400 border-purple-500" />
      </div>

      <AnimatePresence mode="wait">
        {activeSection === "tasks" && (
          <motion.div key="tasks" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }} transition={{ duration: 0.2 }} className="space-y-4">
            <TaskForm onCreated={handleRefreshAll} />
            <FilterBar tabs={FILTER_TABS} active={activeTab} onSelect={setActiveTab}
              counts={FILTER_TABS.reduce((acc, t) => ({ ...acc, [t.key]: tasks.filter(t.filter).length }), {} as Record<string, number>)}
              activeColor="bg-blue-600" />
            {isLoading ? (
              <LoadingSpinner />
            ) : filteredTasks.length === 0 ? (
              <EmptyState icon={<ListTodo size={32} className="text-slate-700" />}
                message={activeTab === "active" ? "진행 중인 할일이 없습니다" : "할일이 없습니다"}
                sub={activeTab === "active" ? "위의 '+ 새 할일 추가' 버튼으로 시작하세요" : undefined} />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={filteredTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                  <motion.div className="space-y-2.5" variants={containerVariants} initial="hidden" animate="visible">
                    <AnimatePresence>
                      {filteredTasks.map((task) => (
                        <motion.div key={task.id} variants={itemVariants} exit="exit">
                          <SortableTaskCard task={task} onUpdate={handleRefreshAll} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </motion.div>
                </SortableContext>
              </DndContext>
            )}
          </motion.div>
        )}
        {activeSection === "actions" && (
          <motion.div key="actions" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }} className="space-y-4">
            <FilterBar tabs={ACTION_FILTER_TABS} active={activeActionTab} onSelect={setActiveActionTab}
              counts={ACTION_FILTER_TABS.reduce((acc, t) => ({ ...acc, [t.key]: actions.filter(t.filter).length }), {} as Record<string, number>)}
              activeColor="bg-amber-600" />
            {filteredActions.length === 0 ? (
              <EmptyState icon={<Bot size={32} className="text-slate-700" />}
                message={activeActionTab === "proposed" ? "대기 중인 액션이 없습니다" : "액션 기록이 없습니다"}
                sub="매일 17:30 자동 스캔 또는 '지금 스캔' 버튼으로 생성됩니다" />
            ) : (
              <motion.div className="grid grid-cols-1 md:grid-cols-2 gap-2.5"
                variants={containerVariants} initial="hidden" animate="visible">
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
        {activeSection === "history" && (
          <motion.div key="history" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.2 }} className="space-y-3">
            {reports.length === 0 ? (
              <EmptyState icon={<History size={32} className="text-slate-700" />}
                message="스캔 이력이 없습니다" sub="'지금 스캔' 버튼을 눌러 첫 번째 스캔을 실행하세요" />
            ) : (
              <motion.div className="space-y-2" variants={containerVariants} initial="hidden" animate="visible">
                {reports.map((report) => (
                  <motion.div key={report.id} variants={itemVariants}><ReportCard report={report} /></motion.div>
                ))}
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function KpiCard({ icon, label, value, color, borderColor, alert, onClick }: {
  icon: React.ReactNode; label: string; value: number;
  color: string; borderColor: string; alert?: boolean; onClick?: () => void;
}) {
  return (
    <motion.div whileHover={onClick ? { scale: 1.03 } : {}} whileTap={onClick ? { scale: 0.97 } : {}}
      onClick={onClick}
      className={`relative bg-[var(--surface)] border ${borderColor} rounded-xl px-3 py-3 transition-all ${onClick ? "cursor-pointer" : ""} ${alert ? "glow-amber" : ""}`}>
      <div className={`flex items-center gap-1.5 mb-1.5 ${color} opacity-60`}>
        {icon}<span className="text-[10px] font-medium">{label}</span>
      </div>
      <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
      {alert && value > 0 && <div className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
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

function SectionTab({ active, onClick, icon, label, count, badge, activeColor }: {
  active: boolean; onClick: () => void; icon: React.ReactNode;
  label: string; count?: number; badge?: boolean; activeColor: string;
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 px-4 pb-2.5 pt-1 text-sm font-medium transition-all border-b-2 cursor-pointer ${
        active ? `${activeColor} border-current` : "border-transparent text-slate-500 hover:text-slate-300"
      }`}>
      {icon}{label}
      {count !== undefined && (
        badge
          ? <span className="text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded-full leading-none">{count}</span>
          : <span className="text-xs opacity-50">{count}</span>
      )}
    </button>
  );
}

function FilterBar({ tabs, active, onSelect, counts, activeColor }: {
  tabs: readonly { key: string; label: string }[];
  active: string; onSelect: (key: string) => void;
  counts: Record<string, number>; activeColor: string;
}) {
  return (
    <div className="flex gap-1 bg-[var(--surface)] border border-[var(--border2)] rounded-xl p-1 w-fit">
      {tabs.map((tab) => (
        <button key={tab.key} onClick={() => onSelect(tab.key)}
          className={`px-4 py-1.5 text-sm rounded-lg transition-all cursor-pointer font-medium ${
            active === tab.key ? `${activeColor} text-white shadow-sm` : "text-slate-400 hover:text-slate-200 hover:bg-[var(--surface2)]"
          }`}>
          {tab.label}<span className="ml-1.5 text-xs opacity-60">{counts[tab.key] ?? 0}</span>
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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-20 gap-3">
      {icon}
      <div className="text-sm text-slate-500 font-medium">{message}</div>
      {sub && <div className="text-xs text-slate-600">{sub}</div>}
    </motion.div>
  );
}

function SortableTaskCard({ task, onUpdate }: { task: TaskWithLinks; onUpdate: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-0">
      <div {...listeners} {...attributes}
        className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-slate-500 hover:text-slate-300 transition-colors touch-none select-none"
        title="드래그하여 순서 변경">
        <GripVertical size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <TaskCard task={task} onUpdate={onUpdate} />
      </div>
    </div>
  );
}

function ReportCard({ report }: { report: DailyReport }) {
  let summary: Record<string, number> | null = null;
  try { if (report.summary) summary = JSON.parse(report.summary); } catch {}
  const pendingCount = (() => {
    try { return report.pendingActions ? JSON.parse(report.pendingActions).length : 0; } catch { return 0; }
  })();
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 hover:border-purple-500/30 transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays size={13} className="text-purple-400" />
          <span className="text-sm font-medium text-slate-200">{report.date}</span>
          {report.slackMessageTs && (
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">Slack 발송됨</span>
          )}
        </div>
        <span className="text-[10px] text-slate-600">{report.createdAt.slice(11, 16)}</span>
      </div>
      {summary ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "진행 중", value: summary.inProgress ?? 0, color: "text-blue-400" },
            { label: "백로그", value: summary.backlog ?? 0, color: "text-slate-400" },
            { label: "7일 완료", value: summary.done7d ?? 0, color: "text-emerald-400" },
            { label: "대기 액션", value: pendingCount, color: pendingCount > 0 ? "text-amber-400" : "text-slate-500" },
          ].map((item) => (
            <div key={item.label} className="bg-[var(--surface2)] rounded-lg p-2 text-center">
              <div className={`text-lg font-bold ${item.color}`}>{item.value}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{item.label}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-600">요약 데이터 없음</p>
      )}
    </div>
  );
}
