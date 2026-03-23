import { v4 as uuidv4 } from "uuid";

export function generateId(): string {
  return uuidv4();
}

export function todayDate(): string {
  // TZ 환경변수 기반 로컬 날짜 반환 (NAS: Asia/Seoul)
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  done: "완료",
  cancelled: "취소",
  overdue: "기한 초과",
};

export const STATUS_COLORS: Record<string, string> = {
  pending: "bg-slate-500",
  in_progress: "bg-blue-500",
  done: "bg-green-500",
  cancelled: "bg-gray-500",
  overdue: "bg-red-500",
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
