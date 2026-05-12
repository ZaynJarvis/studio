import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const root = resolve(appDir, "dist");
const port = Number(process.env.PORT || 3000);
const dataDir = resolve(process.env.DATA_DIR || join(appDir, ".data"));
const publicDataDir = join(dataDir, "public");
const artifactsDir = join(publicDataDir, "artifacts");
const coversDir = join(publicDataDir, "covers");
const inputsDir = join(publicDataDir, "inputs");
const tasksFile = join(dataDir, "tasks.json");
const publicTasksFile = join(publicDataDir, "tasks.json");
const arkApiKey = process.env.ARK_API_KEY || "";
const arkBaseUrl = (process.env.ARK_API_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
const arkParamStyle = process.env.ARK_PARAM_STYLE || "inline";
const arkTitleModel = process.env.ARK_TITLE_MODEL || "ep-20260512155127-ngn88";
const arkTitleTimeoutMs = Number(process.env.ARK_TITLE_TIMEOUT_MS || 6000);
const monitorMode = process.env.TASK_MONITOR_MODE === "webhook" ? "webhook" : "poll";
const callbackBaseUrl = (process.env.ARK_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.ARK_CALLBACK_BASE_URL || "").replace(/\/+$/, "");
const webhookToken = process.env.ARK_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || process.env.MCP_TOKEN || "";
const maxImageBytes = Number(process.env.MAX_IMAGE_BYTES || 10 * 1024 * 1024);
const maxJsonBodyBytes = Number(process.env.MAX_JSON_BODY_BYTES || Math.ceil(maxImageBytes * 1.5) + 1024 * 1024);
const maxArtifactBytes = Number(process.env.MAX_ARTIFACT_BYTES || 500 * 1024 * 1024);

const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "expired"]);
const pollTimers = new Map();
const pollInflight = new Set();
const artifactInflight = new Set();
const coverInflight = new Set();

mkdirSync(dataDir, { recursive: true });
mkdirSync(artifactsDir, { recursive: true });
mkdirSync(coversDir, { recursive: true });
mkdirSync(inputsDir, { recursive: true });

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".webm": "video/webm",
};

let tasks = loadTasks();

