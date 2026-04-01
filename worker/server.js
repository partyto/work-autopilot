// QueryPie Playwright Worker — 사내망 Mac에서 실행
// NAS 봇의 Job Queue를 폴링하여 QueryPie 추출 수행 후 결과 반환
const http = require("http");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

const PORT = process.env.PORT || 3200;
const NAS_URL = process.env.NAS_URL || "http://115.21.223.89:3100";
const POLL_INTERVAL = 15000; // 15초
const SESSION_PATH = path.join(__dirname, "session.json");
const QUERYPIE_BASE = "https://querypie.infra.wadcorp.in";
const ZIP_PASSWORD = "qwer1234!";

// ─── Helpers ───

function isSessionConfigured() {
  try {
    if (!fs.existsSync(SESSION_PATH)) return false;
    const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}

function isAuthPage(url) {
  return (
    url.includes("keycloak") ||
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("sso")
  );
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function extractXlsxFromZip(zipBuffer, password) {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const xlsxFile = directory.files.find(
    (f) => f.path.endsWith(".xlsx") || f.path.endsWith(".xls"),
  );
  if (!xlsxFile) throw new Error("ZIP에서 엑셀 파일을 찾을 수 없습니다");
  return await xlsxFile.buffer(password);
}

// ─── Playwright extraction ───

async function extractFromQueryPie(sql) {
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({ acceptDownloads: true });
    await context.addCookies(cookies);
    const page = await context.newPage();

    console.log("[Worker] QueryPie 접속 중...");
    await page.goto(QUERYPIE_BASE, { waitUntil: "networkidle", timeout: 30000 });
    if (isAuthPage(page.url())) throw new Error("SESSION_EXPIRED");

    console.log("[Worker] SQL Editor 이동...");
    await page.goto(`${QUERYPIE_BASE}/sql-editor`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (isAuthPage(page.url())) throw new Error("SESSION_EXPIRED");

    await page.waitForSelector(
      ".CodeMirror, .cm-editor, [data-testid='sql-editor'], textarea.sql-input",
      { timeout: 20000 },
    );

    console.log("[Worker] SQL 입력 중...");
    const editorSelectors = [
      ".CodeMirror textarea",
      ".cm-content",
      "[data-testid='sql-editor'] textarea",
      "textarea.sql-input",
    ];
    let typed = false;
    for (const sel of editorSelectors) {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0) {
        await el.click();
        await page.keyboard.press("Control+a");
        await page.keyboard.type(sql);
        typed = true;
        break;
      }
    }
    if (!typed) throw new Error("SQL 에디터를 찾을 수 없습니다 — 선택자 확인 필요");

    console.log("[Worker] 쿼리 실행...");
    await page
      .locator(
        'button:has-text("Run"), button:has-text("실행"), button[title="Run"], button[aria-label="Run"]',
      )
      .first()
      .click();

    console.log("[Worker] 결과 대기...");
    await page.waitForSelector(
      '.result-table, .data-grid, [data-testid="result-table"], .ant-table-tbody, .ag-center-cols-container',
      { timeout: 90000 },
    );

    console.log("[Worker] Export 실행...");
    await page
      .locator(
        'button:has-text("Export"), button[title="Export"], button[aria-label="Export"], [data-testid="export-btn"]',
      )
      .first()
      .click();

    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.locator('input[type="password"]').first().fill(ZIP_PASSWORD);

    console.log("[Worker] 다운로드 대기...");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page
        .locator(
          'button:has-text("Download"), button:has-text("다운로드"), button:has-text("확인"), button[type="submit"]',
        )
        .last()
        .click(),
    ]);

    const zipStream = await download.createReadStream();
    const zipBuffer = await streamToBuffer(zipStream);

    console.log("[Worker] ZIP 해제 중...");
    return await extractXlsxFromZip(zipBuffer, ZIP_PASSWORD);
  } finally {
    await browser.close();
  }
}

// ─── Job Polling ───

let polling = false;

async function pollForJobs() {
  if (polling) return;
  polling = true;

  try {
    const res = await fetch(`${NAS_URL}/api/extraction-jobs`, {
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();

    if (!data.job) {
      polling = false;
      return;
    }

    const job = data.job;
    console.log(`[Worker] 🔔 Job 수신: ${job.ticket_key} (${job.extract_type})`);

    if (!isSessionConfigured()) {
      console.log("[Worker] ❌ 세션 미설정 — Job 실패 처리");
      await submitResult(job.id, null, "SESSION_NOT_CONFIGURED — Worker에 쿠키를 등록해주세요");
      polling = false;
      return;
    }

    try {
      const xlsxBuffer = await extractFromQueryPie(job.sql);
      console.log(`[Worker] ✅ 추출 완료: ${xlsxBuffer.length} bytes`);
      await submitResult(job.id, xlsxBuffer, null);
    } catch (err) {
      console.error(`[Worker] ❌ 추출 오류:`, err.message);
      await submitResult(job.id, null, err.message);
    }
  } catch (err) {
    // NAS 연결 실패 — 조용히 무시 (다음 폴링에서 재시도)
    if (!String(err).includes("timeout")) {
      console.error("[Worker] NAS 연결 오류:", err.message);
    }
  }

  polling = false;
}

async function submitResult(jobId, xlsxBuffer, error) {
  try {
    const body = { job_id: jobId };
    if (xlsxBuffer) body.xlsx = xlsxBuffer.toString("base64");
    if (error) body.error = error;

    const res = await fetch(`${NAS_URL}/api/extraction-jobs/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    if (!res.ok) console.error("[Worker] 결과 전송 실패:", data.error);
    else console.log(`[Worker] 결과 전송 완료: job ${jobId.slice(0, 8)}`);
  } catch (err) {
    console.error("[Worker] 결과 전송 오류:", err.message);
  }
}

// ─── HTTP Server (쿠키 관리 + 상태) ───

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Content-Type", "application/json");

  if (req.method === "GET" && url.pathname === "/health") {
    res.end(JSON.stringify({ ok: true, session: isSessionConfigured(), nas: NAS_URL }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/set-cookies") {
    try {
      const body = await parseBody(req);
      if (!Array.isArray(body.cookies) || body.cookies.length === 0) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "cookies 배열 필요" }));
        return;
      }
      fs.writeFileSync(SESSION_PATH, JSON.stringify(body.cookies, null, 2), "utf-8");
      res.end(JSON.stringify({ ok: true, count: body.cookies.length }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[QueryPie Worker] http://localhost:${PORT}`);
  console.log(`  - NAS: ${NAS_URL}`);
  console.log(`  - 폴링 간격: ${POLL_INTERVAL / 1000}초`);
  console.log(`  - 세션: ${isSessionConfigured() ? "✅ 설정됨" : "❌ 미설정"}`);
  console.log(`  - POST /set-cookies — 쿠키 등록`);
  console.log("");

  // 폴링 시작
  setInterval(pollForJobs, POLL_INTERVAL);
  console.log("[Worker] Job 폴링 시작...");
});
