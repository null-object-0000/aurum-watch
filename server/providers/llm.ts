import { config } from "../config.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface LLMAnalysisResult {
  id: string;
  category: string;
  direction: "bullish" | "bearish" | "neutral";
  /** 绝对影响力得分 0-100 */
  impactScore: number;
  /** 置信度得分 0-100 */
  confidence: number;
  /** 影响周期 */
  horizon: string;
  /** 一句话中文摘要（≤30字） */
  summary: string;
  /** LLM 对话详细明细日志 */
  llmLogs?: string[];
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
  /** 详细运行日志 */
  logs: string[];
  /** 进度信息 */
  progress: { total: number; done: number };
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
  lastProcessedCount: 0,
  logs: [],
  progress: { total: 0, done: 0 }
};

// ─── Public API ───────────────────────────────────────────────────────────

export function getLlmTaskState(): LLMTaskState {
  return taskState;
}

export function isLlmConfigured(): boolean {
  return Boolean(config.llmApiKey);
}

/** 追加一行运行日志 */
export function appendLog(msg: string): void {
  const ts = new Date().toLocaleTimeString("zh-CN", { hour12: false });
  taskState.logs.push(`[${ts}] ${msg}`);
  // 只保留最近 200 条
  if (taskState.logs.length > 200) taskState.logs.splice(0, taskState.logs.length - 200);
}

/** 更新进度 */
export function updateProgress(done: number, total: number): void {
  taskState.progress = { done, total };
}

/** 重置日志和进度（每次任务开始前调用） */
export function resetLlmTaskLogs(): void {
  taskState.logs = [];
  taskState.progress = { total: 0, done: 0 };
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
  resetLlmTaskLogs();

  const uncachedCount = items.filter((item) => !analysisCache.has(item.id)).length;
  taskState.lastProcessedCount = uncachedCount;

  appendLog(`分析任务启动，共 ${items.length} 条事件，其中 ${uncachedCount} 条未缓存`);
  appendLog(`【System Prompt】:\n${SYSTEM_PROMPT}`);

  try {
    const result = await analyzeNewsItemsWithLogging(items);

    const analyzedCount = result.size;
    appendLog(`分析完成，成功分析 ${analyzedCount} 条事件`);

    taskState.status = "done";
    taskState.lastFinishedAt = new Date().toISOString();
    taskState.lastSuccessAt = taskState.lastFinishedAt;
    taskState.lastError = null;

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown LLM error";
    taskState.status = "error";
    taskState.lastFinishedAt = new Date().toISOString();
    taskState.lastErrorAt = taskState.lastFinishedAt;
    taskState.lastError = msg;
    appendLog(`分析失败：${msg}`);
    throw error;
  }
}

/**
 * 带日志的批量分析，逐批记录进度。
 */
