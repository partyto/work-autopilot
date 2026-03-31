"use client";

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Trash2,
  ExternalLink,
  MessageSquare,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Flag,
  Calendar,
  X,
  Plus,
  Pencil,
} from "lucide-react";
import { STATUS_LABELS, STATUS_COLORS, cn } from "@/lib/utils";

interface TaskLink {
  id: string;
  linkType: string;
  jiraIssueKey?: string | null;
  jiraIssueUrl?: string | null;
  jiraStatus?: string | null;
  jiraCreatedAt?: string | null;
  slackThreadUrl?: string | null;
  slackChannelName?: string | null;
  slackThreadTs?: string | null;
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
  compact?: boolean;
}

const STATUSES = ["pending", "in_progress", "in_qa", "done", "cancelled"] as const;

const STATUS_DOT: Record<string, string> = {
  pending: "bg-slate-300",
  in_progress: "bg-[var(--accent)]",
  in_qa: "bg-[var(--accent)]",
  done: "bg-slate-400",
  cancelled: "bg-slate-200",
};

const PRIORITY_CONFIG: Record<string, { label: string; barColor: string; badgeClass: string; flagColor: string; cardAccent: string }> = {
  high: {
    label: "긴급",
    barColor: "bg-red-500",
    badgeClass: "bg-red-500 text-white border-red-500",
    flagColor: "text-red-500",
    cardAccent: "ring-1 ring-red-200 bg-red-50/30",
  },
  medium: {
    label: "보통",
    barColor: "bg-[var(--accent)]",
    badgeClass: "bg-[var(--accent)] text-white border-[var(--accent)]",
    flagColor: "text-[var(--accent)]",
    cardAccent: "",
  },
  low: {
    label: "낮음",
    barColor: "bg-slate-300",
    badgeClass: "bg-slate-200 text-slate-500 border-slate-300",
    flagColor: "text-slate-400",
    cardAccent: "",
  },
};

const PRIORITIES = ["high", "medium", "low"] as const;

