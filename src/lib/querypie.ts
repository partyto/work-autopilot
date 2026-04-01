// QueryPie 추출 — 사내망 Worker에 HTTP 요청
// NAS Docker에서 QueryPie 직접 접근 불가 → 사내망 Mac의 Worker 서비스 경유
const WORKER_URL = process.env.QUERYPIE_WORKER_URL || "http://localhost:3200";

export async function isSessionConfigured(): Promise<boolean> {
  try {
    const res = await fetch(`${WORKER_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = await res.json();
    return data.session === true;
  } catch {
    return false;
  }
}

export async function extractFromQueryPie(sql: string): Promise<Buffer> {
  const res = await fetch(`${WORKER_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
    signal: AbortSignal.timeout(180000), // 3분 타임아웃
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Worker error ${res.status}`);
  }

  if (!data.xlsx) {
    throw new Error("Worker에서 xlsx 데이터를 반환하지 않았습니다");
  }

  return Buffer.from(data.xlsx, "base64");
}

export async function setWorkerCookies(cookies: unknown[]): Promise<void> {
  const res = await fetch(`${WORKER_URL}/set-cookies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cookies }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || `Worker error ${res.status}`);
  }
}
