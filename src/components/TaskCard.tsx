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
