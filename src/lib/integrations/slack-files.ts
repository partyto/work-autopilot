// Slack 파일 다운로드 유틸리티
import { getAccessToken } from "./slack-tokens";

// DM에서 최신 .xlsx 파일 찾기
export async function findLatestExcelInDM(
  userId: string,
): Promise<{ url: string; name: string; id: string } | null> {
  const token = await getAccessToken("bot");
  // DM 채널 열기
  const openRes = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ users: userId }),
  });
  const openData = await openRes.json();
  if (!openData.ok) return null;
  const dmChannelId = openData.channel.id;

  // 최근 메시지 조회
  const histRes = await fetch("https://slack.com/api/conversations.history", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: dmChannelId, limit: 20 }),
  });
  const histData = await histRes.json();
  if (!histData.ok) return null;

  // 최신 .xlsx/.xls 파일 찾기
  for (const msg of histData.messages || []) {
    if (!msg.files) continue;
    for (const file of msg.files) {
      if (
        file.name &&
        (file.name.endsWith(".xlsx") || file.name.endsWith(".xls")) &&
        file.url_private
      ) {
        return { url: file.url_private, name: file.name, id: file.id };
      }
    }
  }
  return null;
}

// Slack private URL에서 파일 다운로드
export async function downloadSlackFile(url: string): Promise<Buffer> {
  const token = await getAccessToken("bot");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Slack file download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
