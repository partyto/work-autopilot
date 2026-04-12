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
  in_qa: "bg-amber-400",
  done: "bg-emerald-400",
  cancelled: "bg-slate-200",
  overdue: "bg-red-500",
};

const PRIORITY_CONFIG: Record<string, { label: string; barColor: string; badgeClass: string; flagColor: string; cardAccent: string }> = {
  urgent: {
    label: "긴급",
    barColor: "bg-red-500",
    badgeClass: "bg-red-500 text-white border-red-500",
    flagColor: "text-red-500",
    cardAccent: "ring-1 ring-red-200 bg-red-50/30",
  },
  high: {
    label: "높음",
    barColor: "bg-orange-400",
    badgeClass: "bg-orange-400 text-white border-orange-400",
    flagColor: "text-orange-400",
    cardAccent: "",
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

const PRIORITIES = ["urgent", "high", "medium", "low"] as const;

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

function formatSlackTs(ts: string): string {
  try {
    return formatDateTime(new Date(parseFloat(ts) * 1000).toISOString());
  } catch {
    return "";
  }
}

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
  const [isDescLong, setIsDescLong] = useState(false);

  // 인라인 편집 상태
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(task.title);
  const [editingDue, setEditingDue] = useState(false);
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [editingJira, setEditingJira] = useState(false);
  const [jiraKeyValue, setJiraKeyValue] = useState("");
  const [editingSlack, setEditingSlack] = useState(false);
  const [slackUrlValue, setSlackUrlValue] = useState("");
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlValue, setUrlValue] = useState("");

  const titleInputRef = useRef<HTMLInputElement>(null);
  const jiraInputRef = useRef<HTMLInputElement>(null);
  const slackInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const priorityMenuRef = useRef<HTMLDivElement>(null);
  const statusMenuRef = useRef<HTMLDivElement>(null);
  const descRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.select();
  }, [editingTitle]);

  useEffect(() => {
    if (editingJira) jiraInputRef.current?.focus();
  }, [editingJira]);

  useEffect(() => {
    if (editingSlack) slackInputRef.current?.focus();
  }, [editingSlack]);

  useEffect(() => {
    if (editingUrl) urlInputRef.current?.focus();
  }, [editingUrl]);

  // 설명 2줄 초과 여부 감지
  useEffect(() => {
    const el = descRef.current;
    if (!el) return;
    setIsDescLong(el.scrollHeight > el.clientHeight + 2);
  }, [task.description]);

  // 우선순위 메뉴 외부 클릭 닫기
  useEffect(() => {
    if (!showPriorityMenu) return;
    const handler = (e: MouseEvent) => {
      if (!priorityMenuRef.current?.contains(e.target as Node)) setShowPriorityMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showPriorityMenu]);

  // 상태 메뉴 외부 클릭 닫기
  useEffect(() => {
    if (!showStatusMenu) return;
    const handler = (e: MouseEvent) => {
      if (!statusMenuRef.current?.contains(e.target as Node)) setShowStatusMenu(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showStatusMenu]);

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
    setShowStatusMenu(false);
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

  const parseSlackUrl = (url: string) => {
    const m = url.match(/archives\/([A-Z0-9]+)\/p(\d+)/);
    if (!m) return null;
    const channelId = m[1];
    const raw = m[2];
    const threadTs = raw.slice(0, 10) + "." + raw.slice(10);
    return { channelId, threadTs };
  };

  const handleSaveUrlLink = async () => {
    setEditingUrl(false);
    const url = urlValue.trim();
    if (!url) return;
    try {
      const existing = task.links?.find((l) => l.linkType === "url");
      if (existing) await fetch(`/api/links?id=${existing.id}`, { method: "DELETE" });
      await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id, linkType: "url", url }),
      });
      toast.success("URL 연결됨");
      onUpdate();
    } catch {
      toast.error("URL 저장 실패");
    }
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
  const isDueToday = task.dueDate && task.status !== "done" && task.status !== "cancelled" && task.dueDate.slice(0, 10) === todayStr;
  const isDue = task.dueDate && task.status !== "done" && task.status !== "cancelled" && task.dueDate.slice(0, 10) < todayStr;
  const isDueSoon = task.dueDate && task.status !== "done" && task.status !== "cancelled" && !isDue && !isDueToday && new Date(task.dueDate) <= new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const jiraLink = task.links?.find((l) => l.linkType === "jira");
  const slackLink = task.links?.find((l) => l.linkType === "slack_thread");
  const urlLink = task.links?.find((l) => l.linkType === "url");
  const isDone = task.status === "done";
  const pCfg = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.low;

  // 상태 드롭다운 버튼 스타일 — 현재 상태 색상 기반
  const statusBtnClass = cn(
    "flex items-center gap-1.5 text-[11px] font-semibold rounded-lg px-2 py-1 border transition-all cursor-pointer",
    STATUS_COLORS[task.status] ? cn(STATUS_COLORS[task.status], "text-white border-transparent shadow-sm") : "bg-slate-100 text-slate-600 border-slate-200"
  );

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
      {/* 왼쪽 우선순위 바 */}
      <div className={cn("absolute left-0 top-0 bottom-0 overflow-hidden rounded-l-2xl", task.priority === "urgent" ? "w-[4px]" : "w-[3px]")}>
        <div className={cn("w-full h-full cursor-pointer", pCfg.barColor)} onClick={() => setShowPriorityMenu(true)} title="우선순위 변경" />
      </div>

      <div className={cn("pl-[18px]", compact ? "px-3.5 py-2.5" : "px-4 py-3.5")}>

        {/* 상단: 소스·우선순위 배지(좌) + 상태 드롭다운·삭제(우) */}
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="flex items-center gap-1">
            {SOURCE_BADGE[task.sourceType] && (
              <span className={cn("flex-shrink-0 font-bold rounded leading-none tracking-wide text-[9px] px-1.5 py-0.5", SOURCE_BADGE[task.sourceType].className)}>
                {SOURCE_BADGE[task.sourceType].label}
              </span>
            )}
            <div className="relative flex-shrink-0" ref={priorityMenuRef}>
              <button
                onClick={() => setShowPriorityMenu(!showPriorityMenu)}
                className={cn("flex items-center gap-0.5 font-semibold rounded border leading-none transition-all hover:opacity-80 cursor-pointer text-[10px] px-1.5 py-0.5", pCfg.badgeClass)}
                title="우선순위 변경"
              >
                <Flag size={9} />
                {pCfg.label}
              </button>
              {showPriorityMenu && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[90px]">
                  {PRIORITIES.map((p) => (
                    <button key={p} onClick={() => handlePriorityChange(p)}
                      className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 transition-colors cursor-pointer", task.priority === p ? "font-bold" : "")}>
                      <Flag size={10} className={PRIORITY_CONFIG[p].flagColor} />
                      {PRIORITY_CONFIG[p].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 우측: 상태 드롭다운 */}
          <div className="relative flex-shrink-0" ref={statusMenuRef}>
            <button
              onClick={() => setShowStatusMenu(!showStatusMenu)}
              disabled={isUpdating}
              className={statusBtnClass}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 flex-shrink-0" />
              {STATUS_LABELS[task.status]}
              <ChevronDown size={9} className={cn("transition-transform", showStatusMenu ? "rotate-180" : "")} />
            </button>
            {showStatusMenu && (
              <div className="absolute top-full right-0 mt-1 z-50 bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[110px]">
                {STATUSES.filter((s) => !(s === "in_qa" && task.sourceType === "slack_detected")).map((s) => (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className={cn("w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-slate-50 transition-colors cursor-pointer",
                      task.status === s ? "font-semibold text-slate-800" : "text-slate-600")}
                  >
                    <span className={cn("w-2 h-2 rounded-full flex-shrink-0", STATUS_DOT[s])} />
                    {STATUS_LABELS[s]}
                  </button>
                ))}
                <div className="my-1 border-t border-slate-100" />
                <button
                  onClick={() => { setShowStatusMenu(false); handleDelete(); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50 transition-colors cursor-pointer"
                >
                  <Trash2 size={11} className="flex-shrink-0" />
                  삭제
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 제목 */}
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

        {/* 설명 — 항상 표시, 2줄 클램프 + 더 보기/접기 */}
        {task.description && (
          <div className={cn("mt-1.5", task.sourceType === "slack_detected" ? "flex items-start gap-1" : "")}>
            {task.sourceType === "slack_detected" && (
              <MessageSquare size={10} className="flex-shrink-0 mt-0.5 text-slate-300" />
            )}
            <div className="min-w-0 flex-1">
              <p
                ref={descRef}
                className={cn(
                  "text-[12px] text-slate-500 leading-relaxed break-all",
                  expanded ? "" : "line-clamp-2"
                )}
              >
                {task.description}
              </p>
              {(isDescLong || expanded) && (
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="mt-0.5 text-[11px] text-slate-400 hover:text-slate-600 cursor-pointer transition-colors"
                >
                  {expanded ? "접기" : "더 보기"}
                </button>
              )}
            </div>
          </div>
        )}

        {/* 메타 정보 */}
        <div className={cn("flex items-center flex-wrap gap-1.5", task.description ? "mt-1.5" : compact ? "mt-1" : "mt-1.5")}>
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
                "flex items-center gap-0.5 text-[11px] rounded px-1 py-0.5 transition-all hover:bg-slate-100 cursor-pointer",
                isDue ? "text-[var(--error)] font-medium" : isDueToday ? "text-[var(--accent)] font-medium" : isDueSoon ? "text-slate-500" : task.dueDate ? "text-slate-400 hover:text-slate-600" : "text-slate-300 hover:text-slate-500"
              )}
              title="기한 설정"
            >
              {isDue || isDueToday ? <AlertCircle size={10} /> : <Calendar size={10} />}
              {task.dueDate ? (isDue ? `기한 초과 ${task.dueDate.slice(0, 10)}` : isDueToday ? `오늘 마감` : `마감 ${task.dueDate.slice(5, 10)}`) : null}
            </button>
          )}

          {(() => {
            const { label, value } = getOriginDate(task.sourceType, task.createdAt, jiraLink, slackLink);
            return <span className="text-[11px] text-slate-400">{compact ? value.slice(5, 16) : `${label} ${value}`}</span>;
          })()}
          {task.completedAt && (
            <span className="text-[11px] text-slate-400">완료 {formatDateTime(task.completedAt)}</span>
          )}
        </div>

        {/* 하단: 링크 영역 */}
        <div className={cn("flex items-center gap-1.5 overflow-hidden", compact ? "mt-2" : "mt-2.5")}>
          <div className={cn(
            "flex items-center gap-1.5 w-full overflow-hidden transition-opacity",
            !jiraLink && !slackLink && !urlLink && !editingJira && !editingSlack && !editingUrl ? "opacity-0 group-hover:opacity-100" : ""
          )}>
            {/* Jira */}
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
                <a href={jiraLink.jiraIssueUrl || "#"} target="_blank" rel="noopener noreferrer"
                  className={cn("flex items-center gap-1.5 bg-[var(--accent-glow)] hover:bg-[var(--surface2)] border border-[var(--accent-border)] text-[var(--accent)] rounded-lg shadow-sm transition-colors min-w-0 max-w-full",
                    compact ? "px-2 py-1 text-[11px]" : "px-2 py-1 text-[11px]")}>
                  <span className="w-3.5 h-3.5 rounded bg-[var(--accent)] flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0">J</span>
                  <span className="truncate max-w-[100px] font-medium">{jiraLink.jiraIssueKey}</span>
                  {jiraLink.jiraStatus && <span className="opacity-60 truncate max-w-[70px] flex-shrink-0 hidden sm:inline">· {jiraLink.jiraStatus}</span>}
                  <ExternalLink size={9} className="opacity-50 flex-shrink-0" />
                </a>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/jira:opacity-100 transition-opacity">
                  <button onClick={() => { setJiraKeyValue(jiraLink.jiraIssueKey || ""); setEditingJira(true); }} className="p-0.5 text-slate-400 hover:text-[var(--accent)] cursor-pointer" title="수정"><Pencil size={9} /></button>
                  <button onClick={() => handleDeleteLink(jiraLink.id, "Jira")} className="p-0.5 text-slate-400 hover:text-red-500 cursor-pointer" title="삭제"><X size={9} /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setJiraKeyValue(""); setEditingJira(true); }}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-[var(--accent)] hover:bg-[var(--accent-glow)] border border-dashed border-slate-200 hover:border-[var(--accent-border)] rounded-md px-1.5 py-0.5 transition-all cursor-pointer">
                <Plus size={9} />Jira
              </button>
            )}

            {/* Slack */}
            {editingSlack ? (
              <div className="flex items-center gap-1">
                <MessageSquare size={10} className="text-slate-400 flex-shrink-0" />
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
                <a href={slackLink.slackThreadUrl || "#"} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 rounded-lg shadow-sm transition-colors flex-shrink-0 px-2 py-1 text-[11px]">
                  <MessageSquare size={10} />Slack
                  <ExternalLink size={9} className="opacity-50" />
                </a>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/slack:opacity-100 transition-opacity">
                  <button onClick={() => { setSlackUrlValue(slackLink.slackThreadUrl || ""); setEditingSlack(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer" title="수정"><Pencil size={9} /></button>
                  <button onClick={() => handleDeleteLink(slackLink.id, "Slack")} className="p-0.5 text-slate-400 hover:text-red-500 cursor-pointer" title="삭제"><X size={9} /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setSlackUrlValue(""); setEditingSlack(true); }}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 border border-dashed border-slate-200 hover:border-slate-300 rounded-md px-1.5 py-0.5 transition-all cursor-pointer">
                <Plus size={9} />Slack
              </button>
            )}

            {/* 기타 URL */}
            {editingUrl ? (
              <div className="flex items-center gap-1">
                <ExternalLink size={10} className="text-slate-400 flex-shrink-0" />
                <input
                  ref={urlInputRef}
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  onBlur={handleSaveUrlLink}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveUrlLink();
                    if (e.key === "Escape") setEditingUrl(false);
                  }}
                  placeholder="https://..."
                  className="text-[12px] border border-slate-200 rounded-md px-2 py-1 bg-slate-50 outline-none focus:ring-1 focus:ring-slate-300 w-[180px]"
                />
              </div>
            ) : urlLink ? (
              <div className="group/url flex items-center gap-0.5">
                <a href={urlLink.slackThreadUrl || "#"} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 rounded-lg shadow-sm transition-colors flex-shrink-0 px-2 py-1 text-[11px]">
                  <ExternalLink size={10} />URL
                </a>
                <div className="flex items-center gap-0.5 opacity-0 group-hover/url:opacity-100 transition-opacity">
                  <button onClick={() => { setUrlValue(urlLink.slackThreadUrl || ""); setEditingUrl(true); }} className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer" title="수정"><Pencil size={9} /></button>
                  <button onClick={() => handleDeleteLink(urlLink.id, "URL")} className="p-0.5 text-slate-400 hover:text-red-500 cursor-pointer" title="삭제"><X size={9} /></button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setUrlValue(""); setEditingUrl(true); }}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-600 hover:bg-slate-50 border border-dashed border-slate-200 hover:border-slate-300 rounded-md px-1.5 py-0.5 transition-all cursor-pointer">
                <Plus size={9} />URL
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 확인 모달 */}
      {confirmModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center" onClick={() => setConfirmModal(null)}>
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
          <div className="relative bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-[320px] mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-[15px] font-medium text-slate-800 leading-snug tracking-tight word-break-keep-all mb-5">
              {confirmModal.message}
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmModal(null)}
                className="px-4 py-2 text-[13px] font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-all cursor-pointer">
                취소
              </button>
              <button onClick={confirmModal.onConfirm}
                className="px-4 py-2 text-[13px] font-semibold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all cursor-pointer shadow-sm">
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
