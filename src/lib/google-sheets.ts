import { getIssue } from "@/lib/integrations/jira";

// ─── Google OAuth2 Refresh Token 인증 ───

let cachedToken: { access_token: string; expires_at: number } | null = null;

async function getAccessToken(): Promise<string> {
  // 캐시된 토큰이 유효하면 재사용
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

export function parseGoogleSheetsUrl(text: string): { spreadsheetId: string; gid: string } | null {
  const match = text.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  const gidMatch = text.match(/gid=(\d+)/);
  return { spreadsheetId: match[1], gid: gidMatch?.[1] || "0" };
}

// ─── 시트 데이터에서 shop_seq 추출 ───

export async function fetchShopSeqFromSheet(spreadsheetId: string, gid: string): Promise<string> {
  const token = await getAccessToken();

  // 시트 메타데이터 조회 (gid → 시트명)
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!metaRes.ok) throw new Error(`Sheets meta error: ${metaRes.status}`);
  const meta = await metaRes.json();
  const sheet = meta.sheets?.find(
    (s: { properties: { sheetId: number } }) => String(s.properties.sheetId) === gid,
  );
  const sheetName = sheet?.properties?.title || "Sheet1";

  // 전체 데이터 조회
  const dataRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!dataRes.ok) throw new Error(`Sheets data error: ${dataRes.status}`);
  const data = await dataRes.json();
  const values: string[][] = data.values;
  if (!values || values.length < 2) return "";

  // 헤더에서 shop_seq 컬럼 찾기
  const headerRow = values[0].map((h: string) => h?.toString().toLowerCase().trim());
  let colIdx = headerRow.findIndex(
    (h: string) =>
      h.includes("shop_seq") ||
      h.includes("매장시퀀스") ||
      h.includes("매장번호") ||
      h === "shop_seq",
  );

  if (colIdx === -1) {
    // 헤더에 없으면 — 첫 번째 컬럼이 숫자들인지 확인
    const firstCol = values.slice(1).map((row) => row[0]?.toString().trim()).filter(Boolean);
    if (firstCol.length > 0 && firstCol.every((v) => /^\d+$/.test(v))) {
      colIdx = 0;
    } else {
      // 모든 컬럼에서 3-7자리 숫자만 있는 컬럼 찾기
      for (let c = 0; c < values[0].length; c++) {
        const colValues = values.slice(1).map((row) => row[c]?.toString().trim()).filter(Boolean);
        if (colValues.length > 0 && colValues.every((v) => /^\d{3,7}$/.test(v))) {
          colIdx = c;
          break;
        }
      }
    }
  }

  if (colIdx === -1) return "";

  const shopSeqValues = values
    .slice(1)
    .map((row) => row[colIdx]?.toString().trim())
    .filter((v) => v && /^\d+$/.test(v));

  return shopSeqValues.join(",");
}

// ─── JIRA 이슈에서 Google Sheet → shop_seq 추출 (통합 함수) ───

export async function extractShopSeqFromJira(ticketKey: string): Promise<string | null> {
  try {
    const issue = await getIssue(ticketKey);
    if (!issue?.fields?.description) return null;

    // description에서 Google Sheets URL 찾기 (plain text 또는 ADF JSON)
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
    const shopSeq = await fetchShopSeqFromSheet(sheetInfo.spreadsheetId, sheetInfo.gid);

    if (!shopSeq) {
      console.log(`[google-sheets] ${ticketKey}: shop_seq 컬럼을 찾지 못했습니다`);
      return null;
    }

    const count = shopSeq.split(",").length;
    console.log(`[google-sheets] ${ticketKey}: shop_seq ${count}개 추출`);
    return shopSeq;
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
