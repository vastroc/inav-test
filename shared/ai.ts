import type { AiProvider } from "./types";

/**
 * AI 供应商预设：后台「服务」下拉、默认接口地址、默认模型、需要的环境变量都从这里来，
 * worker 与 admin 前端共用同一份，避免两边各写一套导致对不上。
 */
export interface AiProviderPreset {
  id: AiProvider;
  label: string;
  /** 协议：openai = /chat/completions；gemini = :generateContent；pollinations = 免费公共接口 */
  protocol: "openai" | "gemini" | "pollinations";
  /** 默认接口根地址；custom 为空，必须自己填 */
  baseUrl: string;
  /** 默认模型；custom 为空，必须自己填 */
  model: string;
  /** 密钥所在的环境变量，按优先级排列（最后通常给通用 AI_API_KEY 兜底） */
  keyEnv: string[];
  /** 是否允许在后台设置里直接填 API Key（只有 custom 需要） */
  settingsKey?: boolean;
}

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "pollinations",
    label: "Pollinations（免费，无需密钥）",
    protocol: "pollinations",
    baseUrl: "https://text.pollinations.ai/openai",
    model: "openai",
    keyEnv: [],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    keyEnv: ["DEEPSEEK_API_KEY", "AI_API_KEY"],
  },
  {
    id: "qwen",
    label: "通义千问（阿里云百炼）",
    protocol: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyEnv: ["DASHSCOPE_API_KEY", "QWEN_API_KEY", "AI_API_KEY"],
  },
  {
    id: "volcengine",
    label: "火山方舟（豆包）",
    protocol: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2-1-lite-260915",
    keyEnv: ["ARK_API_KEY", "VOLCENGINE_API_KEY", "AI_API_KEY"],
  },
  {
    id: "openai",
    label: "OpenAI",
    protocol: "openai",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyEnv: ["OPENAI_API_KEY", "AI_API_KEY"],
  },
  {
    id: "gemini",
    label: "Google Gemini",
    protocol: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    model: "gemini-2.5-flash",
    keyEnv: ["GEMINI_API_KEY", "AI_API_KEY"],
  },
  {
    id: "custom",
    label: "自定义（OpenAI 兼容接口）",
    protocol: "openai",
    baseUrl: "",
    model: "",
    keyEnv: ["AI_API_KEY"],
    settingsKey: true,
  },
];

export const AI_PROVIDERS: AiProvider[] = AI_PROVIDER_PRESETS.map((preset) => preset.id);

export function aiProviderPreset(id: AiProvider): AiProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id) ?? AI_PROVIDER_PRESETS[0];
}

/**
 * 默认提示词模板。变量用 `{name}` 这种大括号写法，
 * 渲染时空值变量所在整行会被丢弃（见 renderAiPrompt）。
 */
export const DEFAULT_AI_PROMPT = [
  "你是「{siteName}」的编辑。请为下面这个网站写一段中文介绍。",
  "要求：",
  "1. 45-85 个汉字，1-2 句话，信息密度高。",
  "2. 说明它是什么、主要用途、适合谁。",
  "3. 客观克制，不使用营销口吻，不编造功能。",
  "4. 不要以“该网站”“这是一个”开头；不要标题、引号、项目符号或换行。",
  "5. 只输出介绍正文。",
  "",
  "网站名称：{name}",
  "网址：{url}",
  "所属分类：{category}",
  "标签：{tags}",
  "已有描述（仅作参考，不要照抄）：{description}",
].join("\n");

/** 提示词里可用的变量，后台设置页原样展示给用户 */
export const AI_PROMPT_VARIABLES: Array<{ key: string; label: string }> = [
  { key: "siteName", label: "站点名称" },
  { key: "name", label: "书签名称" },
  { key: "url", label: "网址" },
  { key: "category", label: "所属分类" },
  { key: "tags", label: "标签（顿号分隔）" },
  { key: "description", label: "已有描述" },
];

/**
 * 渲染提示词模板：逐行替换 `{key}`。
 * 某一行引用了「值为空」的变量时整行丢弃——例如没标签时 `标签：{tags}` 不会
 * 变成一行空的“标签：”，也不会把空信息喂给模型。
 */
export function renderAiPrompt(template: string, vars: Record<string, string>): string {
  const source = template.trim() ? template : DEFAULT_AI_PROMPT;
  const emptyPlaceholders = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([key]) => `{${key}}`);
  return source
    .split("\n")
    .map((line) => {
      if (emptyPlaceholders.some((placeholder) => line.includes(placeholder))) return "";
      let rendered = line;
      for (const [key, value] of Object.entries(vars)) {
        rendered = rendered.split(`{${key}}`).join(value);
      }
      return rendered;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
