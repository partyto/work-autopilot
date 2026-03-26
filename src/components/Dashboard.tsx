"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
  GripVertical,
  ExternalLink,
  MessageSquare,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
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

type ScanResultItem =
  | { type: "jira"; key: string; summary: string; status: string; url: string }
  | { type: "slack"; channel: string; preview: string; url: string };

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

const SOURCE_FILTERS = [
  { key: "jira_sync", label: "JIRA", color: "text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300", activeColor: "bg-blue-600 text-white border-blue-600" },
  { key: "slack_detected", label: "SLACK", color: "text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300", activeColor: "bg-slate-700 text-white border-slate-700" },
  { key: "manual", label: "SELF", color: "text-slate-500 bg-slate-50 border-slate-200 hover:bg-slate-100 hover:border-slate-300", activeColor: "bg-slate-500 text-white border-slate-500" },
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
  const [activeTab, setActiveTab] = useState<string>("active");
  const [activeActionTab, setActiveActionTab] = useState<string>("proposed");
  const [activeSection, setActiveSection] = useState<"tasks" | "actions" | "history">("tasks");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [lastScanItems, setLastScanItems] = useState<ScanResultItem[] | null>(null);
  const [kpiFilters, setKpiFilters] = useState<Set<string>>(new Set());
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());

  // DnD 센서 설정
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

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

  useEffect(() => {
    Promise.all([fetchTasks(), fetchActions(), fetchScanStatus(), fetchReports()]);
  }, [fetchTasks, fetchActions, fetchScanStatus, fetchReports]);

  const handleRefreshAll = useCallback(() => {
    Promise.all([fetchTasks(), fetchActions(), fetchReports()]);
  }, [fetchTasks, fetchActions, fetchReports]);

  // DnD stale closure 방지: ref로 최신 tasks 참조
  const tasksRef = useRef(tasks);
  useEffect(() => { tasksRef.current = tasks; }, [tasks]);

  // 드래그 완료 핸들러
  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentFilter = FILTER_TABS.find((t) => t.key === activeTab) || FILTER_TABS[0];
    const currentTasks = tasksRef.current;
    const visibleTasks = currentTasks.filter(currentFilter.filter);

    const oldIndex = visibleTasks.findIndex((t) => t.id === active.id);
    const newIndex = visibleTasks.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(visibleTasks, oldIndex, newIndex);

    const visibleIds = new Set(visibleTasks.map((t) => t.id));
    const nonVisible = currentTasks.filter((t) => !visibleIds.has(t.id));
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
  }, [activeTab, fetchTasks]);

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
          setActiveSection("history");
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

  const filteredTasks = useMemo(() => {
    let base = kpiFilters.size > 0
      ? tasks.filter((t) => Array.from(kpiFilters).some((k) => (KPI_FILTERS[k] ?? (() => false))(t)))
      : tasks;
    if (sourceFilters.size > 0) {
      base = base.filter((t) => sourceFilters.has(t.sourceType));
    }
    return sortTasks(base);
  }, [tasks, kpiFilters, sourceFilters]);

  const handleKpiClick = (key: string) => {
    setKpiFilters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setActiveSection("tasks");
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
    <div className="space-y-7">
      {/* 상단 컨트롤 바 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* 연결 상태 - 그룹 pill */}
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-sm">
          <ConnStatus label="Jira" connected={scanStatus?.jira} />
          <div className="w-px h-3.5 bg-slate-200 mx-1" />
          <ConnStatus label="Slack" connected={scanStatus?.slack} />
          <div className="w-px h-3.5 bg-slate-200 mx-1" />
          <ConnStatus label="Scheduler" connected={scanStatus?.scheduler} />
        </div>

        {/* 액션 버튼 */}
        <div className="flex items-center gap-2">
          <TaskForm onCreated={handleRefreshAll} />
          <button
            onClick={handleScanNow}
            disabled={isScanning}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 rounded-xl transition-all cursor-pointer shadow-sm shadow-blue-200"
          >
            <ScanLine size={13} />
            {isScanning ? "스캔 중..." : "지금 스캔"}
          </button>
        </div>
      </div>

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
        <KpiCard icon={<Clock size={14} />} label="대기" value={stats.pending}
          activeIconClass="bg-slate-700 text-white"
          activeValueClass="text-slate-700" activeBorderClass="border-slate-400"
          active={kpiFilters.has("pending")} onClick={() => handleKpiClick("pending")} />
        <KpiCard icon={<CircleDot size={14} />} label="진행 중" value={stats.inProgress}
          activeIconClass="bg-blue-500 text-white"
          activeValueClass="text-blue-600" activeBorderClass="border-blue-400"
          active={kpiFilters.has("in_progress")} onClick={() => handleKpiClick("in_progress")} />
        <KpiCard icon={<CheckCircle2 size={14} />} label="완료" value={stats.done}
          activeIconClass="bg-emerald-500 text-white"
          activeValueClass="text-emerald-600" activeBorderClass="border-emerald-400"
          active={kpiFilters.has("done")} onClick={() => handleKpiClick("done")} />
        <KpiCard icon={<CalendarDays size={14} />} label="오늘 까지" value={stats.dueToday}
          activeIconClass="bg-orange-500 text-white"
          activeValueClass="text-orange-600" activeBorderClass="border-orange-400"
          alert={stats.dueToday > 0}
          active={kpiFilters.has("dueToday")} onClick={() => handleKpiClick("dueToday")} />
        <KpiCard icon={<AlertTriangle size={14} />} label="기한 초과" value={stats.overdue}
          activeIconClass="bg-red-500 text-white"
          activeValueClass="text-red-600" activeBorderClass="border-red-400"
          alert={stats.overdue > 0}
          active={kpiFilters.has("overdue")} onClick={() => handleKpiClick("overdue")} />
        <KpiCard icon={<Link2Off size={14} />} label="연결 없음" value={stats.noLink}
          activeIconClass="bg-slate-500 text-white"
          activeValueClass="text-slate-600" activeBorderClass="border-slate-400"
          active={kpiFilters.has("noLink")} onClick={() => handleKpiClick("noLink")} />
        <KpiCard icon={<Bell size={14} />} label="승인 대기" value={stats.pendingActions}
          activeIconClass="bg-amber-500 text-white"
          activeValueClass="text-amber-600" activeBorderClass="border-amber-400"
          alert={stats.pendingActions > 0}
          onClick={() => { setKpiFilters(new Set()); setActiveSection("actions"); }} />
      </div>

      {/* 섹션 탭 */}
      <div className="flex items-center gap-1">
        <SectionTab
          active={activeSection === "tasks"}
          onClick={() => setActiveSection("tasks")}
          icon={<ListTodo size={13} />}
          label="TO-DO"
          count={tasks.length}
        />
        <SectionTab
          active={activeSection === "actions"}
          onClick={() => setActiveSection("actions")}
          icon={<Bot size={13} />}
          label="자동 액션"
          count={stats.pendingActions > 0 ? stats.pendingActions : undefined}
          badge={stats.pendingActions > 0}
        />
        <SectionTab
          active={activeSection === "history"}
          onClick={() => setActiveSection("history")}
          icon={<History size={13} />}
          label="스캔 이력"
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
            {/* TaskForm moved to top control bar */}

            {/* 출처 필터 (2차 필터) */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {SOURCE_FILTERS.map((sf) => {
                const isActive = sourceFilters.has(sf.key);
                return (
                  <button
                    key={sf.key}
                    onClick={() => setSourceFilters((prev) => {
                      const next = new Set(prev);
                      if (next.has(sf.key)) next.delete(sf.key);
                      else next.add(sf.key);
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
                  className="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600 transition-all cursor-pointer px-1"
                >
                  <X size={11} /> 해제
                </button>
              )}
            </div>

            {kpiFilters.size > 0 && (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-50/80 border border-blue-100 rounded-2xl text-sm text-blue-700 flex-wrap">
                {Array.from(kpiFilters).map((k) => {
                  const label = { pending: "대기", in_progress: "진행 중", done: "완료", dueToday: "오늘 까지", overdue: "기한 초과", noLink: "연결 없음" }[k];
                  return (
                    <span key={k} className="flex items-center gap-1 bg-white border border-blue-200 px-2.5 py-1 rounded-xl text-xs font-semibold shadow-sm">
                      {label}
                      <button onClick={() => handleKpiClick(k)} className="hover:text-blue-900 ml-0.5"><X size={10} /></button>
                    </span>
                  );
                })}
                <span className="text-blue-400 text-xs font-medium">{filteredTasks.length}건</span>
                <button
                  onClick={() => setKpiFilters(new Set())}
                  className="ml-auto flex items-center gap-1 text-xs text-blue-500 hover:text-blue-700 hover:bg-blue-100 px-2 py-1 rounded-xl transition-all"
                >
                  <X size={11} /> 전체 해제
                </button>
              </div>
            )}

            {isLoading ? (
              <LoadingSpinner />
            ) : filteredTasks.length === 0 ? (
              <EmptyState
                icon={<ListTodo size={32} className="text-slate-300" />}
                message={kpiFilters.size > 0 ? "해당 조건의 할일이 없습니다" : "할일이 없습니다"}
                sub={kpiFilters.size > 0 ? undefined : "위의 '+ 새 할일 추가' 버튼으로 시작하세요"}
              />
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={filteredTasks.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <motion.div
                    className="space-y-3"
                    variants={containerVariants}
                    initial="hidden"
                    animate="visible"
                  >
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
                icon={<Bot size={32} className="text-slate-300" />}
                message={activeActionTab === "proposed" ? "대기 중인 액션이 없습니다" : "액션 기록이 없습니다"}
                sub="30분 간격 자동 스캔 또는 '지금 스캔' 버튼으로 생성됩니다"
              />
            ) : (
              <motion.div
                className="grid grid-cols-1 md:grid-cols-2 gap-4"
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

        {/* 스캔 이력 섹션 */}
        {activeSection === "history" && (
          <motion.div
            key="history"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.2 }}
            className="space-y-4"
          >
            {/* 이번 스캔 결과 (임시, 세션 유지) */}
            <AnimatePresence>
              {lastScanItems && lastScanItems.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="bg-[var(--surface)] border border-purple-200 rounded-2xl p-4 shadow-[var(--shadow-card)]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-soft-pulse" />
                      <span className="text-sm font-semibold text-slate-700">이번 스캔 결과 <span className="text-purple-600">({lastScanItems.length}건)</span></span>
                    </div>
                    <button onClick={() => setLastScanItems(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer p-1 rounded-lg hover:bg-slate-100">
                      <X size={13} />
                    </button>
                  </div>
                  <div className="space-y-1">
                    {lastScanItems.map((item, i) => (
                      <a
                        key={i}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--surface2)] transition-colors group overflow-hidden"
                      >
                        {item.type === "jira" ? (
                          <>
                            <span className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">J</span>
                            <span className="text-xs font-medium text-blue-600 flex-shrink-0">{item.key}</span>
                            <span className="text-xs text-slate-600 truncate flex-1">{item.summary}</span>
                            <span className="text-[10px] text-slate-400 flex-shrink-0">{item.status}</span>
                          </>
                        ) : (
                          <>
                            <MessageSquare size={12} className="text-purple-500 flex-shrink-0" />
                            <span className="text-xs font-medium text-purple-600 flex-shrink-0">#{item.channel}</span>
                            <span className="text-xs text-slate-600 truncate flex-1">{item.preview}</span>
                          </>
                        )}
                        <ExternalLink size={10} className="text-slate-300 group-hover:text-slate-500 flex-shrink-0" />
                      </a>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* 날짜별 이력 */}
            {reports.length === 0 ? (
              <EmptyState
                icon={<History size={32} className="text-slate-300" />}
                message="스캔 이력이 없습니다"
                sub="'지금 스캔' 버튼을 눌러 첫 번째 스캔을 실행하세요"
              />
            ) : (
              <motion.div
                className="space-y-2"
                variants={containerVariants}
                initial="hidden"
                animate="visible"
              >
                {reports.map((report) => (
                  <motion.div key={report.id} variants={itemVariants}>
                    <ReportCard report={report} />
                  </motion.div>
                ))}
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
  icon, label, value,
  activeIconClass, activeValueClass, activeBorderClass,
  alert, active, onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  activeIconClass: string;
  activeValueClass: string;
  activeBorderClass: string;
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
        "relative bg-white rounded-2xl p-3.5 cursor-pointer transition-all",
        "border shadow-sm",
        active
          ? `border-2 ${activeBorderClass} shadow-md`
          : "border-slate-100 hover:border-slate-200 hover:shadow-[var(--shadow-card-hover)]"
      )}
      style={{ transition: `box-shadow 0.3s var(--spring), border-color 0.3s var(--spring)` }}
    >
      <div className={cn(
        "w-7 h-7 rounded-lg flex items-center justify-center mb-2.5 transition-all",
        active ? activeIconClass : "bg-slate-100 text-slate-400"
      )}>
        {icon}
      </div>
      <div className={cn(
        "text-2xl font-bold tracking-tight leading-none",
        active
          ? (value > 0 ? activeValueClass : "text-slate-200")
          : (value > 0 ? "text-slate-700" : "text-slate-200")
      )}>
        {value}
      </div>
      <div className="text-[10px] font-medium text-slate-400 mt-1.5 tracking-wide">{label}</div>
      {alert && value > 0 && !active && (
        <div className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-amber-400 animate-soft-pulse" />
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
          ? "bg-slate-900 text-white shadow-sm"
          : "text-slate-400 hover:text-slate-700 hover:bg-slate-100"
      )}
      style={{ transition: `background 0.2s var(--spring), color 0.2s var(--spring)` }}
    >
      {icon}
      {label}
      {count !== undefined && (
        badge ? (
          <span className="text-[10px] bg-amber-400 text-white px-1.5 py-0.5 rounded-full leading-none font-bold">
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
      <div className="w-8 h-8 border-[2.5px] border-[var(--border2)] border-t-blue-500 rounded-full animate-spin" />
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

// ===== 드래그 가능한 TaskCard 래퍼 =====
function SortableTaskCard({ task, onUpdate }: { task: TaskWithLinks; onUpdate: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-0">
      {/* 드래그 핸들 */}
      <div
        {...listeners}
        {...attributes}
        className="flex items-center px-1.5 cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 transition-colors touch-none select-none"
        title="드래그하여 순서 변경"
      >
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
  try {
    if (report.summary) summary = JSON.parse(report.summary);
  } catch {}

  const pendingCount = (() => {
    try {
      return report.pendingActions ? JSON.parse(report.pendingActions).length : 0;
    } catch { return 0; }
  })();

  return (
    <div className="relative bg-[var(--surface)] border border-[var(--border2)] rounded-xl p-5 hover:border-purple-300 hover:shadow-[var(--shadow-card-hover)] transition-all overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-purple-400 rounded-l-xl" />
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-purple-500" />
          <span className="text-[15px] font-medium text-slate-700">{report.date}</span>
          {report.slackMessageTs && (
            <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
              Slack 발송됨
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{report.createdAt.slice(11, 16)}</span>
      </div>

      {summary ? (
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "진행 중",  value: summary.inProgress ?? 0,  color: "text-blue-600"    },
            { label: "백로그",   value: summary.backlog    ?? 0,  color: "text-slate-500"   },
            { label: "7일 완료", value: summary.done7d     ?? 0,  color: "text-emerald-600" },
            { label: "대기 액션",value: pendingCount,              color: pendingCount > 0 ? "text-amber-600" : "text-slate-400" },
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
