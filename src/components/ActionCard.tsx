"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  MessageSquare,
  PlusSquare,
  CheckSquare,
  RefreshCcw,
  Check,
  X,
  ExternalLink,
  Clock,
  CheckCircle2,
  XCircle,
  Ban,
} from "lucide-react";
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

const ACTION_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  jira_transition: {
    label: "Jira 전환",
    icon: <ArrowRightLeft size={11} />,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  slack_reply: {
    label: "Slack 답글",
    icon: <MessageSquare size={11} />,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
  jira_create: {
    label: "Jira 생성",
    icon: <PlusSquare size={11} />,
    color: "text-cyan-400",
    bg: "bg-cyan-500/10",
    border: "border-cyan-500/20",
  },
  todo_create: {
    label: "TO-DO 생성",
    icon: <PlusSquare size={11} />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  todo_complete: {
    label: "TO-DO 완료",
    icon: <CheckSquare size={11} />,
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
  },
  todo_status_change: {
    label: "TO-DO 상태 변경",
    icon: <RefreshCcw size={11} />,
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
};

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  proposed: { label: "대기", icon: <Clock size={10} />, color: "text-amber-400" },
  approved: { label: "승인됨", icon: <CheckCircle2 size={10} />, color: "text-blue-400" },
  executed: { label: "완료", icon: <CheckCircle2 size={10} />, color: "text-emerald-400" },
  rejected: { label: "거절", icon: <XCircle size={10} />, color: "text-slate-500" },
  cancelled: { label: "자동 취소", icon: <Ban size={10} />, color: "text-orange-400" },
};

export default function ActionCard({ action, onUpdate }: ActionCardProps) {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAction = async (newStatus: "approved" | "rejected") => {
    setIsProcessing(true);
    const toastId = toast.loading(newStatus === "approved" ? "승인 후 실행 중..." : "거절 처리 중...");
    try {
      await fetch(`/api/actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(newStatus === "approved" ? "승인 후 실행됨!" : "거절 완료", { id: toastId });
      onUpdate();
    } catch {
      toast.error("처리 실패", { id: toastId });
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

  const typeConfig = ACTION_TYPE_CONFIG[action.actionType] || {
    label: action.actionType,
    icon: <RefreshCcw size={11} />,
    color: "text-slate-400",
    bg: "bg-slate-500/10",
    border: "border-slate-500/20",
  };
  const statusConfig = STATUS_CONFIG[action.status] || STATUS_CONFIG.proposed;
  const isProposed = action.status === "proposed";
  const isCancelled = action.status === "cancelled" || action.status === "rejected";

  return (
    <motion.div
      layout
      className={cn(
        "relative bg-[var(--surface)] border rounded-xl p-4 transition-all overflow-hidden",
        isProposed
          ? "border-amber-500/30 hover:border-amber-400/50 shadow-sm shadow-amber-500/5"
          : isCancelled
          ? "border-[var(--border)] opacity-50"
          : "border-emerald-800/30 opacity-70"
      )}
    >
      {/* 상단 액션 타입 바 */}
      <div className={cn("absolute top-0 left-0 right-0 h-0.5", isProposed ? "bg-gradient-to-r from-amber-500/50 to-orange-500/30" : "bg-transparent")} />

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border", typeConfig.color, typeConfig.bg, typeConfig.border)}>
            {typeConfig.icon}
            {typeConfig.label}
          </span>
          <span className={cn("flex items-center gap-1 text-[11px]", statusConfig.color)}>
            {statusConfig.icon}
            {statusConfig.label}
          </span>
        </div>
        <span className="text-[10px] text-slate-600 flex-shrink-0">
          {action.proposedAt?.split("T")[0]}
        </span>
      </div>

      {/* 설명 */}
      <p className="text-xs text-slate-300 leading-relaxed mb-2.5">{action.description}</p>

      {/* 연결된 TO-DO */}
      {action.task && (
        <div className="text-[11px] text-slate-600 mb-2.5 flex items-center gap-1">
          <span>→</span>
          <span className="text-slate-500 truncate">{action.task.title}</span>
        </div>
      )}

      {/* Payload 미리보기 */}
      {payload && (
        <div className="bg-[var(--surface2)] border border-[var(--border2)] rounded-lg px-3 py-2 mb-3 space-y-1">
          {payload.jiraIssueKey && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <span className="w-4 h-4 rounded bg-blue-600 flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">J</span>
              <span className="text-blue-400">{payload.jiraIssueKey}</span>
              {payload.targetStatus && (
                <span className="text-slate-500">→ <span className="text-slate-300">{payload.targetStatus}</span></span>
              )}
            </div>
          )}
          {payload.targetTodoStatus && (
            <div className="text-[11px] text-slate-400">
              TO-DO → <span className="text-amber-400">{payload.targetTodoStatus}</span>
            </div>
          )}
          {payload.summary && (
            <div className="text-[11px] text-slate-400 truncate">
              "{payload.summary}"
            </div>
          )}
          {payload.threadUrl && (
            <a
              href={payload.threadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 transition-colors"
            >
              <MessageSquare size={10} />
              Slack 스레드 보기
              <ExternalLink size={9} />
            </a>
          )}
        </div>
      )}

      {/* 실행 결과 */}
      {action.resultLink && (
        <a
          href={action.resultLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-[11px] text-emerald-400 hover:underline mb-2"
        >
          <ExternalLink size={10} />
          실행 결과 보기
        </a>
      )}

      {/* 승인/거절 버튼 */}
      {isProposed && (
        <div className="flex gap-2 pt-2.5 border-t border-[var(--border2)]">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => handleAction("approved")}
            disabled={isProcessing}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors cursor-pointer"
          >
            <Check size={12} />
            {isProcessing ? "처리 중..." : "승인 · 실행"}
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => handleAction("rejected")}
            disabled={isProcessing}
            className="flex items-center justify-center gap-1 px-3 py-1.5 text-xs bg-[var(--surface2)] hover:bg-[var(--surface3)] border border-[var(--border2)] text-slate-400 hover:text-slate-200 rounded-lg transition-all cursor-pointer"
          >
            <X size={12} />
            거절
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}
