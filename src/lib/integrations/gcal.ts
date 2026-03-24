// Google Calendar REST API 연동
// 필요 환경변수:
//   GOOGLE_CLIENT_ID      — OAuth2 클라이언트 ID
//   GOOGLE_CLIENT_SECRET  — OAuth2 클라이언트 시크릿
//   GOOGLE_REFRESH_TOKEN  — OAuth2 리프레시 토큰
//   GOOGLE_CALENDAR_ID    — 캘린더 ID (기본값: hw.joo@catchtable.co.kr)

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
export const GCAL_CALENDAR_ID =
  process.env.GOOGLE_CALENDAR_ID || "hw.joo@catchtable.co.kr";

// ===== 토큰 캐시 =====
let cachedToken = "";
let tokenExpiry  = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type:    "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`GCal OAuth 실패: ${data.error} — ${data.error_description}`);
  }

  cachedToken  = data.access_token;
  tokenExpiry  = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// ===== 타입 =====
export interface GCalEvent {
  id:           string;
  summary:      string;
  description?: string;
  start:        { dateTime?: string; date?: string };
  end:          { dateTime?: string; date?: string };
  attendees?:   { email: string; displayName?: string; responseStatus?: string }[];
  htmlLink?:    string;
  hangoutLink?: string;
  status?:      string; // confirmed | tentative | cancelled
}

// ===== 이벤트 조회 =====
export async function listEvents(
  timeMin: string,                          // ISO 8601 (e.g. "2026-03-24T00:00:00+09:00")
  timeMax: string,
  calendarId: string = GCAL_CALENDAR_ID,
): Promise<GCalEvent[]> {
  const token = await getAccessToken();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy:      "startTime",
    maxResults:   "50",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GCal listEvents 실패: ${data.error?.message}`);

  // cancelled 이벤트 제외
  return (data.items || []).filter((e: GCalEvent) => e.status !== "cancelled");
}

// ===== 이벤트 생성 =====
export async function createEvent(
  title:       string,
  date:        string,   // YYYY-MM-DD
  description?: string,
  calendarId:  string = GCAL_CALENDAR_ID,
): Promise<{ id: string; htmlLink: string }> {
  const token = await getAccessToken();

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary:     `📋 ${title}`,
        description: description || "Work Autopilot에서 자동 생성",
        start: { date },
        end:   { date },
        reminders: {
          useDefault: false,
          overrides:  [{ method: "popup", minutes: 60 }],
        },
      }),
    },
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`GCal createEvent 실패: ${data.error?.message}`);
  return { id: data.id, htmlLink: data.htmlLink };
}

// ===== 유틸 =====
export function isGcalConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

/** KST 기준 오늘 날짜 ISO range 반환 */
export function getTodayRange(): { timeMin: string; timeMax: string } {
  const now   = new Date();
  const kst   = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const dateStr = kst.toISOString().slice(0, 10);
  return {
    timeMin: `${dateStr}T00:00:00+09:00`,
    timeMax: `${dateStr}T23:59:59+09:00`,
  };
}

/** KST 기준 내일 날짜 ISO range 반환 */
export function getTomorrowRange(): { timeMin: string; timeMax: string } {
  const now       = new Date();
  const kst       = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  kst.setDate(kst.getDate() + 1);
  const dateStr = kst.toISOString().slice(0, 10);
  return {
    timeMin: `${dateStr}T00:00:00+09:00`,
    timeMax: `${dateStr}T23:59:59+09:00`,
  };
}

/** 이벤트 시작 시간을 "HH:MM" 형태로 반환 (종일 이벤트면 "종일") */
export function formatEventTime(event: GCalEvent): string {
  if (event.start.dateTime) {
    return new Date(event.start.dateTime).toLocaleTimeString("ko-KR", {
      hour:   "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Seoul",
    });
  }
  return "종일";
}
