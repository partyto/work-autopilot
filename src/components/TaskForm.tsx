"use client";

import { useState, useEffect, useCallback } from "react";

interface TaskFormProps {
  onCreated: () => void;
}

type JiraProject = { key: string; name: string };
type JiraIssueType = { id: string; name: string; subtask: boolean };
type JiraPriority = { id: string; name: string };

export default function TaskForm({ onCreated }: TaskFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState("");
  const [jiraIssueKey, setJiraIssueKey] = useState("");
  const [slackThreadUrl, setSlackThreadUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Jira 생성 모드
  const [jiraMode, setJiraMode] = useState<"none" | "link" | "create">("none");
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraIssueTypes, setJiraIssueTypes] = useState<JiraIssueType[]>([]);
  const [jiraPriorities, setJiraPriorities] = useState<JiraPriority[]>([]);
  const [selectedProject, setSelectedProject] = useState("");
  const [selectedIssueType, setSelectedIssueType] = useState("");
  const [selectedJiraPriority, setSelectedJiraPriority] = useState("");
  const [jiraMetaLoading, setJiraMetaLoading] = useState(false);
  const [jiraConfigured, setJiraConfigured] = useState(true);

  // Jira 메타데이터 로드
  const loadJiraMeta = useCallback(async (projectKey?: string) => {
    setJiraMetaLoading(true);
    try {
      const url = projectKey
        ? `/api/jira/meta?projectKey=${projectKey}`
        : "/api/jira/meta";
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        if (data.configured === false) setJiraConfigured(false);
        return;
      }
      const data = await res.json();
      setJiraConfigured(data.configured);

      if (data.projects?.length > 0 && jiraProjects.length === 0) {
        setJiraProjects(data.projects);
        if (!selectedProject) {
          // 기본 프로젝트: BIZWAIT 우선, 없으면 첫 번째
          const defaultP = data.projects.find((p: JiraProject) => p.key === "BIZWAIT") || data.projects[0];
          setSelectedProject(defaultP.key);
        }
      }

      if (data.priorities?.length > 0 && jiraPriorities.length === 0) {
        setJiraPriorities(data.priorities);
        if (!selectedJiraPriority) {
          const medium = data.priorities.find((p: JiraPriority) => p.name === "Medium");
          setSelectedJiraPriority(medium?.name || data.priorities[0]?.name || "");
        }
      }

      if (data.issueTypes?.length > 0) {
        const nonSubtask = data.issueTypes.filter((it: JiraIssueType) => !it.subtask);
        setJiraIssueTypes(nonSubtask);
        if (!selectedIssueType) {
          const task = nonSubtask.find((it: JiraIssueType) => it.name === "Task");
          setSelectedIssueType(task?.name || nonSubtask[0]?.name || "");
        }
      }
    } catch (err) {
      console.error("Failed to load Jira meta:", err);
    } finally {
      setJiraMetaLoading(false);
    }
  }, [jiraProjects.length, jiraPriorities.length, selectedProject, selectedIssueType, selectedJiraPriority]);

  // 프로젝트 변경 시 이슈타입 다시 로드
  useEffect(() => {
    if (jiraMode === "create" && selectedProject) {
      setJiraIssueTypes([]);
      setSelectedIssueType("");
      loadJiraMeta(selectedProject);
    }
  }, [selectedProject, jiraMode]);

  // "새 이슈 생성" 모드 진입 시 메타 로드
  useEffect(() => {
    if (jiraMode === "create" && jiraProjects.length === 0) {
      loadJiraMeta();
    }
  }, [jiraMode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setIsSubmitting(true);
    try {
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
          jiraIssueType: jiraMode === "create" ? selectedIssueType : undefined,
          jiraPriority: jiraMode === "create" ? selectedJiraPriority : undefined,
          slackThreadUrl: slackThreadUrl || undefined,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        // 생성된 Jira 이슈 키 표시
        const createdKey = data.links?.find((l: any) => l.linkType === "jira")?.jiraIssueKey;
        if (jiraMode === "create" && createdKey) {
          console.log(`Jira 이슈 생성됨: ${createdKey}`);
        }
        resetForm();
        onCreated();
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
    setSelectedIssueType("");
    setSelectedJiraPriority("");
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

  const selectClass = "w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500";
  const inputClass = "w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 space-y-4"
    >
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
          <label className="block text-xs text-slate-400 mb-1">우선순위</label>
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
          <label className="block text-xs text-slate-400 mb-1">기한</label>
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

        {jiraMode === "link" && (
          <input
            type="text"
            placeholder="예: BIZWAIT-5555"
            value={jiraIssueKey}
            onChange={(e) => setJiraIssueKey(e.target.value)}
            className={inputClass}
          />
        )}

        {jiraMode === "create" && (
          <div className="space-y-2 bg-emerald-950/20 border border-emerald-800/30 rounded-lg p-3">
            {!jiraConfigured ? (
              <p className="text-xs text-red-400">Jira API가 설정되지 않았습니다.</p>
            ) : jiraMetaLoading && jiraProjects.length === 0 ? (
              <p className="text-xs text-slate-400">Jira 정보 로딩 중...</p>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {/* 프로젝트 */}
                  <div>
                    <label className="block text-[10px] text-emerald-400/70 mb-1">프로젝트</label>
                    <select
                      value={selectedProject}
                      onChange={(e) => setSelectedProject(e.target.value)}
                      className={selectClass}
                    >
                      {jiraProjects.map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.key} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {/* 이슈 타입 */}
                  <div>
                    <label className="block text-[10px] text-emerald-400/70 mb-1">이슈 타입</label>
                    <select
                      value={selectedIssueType}
                      onChange={(e) => setSelectedIssueType(e.target.value)}
                      className={selectClass}
                      disabled={jiraIssueTypes.length === 0}
                    >
                      {jiraIssueTypes.length === 0 ? (
                        <option value="">로딩 중...</option>
                      ) : (
                        jiraIssueTypes.map((it) => (
                          <option key={it.id} value={it.name}>
                            {it.name}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  {/* 우선순위 */}
                  <div>
                    <label className="block text-[10px] text-emerald-400/70 mb-1">Jira 우선순위</label>
                    <select
                      value={selectedJiraPriority}
                      onChange={(e) => setSelectedJiraPriority(e.target.value)}
                      className={selectClass}
                    >
                      {jiraPriorities.map((p) => (
                        <option key={p.id} value={p.name}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                  <span className="text-[10px] text-emerald-400/80">
                    제목·설명·기한이 Jira 이슈에 자동 반영됩니다 · 담당자: 본인
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
