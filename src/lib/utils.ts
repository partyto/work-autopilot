import { v4 as uuidv4 } from "uuid";

export function generateId(): string {
  return uuidv4();
}

export function todayDate(): string {
  // KST 기준 날짜 반환 (toISOString은 UTC라 자정~09:00 KST 구간에서 오류)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().split("T")[0];
}

export function nowLocal(): string {
  return new Date().toLocaleString("sv-SE").replace(" ", "T");
}

export function cn(...classes: (string | undefined | false)[]) {
  return classes.filter(Boolean).join(" ");
}

export const STATUS_LABELS: Record<string, string> = {
  pending: "대기",
  in_progress: "진행 중",
  in_qa: "IN-QA",
  done: "완료",
  cancelled: "취소",
};

export const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-500",
  in_progress: "bg-blue-500",
  in_qa: "bg-violet-500",
  done: "bg-emerald-500",
  cancelled: "bg-gray-500",
};

export const PRIORITY_LABELS: Record<string, string> = {
  high: "높음",
  medium: "보통",
  low: "낮음",
};

export const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-400",
  medium: "text-yellow-400",
  low: "text-slate-400",
};