const SOURCE_BADGE: Record<string, { label: string; className: string }> = {
  slack_detected: {
    label: "SLACK",
    className: "bg-slate-100 text-slate-500 border border-slate-200",
  },
  jira_sync: {
    label: "JIRA",
    className: "bg-[var(--accent-glow)] text-[var(--accent)] border border-[var(--accent-border)]",
  },
  manual: {
    label: "SELF",
    className: "bg-slate-100 text-slate-500 border border-slate-200",
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

// Slack thread_ts ("1234567890.123456") → 날짜 문자열
function formatSlackTs(ts: string): string {
  try {
    return formatDateTime(new Date(parseFloat(ts) * 1000).toISOString());
  } catch {
    return "";
  }
}

// 카드에 표시할 기준 날짜 정보 반환
function getOriginDate(
  sourceType: string,
  createdAt: string,
  jiraLink?: TaskLink | null,
  slackLink?: TaskLink | null
): { label: string; value: string } {
  if (sourceType === "jira_sync" && jiraLink?.jiraCreatedAt) {
    return { label: "Jira 생성", value: formatDateTime(jiraLink.jiraCreatedAt) };
  }
  if (sourceType === "slack_detected" && slackLink?.slackThreadTs) {
    return { label: "Slack 언급", value: formatSlackTs(slackLink.slackThreadTs) };
  }
  return { label: "생성", value: formatDateTime(createdAt) };
}

export default function TaskCard({ task, onUpdate, compact = false }: TaskCardProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // 인라인 편집 상태
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(task.title);
  const [editingDue, setEditingDue] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [editingJira, setEditingJira] = useState(false);
  const [jiraKeyValue, setJiraKeyValue] = useState("");
  const [editingSlack, setEditingSlack] = useState(false);
  const [slackUrlValue, setSlackUrlValue] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const jiraInputRef = useRef<HTMLInputElement>(null);
  const slackInputRef = useRef<HTMLInputElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  useEffect(() => {
    if (editingJira) jiraInputRef.current?.focus();
  }, [editingJira]);

  useEffect(() => {
    if (editingSlack) slackInputRef.current?.focus();
  }, [editingSlack]);

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
    if (newStatus === "cancelled") {
      setConfirmModal({
        message: "이 할일을 취소 처리하시겠습니까?",
        onConfirm: () => {
          setConfirmModal(null);
          toast.promise(patchTask({ status: newStatus }), {
            loading: "상태 변경 중...",
            success: `상태: ${STATUS_LABELS[newStatus]}`,
            error: "상태 변경 실패",
          });
        },
      });
      return;
    }
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

  const handleDelete = () => {
    setConfirmModal({
      message: "이 할일을 삭제하시겠습니까? 되돌릴 수 없습니다.",
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
          toast.success("할일 삭제됨");
          onUpdate();
        } catch {
          toast.error("삭제 실패");
        }
      },
    });
  };

  // --- 링크 추가/수정/삭제 ---
  const handleDeleteLink = (linkId: string, label: string) => {
    setConfirmModal({
      message: `${label} 링크를 삭제하시겠습니까?`,
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          await fetch(`/api/links?id=${linkId}`, { method: "DELETE" });
          onUpdate();
        } catch {
          toast.error("링크 삭제 실패");
        }
      },
    });
  };

  const handleSaveJiraLink = async () => {
    setEditingJira(false);
    const key = jiraKeyValue.trim().toUpperCase();
    if (!key) return;
    try {
      // 기존 jira 링크가 있으면 먼저 삭제
      const existing = task.links?.find((l) => l.linkType === "jira");
      if (existing) await fetch(`/api/links?id=${existing.id}`, { method: "DELETE" });
      await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, linkType: "jira", jiraIssueKey: key }),
      });
      toast.success(`Jira ${key} 연결됨`);
      onUpdate();
    } catch {
      toast.error("Jira 링크 저장 실패");
    }
  };

  // Slack URL 파싱: https://xxx.slack.com/archives/CXXX/pXXXXXXXXXX
  const parseSlackUrl = (url: string) => {
    const m = url.match(/archives\/([A-Z0-9]+)\/p(\d+)/);
    if (!m) return null;
    const channelId = m[1];
    const raw = m[2];
    const threadTs = raw.slice(0, 10) + "." + raw.slice(10);
    return { channelId, threadTs };
  };

  const handleSaveSlackLink = async () => {
    setEditingSlack(false);
    const url = slackUrlValue.trim();
    if (!url) return;
    const parsed = parseSlackUrl(url);
    try {
      const existing = task.links?.find((l) => l.linkType === "slack_thread");
      if (existing) await fetch(`/api/links?id=${existing.id}`, { method: "DELETE" });
      await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          linkType: "slack_thread",
          slackThreadUrl: url,
          slackChannelId: parsed?.channelId || null,
          slackThreadTs: parsed?.threadTs || null,
        }),
      });
      toast.success("Slack 스레드 연결됨");
      onUpdate();
    } catch {
      toast.error("Slack 링크 저장 실패");
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const isDueToday =
    task.dueDate &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    task.dueDate.slice(0, 10) === todayStr;

  const isDue =
    task.dueDate &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    task.dueDate.slice(0, 10) < todayStr;

  const isDueSoon =
    task.dueDate &&
    task.status !== "done" &&
    task.status !== "cancelled" &&
    !isDue &&
    !isDueToday &&
    new Date(task.dueDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const jiraLink = task.links?.find((l) => l.linkType === "jira");
  const slackLink = task.links?.find((l) => l.linkType === "slack_thread");
  const isDone = task.status === "done";
  const pCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.low;

  return (
    <motion.div
      layout
      className={cn(
        "group relative bg-white border rounded-2xl overflow-visible transition-all duration-200 shadow-[var(--shadow-card)]",
        isDone
          ? "border-[var(--border)] opacity-50"
          : isDue
          ? "border-[var(--accent-border)] shadow-[var(--accent-glow)]"
          : isDueToday
          ? "border-[var(--accent-border)]"
          : isDueSoon
          ? "border-slate-200"
          : "border-[var(--border)] hover:border-slate-200 hover:shadow-[var(--shadow-card-hover)]",
        !isDone && pCfg.cardAccent
      )}
    >
      {/* 왼쪽 우선순위 바 — 클릭해서 우선순위 변경 */}
      <div className={cn("absolute left-0 top-0 bottom-0 overflow-hidden rounded-l-2xl", task.priority === "high" ? "w-[4px]" : "w-[3px]")}>
        <div className={cn("w-full h-full cursor-pointer", pCfg.barColor)} onClick={() => setShowPriorityMenu(true)} title="우선순위 변경" />
      </div>

      <div className={cn("pl-[18px]", compact ? "px-3.5 py-3" : "px-5 py-4")}>
        {/* 상단: 배지 + 삭제 */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5">
            <div className={cn("rounded-full flex-shrink-0", compact ? "w-2 h-2" : "w-2.5 h-2.5", STATUS_DOT[task.status] || "bg-slate-400")} />
            {SOURCE_BADGE[task.sourceType] && (
              <span className={cn(
                "flex-shrink-0 font-bold rounded-md leading-none tracking-wide text-[10px] px-1.5 py-0.5",
                SOURCE_BADGE[task.sourceType].className
              )}>
                {SOURCE_BADGE[task.sourceType].label}
              </span>
            )}
            {/* 우선순위 배지 */}
            <div className="relative flex-shrink-0" ref={priorityMenuRef}>
              <button
                onClick={() => setShowPriorityMenu(!showPriorityMenu)}
                className={cn(
                  "flex items-center gap-1 font-bold rounded-md border leading-none transition-all hover:opacity-80 cursor-pointer text-[11px] px-2 py-1",
                  pCfg.badgeClass
                )}
                title="우선순위 변경"
              >
                <Flag size={10} />
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
          {/* 우측 액션 */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-80 transition-opacity flex-shrink-0">
            {task.description && task.sourceType !== "slack_detected" && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1 text-slate-400 hover:text-slate-700 hover:bg-[var(--surface2)] rounded-lg transition-all cursor-pointer"
              >
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
            <button
              onClick={handleDelete}
              className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* 제목 — 별도 행으로 크게 표시 */}
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
            className={cn(
              "w-full font-semibold text-slate-800 bg-blue-50 border border-blue-300 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-200",
              compact ? "text-[15px]" : "text-[17px]"
            )}
          />
        ) : (
          <h3
            onClick={() => { if (!isDone) setEditingTitle(true); }}
            className={cn(
              "font-semibold leading-snug",
              compact ? "text-[15px]" : "text-[17px]",
              compact ? "truncate" : "line-clamp-2",
              isDone ? "line-through text-slate-400" : "text-slate-800 cursor-text hover:text-[var(--accent)] transition-colors"
            )}
            title="클릭해서 수정"
          >
            {task.title}
          </h3>
        )}

        {/* 메타 정보 */}
        <div className={cn("flex items-center flex-wrap gap-2.5", compact ? "mt-1.5" : "mt-2")}>
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
                className="text-xs border border-blue-300 rounded-lg px-2 py-0.5 bg-blue-50 outline-none focus:ring-2 focus:ring-blue-200 cursor-pointer"
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
                "flex items-center gap-1 text-[13px] rounded-md px-1.5 py-0.5 transition-all hover:bg-slate-100 cursor-pointer",
                isDue ? "text-[var(--error)] font-medium" : isDueToday ? "text-[var(--accent)] font-medium" : isDueSoon ? "text-slate-500" : "text-slate-400 hover:text-slate-600"
              )}
              title="기한 설정"
            >
              {isDue || isDueToday ? <AlertCircle size={11} /> : <Calendar size={11} />}
              {task.dueDate ? (isDue ? `기한 초과 ${task.dueDate.slice(0,10)}` : isDueToday ? `오늘 마감` : `마감 ${task.dueDate.slice(5,10)}`) : "기한 없음"}
            </button>
          )}

          {(() => {
            const { label, value } = getOriginDate(task.sourceType, task.createdAt, jiraLink, slackLink);
            return <span className="text-[12px] text-slate-400">{compact ? value.slice(5, 16) : `${label} ${value}`}</span>;
          })()}
          {task.completedAt && (
            <span className="text-[12px] text-slate-400">완료 {formatDateTime(task.completedAt)}</span>
          )}
        </div>

        {/* Slack 카드 본문 — 항상 1줄 미리보기, 클릭으로 펼치기 */}
        {task.sourceType === "slack_detected" && task.description && (
          <div
            className={cn("flex items-start gap-1.5 cursor-pointer group/desc", compact ? "mt-2" : "mt-2.5")}
            onClick={() => setExpanded(!expanded)}
          >
            <MessageSquare size={11} className="flex-shrink-0 mt-0.5 text-slate-300" />
            <p className={cn(
              "flex-1 text-[13px] text-slate-500 leading-relaxed min-w-0 transition-all",
              expanded ? "whitespace-pre-wrap break-words" : "truncate"
            )}>
              {task.description}
            </p>
            <span className="flex-shrink-0 mt-0.5 text-slate-300 group-hover/desc:text-slate-500 transition-colors">
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </span>
          </div>
        )}

        {/* 일반 설명 (비 Slack 카드) */}
        {expanded && task.description && task.sourceType !== "slack_detected" && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[13px] text-slate-500 mt-2.5 leading-relaxed break-all overflow-hidden"
          >
            {task.description}
          </motion.p>
        )}

        {/* 상태 버튼 + 링크 */}
        <div className={cn("flex flex-col gap-1.5", compact ? "mt-3" : "mt-4")}>
          {/* 상태 버튼 */}
          <div className="flex gap-0.5 bg-slate-50 rounded-lg p-0.5 border border-slate-100 w-full">
            {STATUSES.filter((s) => !(s === "in_qa" && task.sourceType === "slack_detected")).map((s) => (
              <button
                key={s}
                onClick={() => handleStatusChange(s)}
                disabled={isUpdating}
                className={cn(
                  "flex-1 rounded-md font-medium transition-all cursor-pointer text-center",
                  compact ? "px-1.5 py-1.5 text-[12px]" : "px-2.5 py-2 text-[13px]",
                  task.status === s
                    ? cn(STATUS_COLORS[s], "text-white shadow-sm")
                    : "text-slate-500 hover:text-slate-700 hover:bg-white"
                )}
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {/* Jira / Slack 링크 — 추가/수정/삭제 가능 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Jira 링크 */}
            {editingJira ? (
              <div className="flex items-center gap-1">
                <span className="w-4 h-4 rounded bg-[var(--accent)] flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">J</span>
                <input
                  ref={jiraInputRef}
                  value={jiraKeyValue}
                  onChange={(e) => setJiraKeyValue(e.target.value)}
                  onBlur={handleSaveJiraLink}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveJiraLink();
                    if (e.key === "Escape") setEditingJira(false);
                  }}
                  placeholder="PROJ-123"
                  className="text-[12px] border border-[var(--accent-border)] rounded-md px-2 py-1 bg-[var(--accent-glow)] outline-none focus:ring-1 focus:ring-[var(--accent)] w-[100px] font-medium"
                />
              </div>
            ) : jiraLink ? (
              <div className="group/jira flex items-center gap-0.5">
                <a
                  href={jiraLink.jiraIssueUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center gap-1.5 bg-[var(--accent-glow)] hover:bg-[var(--surface2)] border border-[var(--accent-border)] text-[var(--accent)] rounded-lg shadow-sm transition-colors min-w-0 max-w-full",
                    compact ? "px-2 py-1 text-[12px]" : "px-2.5 py-1.5 text-[13px]"
                  )}
                >
                  <span className="w-4 h-4 rounded bg-[var(--accent)] flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">J</span>
                  <span className="truncate max-w-[120px] font-medium">{jiraLink.jiraIssueKey}</span>
                  {jiraLink.jiraStatus && <span className="opacity-60 truncate max-w-[80px] flex-shrink-0">· {jiraLink.jiraStatus}</span>}
                  <ExternalLink size={10} className="opacity-50 flex-shrink-0" />
                </a>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/jira:opacity-100 transition-opacity">
                  <button onClick={() => { setJiraKeyValue(jiraLink.jiraIssueKey || ""); setEditingJira(true); }} className="p-0.5 text-slate-400 hover:text-[var(--accent)] cursor-pointer" title="수정"><Pencil size={10} /></button>
                  <button onClick={() => handleDeleteLink(jiraLink.id, "Jira")} className="p-0.5 text-slate-400 hover:text-red-500 cursor-pointer" title="삭제"><X size={10} /></button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setJiraKeyValue(""); setEditingJira(true); }}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] border border-dashed border-slate-200 hover:border-[var(--accent-border)] rounded-md px-2 py-1 transition-all cursor-pointer"
              >
                <Plus size={10} />Jira
              </button>
            )}

            {/* Slack 링크 */}
            {editingSlack ? (
              <div className="flex items-center gap-1">
                <MessageSquare size={11} className="text-slate-400 flex-shrink-0" />
                <input
                  ref={slackInputRef}
                  value={slackUrlValue}
                  onChange={(e) => setSlackUrlValue(e.target.value)}
                  onBlur={handleSaveSlackLink}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveSlackLink();
                    if (e.key === "Escape") setEditingSlack(false);
                  }}
                  placeholder="Slack 스레드 URL"
                  className="text-[12px] border border-slate-200 rounded-md px-2 py-1 bg-slate-50 outline-none focus:ring-1 focus:ring-slate-300 w-[180px]"
                />
              </div>
            ) : slackLink ? (
              <div className="group/slack flex items-center gap-0.5">
                <a
                  href={slackLink.slackThreadUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "flex items-center gap-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 rounded-lg shadow-sm transition-colors flex-shrink-0",
                    compact ? "px-2 py-1 text-[12px]" : "px-2.5 py-1.5 text-[13px]"
                  )}
                >
                  <MessageSquare size={11} />
                  Slack
                  <ExternalLink size={10} className="opacity-50" />
                </a>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/slack:opacity-100 transition-opacity">
                  <button onClick={() => { setSlackUrlValue(slackLink.slackThreadUrl || ""); setEditingSlack(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer" title="수정"><Pencil size={10} /></button>
                  <button onClick={() => handleDeleteLink(slackLink.id, "Slack")} className="p-0.5 text-slate-400 hover:text-red-500 cursor-pointer" title="삭제"><X size={10} /></button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setSlackUrlValue(""); setEditingSlack(true); }}
                className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 border border-dashed border-slate-200 hover:border-slate-300 rounded-md px-2 py-1 transition-all cursor-pointer"
              >
                <Plus size={10} />Slack
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 확인 모달 */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          onClick={() => setConfirmModal(null)}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div
            className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-[320px] mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[15px] font-medium text-slate-800 leading-snug tracking-tight word-break-keep-all mb-5">
              {confirmModal.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all cursor-pointer shadow-sm"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
