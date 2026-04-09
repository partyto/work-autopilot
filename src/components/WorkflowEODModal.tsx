"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { X, Plus, Loader2 } from "lucide-react";

interface TaskItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string | null;
}

interface EODPreview {
  completedToday: Array<{ id: string; title: string; completedAt?: string | null }>;
  incomplete: TaskItem[];
  overdue: Array<{ id: string; title: string; priority: string; dueDate?: string | null }>;
  todayStr: string;
}

const PRIORITY_LABEL: Record<string, string> = { urgent: "긴급", high: "높음", medium: "보통", low: "낮음" };
const STATUS_LABEL: Record<string, string> = {
  pending: "대기", in_progress: "진행 중", in_qa: "IN-QA", done: "완료", cancelled: "취소",
};
const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500", high: "bg-orange-400", medium: "bg-amber-400", low: "bg-slate-300",
};

interface Props {
  onClose: () => void;
  onSent: () => void;
}

export default function WorkflowEODModal({ onClose, onSent }: Props) {
  const [preview, setPreview] = useState<EODPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // 미완료 태스크 상태 변경
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({});
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  // 내일 새 할일 추가 폼
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<"urgent" | "high" | "medium" | "low">("medium");
  const [newDueDate, setNewDueDate] = useState(() => {
    // 기본값: 내일
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow.toISOString().slice(0, 10);
  });
  const [addingTask, setAddingTask] = useState(false);
  const [addedTasks, setAddedTasks] = useState<{ title: string; priority: string }[]>([]);

  useEffect(() => {
    fetch("/api/daily/preview?type=eod")
      .then((r) => r.json())
      .then((d) => setPreview(d))
      .catch(() => toast.error("데이터 로드 실패"))
      .finally(() => setLoading(false));
  }, []);

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    setStatusOverrides((prev) => ({ ...prev, [taskId]: newStatus }));
    setSavingStatus(taskId);
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {
      toast.error("상태 변경 실패");
    } finally {
      setSavingStatus(null);
    }
  };

  const handleAddTask = async () => {
    if (!newTitle.trim()) return;
    setAddingTask(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          priority: newPriority,
          dueDate: newDueDate || undefined,
        }),
      });
      if (res.ok) {
        setAddedTasks((prev) => [...prev, { title: newTitle.trim(), priority: newPriority }]);
        setNewTitle("");
        setNewPriority("medium");
        toast.success("내일 할일 추가됨");
      } else {
        toast.error("추가 실패");
      }
    } catch {
      toast.error("네트워크 오류");
    } finally {
      setAddingTask(false);
    }
  };

  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch("/api/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "eod" }),
      });
      if (res.ok) {
        toast.success("하루 마무리 리포트가 Slack으로 전송됐어요");
        onSent();
      } else {
        const err = await res.json();
        toast.error(`전송 실패: ${err.error || "알 수 없는 오류"}`);
      }
    } catch {
      toast.error("네트워크 오류");
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 tracking-tight">📊 하루 마무리</h2>
            {preview && (
              <p className="text-[11px] text-slate-400 mt-0.5">{preview.todayStr} · 완료 {preview.completedToday.length}건 · 미완료 {preview.incomplete.length}건</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-all cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-slate-400">
              <Loader2 size={18} className="animate-spin mr-2" />
              <span className="text-sm">데이터 불러오는 중...</span>
            </div>
          ) : preview ? (
            <>
              {/* 오늘 완료 */}
              <Section
                title={`✅ 오늘 완료 (${preview.completedToday.length}건)`}
                empty={preview.completedToday.length === 0}
                emptyText="완료된 항목 없음"
              >
                {preview.completedToday.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 py-1 px-1">
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-emerald-500" />
                    <span className="text-xs text-slate-600 flex-1 truncate" style={{ wordBreak: "keep-all" }}>{t.title}</span>
                  </div>
                ))}
                {preview.completedToday.length > 5 && (
                  <p className="text-[11px] text-slate-400 pl-3">...외 {preview.completedToday.length - 5}건</p>
                )}
              </Section>

              {/* 미완료 — 상태 변경 가능 */}
              <Section
                title={`🔄 미완료 — 내일로 이관 (${preview.incomplete.length}건)`}
                empty={preview.incomplete.length === 0}
                emptyText="미완료 항목 없음"
              >
                {preview.incomplete.map((t) => {
                  const currentStatus = statusOverrides[t.id] ?? t.status;
                  return (
                    <div key={t.id} className="flex items-center gap-2 py-1 px-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || "bg-slate-300"}`} />
                      <span className="text-xs text-slate-700 flex-1 truncate" style={{ wordBreak: "keep-all" }}>{t.title}</span>
                      <div className="relative flex-shrink-0">
                        {savingStatus === t.id ? (
                          <Loader2 size={12} className="animate-spin text-slate-400" />
                        ) : (
                          <select
                            value={currentStatus}
                            onChange={(e) => handleStatusChange(t.id, e.target.value)}
                            className="text-[10px] bg-slate-100 border border-slate-200 rounded-md px-1.5 py-0.5 text-slate-600 cursor-pointer focus:outline-none focus:border-blue-400 appearance-none pr-4"
                          >
                            {["pending", "in_progress", "done", "cancelled"].map((s) => (
                              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Section>

              {/* 기한 초과 */}
              {preview.overdue.length > 0 && (
                <Section title={`⚠️ 기한 초과 (${preview.overdue.length}건)`}>
                  {preview.overdue.slice(0, 5).map((t) => (
                    <div key={t.id} className="flex items-center gap-2 py-1 px-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || "bg-slate-300"}`} />
                      <span className="text-xs text-slate-700 flex-1 truncate" style={{ wordBreak: "keep-all" }}>{t.title}</span>
                      <span className="text-[10px] bg-red-50 text-red-600 border border-red-200 px-1.5 py-0.5 rounded-md flex-shrink-0">
                        {t.dueDate?.slice(0, 10)}
                      </span>
                    </div>
                  ))}
                </Section>
              )}

              {/* 방금 추가한 내일 할일 */}
              {addedTasks.length > 0 && (
                <Section title={`➕ 내일 추가한 할일 (${addedTasks.length}건)`}>
                  {addedTasks.map((t, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 px-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PRIORITY_DOT[t.priority] || "bg-slate-300"}`} />
                      <span className="text-xs text-slate-700 flex-1 truncate" style={{ wordBreak: "keep-all" }}>{t.title}</span>
                      <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md">내일</span>
                    </div>
                  ))}
                </Section>
              )}

              {/* 내일 새 할일 추가 폼 */}
              <div className="border border-slate-100 rounded-xl p-3 space-y-2 bg-slate-50">
                <p className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                  <Plus size={11} /> 내일 새 할일 추가
                </p>
                <input
                  type="text"
                  placeholder="할일 제목"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddTask(); }}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-300/30 transition-colors"
                />
                <div className="flex gap-2">
                  <div className="flex gap-1 flex-1">
                    {(["urgent", "high", "medium", "low"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNewPriority(p)}
                        className={`flex-1 py-1 text-[10px] rounded-md border transition-all cursor-pointer font-medium ${
                          newPriority === p
                            ? p === "urgent" ? "bg-red-50 border-red-300 text-red-600"
                              : p === "high" ? "bg-orange-50 border-orange-300 text-orange-600"
                              : p === "medium" ? "bg-amber-50 border-amber-300 text-amber-600"
                              : "bg-slate-100 border-slate-300 text-slate-600"
                            : "border-slate-200 text-slate-400 hover:border-slate-300"
                        }`}
                      >
                        {PRIORITY_LABEL[p]}
                      </button>
                    ))}
                  </div>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[10px] text-slate-600 focus:outline-none focus:border-blue-400 cursor-pointer"
                  />
                  <button
                    onClick={handleAddTask}
                    disabled={!newTitle.trim() || addingTask}
                    className="flex items-center gap-1 px-3 py-1 text-[11px] bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 text-white rounded-lg transition-colors cursor-pointer font-medium"
                  >
                    {addingTask ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
                    추가
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
          >
            취소
          </button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleSend}
            disabled={sending || loading}
            className="flex items-center gap-1.5 px-5 py-2 text-xs bg-slate-900 hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl transition-colors cursor-pointer font-medium"
          >
            {sending ? (
              <><Loader2 size={12} className="animate-spin" /> 전송 중...</>
            ) : (
              "Slack으로 전송"
            )}
          </motion.button>
        </div>
      </motion.div>
    </div>
  );
}

function Section({
  title, children, empty, emptyText,
}: {
  title: string;
  children?: React.ReactNode;
  empty?: boolean;
  emptyText?: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-slate-500 mb-2">{title}</p>
      <div className="space-y-0.5">
        {empty ? (
          <p className="text-[11px] text-slate-400 pl-1">{emptyText || "없음"}</p>
        ) : children}
      </div>
    </div>
  );
}
