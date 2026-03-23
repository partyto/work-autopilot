"use client";

import { useState } from "react";
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

const ACTION_TYPE_LABELS: Record<string, string> = {
  jira_transition: "Jira 상태 전환",
  slack_reply: "Slack 답글",
  jira_create: "Jira 이슈 생성",
  todo_create: "TO-DO 생성",
  todo_complete: "TO-DO 완료 처리",
};

const ACTION_TYPE_COLORS: Record<string, string> = {
  jira_transition: "bg-blue-900/40 text-blue-400 border-blue-700/50",
  slack_reply: "bg-purple-900/40 text-purple-400 border-purple-700/50",
  jira_create: "bg-cyan-900/40 text-cyan-400 border-cyan-700/50",
  todo_create: "bg-emerald-900/40 text-emerald-400 border-emerald-700/50",
  todo_complete: "bg-green-900/40 text-green-400 border-green-700/50",
};

const STATUS_BADGE: Record<string, { label: string; color: string }> = {
  proposed: { label: "대기", color: "bg-amber-600" },
  approved: { label: "승인됨", color: "bg-blue-600" },
  executed: { label: "실행 완료", color: "bg-green-600" },
  rejected: { label: "거절됨", color: "bg-slate-600" },
  cancelled: { label: "자동 취소", color: "bg-orange-600" },
};

export default function ActionCard({ action, onUpdate }: ActionCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (newStatus: "approved" | "rejected") => {
    setIsProcessing(true);
    try {
      await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      onUpdate();
    } catch (error) {
      console.error("Failed to update action:", error);
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
  const badge = STATUS_BADGE[action.status] || STATUS_BADGE.proposed;
  const typeColor = ACTION_TYPE_COLORS[action.actionType] || "bg-slate-800 text-slate-400 border-slate-700";

  return (
    <div
      className={cn(
        "border rounded-xl p-4 transition-all",
        action.status === "proposed"
          ? "bg-amber-950/20 border-amber-700/40 hover:border-amber-500/60"
          : action.status === "executed"
          ? "bg-green-950/10 border-green-800/30 opacity-70"
          : action.status === "rejected"
          ? "bg-slate-900/30 border-slate-700/30 opacity-50"
          : "bg-[var(--surface)] border-[var(--border)]"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          {/* 액션 타입 뱃지 */}
          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full border", typeColor)}>
            {ACTION_TYPE_LABELS[action.actionType] || action.actionType}
          </span>
          {/* 상태 뱃지 */}
          <span className={cn("text-[10px] text-white px-2 py-0.5 rounded-full", badge.color)}>
            {badge.label}
          </span>
        </div>
        <span className="text-[10px] text-slate-500 whitespace-nowrap">
          {action.proposedAt?.split("T")[0]}
        </span>
      </div>

      {/* 설명 */}
      <p className="text-sm text-slate-300 mb-2">{action.description}</p>

      {/* 연결된 TO-DO */}
      {action.task && (
        <div className="text-xs text-slate-500 mb-3">
          연결: <span className="text-slate-400">{action.task.title}</span>
        </div>
      )}

      {/* Payload 미리보기 */}
      {payload && (
        <div className="bg-slate-900/50 rounded-lg px-3 py-2 mb-3">
          {payload.jiraIssueKey && (
            <div className="text-xs text-slate-400">
              Jira: <span className="text-blue-400">{payload.jiraIssueKey}</span>
              {payload.targetStatus && <span className="text-slate-500"> → {payload.targetStatus}</span>}
            </div>
          )}
          {payload.summary && (
            <div className="text-xs text-slate-400 mt-1">
              요약: <span className="text-slate-300">{payload.summary}</span>
            </div>
          )}
          {payload.threadUrl && (
            <a
              href={payload.threadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-purple-400 hover:underline mt-1 inline-block"
            >
              Slack 스레드 보기 →
            </a>
          )}
        </div>
      )}

      {/* 실행 결과 */}
      {action.resultLink && (
        <div className="text-xs text-green-400 mb-2">
          실행 결과: <a href={action.resultLink} target="_blank" rel="noopener noreferrer" className="underline">{action.resultLink}</a>
        </div>
      )}

      {/* 액션 버튼 (proposed 상태에서만) */}
      {action.status === "proposed" && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-[var(--border)]">
          <button
            onClick={() => handleAction("approved")}
            disabled={isProcessing}
            className="flex-1 px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 text-white rounded-lg transition-colors cursor-pointer font-medium"
          >
            {isProcessing ? "처리 중..." : "승인"}
          </button>
          <button
            onClick={() => handleAction("rejected")}
            disabled={isProcessing}
            className="flex-1 px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-slate-300 rounded-lg transition-colors cursor-pointer"
          >
            거절
          </button>
        </div>
      )}
    </div>
  );
}
