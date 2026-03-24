"use client";

import { useState, useEffect, useCallback } from "react";
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

const FILTER_TABS = [
  { key: "active", label: "진행 중", filter: (t: TaskWithLinks) => t.status !== "done" && t.status !== "cancelled" },
  { key: "all", label: "전체", filter: () => true },
  { key: "done", label: "완료", filter: (t: TaskWithLinks) => t.status === "done" },
] as const;

const ACTION_FILTER_TABS = [
  { key: "proposed", label: "대기", filter: (a: ActionWithTask) => a.status === "proposed" },
  { key: "all", label: "전체", filter: () => true },
  { key: "executed", label: "실행됨", filter: (a: ActionWithTask) => a.status === "executed" },
] as const;

export default function Dashboard() {
  const [tasks, setTasks] = useState<TaskWithLinks[]>([]);
  const [actions, setActions] = useState<ActionWithTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("active");
  const [activeActionTab, setActiveActionTab] = useState<string>("proposed");
  const [activeSection, setActiveSection] = useState<"tasks" | "actions">("tasks");

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?includeLinks=true");
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch("/api/actions");
      if (res.ok) {
        const data = await res.json();
        setActions(data);
      }
    } catch (error) {
      console.error("Failed to fetch actions:", error);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchActions();
  }, [fetchTasks, fetchActions]);

  const handleRefreshAll = () => {
    fetchTasks();
    fetchActions();
  };

  const currentFilter = FILTER_TABS.find((t) => t.key === activeTab) || FILTER_TABS[0];
  const filteredTasks = tasks.filter(currentFilter.filter);

  const currentActionFilter = ACTION_FILTER_TABS.find((t) => t.key === activeActionTab) || ACTION_FILTER_TABS[0];
  const filteredActions = actions.filter(currentActionFilter.filter);

  // 통계
  const stats = {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    inProgress: tasks.filter((t) => t.status === "in_progress").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: tasks.filter(
      (t) =>
        t.dueDate &&
        t.status !== "done" &&
        t.status !== "cancelled" &&
        new Date(t.dueDate) < new Date()
    ).length,
    noLink: tasks.filter((t) => !t.links || t.links.length === 0).length,
    pendingActions: actions.filter((a) => a.status === "proposed").length,
  };

  return (
    <div className="space-y-6">
      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <StatCard label="대기" value={stats.pending} color="text-slate-300" />
        <StatCard label="진행 중" value={stats.inProgress} color="text-blue-400" />
        <StatCard label="완료" value={stats.done} color="text-green-400" />
        <StatCard
          label="기한 초과"
          value={stats.overdue}
          color={stats.overdue > 0 ? "text-red-400" : "text-slate-500"}
        />
        <StatCard
          label="연결 없음"
          value={stats.noLink}
          color={stats.noLink > 0 ? "text-yellow-400" : "text-slate-500"}
        />
        <StatCard
          label="승인 대기"
          value={stats.pendingActions}
          color={stats.pendingActions > 0 ? "text-amber-400" : "text-slate-500"}
          onClick={() => setActiveSection("actions")}
        />
      </div>

      {/* 섹션 탭 */}
      <div className="flex items-center gap-4 border-b border-[var(--border)] pb-1">
        <button
          onClick={() => setActiveSection("tasks")}
          className={`pb-2 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
            activeSection === "tasks"
              ? "border-blue-500 text-blue-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          TO-DO
          <span className="ml-1.5 text-xs opacity-60">{tasks.length}</span>
        </button>
        <button
          onClick={() => setActiveSection("actions")}
          className={`pb-2 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
            activeSection === "actions"
              ? "border-amber-500 text-amber-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          자동 액션
          {stats.pendingActions > 0 && (
            <span className="ml-1.5 text-xs bg-amber-600 text-white px-1.5 py-0.5 rounded-full">
              {stats.pendingActions}
            </span>
          )}
        </button>
      </div>

      {/* TO-DO 섹션 */}
      {activeSection === "tasks" && (
        <>
          {/* 할일 입력 */}
          <TaskForm onCreated={handleRefreshAll} />

          {/* 필터 탭 */}
          <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 w-fit">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
                  activeTab === tab.key
                    ? "bg-blue-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs opacity-60">
                  {tasks.filter(tab.filter).length}
                </span>
              </button>
            ))}
          </div>

          {/* 할일 목록 */}
          {isLoading ? (
            <div className="text-center py-12 text-slate-500">로딩 중...</div>
          ) : filteredTasks.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              {activeTab === "active"
                ? "진행 중인 할일이 없습니다. 위에서 추가해보세요!"
                : "할일이 없습니다."}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredTasks.map((task) => (
                <TaskCard key={task.id} task={task} onUpdate={handleRefreshAll} />
              ))}
            </div>
          )}
        </>
      )}

      {/* 자동 액션 섹션 */}
      {activeSection === "actions" && (
        <>
          {/* 액션 필터 탭 */}
          <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 w-fit">
            {ACTION_FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveActionTab(tab.key)}
                className={`px-4 py-1.5 text-sm rounded-md transition-colors cursor-pointer ${
                  activeActionTab === tab.key
                    ? "bg-amber-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab.label}
                <span className="ml-1.5 text-xs opacity-60">
                  {actions.filter(tab.filter).length}
                </span>
              </button>
            ))}
          </div>

          {/* 액션 목록 */}
          {filteredActions.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              {activeActionTab === "proposed"
                ? "대기 중인 액션이 없습니다. 다음 자동 스캔에서 생성됩니다."
                : "액션 기록이 없습니다."}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredActions.map((action) => (
                <ActionCard key={action.id} action={action} onUpdate={handleRefreshAll} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 ${
        onClick ? "cursor-pointer hover:border-amber-500/50 transition-colors" : ""
      }`}
      onClick={onClick}
    >
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}
