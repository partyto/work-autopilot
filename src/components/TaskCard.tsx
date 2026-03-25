"use client";

import { useState, useRef, useEffect } from "react";
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
  Calendar,
  X,
} from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS, cn } from "@/lib/utils";

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

const STATUSES = ["pending", "in_progress", "in_qa", "done", "cancelled"] as const;

const STATUS_DOT: Record<string, string> = {
  pending: "bg-slate-400",
  in_progress: "bg-blue-500",
  in_qa: "bg-violet-500",
  done: "bg-emerald-500",
  cancelled: "bg-gray-400",
};

const PRIORITY_CONFIG: Record<string, { label: string; barColor: string; badgeClass: string; flagColor: string }> = {
  high: {
    label: "높음",
    barColor: "bg-red-500",
    badgeClass: "bg-red-50 text-red-600 border-red-200",
    flagColor: "text-red-500",
  },
  medium: {
    label: "중간",
    barColor: "bg-amber-400",
    badgeClass: "bg-amber-50 text-amber-600 border-amber-200",
    flagColor: "text-amber-500",
  },
  low: {
    label: "낮음",
    barColor: "bg-slate-300",
    badgeClass: "bg-slate-50 text-slate-500 border-slate-200",
    flagColor: "text-slate-400",
  },
};

const PRIORITIES = ["high", "medium", "low"] as const;

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  slack_detected: {
    label: "SLACK",
    className: "bg-purple-100 text-purple-700 border border-purple-200",
  },
  jira_sync: {
    label: "JIRA",
    className: "bg-blue-100 text-blue-700 border border-blue-200",
  },
  manual: {
    label: "SELF",
    className: "bg-slate-100 text-slate-600 border border-slate-200",
  },
};

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso.slice(0, 10);
  }
}

