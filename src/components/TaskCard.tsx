"use client";

import { useState } from "react";
import {
  STATUS_LABELS,
  STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  cn,
} from "@/lib/utils";

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

export default function TaskCard({ task, onUpdate }: TaskCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);

  const handleStatusChange = async (newStatus: string) => {
    setIsUpdating(true);
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      onUpdate();
    } catch (error) {
      console.error("Failed to update:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("정말 삭제하시겠습니까?")) return;
    try {
      await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      onUpdate();
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  const isDue =
    task.dueDate &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    new Date(task.dueDate) < new Date();

  const jiraLink = task.links?.find((l) => l.linkType === "jira");
  const slackLink = task.links?.find((l) => l.linkType === "slack_thread");
  const hasNoLinks = !jiraLink && !slackLink;

  return (
    <div
      className={cn(
        "bg-[var(--surface)] border rounded-xl p-4 transition-all hover:border-blue-500/50",
        task.status === "done"
          ? "border-green-800/50 opacity-70"
          : isDue
          ? "border-red-500/50"
          : "border-[var(--border)]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {/* 우선순위 */}
            <span className={cn("text-xs font-medium", PRIORITY_COLORS[task.priority])}>
              {task.priority === "high" ? "!!!" : task.priority === "medium" ? "!!" : "!"}
            </span>
            {/* 제목 */}
            <h3
              className={cn(
                "font-medium truncate",
                task.status === "done" && "line-through text-slate-500"
              )}
            >
              {task.title}
            </h3>
          </div>

          {task.description && (
            <p className="text-xs text-slate-500 line-clamp-2 mb-2">
              {task.description}
            </p>
          )}
        </div>

        {/* 삭제 */}
        <button
          onClick={handleDelete}
          className="text-slate-600 hover:text-red-400 transition-colors text-sm cursor-pointer"
          title="삭제"
        >
          ×
        </button>
      </div>

      {/* 상태 버튼 */}
      <div className="flex gap-1.5 mb-3">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => handleStatusChange(s)}
            disabled={isUpdating || task.status === s}
            className={cn(
              "px-2.5 py-1 text-xs rounded-full transition-all cursor-pointer",
              task.status === s
                ? cn(STATUS_COLORS[s], "text-white")
                : "bg-[var(--surface2)] text-slate-400 hover:text-white"
            )}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* 링크 표시 */}
      <div className="flex flex-wrap gap-2 items-center">
        {jiraLink && (
          <a
            href={jiraLink.jiraIssueUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-900/30 text-blue-400 text-xs rounded-md hover:bg-blue-900/50 transition-colors"
          >
            <span className="w-3 h-3 rounded bg-blue-600 flex items-center justify-center text-[8px] font-bold text-white">
              J
            </span>
            {jiraLink.jiraIssueKey}
            {jiraLink.jiraStatus && (
              <span className="text-blue-300/60 ml-1">
                · {jiraLink.jiraStatus}
              </span>
            )}
          </a>
        )}

        {slackLink && (
          <a
            href={slackLink.slackThreadUrl || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-purple-900/30 text-purple-400 text-xs rounded-md hover:bg-purple-900/50 transition-colors"
          >
            <span className="w-3 h-3 rounded bg-purple-600 flex items-center justify-center text-[8px] font-bold text-white">
              S
            </span>
            Slack 스레드
          </a>
        )}

        {hasNoLinks && (
          <span className="text-xs text-yellow-600/70 flex items-center gap-1">
            ⚠ 연결 없음
          </span>
        )}

        {/* 기한 */}
        {task.dueDate && (
          <span
            className={cn(
              "text-xs ml-auto",
              isDue ? "text-red-400 font-medium" : "text-slate-500"
            )}
          >
            {isDue ? "기한 초과 " : ""}
            {task.dueDate}
          </span>
        )}
      </div>
    </div>
  );
}
