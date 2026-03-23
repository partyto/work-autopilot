"use client";

import { useState } from "react";

interface TaskFormProps {
  onCreated: () => void;
}

export default function TaskForm({ onCreated }: TaskFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [dueDate, setDueDate] = useState("");
  const [jiraIssueKey, setJiraIssueKey] = useState("");
  const [slackThreadUrl, setSlackThreadUrl] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
          jiraIssueKey: jiraIssueKey || undefined,
          slackThreadUrl: slackThreadUrl || undefined,
        }),
      });

      if (res.ok) {
        setTitle("");
        setDescription("");
        setPriority("medium");
        setDueDate("");
        setJiraIssueKey("");
        setSlackThreadUrl("");
        setIsOpen(false);
        onCreated();
      }
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setIsSubmitting(false);
    }
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

      {/* 매핑 섹션 */}
      <div className="border-t border-[var(--border)] pt-4">
        <p className="text-xs text-slate-400 mb-3 font-medium">연결 (선택사항)</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Jira 이슈 키</label>
            <input
              type="text"
              placeholder="예: BIZWAIT-5555"
              value={jiraIssueKey}
              onChange={(e) => setJiraIssueKey(e.target.value)}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Slack 스레드 URL</label>
            <input
              type="url"
              placeholder="https://wad-hq.slack.com/..."
              value={slackThreadUrl}
              onChange={(e) => setSlackThreadUrl(e.target.value)}
              className="w-full bg-[var(--surface2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={!title.trim() || isSubmitting}
          className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors cursor-pointer"
        >
          {isSubmitting ? "생성 중..." : "할일 추가"}
        </button>
      </div>
    </form>
  );
}
