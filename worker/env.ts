export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SITE_URL?: string;
  SESSION_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_CALLBACK_URL?: string;
  ADMIN_GITHUB_LOGINS?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  DEEPSEEK_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** 通义千问 / 阿里云百炼 */
  DASHSCOPE_API_KEY?: string;
  QWEN_API_KEY?: string;
  /** 火山方舟（豆包） */
  ARK_API_KEY?: string;
  VOLCENGINE_API_KEY?: string;
}

export interface SessionUser {
  login: string;
  name: string;
  avatarUrl: string;
  provider: "github";
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: SessionUser | null;
  };
};
