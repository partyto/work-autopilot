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

const PRIORITY_ICON_COLOR: Record<string, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-slate-400",
};

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
        "group relative bg-[var(--surface)] border rounded-2xl overflow-hidden transition-all duration-200 shadow-[var(--shadow-card)]",
        isDone
          ? "border-[var(--border)] opacity-60"
          : isDue
          ? "border-red-300 shadow-red-100"
          : isDueSoon
          ? "border-amber-300"
          : "border-[var(--border2)] hover:border-blue-300 hover:shadow-[var(--shadow-card-hover)]"
      )}
    >
      {/* 왼쪽 우선순위 바 */}
      <div className={cn(
        "absolute left-0 top-0 bottom-0 w-[3px]",
        task.priority === "high" ? "bg-red-500" : task.priority === "medium" ? "bg-amber-400" : "bg-slate-300"
      )} />

      <div className="px-5 py-4 pl-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* 상태 닷 + 제목 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className={cn("w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5", STATUS_DOT[task.status] || "bg-slate-400")} />
              {SOURCE_BADGE[task.sourceType] && (
                <span className={cn(
                  "flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none tracking-wide",
                  SOURCE_BADGE[task.sourceType].className
                )}>
                  {SOURCE_BADGE[task.sourceType].label}
                </span>
              )}
              <h3 className={cn(
                "text-[15px] font-semibold leading-snug truncate",
                isDone ? "line-through text-slate-400" : "text-slate-800"
              )}>
                {task.title}
              </h3>
              {task.priority === "high" && (
                <Flag size={11} className="text-red-500 flex-shrink-0" />
              )}
            </div>

            {/* 메타 정보 */}
            <div className="flex items-center gap-3 ml-5 mt-1 flex-wrap">
              {isDue && (
                <span className="flex items-center gap-1 text-[11px] text-red-500 font-medium">
                  <AlertCircle size={10} />
                  기한 초과 {task.dueDate}
                </span>
              )}
              {isDueSoon && !isDue && (
                <span className="text-[11px] text-amber-500">⏰ {task.dueDate}</span>
              )}
              {!isDue && !isDueSoon && task.dueDate && (
                <span className="text-[11px] text-slate-400">마감 {task.dueDate}</span>
              )}
              <span className="text-[11px] text-slate-400">
                생성 {task.createdAt.slice(0, 10)}
              </span>
              {task.completedAt && (
                <span className="text-[11px] text-emerald-600">
                  완료 {task.completedAt.slice(0, 10)}
                </span>
              )}
              {hasNoLinks && (
                <span className="flex items-center gap-1 text-[11px] text-slate-400">
                  <Link2Off size={10} />연결 없음
                </span>
              )}
            </div>
          </div>

          {/* 우측 액션 */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-80 transition-opacity">
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
        <div className="flex items-center justify-between mt-4 ml-5 gap-2">
          {/* 상태 토글 */}
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

          {/* 링크 뱃지 */}
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
