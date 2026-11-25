import type { AiKeyStatus, AiProvider, SiteSettings } from "../shared/types";
import { DEFAULT_AI_PROMPT, aiProviderPreset, renderAiPrompt } from "../shared/ai";
import type { Env } from "./env";

export interface DescriptionInput {
  name: string;
  url: string;
  categoryName?: string;
  tags?: string[];
  currentDescription?: string;
}

export interface DescriptionResult {
  description: string;
  provider: AiProvider;
  model: string;
}

/** 单次 AI 请求超时。后台生成走 waitUntil，响应返回后最多还能跑 30s，这里留出落库余量 */
const AI_TIMEOUT_MS = 22000;

export function defaultModel(provider: AiProvider): string {
  return aiProviderPreset(provider).model;
}

/** 按预设顺序取第一个存在的密钥；custom 优先用设置里填的 */
export function aiApiKey(env: Env, settings: SiteSettings, provider: AiProvider): string {
  const preset = aiProviderPreset(provider);
  if (preset.settingsKey && settings.aiApiKey) return settings.aiApiKey;
  for (const name of preset.keyEnv) {
    const value = (env as unknown as Record<string, string | undefined>)[name];
    if (value) return value;
  }
  return "";
}

/** 该供应商当前是否具备生成条件（有密钥、自定义还要求接口地址和模型） */
export function aiConfigured(env: Env, settings: SiteSettings, provider = settings.aiProvider): boolean {
  const preset = aiProviderPreset(provider);
  if (preset.protocol === "pollinations") return true;
  const base = settings.aiBaseUrl || env.AI_BASE_URL || preset.baseUrl;
  if (!base) return false;
  if (!(settings.aiModel || preset.model) && provider === "custom") return false;
  return Boolean(aiApiKey(env, settings, provider));
}

export function aiKeysStatus(env: Env, settings: SiteSettings): AiKeyStatus {
  return {
    pollinations: true,
    openai: Boolean(env.OPENAI_API_KEY || env.AI_API_KEY),
    deepseek: Boolean(env.DEEPSEEK_API_KEY || env.AI_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY || env.AI_API_KEY),
    qwen: Boolean(env.DASHSCOPE_API_KEY || env.QWEN_API_KEY || env.AI_API_KEY),
    volcengine: Boolean(env.ARK_API_KEY || env.VOLCENGINE_API_KEY || env.AI_API_KEY),
    custom: Boolean(settings.aiApiKey || env.AI_API_KEY),
  };
}

function buildPrompt(input: DescriptionInput, settings: SiteSettings): string {
  return renderAiPrompt(settings.aiPrompt || DEFAULT_AI_PROMPT, {
    siteName: settings.siteName || "锦囊书签",
    name: input.name,
    url: input.url,
    category: input.categoryName ?? "",
    tags: input.tags?.join("、") ?? "",
    description: input.currentDescription ?? "",
  });
}

function cleanDescription(raw: string): string {
  let text = raw
    .replace(/^\s*[#*>-]+\s*/gm, "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
  const firstSentence = text.split(/(?<=[。！？!?])\s*/)[0];
  if (firstSentence && firstSentence.length >= 18) text = firstSentence;
  if (text.length > 180) text = `${text.slice(0, 176).replace(/[，、,；;：:]$/, "")}……`;
  return text;
}

async function timedFetch(url: string, init: RequestInit, timeout = AI_TIMEOUT_MS): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const name = (error as { name?: string } | null)?.name ?? "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`AI 服务 ${Math.round(timeout / 1000)} 秒内没有响应，请稍后重试或换一个服务`);
    }
    throw new Error(`无法连接 AI 服务：${error instanceof Error ? error.message : String(error)}`);
  }
}

function missingKeyMessage(provider: AiProvider): string {
  const preset = aiProviderPreset(provider);
  const names = preset.keyEnv.filter((name) => name !== "AI_API_KEY");
  const hint = names.length ? names.join(" 或 ") : "AI_API_KEY";
  return `未配置 ${hint}（${preset.label}）`;
}

