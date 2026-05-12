import {
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(appDir, "dist");
const port = Number(process.env.PORT || 3000);
const dataDir = resolve(process.env.DATA_DIR || join(appDir, ".data"));
const tasksFile = join(dataDir, "tasks.json");
const arkApiKey = process.env.ARK_API_KEY || "";
const arkBaseUrl = (process.env.ARK_API_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
const arkParamStyle = process.env.ARK_PARAM_STYLE || "inline";
const maxImageBytes = Number(process.env.MAX_IMAGE_BYTES || 5 * 1024 * 1024);

const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "expired"]);
const pollTimers = new Map();
const pollInflight = new Set();

mkdirSync(dataDir, { recursive: true });

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

let tasks = loadTasks();

for (const task of tasks.values()) {
  if (!terminalStatuses.has(task.status)) {
    schedulePoll(task.id, 1500);
  }
}

function loadTasks() {
  try {
    if (!existsSync(tasksFile)) return new Map();
    const raw = JSON.parse(readFileSync(tasksFile, "utf8"));
    return new Map(Object.entries(raw.tasks || {}));
  } catch (error) {
    console.error("failed to load tasks", error);
    return new Map();
  }
}

function saveTasks() {
  const payload = {
    version: 1,
    updatedAt: Date.now(),
    tasks: Object.fromEntries(tasks),
  };
  const tmp = `${tasksFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, tasksFile);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeResolution(value) {
  const raw = String(value || "1080p");
  if (raw.toLowerCase() === "2k") return "2K";
  return raw;
}

function normalizeStatus(status) {
  const raw = String(status || "queued").toLowerCase();
  if (raw === "pending") return "queued";
  if (raw === "processing") return "running";
  if (raw === "completed" || raw === "complete") return "succeeded";
  if (raw === "error") return "failed";
  return raw;
}

function resolveModel(uiModel, mode) {
  if (uiModel && !uiModel.startsWith("seedance-")) return uiModel;
  if (uiModel === "seedance-lite") {
    return mode === "i2v"
      ? process.env.ARK_MODEL_LITE_I2V || "doubao-seedance-1-0-lite-i2v-250428"
      : process.env.ARK_MODEL_LITE_T2V || "doubao-seedance-1-0-lite-t2v-250428";
  }
  return process.env.ARK_MODEL_PRO || "doubao-seedance-2-0-260128";
}

function titleFromPrompt(prompt) {
  return (prompt.split(/[.,;\n，。；]/)[0] || "Untitled take").trim().slice(0, 80);
}

function estimateProgress(task) {
  if (task.status === "succeeded") return 100;
  if (terminalStatuses.has(task.status)) return task.progress || 0;

  const elapsed = Math.max(0, Date.now() - (task.createdAt || Date.now()));
  const expectedMs = Math.max(45_000, Number(task.duration || 5) * 12_000);
  const estimate = Math.min(94, Math.round((elapsed / expectedMs) * 88) + 6);

  if (task.status === "queued") return Math.min(estimate, 28);
  return Math.max(30, estimate);
}

function publicTask(task) {
  return {
    id: task.id,
    task_id: task.arkTaskId,
    status: task.status,
    progress: estimateProgress(task),
    video_url: task.videoUrl || null,
    error: task.error || null,
    title: task.title,
    prompt: task.prompt,
    model: task.uiModel,
    ark_model: task.arkModel,
    mode: task.mode,
    resolution: task.resolution,
    aspect: task.aspect,
    duration: task.duration,
    camera: task.camera,
    seed: task.seed,
    image_id: task.imageId || null,
    thumb: task.thumb || null,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    finished_at: task.finishedAt || null,
    last_poll_error: task.lastPollError || null,
  };
}

function normalizeGenerateInput(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw httpError(400, "prompt_required", "Prompt is required.");
  }

  const imageUrl = input.image_url || input.imageUrl || input.image?.src || null;
  if (imageUrl && imageUrl.startsWith("data:") && Buffer.byteLength(imageUrl, "utf8") > maxImageBytes) {
    throw httpError(413, "image_too_large", "Reference image is too large for inline upload.");
  }

  const mode = imageUrl ? "i2v" : "t2v";
  const duration = clampInt(input.duration_seconds ?? input.duration, 5, 15, 5);
  const seed = clampInt(input.seed, -1, 4_294_967_295, Math.floor(Math.random() * 99_999));
  const resolution = normalizeResolution(input.resolution || "1080p");
  const aspect = String(input.aspect_ratio || input.aspect || "16:9");
  const camera = input.camera_fixed === true || input.camera === "fixed" ? "fixed" : "dynamic";
  const uiModel = String(input.model || "seedance-pro");
  const arkModel = resolveModel(uiModel, mode);

  return {
    prompt,
    imageUrl,
    imageId: input.image_id || input.imageId || null,
    thumb: input.thumb || imageUrl || null,
    mode,
    duration,
    seed,
    resolution,
    aspect,
    camera,
    uiModel,
    arkModel,
    title: titleFromPrompt(prompt),
  };
}

function toArkBody(input) {
  const flags = [
    `--rs ${input.resolution}`,
    `--rt ${input.aspect}`,
    `--dur ${input.duration}`,
    `--cf ${input.camera === "fixed"}`,
    `--seed ${input.seed}`,
  ].join(" ");

  const useInline = arkParamStyle === "inline" || arkParamStyle === "both";
  const useFields = arkParamStyle === "fields" || arkParamStyle === "both";
  const text = useInline ? `${input.prompt}  ${flags}` : input.prompt;
  const content = [{ type: "text", text }];

  if (input.imageUrl) {
    content.push({ type: "image_url", image_url: { url: input.imageUrl } });
  }

  const body = {
    model: input.arkModel,
    content,
  };

  if (useFields) {
    body.resolution = input.resolution;
    body.ratio = input.aspect;
    body.duration = input.duration;
    body.seed = input.seed;
    body.watermark = false;
    if (!input.imageUrl) {
      body.camera_fixed = input.camera === "fixed";
    }
  }

  return body;
}

async function createArkTask(input) {
  const body = toArkBody(input);
  const result = await arkFetch("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.id) {
    throw httpError(502, "upstream_bad_response", "Ark did not return a task id.");
  }

  return result.id;
}

async function getArkTask(taskId) {
  return arkFetch(`/contents/generations/tasks/${encodeURIComponent(taskId)}`);
}

async function arkFetch(path, options = {}) {
  if (!arkApiKey) {
    throw httpError(503, "ark_key_missing", "ARK_API_KEY is not configured on the server.");
  }

  const res = await fetch(`${arkBaseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${arkApiKey}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;

  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 500) };
    }
  }

  if (!res.ok) {
    const message = body?.error?.message || body?.message || `Ark request failed with HTTP ${res.status}.`;
    throw httpError(res.status, body?.error?.code || "ark_request_failed", message, body);
  }

  return body || {};
}

