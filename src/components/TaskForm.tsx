"use client";

import { useState, useEffect, useCallback } from "react";

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

export default function TaskForm({ onCreated }: TaskFormProps) {
  const [isOpen, setIsOpen] = useState(false);

  // TO-DO 기본 필드
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState("");
  const [slackThreadUrl, setSlackThreadUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Jira 모드: none | link | create
  const [jiraMode, setJiraMode] = useState<"none" | "link" | "create">("none");
  const [jiraIssueKey, setJiraIssueKey] = useState("");

  // Jira 생성 메타
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

  // 1) 프로젝트 목록 로드
  const loadProjects = useCallback(async () => {
    if (projects.length > 0) return;
    setLoadingProjects(true);
    try {
      const res = await fetch("/api/jira/meta?action=projects");
      if (!res.ok) return;
      const data = await res.json();
      setProjects(data.projects || []);
      setPinnedKeys(data.pinnedKeys || []);
      // 기본 선택: 첫 번째 pinned 프로젝트
      if (data.projects?.length > 0 && !selectedProject) {
        setSelectedProject(data.pinnedKeys?.[0] || data.projects[0].key);
      }
    } catch (err) {
      console.error("프로젝트 로드 실패:", err);
    } finally {
      setLoadingProjects(false);
    }
  }, [projects.length, selectedProject]);

  // 2) 이슈타입 로드 (프로젝트 변경 시)
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
          // 기본: Task 우선
          const task = types.find((t: JiraIssueType) => t.name === "Task") || types[0];
          setSelectedIssueType(task);
        }
      })
      .catch((err) => console.error("이슈타입 로드 실패:", err))
      .finally(() => { if (!cancelled) setLoadingIssueTypes(false); });

    return () => { cancelled = true; };
  }, [selectedProject, jiraMode]);

  // 3) 필드 로드 (이슈타입 변경 시)
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
        // 기본값 설정
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

  // "새 이슈 생성" 모드 진입 시 프로젝트 로드
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
    try {
      // Jira 생성 시 fieldValues에 summary, description, duedate 자동 주입
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
        resetForm();
        onCreated();
      } else {
        const err = await res.json();
        alert(`생성 실패: ${err.error || "알 수 없는 오류"}`);
      }
    } catch (error) {
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

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="w-full py-3 px-4 border-2 border-dashed border-[var(--border)] rounded-xl text-slate-400 hover:border-blue-500 hover:text-blue-400 transition-colors cursor-pointer"
      >
        + 새 할일 추가
      </button>
    );
  }

  const inputClass = "w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500";
  const selectClass = inputClass;
  const labelClass = "block text-[10px] text-slate-400 mb-1";

  // summary, description, duedate, assignee는 TO-DO 기본 필드에서 자동 매핑 → 별도 표시 불필요
  const AUTO_MAPPED_FIELDS = new Set(["summary", "description", "duedate", "assignee"]);
  const visibleFields = createFields.filter((f) => !AUTO_MAPPED_FIELDS.has(f.fieldId));

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4"
    >
      {/* TO-DO 기본 필드 */}
      <div>
        <input
          type="text"
          placeholder="할일 제목을 입력하세요"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          autoFocus
        />
      </div>

      <div>
        <textarea
          placeholder="설명 (선택사항)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>우선순위</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as any)}
            className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          >
            <option value="high">높음</option>
            <option value="medium">보통</option>
            <option value="low">낮음</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>기한</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Jira 연결 섹션 */}
      <div className="border-t border-[var(--border)] pt-4">
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-slate-400 font-medium">Jira</span>
          <div className="flex items-center gap-1 bg-[var(--surface2)] rounded-lg p-0.5">
            {(["none", "link", "create"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setJiraMode(mode);
                  if (mode !== "link") setJiraIssueKey("");
                }}
                className={`px-2.5 py-1 text-[10px] rounded-md transition-colors cursor-pointer ${
                  jiraMode === mode
                    ? mode === "create"
                      ? "bg-emerald-600 text-white"
                      : mode === "link"
                      ? "bg-blue-600 text-white"
                      : "bg-slate-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {mode === "none" ? "연결 안함" : mode === "link" ? "기존 이슈 연결" : "새 이슈 생성"}
              </button>
            ))}
          </div>
        </div>

        {/* 기존 이슈 연결 */}
        {jiraMode === "link" && (
          <input
            type="text"
            placeholder="예: BIZWAIT-5555"
            value={jiraIssueKey}
            onChange={(e) => setJiraIssueKey(e.target.value)}
            className={inputClass}
          />
        )}

        {/* 새 이슈 생성 */}
        {jiraMode === "create" && (
          <div className="space-y-3 bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-3">
            {loadingProjects ? (
              <p className="text-xs text-slate-400">프로젝트 로딩 중...</p>
            ) : (
              <>
                {/* 프로젝트 + 이슈타입 선택 */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] text-emerald-400/70 mb-1">프로젝트 *</label>
                    <select
                      value={selectedProject}
                      onChange={(e) => setSelectedProject(e.target.value)}
                      className={selectClass}
                    >
                      {projects.map((p) => (
                        <option key={p.key} value={p.key}>
                          {pinnedKeys.includes(p.key) ? "⭐ " : ""}{p.name} ({p.key})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] text-emerald-400/70 mb-1">이슈 타입 *</label>
                    {loadingIssueTypes ? (
                      <div className="px-3 py-2 text-xs text-slate-500">로딩 중...</div>
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

                {/* 동적 필드 */}
                {loadingFields ? (
                  <p className="text-xs text-slate-400">필드 로딩 중...</p>
                ) : visibleFields.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-emerald-400/50 border-b border-emerald-800/20 pb-1">
                      추가 필드 {visibleFields.filter((f) => f.required).length > 0 && "(* 필수)"}
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

                {/* 자동 매핑 안내 */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-emerald-800/20">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  <span className="text-[10px] text-emerald-400/70">
                    제목 → Summary · 설명 → Description · 기한 → Due Date · 담당자 → 본인 (자동)
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Slack 연결 */}
      <div>
        <label className="block text-xs text-slate-500 mb-1">Slack 스레드 URL (선택)</label>
        <input
          type="url"
          placeholder="https://wad-hq.slack.com/..."
          value={slackThreadUrl}
          onChange={(e) => setSlackThreadUrl(e.target.value)}
          className={inputClass}
        />
      </div>

      {/* 버튼 */}
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={resetForm}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={!title.trim() || isSubmitting}
          className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors cursor-pointer"
        >
          {isSubmitting
            ? jiraMode === "create"
              ? "Jira 이슈 생성 + 할일 추가 중..."
              : "생성 중..."
            : jiraMode === "create"
            ? "Jira 이슈 + 할일 추가"
            : "할일 추가"}
        </button>
      </div>
    </form>
  );
}

// ===== 동적 필드 렌더러 =====
function DynamicField({
  field,
  value,
  onChange,
  inputClass,
  selectClass,
}: {
  field: JiraCreateField;
  value: any;
  onChange: (val: any) => void;
  inputClass: string;
  selectClass: string;
}) {
  const label = `${field.name}${field.required ? " *" : ""}`;
  const { type } = field.schema;

  // select: allowedValues가 있는 경우
  if (field.allowedValues && field.allowedValues.length > 0) {
    // 다중 선택 (array 타입)
    if (type === "array") {
      const selected: string[] = Array.isArray(value) ? value : [];
      return (
        <div>
          <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
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

    // 단일 선택
    return (
      <div>
        <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
        <select
          value={typeof value === "object" ? value?.id || "" : value || ""}
          onChange={(e) => {
            const selected = field.allowedValues!.find((av) => av.id === e.target.value);
            if (selected) {
              // option 타입은 { id }, priority는 { name }
              if (field.fieldId === "priority") {
                onChange(selected.name);
              } else {
                onChange({ id: selected.id });
              }
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

  // number 타입
  if (type === "number") {
    return (
      <div>
        <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
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

  // date 타입
  if (type === "date") {
    return (
      <div>
        <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
        <input
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value || undefined)}
          className={inputClass}
        />
      </div>
    );
  }

  // labels (string array, 쉼표 구분 입력)
  if (field.fieldId === "labels") {
    return (
      <div>
        <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
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

  // 기본: 텍스트 입력
  return (
    <div>
      <label className="block text-[10px] text-slate-400 mb-1">{label}</label>
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
