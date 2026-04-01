// QueryPie Playwright Worker — 사내망 Mac에서 실행
// NAS 봇이 POST /extract { sql } 호출 → QueryPie에서 데이터 추출 → xlsx Buffer 반환
const http = require("http");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const unzipper = require("unzipper");

const PORT = process.env.PORT || 3200;
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

    // 1. QueryPie 접속 + 세션 확인
    console.log("[Worker] QueryPie 접속 중...");
    await page.goto(QUERYPIE_BASE, { waitUntil: "networkidle", timeout: 30000 });
    if (isAuthPage(page.url())) throw new Error("SESSION_EXPIRED");

    // 2. SQL Worksheet 이동
    console.log("[Worker] SQL Editor 이동...");
    await page.goto(`${QUERYPIE_BASE}/sql-editor`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (isAuthPage(page.url())) throw new Error("SESSION_EXPIRED");

    // 3. 에디터 대기
    await page.waitForSelector(
      ".CodeMirror, .cm-editor, [data-testid='sql-editor'], textarea.sql-input",
      { timeout: 20000 },
    );

    // 4. SQL 입력
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

    // 5. 실행
    console.log("[Worker] 쿼리 실행...");
    await page
      .locator(
        'button:has-text("Run"), button:has-text("실행"), button[title="Run"], button[aria-label="Run"]',
      )
      .first()
      .click();

    // 6. 결과 대기 (최대 90초)
    console.log("[Worker] 결과 대기...");
    await page.waitForSelector(
      '.result-table, .data-grid, [data-testid="result-table"], .ant-table-tbody, .ag-center-cols-container',
      { timeout: 90000 },
    );

    // 7. Export
    console.log("[Worker] Export 실행...");
    await page
      .locator(
        'button:has-text("Export"), button[title="Export"], button[aria-label="Export"], [data-testid="export-btn"]',
      )
      .first()
      .click();

    // 8. 비밀번호 입력
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.locator('input[type="password"]').first().fill(ZIP_PASSWORD);

    // 9. 다운로드
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

    // 10. ZIP 해제 → xlsx
    console.log("[Worker] ZIP 해제 중...");
    return await extractXlsxFromZip(zipBuffer, ZIP_PASSWORD);
  } finally {
    await browser.close();
  }
}

// ─── HTTP Server ───

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Content-Type", "application/json");

  // GET /health
  if (req.method === "GET" && url.pathname === "/health") {
    res.end(JSON.stringify({ ok: true, session: isSessionConfigured() }));
    return;
  }

  // POST /set-cookies
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

  // POST /extract
  if (req.method === "POST" && url.pathname === "/extract") {
    try {
      const body = await parseBody(req);
      if (!body.sql) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "sql 필드 필요" }));
        return;
      }
      if (!isSessionConfigured()) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "SESSION_NOT_CONFIGURED" }));
        return;
      }

      console.log(`[Worker] 추출 시작: ${body.sql.slice(0, 80)}...`);
      const xlsxBuffer = await extractFromQueryPie(body.sql);
      console.log(`[Worker] 추출 완료: ${xlsxBuffer.length} bytes`);

      res.end(JSON.stringify({ ok: true, xlsx: xlsxBuffer.toString("base64") }));
    } catch (e) {
      console.error("[Worker] 추출 오류:", e.message);
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`[QueryPie Worker] http://localhost:${PORT}`);
  console.log(`  - GET  /health      — 상태 확인`);
  console.log(`  - POST /set-cookies — 쿠키 등록`);
  console.log(`  - POST /extract     — SQL 추출`);
  console.log(`  - 세션 상태: ${isSessionConfigured() ? "✅ 설정됨" : "❌ 미설정"}`);
});
