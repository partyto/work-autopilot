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

export default function Dashboard() {
  const [tasks, setTasks] = useState<TaskWithLinks[]>([]);
  const [actions, setActions] = useState<ActionWithTask[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("active");
  const [activeActionTab, setActiveActionTab] = useState<string>("proposed");
  const [activeSection, setActiveSection] = useState<"tasks" | "actions">("tasks");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tasks?includeLinks=true");
      if (res.ok) setTasks(await res.json());
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchActions = useCallback(async () => {
    try {
      const res = await fetch("/api/actions");
      if (res.ok) setActions(await res.json());
    } catch (error) {
      console.error("Failed to fetch actions:", error);
    }
  }, []);

  const fetchScanStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/scan");
      if (res.ok) setScanStatus(await res.json());
    } catch (error) {
      console.error("Failed to fetch scan status:", error);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchActions();
    fetchScanStatus();
  }, [fetchTasks, fetchActions, fetchScanStatus]);

  const handleRefreshAll = () => {
    fetchTasks();
    fetchActions();
  };

  const handleScanNow = async () => {
    setIsScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setScanResult("스캔 완료! Slack DM을 확인하세요.");
        handleRefreshAll();
      } else {
        setScanResult("스캔 실패: " + (data.error || "알 수 없는 오류"));
      }
    } catch (error) {
      setScanResult("스캔 실패: 서버 연결 오류");
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanResult(null), 5000);
    }
  };

  const handleExecuteNow = async () => {
    setIsScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/scan?type=execute", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        setScanResult("승인된 액션 실행 완료!");
        handleRefreshAll();
      } else {
        setScanResult("실행 실패: " + (data.error || "알 수 없는 오류"));
      }
    } catch (error) {
      setScanResult("실행 실패: 서버 연결 오류");
    } finally {
      setIsScanning(false);
      setTimeout(() => setScanResult(null), 5000);
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
        <div className="flex items-center gap-3">
          <StatusDot label="Jira" connected={scanStatus?.jira} />
          <StatusDot label="Slack" connected={scanStatus?.slack} />
          <StatusDot label="스케줄러" connected={scanStatus?.scheduler} />
        </div>

        {/* 스캔 버튼 */}
        <div className="flex items-center gap-2">
          {scanResult && (
            <span className={`text-xs px-3 py-1 rounded-full ${
              scanResult.includes("완료") ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"
            }`}>
              {scanResult}
            </span>
          )}
          <button
            onClick={handleExecuteNow}
            disabled={isScanning || stats.pendingActions === 0}
            className="px-3 py-1.5 text-xs bg-amber-600/80 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors cursor-pointer"
          >
            {isScanning ? "처리 중..." : `액션 실행 (${stats.pendingActions})`}
          </button>
          <button
            onClick={handleScanNow}
            disabled={isScanning}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors cursor-pointer font-medium"
          >
            {isScanning ? "스캔 중..." : "지금 스캔"}
          </button>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        <StatCard label="대기" value={stats.pending} color="text-slate-300" />
        <StatCard label="진행 중" value={stats.inProgress} color="text-blue-400" />
        <StatCard label="완료" value={stats.done} color="text-green-400" />
        <StatCard
          label="기한 초과"
          value={stats.overdue}
          color={stats.overdue > 0 ? "text-red-400" : "text-slate-500"}
          alert={stats.overdue > 0}
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
          alert={stats.pendingActions > 0}
          onClick={() => setActiveSection("actions")}
        />
      </div>

      {/* 섹션 탭 */}
      <div className="flex items-center gap-1 border-b border-[var(--border)]">
        <button
          onClick={() => setActiveSection("tasks")}
          className={`px-4 pb-2.5 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
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
          className={`px-4 pb-2.5 text-sm font-medium transition-colors border-b-2 cursor-pointer ${
            activeSection === "actions"
              ? "border-amber-500 text-amber-400"
              : "border-transparent text-slate-500 hover:text-slate-300"
          }`}
        >
          자동 액션
          {stats.pendingActions > 0 && (
            <span className="ml-1.5 text-[10px] bg-amber-600 text-white px-1.5 py-0.5 rounded-full">
              {stats.pendingActions}
            </span>
          )}
        </button>
      </div>

      {/* TO-DO 섹션 */}
      {activeSection === "tasks" && (
        <>
          <TaskForm onCreated={handleRefreshAll} />

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

          {isLoading ? (
            <div className="text-center py-16 text-slate-500">
              <div className="inline-block w-5 h-5 border-2 border-slate-500 border-t-blue-400 rounded-full animate-spin mb-2" />
              <div className="text-sm">로딩 중...</div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <EmptyState
              message={activeTab === "active" ? "진행 중인 할일이 없습니다" : "할일이 없습니다"}
              sub={activeTab === "active" ? "위의 '+ 새 할일 추가' 버튼으로 시작하세요" : undefined}
            />
          ) : (
            <div className="space-y-2.5">
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

          {filteredActions.length === 0 ? (
            <EmptyState
              message={activeActionTab === "proposed" ? "대기 중인 액션이 없습니다" : "액션 기록이 없습니다"}
              sub="매일 17:30 자동 스캔 또는 '지금 스캔' 버튼으로 생성됩니다"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
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
  alert,
  onClick,
}: {
  label: string;
  value: number;
  color: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`bg-[var(--surface)] border rounded-xl px-3 py-2.5 transition-colors ${
        alert ? "border-amber-700/50" : "border-[var(--border)]"
      } ${onClick ? "cursor-pointer hover:border-blue-500/50" : ""}`}
      onClick={onClick}
    >
      <div className="text-[10px] text-slate-500 mb-0.5">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

function StatusDot({ label, connected }: { label: string; connected?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={`w-1.5 h-1.5 rounded-full ${
          connected === undefined ? "bg-slate-600" : connected ? "bg-green-400" : "bg-red-400"
        }`}
      />
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

function EmptyState({ message, sub }: { message: string; sub?: string }) {
  return (
    <div className="text-center py-16">
      <div className="text-slate-500 text-sm">{message}</div>
      {sub && <div className="text-slate-600 text-xs mt-1">{sub}</div>}
    </div>
  );
}