export default function TaskCard({ task, onUpdate }: TaskCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // 인라인 편집 상태
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(task.title);
  const [editingDue, setEditingDue] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  // 우선순위 메뉴 외부 클릭 닫기
  useEffect(() => {
    if (!showPriorityMenu) return;
    const handler = (e: MouseEvent) => {
      if (!priorityMenuRef.current?.contains(e.target as Node)) {
        setShowPriorityMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPriorityMenu]);

  const patchTask = async (data: Record<string, unknown>) => {
    setIsUpdating(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (res.ok) onUpdate();
      else toast.error("저장 실패");
    } catch {
      toast.error("저장 실패");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (task.status === newStatus) return;
    toast.promise(patchTask({ status: newStatus }), {
      loading: "상태 변경 중...",
      success: `상태: ${STATUS_LABELS[newStatus]}`,
      error: "상태 변경 실패",
    });
  };

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== task.title) {
      patchTask({ title: trimmed });
    } else {
      setTitleValue(task.title);
    }
  };

  const handlePriorityChange = (p: string) => {
    setShowPriorityMenu(false);
    if (p !== task.priority) patchTask({ priority: p });
  };

  const handleDueSave = (val: string) => {
    setEditingDue(false);
    patchTask({ dueDate: val || null });
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
  const pCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.low;

  return (
    <motion.div
      layout
      className={cn(
        "group relative bg-[var(--surface)] border rounded-2xl overflow-visible transition-all duration-200 shadow-[var(--shadow-card)]",
        isDone
          ? "border-[var(--border)] opacity-60"
          : isDue
          ? "border-red-300 shadow-red-100"
          : isDueSoon
          ? "border-amber-300"
          : "border-[var(--border2)] hover:border-blue-300 hover:shadow-[var(--shadow-card-hover)]"
      )}
    >
      {/* 왼쪽 우선순위 바 — 클릭해서 우선순위 변경 */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] overflow-hidden rounded-l-2xl">
        <div className={cn("w-full h-full cursor-pointer", pCfg.barColor)} onClick={() => setShowPriorityMenu(true)} title="우선순위 변경" />
      </div>

      <div className="px-5 py-4 pl-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
              <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5", STATUS_DOT[task.status] || "bg-slate-400")} />

              {SOURCE_BADGE[task.sourceType] && (
                <span className={cn(
                  "flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none tracking-wide",
                  SOURCE_BADGE[task.sourceType].className
                )}>
                  {SOURCE_BADGE[task.sourceType].label}
                </span>
              )}

              {/* 제목 — 클릭해서 인라인 편집 */}
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                  onBlur={handleTitleSave}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleTitleSave();
                    if (e.key === "Escape") { setEditingTitle(false); setTitleValue(task.title); }
                  }}
                  className="flex-1 text-[15px] font-semibold text-slate-800 bg-blue-50 border border-blue-300 rounded-lg px-2 py-0.5 outline-none focus:ring-2 focus:ring-blue-200 min-w-0"
                />
              ) : (
                <h3
                  onClick={() => { if (!isDone) setEditingTitle(true); }}
                  className={cn(
                    "text-[15px] font-semibold leading-snug truncate",
                    isDone ? "line-through text-slate-400" : "text-slate-800 cursor-text hover:text-blue-600 transition-colors"
                  )}
                  title="클릭해서 수정"
                >
                  {task.title}
                </h3>
              )}

              {/* 우선순위 배지 */}
              <div className="relative flex-shrink-0" ref={priorityMenuRef}>
                <button
                  onClick={() => setShowPriorityMenu(!showPriorityMenu)}
                  className={cn(
                    "flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border leading-none transition-all hover:opacity-80 cursor-pointer",
                    pCfg.badgeClass
                  )}
                  title="우선순위 변경"
                >
                  <Flag size={9} />
                  {pCfg.label}
                </button>
                {showPriorityMenu && (
                  <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[90px]">
                    {PRIORITIES.map((p) => (
                      <button
                        key={p}
                        onClick={() => handlePriorityChange(p)}
                        className={cn(
                          "w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors cursor-pointer",
                          task.priority === p ? "font-bold" : ""
                        )}
                      >
                        <Flag size={10} className={PRIORITY_CONFIG[p].flagColor} />
                        {PRIORITY_CONFIG[p].label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 메타 정보 */}
            <div className="flex items-center gap-3 ml-5 mt-1 flex-wrap">
              {/* 기한 — 클릭해서 편집 */}
              {editingDue ? (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    defaultValue={task.dueDate?.slice(0, 10) || ""}
                    autoFocus
                    onBlur={(e) => handleDueSave(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleDueSave((e.target as HTMLInputElement).value);
                      if (e.key === "Escape") setEditingDue(false);
                    }}
                    className="text-[11px] border border-blue-300 rounded-lg px-2 py-0.5 bg-blue-50 outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer"
                  />
                  {task.dueDate && (
                    <button onClick={() => handleDueSave("")} className="text-slate-400 hover:text-red-500">
                      <X size={11} />
                    </button>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setEditingDue(true)}
                  className={cn(
                    "flex items-center gap-1 text-[11px] rounded-md px-1.5 py-0.5 transition-all hover:bg-slate-100 cursor-pointer",
                    isDue ? "text-red-500 font-medium" : isDueSoon ? "text-amber-500" : "text-slate-400 hover:text-slate-600"
                  )}
                  title="기한 설정"
                >
                  {isDue ? <AlertCircle size={10} /> : <Calendar size={10} />}
                  {task.dueDate ? (isDue ? `기한 초과 ${task.dueDate}` : `마감 ${task.dueDate}`) : "기한 없음"}
                </button>
              )}

              <span className="text-[11px] text-slate-400">생성 {formatDateTime(task.createdAt)}</span>
              {task.completedAt && (
                <span className="text-[11px] text-emerald-600">완료 {formatDateTime(task.completedAt)}</span>
              )}
              {hasNoLinks && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Link2Off size={10} />연결 없음
                </span>
              )}
            </div>
          </div>

          {/* 우측 액션 */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-80 transition-opacity flex-shrink-0">
            {task.description && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-2 text-slate-400 hover:text-slate-700 hover:bg-[var(--surface2)] rounded-lg transition-all cursor-pointer"
              >
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* 설명 */}
        {expanded && task.description && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-xs text-slate-500 ml-5 mt-2 leading-relaxed"
          >
            {task.description}
          </motion.p>
        )}

        {/* 상태 버튼 + 링크 */}
        <div className="flex items-center justify-between mt-4 ml-5 gap-2">
          <div className="flex gap-1 bg-slate-50 rounded-lg p-0.5 border border-slate-100">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={isUpdating}
                className={cn(
                  "px-3 py-1.5 text-xs rounded-md font-medium transition-all cursor-pointer",
                  task.status === s
                    ? cn(STATUS_COLORS[s], "text-white shadow-sm")
                    : "text-slate-500 hover:text-slate-700 hover:bg-white"
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {jiraLink && (
              <a
                href={jiraLink.jiraIssueUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-600 text-xs rounded-lg shadow-sm transition-colors"
              >
                <span className="w-3.5 h-3.5 rounded bg-blue-600 flex items-center justify-center text-[8px] font-bold text-white">J</span>
                {jiraLink.jiraIssueKey}
                {jiraLink.jiraStatus && <span className="text-blue-400">· {jiraLink.jiraStatus}</span>}
                <ExternalLink size={10} className="opacity-50" />
              </a>
            )}
            {slackLink && (
              <a
                href={slackLink.slackThreadUrl || "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2.5 py-1 bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-600 text-xs rounded-lg shadow-sm transition-colors"
              >
                <MessageSquare size={10} />
                Slack
                <ExternalLink size={10} className="opacity-50" />
              </a>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
