/**
 * LLM abstraction — speaks OpenAI-compatible Chat Completions protocol.
 * Compatible with OpenAI, DeepSeek, Aliyun Tongyi (DashScope compatible mode),
 * Zhipu GLM (OpenAI compat endpoint), Moonshot, etc.
 *
 * Env:
 *   LLM_BASE_URL    e.g. https://api.openai.com/v1   | https://api.deepseek.com/v1
 *   LLM_API_KEY     secret
 *   LLM_MODEL       e.g. gpt-4o-mini | deepseek-chat | qwen-turbo | glm-4-flash
 *
 * When LLM_API_KEY is missing, callers should use the rule-based fallback.
 */
export interface LlmMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

export function isLlmConfigured(): boolean {
    return !!(process.env.LLM_API_KEY && process.env.LLM_BASE_URL && process.env.LLM_MODEL);
}

export async function llmChat(messages: LlmMessage[], opts?: { temperature?: number; maxTokens?: number }): Promise<string> {
    const base = process.env.LLM_BASE_URL!;
    const key = process.env.LLM_API_KEY!;
    const model = process.env.LLM_MODEL!;
    const url = base.endsWith("/") ? `${base}chat/completions` : `${base}/chat/completions`;
    const body: Record<string, any> = {
        model,
        messages,
        temperature: opts?.temperature ?? 0.2,
    };
    if (opts?.maxTokens) body.max_tokens = opts.maxTokens;

    const res = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const data: any = await res.json();
    return data?.choices?.[0]?.message?.content || "";
}

/** Best-effort JSON extraction from model output (handles ```json fenced blocks). */
export function extractJson(content: string): any | null {
    if (!content) return null;
    let txt = content.trim();
    const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) txt = fence[1].trim();
    const first = txt.indexOf("{");
    const last = txt.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    try {
        return JSON.parse(txt.slice(first, last + 1));
    } catch {
        return null;
    }
}
