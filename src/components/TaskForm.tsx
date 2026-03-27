"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Plus,
  X,
  Flag,
  Calendar,
  Link2,
  GitBranch,
  Hash,
  MessageSquare,
  Loader2,
} from "lucide-react";

interface TaskFormProps {
  onCreated: () => void;
}

type JiraProject = { key: string; name: string; id: string };
type JiraIssueType = { id: string; name: string; subtask: boolean };
type JiraCreateField = {
  fieldId: string;
  name: string;
  required: boolean;
  schema: { type: string; items?: string; custom?: string };
  allowedValues?: { id: string; name: string; value?: string }[];
};

const PRIORITY_CONFIG = {
  high:   { label: "높음",  color: "text-white",            bg: "bg-red-500",              border: "border-red-500" },
  medium: { label: "보통",  color: "text-[var(--accent)]",  bg: "bg-[var(--accent-glow)]", border: "border-[var(--accent-border)]" },
  low:    { label: "낮음",  color: "text-slate-400",        bg: "bg-slate-100",            border: "border-slate-200" },
};

export default function TaskForm({ onCreated }: TaskFormProps) {
  const [isOpen, setIsOpen] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState("");
  const [slackThreadUrl, setSlackThreadUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [jiraMode, setJiraMode] = useState<"none" | "link" | "create">("none");
  const [jiraIssueKey, setJiraIssueKey] = useState("");

  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [issueTypes, setIssueTypes] = useState<JiraIssueType[]>([]);
  const [createFields, setCreateFields] = useState<JiraCreateField[]>([]);
  const [myAccountId, setMyAccountId] = useState("");

  const [selectedProject, setSelectedProject] = useState("");
  const [selectedIssueType, setSelectedIssueType] = useState<JiraIssueType | null>(null);
  const [fieldValues, setFieldValues] = useState<Record<string, any>>({});

  const [loadingProjects, setLoadingProjects] = useState(false);
  const [loadingIssueTypes, setLoadingIssueTypes] = useState(false);
  const [loadingFields, setLoadingFields] = useState(false);

  const loadProjects = useCallback(async () => {
    if (projects.length > 0) return;
    setLoadingProjects(true);
    try {
      const res = await fetch("/api/jira/meta?action=projects");
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects || []);
      setPinnedKeys(data.pinnedKeys || []);
      if (data.projects?.length > 0 && !selectedProject) {
        setSelectedProject(data.pinnedKeys?.[0] || data.projects[0].key);
      }
    } catch (err) {
      console.error("프로젝트 로드 실패:", err);
    } finally {
      setLoadingProjects(false);
    }
  }, [projects.length, selectedProject]);

  useEffect(() => {
    if (jiraMode !== "create" || !selectedProject) return;
    let cancelled = false;
    setLoadingIssueTypes(true);
    setIssueTypes([]);
    setSelectedIssueType(null);
    setCreateFields([]);
    setFieldValues({});

    fetch(`/api/jira/meta?action=issuetypes&project=${selectedProject}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const types = data.issueTypes || [];
        setIssueTypes(types);
        if (types.length > 0) {
          const task = types.find((t: JiraIssueType) => t.name === "Task") || types[0];
          setSelectedIssueType(task);
        }
      })
      .catch((err) => console.error("이슈타입 로드 실패:", err))
      .finally(() => { if (!cancelled) setLoadingIssueTypes(false); });

    return () => { cancelled = true; };
  }, [selectedProject, jiraMode]);

  useEffect(() => {
    if (jiraMode !== "create" || !selectedProject || !selectedIssueType) return;
    let cancelled = false;
    setLoadingFields(true);
    setCreateFields([]);
    setFieldValues({});

    fetch(`/api/jira/meta?action=fields&project=${selectedProject}&issueTypeId=${selectedIssueType.id}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setCreateFields(data.fields || []);
        setMyAccountId(data.myAccountId || "");
        const defaults: Record<string, any> = {};
        for (const f of data.fields || []) {
          if (f.fieldId === "assignee") defaults[f.fieldId] = data.myAccountId;
        }
        setFieldValues(defaults);
      })
      .catch((err) => console.error("필드 로드 실패:", err))
      .finally(() => { if (!cancelled) setLoadingFields(false); });

    return () => { cancelled = true; };
  }, [selectedProject, selectedIssueType, jiraMode]);

  useEffect(() => {
    if (jiraMode === "create") loadProjects();
  }, [jiraMode, loadProjects]);

  const setFieldValue = (fieldId: string, value: any) => {
    setFieldValues((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    const toastId = toast.loading(
      jiraMode === "create" ? "Jira 이슈 생성 중..." : "할일 추가 중..."
    );

    try {
      let jiraFields: Record<string, any> | undefined;
      if (jiraMode === "create") {
        jiraFields = { ...fieldValues };
        jiraFields.summary = title.trim();
        if (description.trim()) jiraFields.description = description.trim();
        if (dueDate) jiraFields.duedate = dueDate;
        if (!jiraFields.assignee && myAccountId) jiraFields.assignee = myAccountId;
      }

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: description || undefined,
          priority,
          dueDate: dueDate || undefined,
          jiraIssueKey: jiraMode === "link" ? jiraIssueKey || undefined : undefined,
          createJiraIssue: jiraMode === "create",
          jiraProjectKey: jiraMode === "create" ? selectedProject : undefined,
          jiraIssueTypeName: jiraMode === "create" ? selectedIssueType?.name : undefined,
          jiraFields: jiraMode === "create" ? jiraFields : undefined,
          slackThreadUrl: slackThreadUrl || undefined,
        }),
      });

      if (res.ok) {
        toast.success(
          jiraMode === "create" ? "Jira 이슈 + 할일 생성 완료" : "할일 추가됨",
          { id: toastId }
        );
        resetForm();
        onCreated();
      } else {
        const err = await res.json();
        toast.error(`생성 실패: ${err.error || "알 수 없는 오류"}`, { id: toastId });
      }
    } catch (error) {
      toast.error("네트워크 오류", { id: toastId });
      console.error("Failed to create task:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("medium");
    setDueDate("");
    setJiraIssueKey("");
    setJiraMode("none");
    setSlackThreadUrl("");
    setFieldValues({});
    setIsOpen(false);
  };

  const inputClass =
    "w-full bg-[var(--surface2)] border border-[var(--border2)] rounded-lg px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 transition-colors";
  const selectClass = inputClass;

  const AUTO_MAPPED_FIELDS = new Set(["summary", "description", "duedate", "assignee"]);
  const visibleFields = createFields.filter((f) => !AUTO_MAPPED_FIELDS.has(f.fieldId));

  if (!isOpen) {
    return (
      <motion.button
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-[var(--accent)] hover:bg-[var(--accent-dim)] text-white rounded-xl transition-all cursor-pointer shadow-sm"
      >
        <Plus size={13} />
        새 할일
      </motion.button>
    );
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* 배경 오버레이 */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-[2px]"
        onClick={resetForm}
      />

      {/* 모달 */}
      <AnimatePresence>
        <motion.form
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onSubmit={handleSubmit}
          className="relative z-10 bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 w-full max-w-lg overflow-y-auto max-h-[88vh] space-y-4"
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between mb-1">
            <span className="text-[15px] font-bold text-slate-800">새 할일</span>
            <button
              type="button"
              onClick={resetForm}
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>

          {/* 제목 */}
          <input
            type="text"
            placeholder="할일 제목을 입력하세요"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-[var(--surface2)] border border-[var(--border2)] rounded-xl px-4 py-3 text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--accent)]/50 focus:ring-2 focus:ring-[var(--accent-glow)] transition-all"
            autoFocus
          />

          {/* 설명 */}
          <textarea
            placeholder="설명 (선택사항)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full bg-[var(--surface2)] border border-[var(--border2)] rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:border-[var(--accent)]/50 resize-none transition-all"
          />

          {/* 우선순위 + 기한 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="flex items-center gap-1 text-[11px] text-slate-500 mb-1.5 font-medium">
                <Flag size={10} /> 우선순위
              </label>
              <div className="flex gap-1">
                {(["high", "medium", "low"] as const).map((p) => {
                  const cfg = PRIORITY_CONFIG[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`flex-1 py-1.5 text-[11px] rounded-lg border transition-all cursor-pointer font-medium ${
                        priority === p
                          ? `${cfg.bg} ${cfg.border} ${cfg.color}`
                          : "border-[var(--border2)] text-slate-400 hover:text-slate-700 hover:bg-[var(--surface2)]"
                      }`}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label className="flex items-center gap-1 text-[11px] text-slate-500 mb-1.5 font-medium">
                <Calendar size={10} /> 기한
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={selectClass}
              />
            </div>
          </div>

          {/* Jira 연결 */}
          <div className="border-t border-[var(--border2)] pt-4">
            <div className="flex items-center gap-3 mb-3">
              <span className="flex items-center gap-1 text-[11px] text-slate-500 font-medium">
                <GitBranch size={10} /> Jira
              </span>
              <div className="flex items-center gap-0.5 bg-[var(--surface2)] rounded-lg p-0.5">
                {(["none", "link", "create"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setJiraMode(mode);
                      if (mode !== "link") setJiraIssueKey("");
                    }}
                    className={`px-2.5 py-1 text-[10px] rounded-md transition-all cursor-pointer font-medium ${
                      jiraMode === mode
                        ? "bg-[var(--accent)] text-white"
                        : "text-slate-500 hover:text-slate-700 hover:bg-[var(--surface)]"
                    }`}
                  >
                    {mode === "none" ? "연결 안함" : mode === "link" ? "기존 연결" : "새 이슈 생성"}
                  </button>
                ))}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {jiraMode === "link" && (
                <motion.div
                  key="link"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="flex items-center gap-2">
                    <Hash size={13} className="text-slate-400 shrink-0" />
                    <input
                      type="text"
                      placeholder="예: BIZWAIT-5555"
                      value={jiraIssueKey}
                      onChange={(e) => setJiraIssueKey(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </motion.div>
              )}

              {jiraMode === "create" && (
                <motion.div
                  key="create"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-3 bg-[var(--accent-glow)] border border-[var(--accent-border)] rounded-xl p-3"
                >
                  {loadingProjects ? (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Loader2 size={12} className="animate-spin" />
                      프로젝트 로딩 중...
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] text-[var(--accent)] mb-1 font-medium">프로젝트 *</label>
                          <select
                            value={selectedProject}
                            onChange={(e) => setSelectedProject(e.target.value)}
                            className={selectClass}
                          >
                            {projects.map((p) => (
                              <option key={p.key} value={p.key}>
                                {pinnedKeys.includes(p.key) ? "★ " : ""}{p.name} ({p.key})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-[10px] text-[var(--accent)] mb-1 font-medium">이슈 타입 *</label>
                          {loadingIssueTypes ? (
                            <div className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500">
                              <Loader2 size={11} className="animate-spin" /> 로딩 중...
                            </div>
                          ) : (
                            <select
                              value={selectedIssueType?.id || ""}
                              onChange={(e) => {
                                const it = issueTypes.find((t) => t.id === e.target.value);
                                setSelectedIssueType(it || null);
                              }}
                              className={selectClass}
                              disabled={issueTypes.length === 0}
                            >
                              {issueTypes.map((it) => (
                                <option key={it.id} value={it.id}>{it.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      </div>

                      {loadingFields ? (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Loader2 size={12} className="animate-spin" />
                          필드 로딩 중...
                        </div>
                      ) : visibleFields.length > 0 ? (
                        <div className="space-y-2">
                          <p className="text-[10px] text-[var(--accent)] border-b border-[var(--accent-border)] pb-1">
                            추가 필드{visibleFields.filter((f) => f.required).length > 0 && " (* 필수)"}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            {visibleFields.map((field) => (
                              <DynamicField
                                key={field.fieldId}
                                field={field}
                                value={fieldValues[field.fieldId]}
                                onChange={(val) => setFieldValue(field.fieldId, val)}
                                inputClass={inputClass}
                                selectClass={selectClass}
                              />
                            ))}
                          </div>
                        </div>
                      ) : null}

                      <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--accent-border)]">
                        <div className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full opacity-60" />
                        <span className="text-[10px] text-[var(--accent)]/70">
                          제목 → Summary · 설명 → Description · 기한 → Due Date · 담당자 → 본인 (자동)
                        </span>
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Slack */}
          <div>
            <label className="flex items-center gap-1 text-[11px] text-slate-500 mb-1.5 font-medium">
              <MessageSquare size={10} /> Slack 스레드 URL (선택)
            </label>
            <input
              type="url"
              placeholder="https://wad-hq.slack.com/..."
              value={slackThreadUrl}
              onChange={(e) => setSlackThreadUrl(e.target.value)}
              className={inputClass}
            />
          </div>

          {/* 버튼 */}
          <div className="flex gap-2 justify-end pt-2 border-t border-[var(--border2)]">
            <button
              type="button"
              onClick={resetForm}
              className="px-4 py-2 text-[13px] text-slate-500 hover:text-slate-800 transition-colors cursor-pointer rounded-xl hover:bg-slate-100"
            >
              취소
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={!title.trim() || isSubmitting}
              className="flex items-center gap-1.5 px-5 py-2 text-[13px] bg-[var(--accent)] hover:bg-[var(--accent-dim)] disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl transition-all cursor-pointer font-semibold"
            >
              {isSubmitting ? (
                <><Loader2 size={13} className="animate-spin" /> 처리 중...</>
              ) : (
                <><Plus size={13} /> {jiraMode === "create" ? "Jira + 할일 추가" : "할일 추가"}</>
              )}
            </motion.button>
          </div>
        </motion.form>
      </AnimatePresence>
    </div>
  );
}

function DynamicField({
  field, value, onChange, inputClass, selectClass,
}: {
  field: JiraCreateField;
  value: any;
  onChange: (val: any) => void;
  inputClass: string;
  selectClass: string;
}) {
  const label = `${field.name}${field.required ? " *" : ""}`;
  const { type } = field.schema;

  if (field.allowedValues && field.allowedValues.length > 0) {
    if (type === "array") {
      const selected: string[] = Array.isArray(value) ? value : [];
      return (
        <div>
          <label className="block text-[10px] text-slate-500 mb-1 font-medium">{label}</label>
          <select
            multiple
            value={selected}
            onChange={(e) => {
              const vals = Array.from(e.target.selectedOptions).map((o) => o.value);
              onChange(vals.map((v) => ({ id: v })));
            }}
            className={`${selectClass} min-h-[60px]`}
          >
            {field.allowedValues.map((av) => (
              <option key={av.id} value={av.id}>{av.name}</option>
            ))}
          </select>
        </div>
      );
    }
    return (
      <div>
        <label className="block text-[10px] text-slate-500 mb-1 font-medium">{label}</label>
        <select
          value={typeof value === "object" ? value?.id || "" : value || ""}
          onChange={(e) => {
            const sel = field.allowedValues!.find((av) => av.id === e.target.value);
            if (sel) {
              onChange(field.fieldId === "priority" ? sel.name : { id: sel.id });
            } else {
              onChange(undefined);
            }
          }}
          className={selectClass}
        >
          {!field.required && <option value="">선택 안함</option>}
          {field.allowedValues.map((av) => (
            <option key={av.id} value={av.id}>{av.name}</option>
          ))}
        </select>
      </div>
    );
  }

  if (type === "number") {
    return (
      <div>
        <label className="block text-[10px] text-slate-500 mb-1 font-medium">{label}</label>
        <input
          type="number"
          value={value || ""}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          className={inputClass}
          placeholder={field.name}
        />
      </div>
    );
  }

  if (type === "date") {
    return (
      <div>
        <label className="block text-[10px] text-slate-500 mb-1 font-medium">{label}</label>
        <input
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        />
      </div>
    );
  }

  if (field.fieldId === "labels") {
    return (
      <div>
        <label className="block text-[10px] text-slate-500 mb-1 font-medium">{label}</label>
        <input
          type="text"
          value={Array.isArray(value) ? value.join(", ") : value || ""}
          onChange={(e) => {
            const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
            onChange(vals.length > 0 ? vals : undefined);
          }}
          className={inputClass}
          placeholder="쉼표로 구분 (예: bug, urgent)"
        />
      </div>
    );
  }

  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1 font-medium">{label}</label>
      <input
        type="text"
        value={value || ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className={inputClass}
        placeholder={field.name}
      />
    </div>
  );
}
