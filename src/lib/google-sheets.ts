import { getIssue } from "@/lib/integrations/jira";

// ─── Types ───

export interface SheetTab {
  sheetId: number;
  title: string;
}

export interface SheetExtractionSuccess {
  type: "success";
  shopSeq: string;
  tabName: string;
}

export interface SheetTabSelectionNeeded {
  type: "select_tab";
  tabs: SheetTab[];
  spreadsheetId: string;
}

export type SheetExtractionResult = SheetExtractionSuccess | SheetTabSelectionNeeded | null;

// ─── Google OAuth2 Refresh Token 인증 ───

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expires_at > Date.now() + 60000) {
    return cachedToken.access_token;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN 미설정");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Google token error: ${res.status}`);
  const data = await res.json();

  cachedToken = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };

  return data.access_token;
}

// ─── Google Sheets URL 파싱 ───

export function parseGoogleSheetsUrl(text: string): {
  spreadsheetId: string;
  gid: string;
  hasExplicitGid: boolean;
} | null {
  const match = text.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const gidMatch = text.match(/gid=(\d+)/);
  return {
    spreadsheetId: match[1],
    gid: gidMatch?.[1] || "0",
    hasExplicitGid: !!gidMatch,
  };
}

// ─── 시트 탭 목록 조회 ───

async function getSheetTabs(spreadsheetId: string): Promise<SheetTab[]> {
  const token = await getAccessToken();
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) throw new Error(`Sheets meta error: ${metaRes.status}`);
  const meta = await metaRes.json();
  return (meta.sheets || []).map((s: { properties: { sheetId: number; title: string } }) => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
  }));
}

// ─── 특정 탭에서 shop_seq 추출 ───

export async function fetchShopSeqFromSheet(spreadsheetId: string, gid: string): Promise<string> {
  const token = await getAccessToken();

  // gid → 시트명 변환
  const tabs = await getSheetTabs(spreadsheetId);
  const sheet = tabs.find((t) => String(t.sheetId) === gid);
  const sheetName = sheet?.title || "Sheet1";

  return fetchShopSeqByTabName(spreadsheetId, sheetName);
}

async function fetchShopSeqByTabName(spreadsheetId: string, sheetName: string): Promise<string> {
  const token = await getAccessToken();

  const dataRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dataRes.ok) throw new Error(`Sheets data error: ${dataRes.status}`);
  const data = await dataRes.json();
  const values: string[][] = data.values;
  if (!values || values.length < 2) return "";

  // 1) 모든 행을 스캔하여 shop_seq 키워드가 있는 행을 헤더로 탐지
  //    비표준 시트(1행이 제목/메타데이터, 중간 행에 실제 헤더)에도 대응
  const isHeaderMatch = (cell: string) =>
    cell.includes("shop_seq") ||
    cell.includes("매장시퀀스") ||
    cell.includes("매장번호") ||
    cell.includes("샵시퀀스") ||
    cell.includes("매장 시퀀스") ||
    cell.includes("매장 번호");

  let headerRowIdx = -1;
  let colIdx = -1;
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    const normalized = row.map((h) => h?.toString().toLowerCase().trim() || "");
    const found = normalized.findIndex((h) => h && isHeaderMatch(h));
    if (found !== -1) {
      headerRowIdx = r;
      colIdx = found;
      break;
    }
  }

  // 2) 헤더 키워드를 못 찾은 경우 — fallback: 전체 컬럼에서 숫자만 있는 컬럼 탐색
  if (colIdx === -1) {
    for (let c = 0; c < (values[0]?.length || 0); c++) {
      const colValues = values
        .slice(1)
        .map((row) => row[c]?.toString().trim())
        .filter(Boolean);
      if (colValues.length > 0 && colValues.every((v) => /^\d{3,7}$/.test(v))) {
        headerRowIdx = 0;
        colIdx = c;
        break;
      }
    }
  }

  if (colIdx === -1) return "";

  // 헤더 다음 행부터 shop_seq 값 수집
  const shopSeqValues = values
    .slice(headerRowIdx + 1)
    .map((row) => row[colIdx]?.toString().trim())
    .filter((v) => v && /^\d+$/.test(v));

  return shopSeqValues.join(",");
}

// ─── JIRA 이슈에서 Google Sheet → shop_seq 추출 (다중 탭 지원) ───

export async function extractShopSeqFromJira(ticketKey: string): Promise<SheetExtractionResult> {
  try {
    const issue = await getIssue(ticketKey);
    if (!issue?.fields?.description) return null;

    const desc =
      typeof issue.fields.description === "string"
        ? issue.fields.description
        : JSON.stringify(issue.fields.description);

    const sheetInfo = parseGoogleSheetsUrl(desc);
    if (!sheetInfo) {
      console.log(`[google-sheets] ${ticketKey}: Google Sheets URL 없음`);
      return null;
    }

    console.log(`[google-sheets] ${ticketKey}: 시트 ${sheetInfo.spreadsheetId} (gid=${sheetInfo.gid})`);

    const tabs = await getSheetTabs(sheetInfo.spreadsheetId);

    // 탭이 1개면 바로 추출
    if (tabs.length === 1) {
      const shopSeq = await fetchShopSeqByTabName(sheetInfo.spreadsheetId, tabs[0].title);
      if (!shopSeq) {
        console.log(`[google-sheets] ${ticketKey}: shop_seq 컬럼을 찾지 못했습니다`);
        return null;
      }
      console.log(`[google-sheets] ${ticketKey}: shop_seq ${shopSeq.split(",").length}개 추출 (탭: ${tabs[0].title})`);
      return { type: "success", shopSeq, tabName: tabs[0].title };
    }

    // 탭이 여러 개인 경우 — 항상 모든 탭을 스캔하여 선택지 제공
    console.log(`[google-sheets] ${ticketKey}: ${tabs.length}개 탭 발견 — ${tabs.map((t) => t.title).join(", ")}`);

    // 모든 탭에서 shop_seq 존재 여부 스캔
    const tabsWithShopSeq: SheetTab[] = [];
    for (const tab of tabs) {
      const shopSeq = await fetchShopSeqByTabName(sheetInfo.spreadsheetId, tab.title);
      if (shopSeq) {
        tabsWithShopSeq.push(tab);
      }
    }

    if (tabsWithShopSeq.length === 0) {
      console.log(`[google-sheets] ${ticketKey}: 어떤 탭에서도 shop_seq를 찾지 못했습니다`);
      return null;
    }

    // shop_seq가 있는 탭이 1개뿐이면 바로 추출
    if (tabsWithShopSeq.length === 1) {
      const shopSeq = await fetchShopSeqByTabName(sheetInfo.spreadsheetId, tabsWithShopSeq[0].title);
      console.log(`[google-sheets] ${ticketKey}: shop_seq ${shopSeq.split(",").length}개 추출 (탭: ${tabsWithShopSeq[0].title})`);
      return { type: "success", shopSeq, tabName: tabsWithShopSeq[0].title };
    }

    // shop_seq가 있는 탭이 여러 개 → 사용자 선택 필요
    // URL gid가 명시되어 있어도 다른 탭에도 데이터가 있으면 선택지 제공
    console.log(`[google-sheets] ${ticketKey}: ${tabsWithShopSeq.length}개 탭에 shop_seq 존재 — 사용자 선택 필요`);
    return {
      type: "select_tab",
      tabs: tabsWithShopSeq,
      spreadsheetId: sheetInfo.spreadsheetId,
    };
  } catch (err) {
    console.error(`[google-sheets] ${ticketKey} 오류:`, err);
    return null;
  }
}

export function isGoogleSheetsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}
