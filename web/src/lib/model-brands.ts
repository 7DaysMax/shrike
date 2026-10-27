/** Brand is independent of the API wire format. Gateways may use any protocol. */
export const MODEL_BRANDS = [
  ["deepseek", "DeepSeek"],
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic / Claude"],
  ["glm", "智谱 GLM"],
  ["zai", "Z.AI"],
  ["gemini", "Google Gemini"],
  ["qwen", "通义千问 Qwen"],
  ["kimi", "Kimi / Moonshot"],
  ["minimax", "MiniMax"],
  ["xai", "xAI / Grok"],
  ["mistral", "Mistral"],
  ["doubao", "豆包 Doubao"],
  ["stepfun", "阶跃星辰 StepFun"],
  ["ollama", "Ollama"],
  ["meta", "Meta / Llama"],
  ["custom", "自定义模型"],
] as const;
export type ModelBrand = (typeof MODEL_BRANDS)[number][0];
export type BrandProfile = { brand?: string; model?: string; base_url?: string; auth_mode?: string };
const known = new Set<string>(MODEL_BRANDS.map((b) => b[0]));
export function modelBrand(p?: BrandProfile | null): ModelBrand {
  if (p?.brand && known.has(p.brand)) return p.brand as ModelBrand;
  if (p?.auth_mode === "deepseek-account") return "deepseek";
  const model = (p?.model ?? "").toLowerCase().split("/").pop() ?? "";
  const rules: [RegExp, ModelBrand][] = [
    [/^deepseek/, "deepseek"],
    [/^(gpt(?:-|$)|chatgpt|o[134](?:-|$)|codex(?:-|$))/, "openai"],
    [/^claude/, "anthropic"],
    [/^(glm|chatglm|codegeex)/, "glm"],
    [/^(gemini|gemma)/, "gemini"],
    [/^(qwen|qwq|qvq)/, "qwen"],
    [/^(kimi|moonshot)/, "kimi"],
    [/^(minimax|abab|m[12](?:-|$))/, "minimax"],
    [/^grok/, "xai"],
    [/^(mistral|mixtral|codestral|devstral|magistral|ministral|pixtral)/, "mistral"],
    [/^(doubao|seed-)/, "doubao"],
    [/^step[\d-]/, "stepfun"],
    [/^llama/, "meta"],
  ];
  for (const [re, brand] of rules) if (re.test(model)) return brand;
  let host = "";
  try {
    host = new URL(p?.base_url ?? "").hostname.toLowerCase();
  } catch {
    /* Corrupt or unavailable local storage/URL leaves the current defaults intact. */
  }
  const hosts: [string, ModelBrand][] = [
    ["deepseek.com", "deepseek"],
    ["openai.com", "openai"],
    ["anthropic.com", "anthropic"],
    ["bigmodel.cn", "glm"],
    ["z.ai", "zai"],
    ["googleapis.com", "gemini"],
    ["dashscope.aliyuncs.com", "qwen"],
    ["dashscope-intl.aliyuncs.com", "qwen"],
    ["moonshot.cn", "kimi"],
    ["moonshot.ai", "kimi"],
    ["minimax.io", "minimax"],
    ["minimaxi.com", "minimax"],
    ["x.ai", "xai"],
    ["mistral.ai", "mistral"],
    ["volces.com", "doubao"],
    ["stepfun.com", "stepfun"],
    ["ollama.com", "ollama"],
  ];
  for (const [domain, brand] of hosts) if (host === domain || host.endsWith(`.${domain}`)) return brand;
  return "custom";
}