for (const task of tasks.values()) {
  const normalizedTitle = limitTitle(task.title || titleFromPrompt(task.prompt));
  if (normalizedTitle !== task.title) {
    task.title = normalizedTitle;
    task.updatedAt = Date.now();
  }
  if (monitorMode === "poll" && !terminalStatuses.has(task.status)) {
    schedulePoll(task.id, 1500);
  }
  if (task.status === "succeeded" && (task.sourceVideoUrl || task.videoUrl) && !task.artifactUrl) {
    scheduleArtifactCache(task.id, "startup");
  }
  if (task.status === "succeeded" && task.artifactPath && !task.coverUrl) {
    scheduleCoverGeneration(task.id, "startup");
  }
}
saveTasks();

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

  const publicPayload = {
    version: 1,
    updated_at: Date.now(),
    tasks: [...tasks.values()]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(publicTask),
  };
  const publicTmp = `${publicTasksFile}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(publicTmp, JSON.stringify(publicPayload, null, 2));
  renameSync(publicTmp, publicTasksFile);
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
  if (["created", "pending", "submitted", "scheduled", "waiting", "not_started", "in_queue"].includes(raw)) return "queued";
  if (["processing", "rendering", "in_progress", "executing", "started"].includes(raw)) return "running";
  if (raw === "completed" || raw === "complete") return "succeeded";
  if (raw === "error") return "failed";
  return raw;
}

function resolveModel() {
  return process.env.ARK_MODEL_PRO || "doubao-seedance-2-0-260128";
}

function callbackUrlForTask(id) {
  if (monitorMode !== "webhook") return null;
  if (!callbackBaseUrl) {
    throw httpError(500, "callback_base_url_missing", "ARK_CALLBACK_BASE_URL or PUBLIC_BASE_URL is required in webhook mode.");
  }

  const url = new URL("/api/ark/webhook", callbackBaseUrl);
  url.searchParams.set("task_id", id);
  if (webhookToken) {
    url.searchParams.set("token", webhookToken);
  }
  return url.toString();
}

function limitTitle(title, fallback = "Untitled take") {
  let clean = String(title || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || "";

  clean = clean
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^[#*\-\s]+/, "")
    .replace(/^(title|标题)\s*[:：]\s*/i, "")
    .replace(/[.。!！?？:：;；]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return fallback;

  if (/[\u3400-\u9fff]/.test(clean)) {
    return clean.replace(/\s+/g, "").slice(0, 10) || fallback;
  }

  const words = clean.split(" ").filter(Boolean).slice(0, 5).join(" ");
  return words.slice(0, 60).trim() || fallback;
}

function titleFromPrompt(prompt) {
  const raw = String(prompt || "");
  return limitTitle((raw.split(/[.,;\n，。；]/)[0] || "Untitled take").trim());
}

function cleanGeneratedTitle(text, fallback) {
  return limitTitle(text, limitTitle(fallback));
}

function extractResponseText(raw) {
  if (typeof raw?.output_text === "string") return raw.output_text;

  const texts = [];
  const collectContent = (content) => {
    if (typeof content === "string") {
      texts.push(content);
      return;
    }
    if (!Array.isArray(content)) return;
    for (const item of content) {
      if (typeof item?.text === "string") texts.push(item.text);
      if (typeof item?.output_text === "string") texts.push(item.output_text);
    }
  };

  if (Array.isArray(raw?.output)) {
    for (const item of raw.output) {
      if (typeof item?.text === "string") texts.push(item.text);
      collectContent(item?.content);
    }
  }

  if (Array.isArray(raw?.choices)) {
    for (const choice of raw.choices) {
      collectContent(choice?.message?.content);
      if (typeof choice?.message?.content === "string") texts.push(choice.message.content);
      if (typeof choice?.text === "string") texts.push(choice.text);
    }
  }

  return texts.join("\n").trim();
}

async function generateTaskTitle(input) {
  const fallback = titleFromPrompt(input.prompt);
  if (!arkTitleModel) return fallback;

  const content = [];
  if (input.imageUrl) {
    content.push({ type: "input_image", image_url: input.imageUrl });
  }
  content.push({
    type: "input_text",
    text: [
      "Create a short production title for a video generation task.",
      "Return only the title, no quotes, no prefix, and do not copy the full prompt.",
      "If the prompt is Chinese, use Chinese and keep it 4 to 10 characters. Otherwise use English and keep it 2 to 5 words.",
      `Video prompt: ${input.prompt}`,
    ].join("\n"),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), arkTitleTimeoutMs);
  timeout.unref?.();

  try {
    const raw = await arkFetch("/responses", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        model: arkTitleModel,
        input: [{ role: "user", content }],
      }),
    });
    return cleanGeneratedTitle(extractResponseText(raw), fallback);
  } catch (error) {
    console.warn("title generation failed", publicError(error));
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
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

function publicVideoUrl(task) {
  return task.artifactUrl || task.videoUrl || null;
}

function publicThumbUrl(value) {
  const raw = String(value || "");
  if (!raw || raw.startsWith("data:")) return null;
  if (raw.length > 2048) return null;
  return raw;
}

function publicMediaUrl(path) {
  if (!path) return null;
  if (String(path).startsWith("http://") || String(path).startsWith("https://")) return path;
  if (!publicBaseUrl) return path;
  return new URL(path, publicBaseUrl).toString();
}

function publicText(value, max = 4000) {
  const raw = String(value || "");
  return raw.length > max ? `${raw.slice(0, max)}...` : raw;
}

function publicTask(task) {
  const taskMonitorMode = task.monitorMode || monitorMode;
  const activeWebhookTask = taskMonitorMode === "webhook" && !terminalStatuses.has(task.status);

  return {
    id: task.id,
    task_id: task.arkTaskId,
    status: task.status,
    progress: activeWebhookTask ? null : estimateProgress(task),
    video_url: publicVideoUrl(task),
    artifact_url: task.artifactUrl || null,
    artifact_status: task.artifactStatus || (task.artifactUrl ? "ready" : null),
    artifact_bytes: task.artifactBytes || null,
    artifact_error: task.artifactError || null,
    cover_url: task.coverUrl || null,
    cover_status: task.coverStatus || (task.coverUrl ? "ready" : null),
    cover_bytes: task.coverBytes || null,
    cover_error: task.coverError || null,
    error: task.error || null,
    title: publicText(task.title, 120),
    prompt: publicText(task.prompt, 4000),
    model: task.uiModel,
    ark_model: task.arkModel,
    mode: task.mode,
    resolution: task.resolution,
    aspect: task.aspect,
    duration: task.duration,
    camera: task.camera,
    seed: task.seed,
    image_id: task.imageId || null,
    reference_image_url: publicMediaUrl(task.inputImageUrl) || null,
    reference_image_bytes: task.inputImageBytes || null,
    thumb: publicThumbUrl(task.coverUrl || task.thumb),
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    finished_at: task.finishedAt || null,
    last_poll_error: task.lastPollError || null,
    monitor_mode: taskMonitorMode,
  };
}

function sanitizeFilePart(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || randomUUID();
}

function decodeDataImageUrl(value) {
  const match = String(value || "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length) {
    throw httpError(400, "image_invalid", "Reference image data is empty.");
  }
  if (buffer.length > maxImageBytes) {
    throw httpError(413, "image_too_large", "Reference image is larger than MAX_IMAGE_BYTES.");
  }

  return { buffer, mime, ext };
}

function persistInputImage(imageUrl) {
  if (!imageUrl || !String(imageUrl).startsWith("data:")) return null;
  const decoded = decodeDataImageUrl(imageUrl);
  if (!decoded) {
    throw httpError(400, "image_invalid", "Reference image must be a JPEG, PNG, or WEBP data URL.");
  }

  if (!publicBaseUrl) {
    throw httpError(500, "public_base_url_missing", "PUBLIC_BASE_URL is required to upload inline reference images.");
  }

  const filename = `${randomUUID()}${decoded.ext}`;
  const finalPath = join(inputsDir, filename);
  writeFileSync(finalPath, decoded.buffer);

  const mediaPath = `/media/inputs/${filename}`;
  return {
    url: publicMediaUrl(mediaPath),
    mediaPath,
    path: `inputs/${filename}`,
    bytes: decoded.buffer.length,
    mime: decoded.mime,
  };
}

function artifactExtension(sourceUrl, contentType) {
  try {
    const ext = extname(new URL(sourceUrl).pathname).toLowerCase();
    if ([".mp4", ".webm", ".mov"].includes(ext)) return ext;
  } catch {
    // Fall back to content-type below.
  }

  if (String(contentType || "").includes("webm")) return ".webm";
  if (String(contentType || "").includes("quicktime")) return ".mov";
  return ".mp4";
}

function scheduleArtifactCache(id, reason = "task") {
  const task = tasks.get(id);
  if (!task || task.status !== "succeeded" || task.artifactUrl || artifactInflight.has(id)) return;
  if (!(task.sourceVideoUrl || task.videoUrl)) return;

  setTimeout(() => {
    cacheTaskArtifact(id, reason).catch((error) => {
      console.error(`artifact cache failed ${id}`, publicError(error));
    });
  }, 0).unref?.();
}

function scheduleCoverGeneration(id, reason = "task") {
  const task = tasks.get(id);
  if (!task || task.status !== "succeeded" || task.coverUrl || coverInflight.has(id)) return;
  if (!task.artifactPath) return;

  setTimeout(() => {
    generateTaskCover(id, reason).catch((error) => {
      console.error(`cover generation failed ${id}`, publicError(error));
    });
  }, 0).unref?.();
}

async function cacheTaskArtifact(id, reason = "task") {
  const task = tasks.get(id);
  if (!task || task.status !== "succeeded" || task.artifactUrl || artifactInflight.has(id)) return;

  const sourceUrl = task.sourceVideoUrl || task.videoUrl;
  if (!sourceUrl || sourceUrl.startsWith("/media/")) return;

  artifactInflight.add(id);
  let tmpPath = null;

  try {
    task.artifactStatus = "caching";
    task.artifactError = null;
    task.updatedAt = Date.now();
    saveTasks();

    const res = await fetch(sourceUrl);
    if (!res.ok || !res.body) {
      throw httpError(res.status || 502, "artifact_fetch_failed", `Could not fetch generated video for storage.`);
    }

    const contentLength = Number(res.headers.get("content-length") || 0);
    if (contentLength > maxArtifactBytes) {
      throw httpError(413, "artifact_too_large", "Generated video is larger than MAX_ARTIFACT_BYTES.");
    }

    const ext = artifactExtension(sourceUrl, res.headers.get("content-type"));
    const filename = `${sanitizeFilePart(task.id)}${ext}`;
    const finalPath = join(artifactsDir, filename);
    tmpPath = `${finalPath}.${process.pid}.${Date.now()}.tmp`;
    let bytes = 0;

    const counter = new Transform({
      transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxArtifactBytes) {
          callback(httpError(413, "artifact_too_large", "Generated video is larger than MAX_ARTIFACT_BYTES."));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(tmpPath));
    renameSync(tmpPath, finalPath);
    tmpPath = null;

    task.sourceVideoUrl = sourceUrl;
    task.artifactUrl = `/media/artifacts/${filename}`;
    task.artifactPath = `artifacts/${filename}`;
    task.artifactBytes = bytes;
    task.artifactCachedAt = Date.now();
    task.artifactStatus = "ready";
    task.updatedAt = Date.now();
    saveTasks();
    console.log(`artifact cache ${reason}: ${id} -> ${task.artifactUrl} (${bytes} bytes)`);
    scheduleCoverGeneration(id, reason);
  } catch (error) {
    if (tmpPath) {
      try { rmSync(tmpPath, { force: true }); } catch {}
    }
    task.artifactStatus = "failed";
    task.artifactError = publicError(error);
    task.updatedAt = Date.now();
    saveTasks();
    throw error;
  } finally {
    artifactInflight.delete(id);
  }
}

async function generateTaskCover(id, reason = "task") {
  const task = tasks.get(id);
  if (!task || task.status !== "succeeded" || task.coverUrl || coverInflight.has(id)) return;

  const artifactPath = task.artifactPath ? resolve(publicDataDir, task.artifactPath) : null;
  if (!artifactPath || !artifactPath.startsWith(publicDataDir) || !existsSync(artifactPath)) return;

  coverInflight.add(id);
  let tmpPath = null;

  try {
    const filename = `${sanitizeFilePart(task.id)}.jpg`;
    const finalPath = join(coversDir, filename);
    const coverUrl = `/media/covers/${filename}`;

    task.coverStatus = "generating";
    task.coverError = null;
    task.updatedAt = Date.now();
    saveTasks();

    if (!existsSync(finalPath)) {
      tmpPath = join(coversDir, `${sanitizeFilePart(task.id)}.${process.pid}.${Date.now()}.jpg`);
      await execFileAsync("ffmpeg", [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        "0",
        "-i",
        artifactPath,
        "-frames:v",
        "1",
        "-vf",
        "scale=1280:-2:force_original_aspect_ratio=decrease",
        "-q:v",
        "3",
        "-f",
        "image2",
        tmpPath,
      ], { timeout: 30_000, maxBuffer: 1024 * 1024 });
      renameSync(tmpPath, finalPath);
      tmpPath = null;
    }

    const bytes = statSync(finalPath).size;
    task.coverUrl = coverUrl;
    task.coverPath = `covers/${filename}`;
    task.coverBytes = bytes;
    task.coverGeneratedAt = Date.now();
    task.coverStatus = "ready";
    task.coverError = null;
    task.thumb = coverUrl;
    task.updatedAt = Date.now();
    saveTasks();
    console.log(`cover generation ${reason}: ${id} -> ${task.coverUrl} (${bytes} bytes)`);
  } catch (error) {
    if (tmpPath) {
      try { rmSync(tmpPath, { force: true }); } catch {}
    }
    task.coverStatus = "failed";
    task.coverError = publicError(error);
    task.updatedAt = Date.now();
    saveTasks();
    throw error;
  } finally {
    coverInflight.delete(id);
  }
}

function normalizeGenerateInput(input) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw httpError(400, "prompt_required", "Prompt is required.");
  }

  const rawImageUrl = input.image_url || input.imageUrl || input.image?.src || null;
  const persistedImage = persistInputImage(rawImageUrl);
  const imageUrl = persistedImage?.url || rawImageUrl;
  const rawThumb = input.thumb || rawImageUrl || null;
  const thumb = persistedImage?.mediaPath || (String(rawThumb || "").startsWith("data:") ? null : rawThumb) || imageUrl || null;

  const mode = imageUrl ? "i2v" : "t2v";
  const duration = clampInt(input.duration_seconds ?? input.duration, 5, 15, 5);
  const seed = clampInt(input.seed, -1, 4_294_967_295, Math.floor(Math.random() * 99_999));
  const resolution = normalizeResolution(input.resolution || "1080p");
  const aspect = String(input.aspect_ratio || input.aspect || "16:9");
  const camera = input.camera_fixed === true || input.camera === "fixed" ? "fixed" : "dynamic";
  const uiModel = "seedance-pro";
  const arkModel = resolveModel();

  return {
    prompt,
    imageUrl,
    inputImagePath: persistedImage?.path || null,
    inputImageUrl: persistedImage?.mediaPath || imageUrl || null,
    inputImageBytes: persistedImage?.bytes || null,
    inputImageMime: persistedImage?.mime || null,
    imageId: input.image_id || input.imageId || null,
    thumb,
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

function toArkBody(input, localTaskId) {
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

  const callbackUrl = callbackUrlForTask(localTaskId);
  if (callbackUrl) {
    body.callback_url = callbackUrl;
  }

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
  const localTaskId = randomUUID();
  const body = toArkBody(input, localTaskId);
  const result = await arkFetch("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!result.id) {
    throw httpError(502, "upstream_bad_response", "Ark did not return a task id.");
  }

  return { localTaskId, arkTaskId: result.id };
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

function applyArkResult(task, raw) {
  const next = normalizeArkResult(raw);
  task.status = next.status;
  if (next.videoUrl) {
    task.sourceVideoUrl = next.videoUrl;
  }
  task.videoUrl = task.artifactUrl || next.videoUrl || task.videoUrl || null;
  task.error = next.error;
  task.updatedAt = Date.now();
  task.progress = task.monitorMode === "webhook" && !terminalStatuses.has(task.status)
    ? null
    : estimateProgress(task);
  task.rawMeta = next.rawMeta;

  if (terminalStatuses.has(task.status)) {
    task.finishedAt = Date.now();
    task.progress = task.status === "succeeded" ? 100 : task.progress;
  }

  return task;
}

async function pollTask(id, reason = "timer") {
  if (monitorMode !== "poll") return;
  const task = tasks.get(id);
  if (!task || terminalStatuses.has(task.status) || pollInflight.has(id)) return;

  pollInflight.add(id);
  try {
    const raw = await getArkTask(task.arkTaskId);
    applyArkResult(task, raw);
    task.lastPolledAt = Date.now();
    task.lastPollError = null;
    task.pollCount = (task.pollCount || 0) + 1;

    saveTasks();
    if (task.status === "succeeded") {
      scheduleArtifactCache(id, reason);
    }
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
  const task = await createVideoTask(await readJson(req));
  sendJson(res, 202, publicTask(task));
}

async function createVideoTask(rawInput) {
  const input = normalizeGenerateInput(rawInput);
  input.title = await generateTaskTitle(input);
  const { localTaskId, arkTaskId } = await createArkTask(input);
  const now = Date.now();
  const id = monitorMode === "webhook" ? localTaskId : arkTaskId;
  const task = {
    id,
    arkTaskId,
    status: "queued",
    progress: monitorMode === "poll" ? 3 : null,
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
    inputImagePath: input.inputImagePath,
    inputImageUrl: input.inputImageUrl,
    inputImageBytes: input.inputImageBytes,
    inputImageMime: input.inputImageMime,
    thumb: input.thumb,
    videoUrl: null,
    sourceVideoUrl: null,
    artifactUrl: null,
    artifactPath: null,
    artifactStatus: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    pollCount: 0,
    monitorMode,
    callbackUrl: monitorMode === "webhook" ? callbackUrlForTask(localTaskId) : null,
  };

  tasks.set(id, task);
  saveTasks();
  if (monitorMode === "poll") {
    schedulePoll(id, 1500);
  }
  return task;
}

async function handleGetTask(req, res, id) {
  const task = tasks.get(id);
  if (!task) {
    sendJson(res, 404, { error: { code: "task_not_found", message: "Task not found." } });
    return;
  }

  if (monitorMode === "poll" && !terminalStatuses.has(task.status) && Date.now() - (task.lastPolledAt || 0) > 4_000) {
    schedulePoll(id, 0);
  }

  sendJson(res, 200, publicTask(task));
}

async function handleDeleteTask(req, res, id) {
  const task = tasks.get(id);
  if (!task) {
    sendJson(res, 404, { error: { code: "task_not_found", message: "Task not found." } });
    return;
  }

  if (task.artifactPath) {
    const artifactPath = resolve(publicDataDir, task.artifactPath);
    if (artifactPath.startsWith(publicDataDir)) {
      try { rmSync(artifactPath, { force: true }); } catch {}
    }
  }
  if (task.coverPath) {
    const coverPath = resolve(publicDataDir, task.coverPath);
    if (coverPath.startsWith(publicDataDir)) {
      try { rmSync(coverPath, { force: true }); } catch {}
    }
  }
  if (task.inputImagePath) {
    const inputImagePath = resolve(publicDataDir, task.inputImagePath);
    if (inputImagePath.startsWith(publicDataDir)) {
      try { rmSync(inputImagePath, { force: true }); } catch {}
    }
  }

  tasks.delete(id);
  saveTasks();
  sendJson(res, 200, { ok: true, deleted: id });
}

async function handleArkWebhook(req, res, url) {
  if (webhookToken) {
    const provided = url.searchParams.get("token") || req.headers["x-videogen-webhook-token"] || "";
    if (provided !== webhookToken) {
      sendJson(res, 401, { error: { code: "unauthorized", message: "Invalid webhook token." } });
      return;
    }
  }

  const body = await readJson(req);
  const id = url.searchParams.get("task_id") || body.id || body.task_id;
  const arkTaskId = body.id || body.task_id;
  let task = id ? tasks.get(id) : null;

  if (!task && arkTaskId) {
    task = [...tasks.values()].find((item) => item.arkTaskId === arkTaskId) || null;
  }

  if (!task) {
    sendJson(res, 404, { error: { code: "task_not_found", message: "Task not found for webhook." } });
    return;
  }

  applyArkResult(task, body);
  task.lastWebhookAt = Date.now();
  task.lastPollError = null;
  tasks.set(task.id, task);
  saveTasks();
  if (task.status === "succeeded") {
    scheduleArtifactCache(task.id, "webhook");
  }
  sendJson(res, 200, { ok: true, task: publicTask(task) });
}

async function handleListTasks(req, res) {
  const items = [...tasks.values()]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 100)
    .map(publicTask);
  sendJson(res, 200, { tasks: items });
}

function mcpAuthorized(req, url) {
  if (!process.env.MCP_TOKEN) return true;
  const header = String(req.headers.authorization || "");
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const queryToken = url.searchParams.get("access_token") || "";
  return bearer === process.env.MCP_TOKEN || queryToken === process.env.MCP_TOKEN;
}

function mcpTools() {
  return [
    {
      name: "create_video_task",
      description: "Create a Seedance 2.0 Pro video generation task and persist it in the server queue.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video prompt. Required." },
          image_url: { type: "string", description: "Optional reference image URL for image-to-video." },
          image_id: { type: "string", description: "Optional reference image id." },
          thumb: { type: "string", description: "Optional thumbnail URL." },
          resolution: { type: "string", enum: ["720p", "1080p", "2K"], default: "1080p" },
          aspect: { type: "string", enum: ["16:9", "9:16", "1:1"], default: "16:9" },
          duration: { type: "integer", minimum: 5, maximum: 15, default: 5 },
          camera: { type: "string", enum: ["fixed", "dynamic"], default: "dynamic" },
          seed: { type: "integer", default: -1 },
        },
        required: ["prompt"],
        additionalProperties: true,
      },
    },
    {
      name: "get_video_task",
      description: "Fetch a persisted video task by local task id.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Local task id returned by create_video_task." },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
    {
      name: "list_video_tasks",
      description: "List persisted video tasks from the shared server queue.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional status filter." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
      },
    },
  ];
}

function mcpTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function callMcpTool(name, args = {}) {
  if (name === "create_video_task") {
    const task = await createVideoTask({ ...args, model: "seedance-pro" });
    return mcpTextResult({ task: publicTask(task) });
  }

  if (name === "get_video_task") {
    const task = tasks.get(String(args.id || ""));
    if (!task) {
      throw httpError(404, "task_not_found", "Task not found.");
    }
    return mcpTextResult({ task: publicTask(task) });
  }

  if (name === "list_video_tasks") {
    const status = args.status ? normalizeStatus(args.status) : null;
    const limit = clampInt(args.limit, 1, 100, 20);
    const items = [...tasks.values()]
      .filter((task) => !status || task.status === status)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, limit)
      .map(publicTask);
    return mcpTextResult({ tasks: items });
  }

  throw httpError(404, "tool_not_found", `Unknown MCP tool: ${name}`);
}

async function handleMcpRpc(message) {
  const id = message?.id;
  const method = message?.method;
  const params = message?.params || {};

  try {
    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "videogen", version: "1.0.0" },
        },
      };
    }

    if (method === "notifications/initialized") {
      return null;
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: mcpTools() } };
    }

    if (method === "tools/call") {
      const result = await callMcpTool(params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result };
    }

    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: error.status || -32000,
        message: error.message || "MCP tool failed.",
        data: publicError(error),
      },
    };
  }
}

async function handleMcp(req, res, url) {
  if (!mcpAuthorized(req, url)) {
    sendJson(res, 401, { error: { code: "unauthorized", message: "Invalid MCP token." } });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "authorization,content-type",
    });
    res.end();
    return;
  }

  if (req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write("event: endpoint\n");
    res.write("data: /mcp\n\n");
    res.write("event: tools\n");
    res.write(`data: ${JSON.stringify({ tools: mcpTools().map((tool) => tool.name) })}\n\n`);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "method_not_allowed", message: "MCP supports GET and POST." } });
    return;
  }

  const body = await readJson(req);
  const batch = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(batch.map(handleMcpRpc))).filter(Boolean);

  if (responses.length === 0) {
    res.writeHead(202, { "cache-control": "no-store" });
    res.end();
    return;
  }

  sendJson(res, 200, Array.isArray(body) ? responses : responses[0]);
}

async function routeApi(req, res, url) {
  try {
    if (url.pathname === "/mcp") {
      await handleMcp(req, res, url);
      return true;
    }

    if (url.pathname === "/api/generate" && req.method === "POST") {
      await handleGenerate(req, res);
      return true;
    }

    if (url.pathname === "/api/tasks" && req.method === "GET") {
      await handleListTasks(req, res);
      return true;
    }

    if (url.pathname === "/api/ark/webhook" && req.method === "POST") {
      await handleArkWebhook(req, res, url);
      return true;
    }

    const taskMatch = url.pathname.match(/^\/api\/task\/([^/]+)$/);
    if (taskMatch && req.method === "GET") {
      await handleGetTask(req, res, decodeURIComponent(taskMatch[1]));
      return true;
    }

    if (taskMatch && req.method === "DELETE") {
      await handleDeleteTask(req, res, decodeURIComponent(taskMatch[1]));
      return true;
    }
  } catch (error) {
    const status = error.status || 500;
    sendJson(res, status, { error: publicError(error) });
    return true;
  }

  return false;
}

function readJson(req, maxBytes = maxJsonBodyBytes) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    let settled = false;
    const contentLength = Number(req.headers["content-length"] || 0);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      raw = "";
      req.resume();
      reject(error);
    };

    if (contentLength > maxBytes) {
      fail(httpError(413, "body_too_large", `Request body is too large. Limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`));
      return;
    }

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      if (settled) return;
      raw += chunk;
      if (Buffer.byteLength(raw, "utf8") > maxBytes) {
        fail(httpError(413, "body_too_large", `Request body is too large. Limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`));
      }
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
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
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
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

function resolveDataAsset(urlPath) {
  const withoutPrefix = urlPath.replace(/^\/media\/?/, "");
  const cleanPath = normalize(decodeURIComponent(withoutPrefix.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const candidate = resolve(publicDataDir, `./${cleanPath}`);

  if (!candidate.startsWith(publicDataDir)) {
    return null;
  }

  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }

  return null;
}

function sendFile(req, res, filePath, cacheControl) {
  const ext = extname(filePath);
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": cacheControl,
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      ark: Boolean(arkApiKey),
      tasks: tasks.size,
      monitor_mode: monitorMode,
      webhook_ready: monitorMode === "webhook" ? Boolean(callbackBaseUrl) : false,
      data_dir: dataDir,
      max_json_body_bytes: maxJsonBodyBytes,
      max_image_bytes: maxImageBytes,
      artifacts: [...tasks.values()].filter((task) => task.artifactUrl).length,
      covers: [...tasks.values()].filter((task) => task.coverUrl).length,
      input_images: [...tasks.values()].filter((task) => task.inputImagePath).length,
    });
    return;
  }

  if (url.pathname === "/state/tasks.json") {
    if (!existsSync(publicTasksFile)) {
      saveTasks();
    }
    sendFile(req, res, publicTasksFile, "no-store");
    return;
  }

  if (url.pathname.startsWith("/media/")) {
    const dataFile = resolveDataAsset(url.pathname);
    if (!dataFile) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    sendFile(req, res, dataFile, "public, max-age=31536000, immutable");
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
  sendFile(req, res, filePath, ext === ".html" ? "no-cache" : "public, max-age=31536000, immutable");
}).listen(port, "0.0.0.0", () => {
  console.log(`videogen listening on :${port}`);
  console.log(`task store: ${tasksFile}`);
  console.log(`artifact store: ${artifactsDir}`);
  console.log(`task monitor mode: ${monitorMode}`);
});