function extractVideoUrl(raw) {
  const content = raw?.content;
  if (!content) return null;
  if (typeof content.video_url === "string") return content.video_url;
  if (typeof content.file_url === "string") return content.file_url;
  if (Array.isArray(content)) {
    const item = content.find((entry) => entry?.url || entry?.video_url || entry?.file_url);
    return item?.url || item?.video_url || item?.file_url || null;
  }
  if (typeof content.url === "string") return content.url;
  return null;
}

function normalizeArkResult(raw) {
  const status = normalizeStatus(raw.status);
  return {
    status,
    videoUrl: extractVideoUrl(raw),
    error: raw.error
      ? {
          code: raw.error.code || "ark_error",
          message: raw.error.message || "Ark task failed.",
        }
      : null,
    updatedAt: raw.updated_at ? raw.updated_at * 1000 : Date.now(),
    rawMeta: {
      usage: raw.usage || null,
      seed: raw.seed,
      resolution: raw.resolution,
      ratio: raw.ratio,
      duration: raw.duration,
    },
  };
}

async function pollTask(id, reason = "timer") {
  const task = tasks.get(id);
  if (!task || terminalStatuses.has(task.status) || pollInflight.has(id)) return;

  pollInflight.add(id);
  try {
    const raw = await getArkTask(task.arkTaskId);
    const next = normalizeArkResult(raw);
    task.status = next.status;
    task.videoUrl = next.videoUrl || task.videoUrl || null;
    task.error = next.error;
    task.updatedAt = Date.now();
    task.lastPolledAt = Date.now();
    task.lastPollError = null;
    task.pollCount = (task.pollCount || 0) + 1;
    task.progress = estimateProgress(task);
    task.rawMeta = next.rawMeta;

    if (terminalStatuses.has(task.status)) {
      task.finishedAt = Date.now();
      task.progress = task.status === "succeeded" ? 100 : task.progress;
    }

    saveTasks();
    if (!terminalStatuses.has(task.status)) {
      schedulePoll(id, pollDelay(task));
    }
  } catch (error) {
    task.updatedAt = Date.now();
    task.lastPolledAt = Date.now();
    task.lastPollError = publicError(error);
    task.pollErrorCount = (task.pollErrorCount || 0) + 1;

    if (error.status === 401 || error.status === 403) {
      task.status = "failed";
      task.error = { code: "auth_error", message: "Ark rejected the configured API key." };
      task.finishedAt = Date.now();
    }

    saveTasks();
    if (!terminalStatuses.has(task.status)) {
      schedulePoll(id, Math.min(60_000, 5_000 * task.pollErrorCount));
    }
  } finally {
    pollInflight.delete(id);
    console.log(`task poll ${reason}: ${id} -> ${tasks.get(id)?.status || "missing"}`);
  }
}

