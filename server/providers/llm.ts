import { config } from "../config.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface LLMAnalysisResult {
  id: string;
  category: string;
  direction: "bullish" | "bearish" | "neutral";
  /** 绝对影响力得分 0-100 */
  impactScore: number;
  /** 一句话中文摘要（≤30字） */
  summary: string;
}

interface LLMTaskState {
  status: "idle" | "running" | "done" | "error";
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  nextRunAt: string | null;
  /** 本次分析处理的新条目数 */
  lastProcessedCount: number;
}

// ─── State ────────────────────────────────────────────────────────────────

/** 内存缓存：同一 event.id 的分析结果永久复用 */
const analysisCache = new Map<string, LLMAnalysisResult>();

const taskState: LLMTaskState = {
  status: "idle",
  lastStartedAt: null,
  lastFinishedAt: null,
  lastSuccessAt: null,
  lastErrorAt: null,
  lastError: null,
  nextRunAt: null,
  lastProcessedCount: 0
};

// ─── Public API ───────────────────────────────────────────────────────────

export function getLlmTaskState(): LLMTaskState {
  return taskState;
}

export function isLlmConfigured(): boolean {
  return Boolean(config.llmApiKey);
}

/**
 * 批量分析新闻条目，返回已分析结果的 Map（id → result）。
 * - 已缓存的条目直接命中，不重复调用 LLM。
 * - LLM 未配置或调用失败时，返回命中缓存的部分（可能为空 Map）。
 */
export async function analyzeNewsItems(
  items: Array<{ id: string; title: string }>
): Promise<Map<string, LLMAnalysisResult>> {
  const resultMap = new Map<string, LLMAnalysisResult>();

  // 先填充缓存命中的条目
  const uncachedItems: Array<{ id: string; title: string }> = [];
  for (const item of items) {
    const cached = analysisCache.get(item.id);
    if (cached) {
      resultMap.set(item.id, cached);
    } else {
      uncachedItems.push(item);
    }
  }

  if (!uncachedItems.length || !config.llmApiKey) {
    return resultMap;
  }

  // 按批次调用 LLM（每批最多 10 条）
  const BATCH_SIZE = 10;
  for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
    const batch = uncachedItems.slice(i, i + BATCH_SIZE);
    try {
      const batchResults = await callLlmBatch(batch);
      for (const result of batchResults) {
        analysisCache.set(result.id, result);
        resultMap.set(result.id, result);
      }
    } catch (err) {
      // 单批失败不影响整体，继续处理下一批
      console.warn(`[LLM] Batch ${i / BATCH_SIZE + 1} failed:`, err instanceof Error ? err.message : err);
    }
  }

  return resultMap;
}

/**
 * 运行 LLM 分析任务（由 index.ts 调度调用）。
 * 更新 taskState 供 /api/tasks 可观测。
 */
export async function runLlmAnalysis(
  items: Array<{ id: string; title: string }>
): Promise<Map<string, LLMAnalysisResult>> {
  taskState.status = "running";
  taskState.lastStartedAt = new Date().toISOString();

  try {
    const uncachedCount = items.filter((item) => !analysisCache.has(item.id)).length;
    taskState.lastProcessedCount = uncachedCount;

    const result = await analyzeNewsItems(items);

    taskState.status = "done";
    taskState.lastFinishedAt = new Date().toISOString();
    taskState.lastSuccessAt = taskState.lastFinishedAt;
    taskState.lastError = null;

    return result;
  } catch (error) {
    taskState.status = "error";
    taskState.lastFinishedAt = new Date().toISOString();
    taskState.lastErrorAt = taskState.lastFinishedAt;
    taskState.lastError = error instanceof Error ? error.message : "Unknown LLM error";
    throw error;
  }
}

// ─── LLM API Call ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一位黄金市场专业分析师。
对于输入的每条新闻，请判断其对黄金价格的影响，输出严格的 JSON 数组。
每个元素格式：
{
  "id": "<原始id>",
  "category": "<分类，从[美联储,美元,地缘政治,避险情绪,通胀,黄金市场,美债]中选一>",
  "direction": "<bullish|bearish|neutral，对黄金价格而言>",
  "impactScore": <0-100的整数，表示影响力强度>,
  "summary": "<一句话中文摘要，不超过30字>"
}
规则：
- bullish = 利多黄金（如降息、地缘冲突、避险需求）
- bearish = 利空黄金（如加息、美元走强、风险偏好提升）
- neutral = 影响不明确或与黄金无关
- impactScore：重大事件(美联储决议/战争)70-100，重要数据(CPI/非农)40-70，一般消息10-40
- 仅输出合法JSON数组，不要任何额外文字、代码块标记或解释`;

async function callLlmBatch(
  items: Array<{ id: string; title: string }>
): Promise<LLMAnalysisResult[]> {
  const userContent = JSON.stringify(
    items.map((item) => ({ id: item.id, title: item.title }))
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${config.llmBaseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.llmApiKey}`
      },
      body: JSON.stringify({
        model: config.llmModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent }
        ],
        temperature: 0.1,
        max_tokens: 1500,
        response_format: { type: "json_object" }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`LLM API HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    return parseLlmResponse(content, items);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseLlmResponse(
  content: string,
  originalItems: Array<{ id: string; title: string }>
): LLMAnalysisResult[] {
  try {
    // 尝试直接解析
    let parsed: unknown;
    const trimmed = content.trim();

    // 有时模型会输出 {"results": [...]} 格式
    const jsonObj = JSON.parse(trimmed) as Record<string, unknown>;
    if (Array.isArray(jsonObj)) {
      parsed = jsonObj;
    } else {
      // 查找任意数组值
      const arrValue = Object.values(jsonObj).find((v) => Array.isArray(v));
      parsed = arrValue ?? jsonObj;
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];

    return arr
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        category: String(item.category ?? "黄金市场"),
        direction: validateDirection(item.direction),
        impactScore: clampScore(Number(item.impactScore ?? 30)),
        summary: String(item.summary ?? "")
      }))
      .filter((item) => item.id && originalItems.some((o) => o.id === item.id));
  } catch {
    console.warn("[LLM] Failed to parse response:", content.slice(0, 300));
    return [];
  }
}

function validateDirection(value: unknown): "bullish" | "bearish" | "neutral" {
  if (value === "bullish" || value === "bearish" || value === "neutral") return value;
  return "neutral";
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(0, Math.min(100, Math.round(value)));
}
