import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

/**
 * Slack 메시지 전체 본문을 20자 이내 할일 제목으로 요약.
 * API Key 없거나 실패 시 앞 20자로 fallback.
 */
export async function summarizeSlackTitle(text: string): Promise<string> {
  const ai = getClient();
  if (!ai) return text.substring(0, 20);

  try {
    const msg = await ai.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 64,
      messages: [{
        role: "user",
        content: `다음 Slack 메시지를 할일 제목으로 20자 이내 한국어로 요약해. 사람 이름(@멘션 포함)은 제목에 넣지 마. 동사형으로 끝내. 따옴표 없이 제목만 출력:\n${text}`,
      }],
    });
    const result = (msg.content[0] as { type: string; text: string }).text.trim();
    return result.substring(0, 20);
  } catch (err) {
    console.warn("[AI] summarizeSlackTitle failed, using fallback:", err);
    return text.substring(0, 20);
  }
}
