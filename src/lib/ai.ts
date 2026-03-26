import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * @멘션, 이름 호칭 패턴을 제거한 뒤 LLM으로 20자 이내 할일 제목 생성.
 * API Key 없거나 실패 시 전처리된 텍스트 앞 20자로 fallback.
 */
function stripMentions(text: string): string {
  return text
    // "@이름 (조직명)" 패턴 통째로 제거: "@주현우 (B2B서비스)", "@김응균 (KA사업)", "@나" 등
    .replace(/@[\w가-힣]+\s*(\([^)]*\))?\s*/g, "")
    // 남은 고아 괄호 조직명 제거: "(B2B서비스)", "(KA사업)" 등
    .replace(/\([^)]{1,20}\)\s*/g, "")
    // "님" 호칭 제거
    .replace(/님\s*/g, "")
    // 연속 공백 정리
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function summarizeSlackTitle(text: string): Promise<string> {
  const cleaned = stripMentions(text);
  const ai = getClient();
  if (!ai) return cleaned.substring(0, 20);

  try {
    const msg = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      messages: [{
        role: "user",
        content: `다음 Slack 메시지를 할일 제목으로 20자 이내 한국어로 요약해. 사람 이름은 절대 포함하지 마. 동사형으로 끝내. 따옴표 없이 제목만 출력:\n${cleaned}`,
      }],
    });
    const result = (msg.content[0] as { type: string; text: string }).text.trim();
    return result.substring(0, 20);
  } catch (err) {
    console.warn("[AI] summarizeSlackTitle failed, using fallback:", err);
    return cleaned.substring(0, 20);
  }
}