function pollDelay(task) {
  const count = task.pollCount || 0;
  if (count < 20) return 5_000;
  if (count < 80) return 15_000;
  return 60_000;
}

function schedulePoll(id, delayMs) {
  const task = tasks.get(id);
  if (!task || terminalStatuses.has(task.status) || pollTimers.has(id)) return;
  const timer = setTimeout(() => {
    pollTimers.delete(id);
    pollTask(id);
  }, delayMs);
  timer.unref?.();
  pollTimers.set(id, timer);
}

async function handleGenerate(req, res) {
  const input = normalizeGenerateInput(await readJson(req));
  const arkTaskId = await createArkTask(input);
  const now = Date.now();
  const id = arkTaskId || randomUUID();
  const task = {
    id,
    arkTaskId,
    status: "queued",
    progress: 3,
    title: input.title,
    prompt: input.prompt,
    uiModel: input.uiModel,
    arkModel: input.arkModel,
    mode: input.mode,
    resolution: input.resolution,
    aspect: input.aspect,
    duration: input.duration,
    camera: input.camera,
    seed: input.seed,
    imageId: input.imageId,
    thumb: input.thumb,
    videoUrl: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    pollCount: 0,
  };

  tasks.set(id, task);
  saveTasks();
  schedulePoll(id, 1500);
  sendJson(res, 202, publicTask(task));
}

async function handleGetTask(req, res, id) {
  const task = tasks.get(id);
  if (!task) {
    sendJson(res, 404, { error: { code: "task_not_found", message: "Task not found." } });
    return;
  }

  if (!terminalStatuses.has(task.status) && Date.now() - (task.lastPolledAt || 0) > 4_000) {
    schedulePoll(id, 0);
  }

  sendJson(res, 200, publicTask(task));
}

async function handleListTasks(req, res) {
  const items = [...tasks.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100)
    .map(publicTask);
  sendJson(res, 200, { tasks: items });
}

async function routeApi(req, res, url) {
  try {
    if (url.pathname === "/api/generate" && req.method === "POST") {
      await handleGenerate(req, res);
      return true;
    }

    if (url.pathname === "/api/tasks" && req.method === "GET") {
      await handleListTasks(req, res);
      return true;
    }

    const taskMatch = url.pathname.match(/^\/api\/task\/([^/]+)$/);
    if (taskMatch && req.method === "GET") {
      await handleGetTask(req, res, decodeURIComponent(taskMatch[1]));
      return true;
    }
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { error: publicError(error) });
    return true;
  }

  return false;
}

function readJson(req, maxBytes = 7 * 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        reject(httpError(413, "body_too_large", "Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) {
        resolveBody({});
        return;
      }

      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(httpError(400, "invalid_json", "Request body must be valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function httpError(status, code, message, cause) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.cause = cause;
  return error;
}

function publicError(error) {
  return {
    code: error.code || "server_error",
    message: error.message || "Unexpected server error.",
  };
}

function resolveAsset(urlPath) {
  const cleanPath = normalize(decodeURIComponent(urlPath.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(root, `.${cleanPath}`);

  if (!candidate.startsWith(root)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return join(root, "index.html");
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(res, 200, { ok: true, ark: Boolean(arkApiKey), tasks: tasks.size });
    return;
  }

  if (await routeApi(req, res, url)) {
    return;
  }

  const filePath = resolveAsset(req.url || "/");

  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const ext = extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}).listen(port, "0.0.0.0", () => {
  console.log(`videogen listening on :${port}`);
  console.log(`task store: ${tasksFile}`);
});