async function analyzeNewsItemsWithLogging(
  items: Array<{ id: string; title: string }>
): Promise<Map<string, LLMAnalysisResult>> {
  const resultMap = new Map<string, LLMAnalysisResult>();

  const uncachedItems: Array<{ id: string; title: string }> = [];
  for (const item of items) {
    const cached = analysisCache.get(item.id);
    if (cached) {
      resultMap.set(item.id, cached);
    } else {
      uncachedItems.push(item);
    }
  }

  const cachedCount = resultMap.size;
  if (cachedCount > 0) appendLog(`缓存命中 ${cachedCount} 条，跳过`);

  if (!uncachedItems.length || !config.llmApiKey) {
    updateProgress(0, 0);
    return resultMap;
  }

  const total = uncachedItems.length;
  appendLog(`需要分析 ${total} 条，按每批最多 10 条调用 LLM`);

  const BATCH_SIZE = 10;
  for (let i = 0; i < uncachedItems.length; i += BATCH_SIZE) {
    const batch = uncachedItems.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(uncachedItems.length / BATCH_SIZE);

    try {
      appendLog(`[${batchNum}/${totalBatches}] 发送批次，${batch.length} 条...`);
      const batchResults = await callLlmBatch(batch, { appendLog });
      for (const result of batchResults) {
        analysisCache.set(result.id, result);
        resultMap.set(result.id, result);
      }
      updateProgress(resultMap.size - cachedCount, total);
      appendLog(`[${batchNum}/${totalBatches}] 返回 ${batchResults.length} 条结果`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "未知错误";
      appendLog(`[${batchNum}/${totalBatches}] 批次失败：${msg}`);
      console.warn(`[LLM] Batch ${batchNum} failed:`, msg);
    }
  }

  appendLog(`LLM 分析完毕，共处理 ${resultMap.size - cachedCount} 条`);
  return resultMap;
}

// ─── LLM API Call ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一位黄金市场专业分析师。
对于输入的每条新闻，请判断其对黄金价格的影响，输出一个 JSON 对象，其中包含一个 results 数组。
每个结果对应输入的新闻条目。
results 数组中的每个元素格式：
{
  "id": "<原始id>",
  "category": "<分类，从[美联储,美元,地缘政治,避险情绪,通胀,黄金市场,美债]中选一>",
  "direction": "<bullish|bearish|neutral，对黄金价格而言>",
  "impactScore": <0-100的整数，表示影响力强度>,
  "confidence": <0-100的整数，表示对该分析结论的置信度>,
  "horizon": "<影响周期，从[1小时,4小时,1天,3天,7天]中选一>",
  "summary": "<一句话中文摘要，不超过30字>"
}
规则：
- bullish = 利多黄金（如降息、地缘冲突、避险需求增加）
- bearish = 利空黄金（如加息、美元走强、风险偏好提升）
- neutral = 影响不明确或与黄金无关
- impactScore：重大事件(美联储决议/战争)70-100，重要数据(CPI/非农)40-70，一般消息10-40
- confidence：置信度评估，考虑信息源可靠度与逻辑推导的确定性
- horizon：影响持续的预期时间范围
- 仅输出合法的 JSON 对象，格式必须是：{ "results": [...] }，不要任何额外文字、代码块标记或解释`;

export async function callLlmBatch(
  items: Array<{ id: string; title: string }>,
  options?: { appendLog?: (msg: string) => void }
): Promise<LLMAnalysisResult[]> {
  const userContent = JSON.stringify(
    items.map((item) => ({ id: item.id, title: item.title }))
  );

  const appendLog = options?.appendLog;
  if (appendLog) {
    appendLog(`[LLM 请求参数] Model: ${config.llmModel}, URL: ${config.llmBaseUrl}/v1/chat/completions`);
    appendLog(`[LLM 输入]\n${userContent}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

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
      const errorMsg = `LLM API HTTP ${response.status}: ${errText.slice(0, 200)}`;
      if (appendLog) appendLog(`[LLM 错误] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "";
    if (appendLog) {
      appendLog(`[LLM 输出]\n${content}`);
    }

    const parsedResults = parseLlmResponse(content, items);

    // 写入内存缓存与每个结果的独立日志中
    for (const result of parsedResults) {
      const eventLogs = [
        `[LLM 请求参数] Model: ${config.llmModel}, URL: ${config.llmBaseUrl}/v1/chat/completions`,
        `[LLM 输入]\n${userContent}`,
        `[LLM 输出]\n${content}`,
        `[解析结果] 类别=${result.category}, 方向=${result.direction === "bullish" ? "利多" : result.direction === "bearish" ? "利空" : "中性"}, 得分=${result.impactScore}, 置信度=${result.confidence}%, 影响周期=${result.horizon}`
      ];
      result.llmLogs = eventLogs;
      analysisCache.set(result.id, result);
    }

    return parsedResults;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (appendLog) appendLog(`[LLM 调用异常] ${msg}`);
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseLlmResponse(
  content: string,
  originalItems: Array<{ id: string; title: string }>
): LLMAnalysisResult[] {
  try {
    let parsed: unknown;
    let jsonStr = content.trim();

    // 自动剥离 Markdown 代码块标记
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```[a-zA-Z]*\s*/, "");
      jsonStr = jsonStr.replace(/\s*```$/, "");
      jsonStr = jsonStr.trim();
    }

    const jsonObj = JSON.parse(jsonStr) as Record<string, unknown>;
    if (Array.isArray(jsonObj)) {
      parsed = jsonObj;
    } else {
      // 优先从 results 数组查找
      const resultsArr = jsonObj.results;
      if (Array.isArray(resultsArr)) {
        parsed = resultsArr;
      } else {
        // 查找任意第一个数组值
        const arrValue = Object.values(jsonObj).find((v) => Array.isArray(v));
        parsed = arrValue ?? jsonObj;
      }
    }

    const arr = Array.isArray(parsed) ? parsed : [parsed];

    return arr
      .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
      .map((item) => ({
        id: String(item.id ?? ""),
        category: String(item.category ?? "黄金市场"),
        direction: validateDirection(item.direction),
        impactScore: clampScore(Number(item.impactScore ?? 30)),
        confidence: clampScore(Number(item.confidence ?? 80)),
        horizon: validateHorizon(item.horizon),
        summary: String(item.summary ?? "")
      }))
      .filter((item) => item.id && originalItems.some((o) => o.id === item.id));
  } catch (err) {
    console.warn("[LLM] Failed to parse response:", content.slice(0, 300), err);
    return [];
  }
}

function validateDirection(value: unknown): "bullish" | "bearish" | "neutral" {
  if (value === "bullish" || value === "bearish" || value === "neutral") return value;
  return "neutral";
}

function validateHorizon(value: unknown): string {
  const allowed = ["1小时", "4小时", "1天", "3天", "7天"];
  const valStr = String(value ?? "").trim();
  if (allowed.includes(valStr)) return valStr;
  return "1天";
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 30;
  return Math.max(0, Math.min(100, Math.round(value)));
}
