const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || "";
export const GCAL_CALENDAR_ID =
  process.env.GOOGLE_CALENDAR_ID || "hw.joo@catchtable.co.kr";

let cachedToken = "";
let tokenExpiry  = 0;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`GCal OAuth 실패: ${data.error}`);
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

export interface GCalEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: { email: string; displayName?: string; responseStatus?: string }[];
  htmlLink?: string;
  hangoutLink?: string;
  status?: string;
}

export async function listEvents(
  timeMin: string, timeMax: string,
  calendarId: string = GCAL_CALENDAR_ID,
): Promise<GCalEvent[]> {
  const token = await getAccessToken();
  const params = new URLSearchParams({
    timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GCal listEvents 실패: ${data.error?.message}`);
  return (data.items || []).filter((e: GCalEvent) => e.status !== "cancelled");
}

export async function createEvent(
  title: string, date: string, description?: string,
  calendarId: string = GCAL_CALENDAR_ID,
): Promise<{ id: string; htmlLink: string }> {
  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: `📋 ${title}`,
        description: description || "Work Autopilot에서 자동 생성",
        start: { date }, end: { date },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] },
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`GCal createEvent 실패: ${data.error?.message}`);
  return { id: data.id, htmlLink: data.htmlLink };
}

export function isGcalConfigured(): boolean {
  return !!(CLIENT_ID && CLIENT_SECRET && REFRESH_TOKEN);
}

export function getTodayRange(): { timeMin: string; timeMax: string } {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const d = kst.toISOString().slice(0, 10);
  return { timeMin: `${d}T00:00:00+09:00`, timeMax: `${d}T23:59:59+09:00` };
}

export function getTomorrowRange(): { timeMin: string; timeMax: string } {
  const kst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  kst.setDate(kst.getDate() + 1);
  const d = kst.toISOString().slice(0, 10);
  return { timeMin: `${d}T00:00:00+09:00`, timeMax: `${d}T23:59:59+09:00` };
}

export function formatEventTime(event: GCalEvent): string {
  if (event.start.dateTime) {
    return new Date(event.start.dateTime).toLocaleTimeString("ko-KR", {
      hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul",
    });
  }
  return "종일";
}