function resolveBaseUrl(env: Env, settings: SiteSettings, provider: AiProvider): string {
  const preset = aiProviderPreset(provider);
  // 后台填的接口地址优先，其次环境变量，最后用预设默认值
  const base = settings.aiBaseUrl || env.AI_BASE_URL || preset.baseUrl;
  if (!base) throw new Error("自定义接口需要先在「设置 → AI 简介」里填写接口地址（例如 https://api.example.com/v1）");
  return base.replace(/\/$/, "");
}

async function viaOpenAICompatible(
  provider: AiProvider,
  env: Env,
  settings: SiteSettings,
  prompt: string,
): Promise<string> {
  const preset = aiProviderPreset(provider);
  const apiKey = aiApiKey(env, settings, provider);
  if (!apiKey) throw new Error(missingKeyMessage(provider));
  const base = resolveBaseUrl(env, settings, provider);
  const model = settings.aiModel || preset.model;
  if (!model) throw new Error("请先在「设置 → AI 简介」里填写模型名称");
  const response = await timedFetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一位克制、准确的中文网站编辑。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 240,
      stream: false,
    }),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`${preset.label} 返回 ${response.status}${detail ? `：${detail}` : ""}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI 服务没有返回介绍内容");
  return content;
}

async function viaPollinations(env: Env, settings: SiteSettings, prompt: string): Promise<string> {
  const model = settings.aiModel || "openai";
  const response = await timedFetch("https://text.pollinations.ai/openai", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "iNav/1.0",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "你是一位克制、准确的中文网站编辑。" },
        { role: "user", content: prompt },
      ],
      temperature: 0.6,
      max_tokens: 240,
      referrer: "iNav",
    }),
  });
  if (!response.ok) {
    throw new Error(`免费 AI 服务返回 ${response.status}，可稍后重试或在后台切换模型`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    const content = data.choices?.[0]?.message?.content;
    if (content) return content;
    const error = typeof data.error === "string" ? data.error : data.error?.message;
    if (error) throw new Error(`免费 AI 服务：${error}`);
    throw new Error("免费 AI 服务没有返回介绍内容");
  }
  return await response.text();
}

async function viaGemini(env: Env, settings: SiteSettings, prompt: string): Promise<string> {
  const apiKey = aiApiKey(env, settings, "gemini");
  if (!apiKey) throw new Error(missingKeyMessage("gemini"));
  const model = settings.aiModel || defaultModel("gemini");
  if (!model) throw new Error("请先在「设置 → AI 简介」里填写模型名称");
  const base = resolveBaseUrl(env, settings, "gemini");
  const response = await timedFetch(
    `${base}/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.6, maxOutputTokens: 300 },
      }),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    throw new Error(`Gemini 返回 ${response.status}${detail ? `：${detail}` : ""}`);
  }
  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
  if (!content) throw new Error("Gemini 没有返回介绍内容");
  return content;
}

export async function generateDescription(
  env: Env,
  settings: SiteSettings,
  input: DescriptionInput,
  override?: { provider?: AiProvider; model?: string; baseUrl?: string },
): Promise<DescriptionResult> {
  const provider = override?.provider ?? settings.aiProvider;
  const preset = aiProviderPreset(provider);
  const effective: SiteSettings = {
    ...settings,
    aiProvider: provider,
    aiModel: override?.model || settings.aiModel || preset.model,
    aiBaseUrl: override?.baseUrl ?? settings.aiBaseUrl,
    aiPrompt: settings.aiPrompt || DEFAULT_AI_PROMPT,
  };
  const prompt = buildPrompt(input, effective);
  let raw: string;
  if (preset.protocol === "pollinations") raw = await viaPollinations(env, effective, prompt);
  else if (preset.protocol === "gemini") raw = await viaGemini(env, effective, prompt);
  else raw = await viaOpenAICompatible(provider, env, effective, prompt);

  const description = cleanDescription(raw);
  if (description.length < 12) throw new Error("AI 返回的内容过短，请重试");
  return { description, provider, model: effective.aiModel };
}
