// 한국 공휴일 목록 (2025-2027)
const HOLIDAYS = new Set([
  // 2025
  "2025-01-01", // 신정
  "2025-01-28", "2025-01-29", "2025-01-30", // 설날 연휴
  "2025-03-01", // 삼일절
  "2025-05-05", "2025-05-06", // 어린이날 + 대체
  "2025-06-06", // 현충일
  "2025-08-15", // 광복절
  "2025-09-06", "2025-09-07", "2025-09-08", // 추석 연휴
  "2025-10-03", // 개천절
  "2025-10-09", // 한글날
  "2025-12-25", // 성탄절
  // 2026
  "2026-01-01", // 신정
  "2026-02-16", "2026-02-17", "2026-02-18", // 설날 연휴
  "2026-03-01", // 삼일절
  "2026-05-05", // 어린이날
  "2026-05-25", // 부처님오신날
  "2026-06-06", // 현충일
  "2026-08-15", // 광복절
  "2026-09-24", "2026-09-25", "2026-09-26", // 추석 연휴
  "2026-10-03", // 개천절
  "2026-10-09", // 한글날
  "2026-12-25", // 성탄절
  // 2027
  "2027-01-01", // 신정
  "2027-02-06", "2027-02-07", "2027-02-08", // 설날 연휴
  "2027-03-01", // 삼일절
  "2027-05-05", // 어린이날
  "2027-05-13", // 부처님오신날
  "2027-06-06", // 현충일
  "2027-08-15", // 광복절
  "2027-09-14", "2027-09-15", "2027-09-16", // 추석 연휴
  "2027-10-03", // 개천절
  "2027-10-09", // 한글날
  "2027-12-25", // 성탄절
]);

/** KST 기준 날짜를 YYYY-MM-DD 문자열로 반환 */
export function toKSTDateStr(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * 영업일 기준 날짜 문자열 — KST 05:00 이전은 전날로 취급
 * (새벽에 마무리/시작을 눌러도 업무일 경계를 5시 기준으로 처리)
 */
export function toBusinessDateStr(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const kstHour = kst.getUTCHours(); // UTC 기준 KST시간 = KST 시각
  if (kstHour < 5) {
    // 전날로 처리
    const prev = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
    return prev.toISOString().slice(0, 10);
  }
  return kst.toISOString().slice(0, 10);
}

/** 주말(토/일) 또는 공휴일이 아닌 워킹 데이 여부 */
export function isWorkingDay(date: Date): boolean {
  const dow = date.getDay(); // 0=일, 6=토
  if (dow === 0 || dow === 6) return false;
  return !HOLIDAYS.has(toKSTDateStr(date));
}

/**
 * from 기준 다음 워킹 데이 반환
 * includeSameDay=true: from 자체가 워킹 데이면 from 반환
 */
export function nextWorkingDay(from: Date, includeSameDay = false): Date {
  const d = new Date(from);
  if (!includeSameDay) {
    d.setDate(d.getDate() + 1);
  }
  while (!isWorkingDay(d)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

/** 이전 워킹 데이 반환 (당일 제외) */
export function prevWorkingDay(from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - 1);
  while (!isWorkingDay(d)) {
    d.setDate(d.getDate() - 1);
  }
  return d;
}

const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** "YYYY-MM-DD (월)" 형식 */
export function formatWorkingDate(date: Date): string {
  const ds = toKSTDateStr(date);
  const dow = DOW_KO[date.getDay()];
  return `${ds} (${dow})`;
}
