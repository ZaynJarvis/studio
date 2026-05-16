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
import { basename, extname, join, normalize, resolve } from "node:path";
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
const configuredArkTitleModel = process.env.ARK_TITLE_MODEL || "";
const arkTitleModels = uniqueTitleModels([
  process.env.ARK_VLM_TITLE_MODEL,
  configuredArkTitleModel && configuredArkTitleModel !== "ep-20260512155127-ngn88" ? configuredArkTitleModel : "",
  "doubao-seed-2-0-pro-260215",
  "doubao-seed-1-6-vision-250815",
]);
const arkTitleTimeoutMs = Number(process.env.ARK_TITLE_TIMEOUT_MS || 20000);
const arkTitleImageFetchTimeoutMs = Number(process.env.ARK_TITLE_IMAGE_FETCH_TIMEOUT_MS || 8000);
const arkTitleMaxImageBytes = Number(process.env.ARK_TITLE_MAX_IMAGE_BYTES || 5 * 1024 * 1024);
const monitorMode = process.env.TASK_MONITOR_MODE === "webhook" ? "webhook" : "poll";
const callbackBaseUrl = (process.env.ARK_CALLBACK_BASE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
const publicBaseUrl = (process.env.PUBLIC_BASE_URL || process.env.ARK_CALLBACK_BASE_URL || "").replace(/\/+$/, "");
const webhookToken = process.env.ARK_WEBHOOK_TOKEN || process.env.WEBHOOK_TOKEN || process.env.MCP_TOKEN || "";
const webAccessToken = process.env.MCP_TOKEN || "";
const maxImageBytes = Number(process.env.MAX_IMAGE_BYTES || 10 * 1024 * 1024);
const maxJsonBodyBytes = Number(process.env.MAX_JSON_BODY_BYTES || Math.ceil(maxImageBytes * 1.5) + 1024 * 1024);
const maxArtifactBytes = Number(process.env.MAX_ARTIFACT_BYTES || 500 * 1024 * 1024);
const imageRepoBaseUrl = (
  process.env.IMAGE_REPO_BASE_URL ||
  process.env.IMAGEREPO_BASE_URL ||
  "https://image.zaynjarvis.com"
).replace(/\/+$/, "");
const imageRepoUploadKey = process.env.IMAGE_REPO_UPLOAD_KEY || process.env.IMAGEREPO_UPLOAD_KEY || process.env.MCP_TOKEN || "";
const imageRepoTag = (process.env.IMAGE_REPO_TAG || process.env.IMAGEREPO_TAG || "studio").trim();
const shutdownGraceMs = clampInt(process.env.SHUTDOWN_GRACE_MS, 1_000, 60_000, 20_000);

const terminalStatuses = new Set(["succeeded", "failed", "cancelled", "expired"]);
const referenceOnlyImageRoles = new Set([
  "character_reference",
  "character_sheet",
  "infographic",
  "info_graph",
  "model_sheet",
  "reference",
  "reference_only",
  "turnaround",
]);
const sceneFrameImageRoles = new Set([
  "first_frame",
  "image_to_video",
  "i2v",
  "scene_first_frame",
  "scene_frame",
  "source_frame",
]);
const pollTimers = new Map();
const backgroundTimers = new Set();
const backgroundJobs = new Set();
const shutdownControllers = new Set();
const activeSockets = new Set();
const pollInflight = new Set();
const submissionInflight = new Set();
const artifactInflight = new Set();
const coverInflight = new Set();
let isShuttingDown = false;

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
  if (!task.arkTaskId && !terminalStatuses.has(task.status)) {
    scheduleArkSubmit(task.id, 1500);
  } else if (monitorMode === "poll" && !terminalStatuses.has(task.status)) {
    schedulePoll(task.id, 1500);
  }
  if (task.status === "succeeded" && (task.sourceVideoUrl || task.videoUrl) && !task.artifactUrl) {
    scheduleArtifactCache(task.id, "startup");
  }
  if (task.status === "succeeded" && task.artifactPath && !task.coverUrl) {
    scheduleCoverGeneration(task.id, "startup");
  }
  if (shouldRefreshGeneratedTitle(task)) {
    scheduleBackgroundTimer(() => {
      trackBackgroundJob(updateTaskTitle(task.id, inputFromTask(task)).catch((error) => {
        console.warn(`startup title refresh failed ${task.id}`, publicError(error));
      }));
    }, 3000);
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

function normalizeImageRole(value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (referenceOnlyImageRoles.has(raw)) return "character_reference";
  if (sceneFrameImageRoles.has(raw)) return "scene_first_frame";
  return raw;
}

function normalizeUrlList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const urls = [];
  for (const item of values) {
    const url = String(item || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

function uniqueTitleModels(values) {
  const seen = new Set();
  const models = [];
  for (const value of values) {
    const model = String(value || "").trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

function promptMentionsReferenceAsset(prompt) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();
  return [
    /\bcharacter\s+(reference|sheet|design sheet|model sheet|turnaround|infographic)\b/,
    /\b(reference|model|turnaround|design)\s+(image|sheet|board|plate)\b/,
    /\binfo\s*graph(?:ic)?\b/,
    /\bstyle\s+sheet\b/,
    /角色.{0,8}(参考|设定|表|图|三视|转面|信息图)/,
    /(参考图|设定图|角色表|三视图|转面图|信息图|信息图表)/,
  ].some((pattern) => pattern.test(lower) || pattern.test(text));
}

function promptTreatsImageAsOpeningFrame(prompt) {
  const text = String(prompt || "");
  const lower = text.toLowerCase();
  return [
    /\b(first|opening|initial|starting)\s+(frame|image|shot)\b/,
    /\b(start|starts|begin|begins|open|opens)\s+(with|from)\b/,
    /\banimat(?:e|es|ed|ing)\s+(?:from|the)?\s*(?:reference|character|sheet|infographic|image)/,
    /(首帧|第一帧|开场|开头|起始帧|起始画面)/,
    /(从|以).{0,12}(参考图|设定图|角色表|信息图|首帧|第一帧).{0,12}(开始|开场|生成|动起来)/,
  ].some((pattern) => pattern.test(lower) || pattern.test(text));
}

function referenceWorkflowMessage() {
  return [
    "Character sheets, infographics, turnarounds, and reference boards are identity references, not Seedance first frames.",
    "Pass them as reference_image_url, or use imagegen with thinking to create the actual storyboard/scene frame first and pass that frame as image_url with image_role=\"scene_first_frame\".",
  ].join(" ");
}

function rejectReferenceAsFirstFrame(message) {
  throw httpError(400, "reference_requires_scene_frame", message || referenceWorkflowMessage());
}

function assertVideoPromptDoesNotUseReferenceAsFirstFrame(prompt) {
  if (promptMentionsReferenceAsset(prompt) && promptTreatsImageAsOpeningFrame(prompt)) {
    rejectReferenceAsFirstFrame("The prompt appears to describe a character sheet/infographic/reference board as the opening or first frame. Rewrite the video prompt around the real scene action, and generate the scene frame with imagegen before creating the video task.");
  }
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

function shouldRefreshGeneratedTitle(task) {
  const title = String(task?.title || "").trim().toLowerCase();
  if (title !== "untitled take") return false;

  const hasImages = Boolean(task.inputImageUrl || task.lastFrameImageUrl)
    || normalizeUrlList(task.referenceImageUrls || task.referenceImageUrl).length > 0;
  if (!hasImages) return false;

  const createdAt = Number(task.createdAt || 0);
  return !createdAt || Date.now() - createdAt < 7 * 24 * 60 * 60 * 1000;
}

function cleanGeneratedTitle(text, fallback) {
  return limitTitle(text, limitTitle(fallback));
}

function titleImageUrls(input) {
  return normalizeUrlList([
    input.imageUrl,
    input.lastFrameImageUrl,
    ...normalizeUrlList(input.referenceImageUrls),
  ]).slice(0, 4);
}

function mimeFromImageUrl(url) {
  const ext = extname(new URL(url, "https://local.invalid").pathname).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function titleImageDataUrl(imageUrl, signal = undefined) {
  const raw = String(imageUrl || "").trim();
  if (!raw || raw.startsWith("data:")) return raw;
  if (!/^https?:\/\//i.test(raw)) return raw;

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(), arkTitleImageFetchTimeoutMs);
  timeout.unref?.();

  try {
    const response = await fetch(raw, { signal: controller.signal });
    if (!response.ok) return raw;

    const contentType = String(response.headers.get("content-type") || mimeFromImageUrl(raw)).split(";")[0].trim() || "image/jpeg";
    if (!contentType.startsWith("image/")) return raw;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > arkTitleMaxImageBytes) return raw;
    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch (error) {
    console.warn("title image fetch failed", publicError(error));
    return raw;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
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

async function generateTaskTitle(input, signal = undefined) {
  const fallback = "Untitled take";
  if (!arkTitleModels.length) return fallback;

  const controller = new AbortController();
  const abortTitle = () => controller.abort();
  signal?.addEventListener("abort", abortTitle, { once: true });
  const timeout = setTimeout(() => controller.abort(), arkTitleTimeoutMs);
  timeout.unref?.();

  const createTitle = async (model, imageUrls) => {
    const content = [{
      type: "input_text",
      text: [
        "Create a short production title for this video generation task.",
        imageUrls.length
          ? "Use the attached image(s) as the primary source; base the title on visible subject, setting, action, or mood."
          : "No image is attached, so infer a concise visual title from the prompt without copying it.",
        "Return only the title, no quotes, no prefix, and do not copy or truncate the prompt.",
        "If the prompt is Chinese, use Chinese and keep it 4 to 10 characters. Otherwise use English and keep it 2 to 5 words.",
        `Video prompt: ${input.prompt}`,
      ].join("\n"),
    }];

    for (const imageUrl of imageUrls) {
      content.push({ type: "input_image", image_url: imageUrl, detail: "low" });
    }

    const raw = await arkFetch("/responses", {
      method: "POST",
      signal: controller.signal,
      body: JSON.stringify({
        model,
        input: [{ role: "user", content }],
      }),
    });
    return cleanGeneratedTitle(extractResponseText(raw), fallback);
  };

  try {
    const imageUrls = await Promise.all(titleImageUrls(input).map((url) => titleImageDataUrl(url, controller.signal)));

    for (const model of arkTitleModels) {
      try {
        if (imageUrls.length) {
          const title = await createTitle(model, imageUrls);
          if (title !== fallback) return title;
          console.warn(`vlm title generation returned no title with ${model}; retrying text-only`);
        }

        const title = await createTitle(model, []);
        if (title !== fallback || !imageUrls.length) return title;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        console.warn(`title generation failed with ${model}`, publicError(error));
      }
    }

    return fallback;
  } catch (error) {
    console.warn("title generation failed", publicError(error));
    return fallback;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortTitle);
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

function versionedLocalMediaUrl(path, version) {
  const raw = String(path || "");
  if (!raw) return null;
  if (!raw.startsWith("/media/")) return raw;
  if (!version) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}v=${encodeURIComponent(String(version))}`;
}

function publicVideoUrl(task) {
  if (task.artifactUrl) {
    return versionedLocalMediaUrl(task.artifactUrl, task.artifactCachedAt || task.updatedAt || task.finishedAt);
  }
  return task.videoUrl || null;
}

function publicThumbUrl(value) {
  const raw = String(value || "");
  if (!raw || raw.startsWith("data:")) return null;
  if (raw.length > 2048) return null;
  return raw;
}

function publicTaskThumbUrl(task) {
  if (task.coverUrl) {
    return publicThumbUrl(versionedLocalMediaUrl(task.coverUrl, task.coverGeneratedAt || task.updatedAt || task.finishedAt));
  }

  const raw = String(task.thumb || "");
  if (!raw) return null;
  if (task.inputImageUrl && raw === String(task.inputImageUrl)) return null;
  if (task.lastFrameImageUrl && raw === String(task.lastFrameImageUrl)) return null;
  if (task.referenceImageUrl && raw === String(task.referenceImageUrl)) return null;
  if (normalizeUrlList(task.referenceImageUrls).includes(raw)) return null;
  return publicThumbUrl(raw);
}

function publicMediaUrl(path, baseUrl = publicBaseUrl) {
  if (!path) return null;
  if (String(path).startsWith("http://") || String(path).startsWith("https://")) return path;
  if (!baseUrl) return path;
  return new URL(path, baseUrl).toString();
}

function requestPublicBaseUrl(req) {
  const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
  const host = forwardedHost || String(req.headers.host || "").split(",")[0].trim();
  if (!host) return "";

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const proto = forwardedProto || (/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host) ? "http" : "https");
  try {
    return new URL(`${proto}://${host}`).origin;
  } catch {
    return "";
  }
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
    artifact_url: task.artifactUrl
      ? versionedLocalMediaUrl(task.artifactUrl, task.artifactCachedAt || task.updatedAt || task.finishedAt)
      : null,
    artifact_status: task.artifactStatus || (task.artifactUrl ? "ready" : null),
    artifact_bytes: task.artifactBytes || null,
    artifact_error: task.artifactError || null,
    cover_url: task.coverUrl
      ? versionedLocalMediaUrl(task.coverUrl, task.coverGeneratedAt || task.updatedAt || task.finishedAt)
      : null,
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
    image_role: task.imageRole || (task.inputImageUrl ? "scene_first_frame" : task.referenceImageUrl ? "character_reference" : "none"),
    image_id: task.imageId || null,
    source_frame_url: publicMediaUrl(task.inputImageUrl) || null,
    last_frame_url: publicMediaUrl(task.lastFrameImageUrl) || null,
    reference_image_url: publicMediaUrl(task.inputImageUrl) || null,
    character_reference_url: publicMediaUrl(task.referenceImageUrl) || null,
    character_reference_urls: normalizeUrlList(task.referenceImageUrls || task.referenceImageUrl).map((url) => publicMediaUrl(url)),
    character_reference_bytes: task.referenceImageBytes || null,
    reference_image_bytes: task.inputImageBytes || null,
    last_frame_bytes: task.lastFrameImageBytes || null,
    thumb: publicTaskThumbUrl(task),
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

function decodeDataImageUrl(value, label = "Image") {
  const match = String(value || "").match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-zA-Z0-9+/=\s]+)$/i);
  if (!match) return null;

  const mime = match[1].toLowerCase().replace("image/jpg", "image/jpeg");
  const ext = mime === "image/png" ? ".png" : mime === "image/webp" ? ".webp" : ".jpg";
  const base64 = match[2].replace(/\s+/g, "");
  const buffer = Buffer.from(base64, "base64");

  if (!buffer.length) {
    throw httpError(400, "image_invalid", `${label} data is empty.`);
  }
  if (buffer.length > maxImageBytes) {
    throw httpError(413, "image_too_large", `${label} is larger than MAX_IMAGE_BYTES.`);
  }

  return { buffer, mime, ext };
}

function persistInputImage(imageUrl, baseUrl = publicBaseUrl, label = "Reference image") {
  if (!imageUrl || !String(imageUrl).startsWith("data:")) return null;
  const decoded = decodeDataImageUrl(imageUrl, label);
  if (!decoded) {
    throw httpError(400, "image_invalid", `${label} must be a JPEG, PNG, or WEBP data URL.`);
  }

  const mediaBaseUrl = baseUrl || publicBaseUrl;
  if (!mediaBaseUrl) {
    throw httpError(500, "public_base_url_missing", "PUBLIC_BASE_URL or a public request host is required to upload inline images.");
  }

  const filename = `${randomUUID()}${decoded.ext}`;
  const finalPath = join(inputsDir, filename);
  writeFileSync(finalPath, decoded.buffer);

  const mediaPath = `/media/inputs/${filename}`;
  return {
    url: publicMediaUrl(mediaPath, mediaBaseUrl),
    mediaPath,
    path: `inputs/${filename}`,
    bytes: decoded.buffer.length,
    mime: decoded.mime,
  };
}

function assertImageRepoConfigured() {
  if (!imageRepoBaseUrl) {
    throw httpError(500, "image_repo_missing", "IMAGE_REPO_BASE_URL is required for image uploads.");
  }
  if (!imageRepoUploadKey) {
    throw httpError(500, "image_repo_key_missing", "IMAGE_REPO_UPLOAD_KEY is required for image uploads.");
  }
}

async function uploadImageToRepo(imageUrl, name, label = "Image") {
  if (!imageUrl || !String(imageUrl).startsWith("data:")) return null;
  const decoded = decodeDataImageUrl(imageUrl, label);
  if (!decoded) {
    throw httpError(400, "image_invalid", `${label} must be a JPEG, PNG, or WEBP data URL.`);
  }

  assertImageRepoConfigured();

  const filename = cleanImageUploadName(name, decoded.ext);
  const form = new FormData();
  form.append("image", new Blob([decoded.buffer], { type: decoded.mime }), filename);
  if (imageRepoTag) form.append("tag", imageRepoTag);

  const response = await fetch(`${imageRepoBaseUrl}/api/upload`, {
    method: "POST",
    headers: {
      "x-upload-key": imageRepoUploadKey,
    },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw httpError(
      response.status || 502,
      payload?.error?.code || "image_repo_upload_failed",
      payload?.error?.message || payload?.error || `Image repository upload failed with HTTP ${response.status}.`,
      payload
    );
  }
  if (!payload?.url) {
    throw httpError(502, "image_repo_bad_response", "Image repository did not return a URL.", payload);
  }

  return {
    url: payload.url,
    mediaPath: payload.url,
    path: null,
    key: payload.key || null,
    bytes: payload.size ?? decoded.buffer.length,
    mime: payload.contentType || decoded.mime,
    tag: payload.tag || imageRepoTag || "",
    duplicate: Boolean(payload.duplicate),
    provider: "imagerepo",
  };
}

function cleanImageUploadName(name, fallbackExt) {
  const clean = String(name || "")
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\-() ]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  if (clean) return clean;
  return `image${fallbackExt || ".jpg"}`;
}

function uploadedImagePayload(persisted, name) {
  const file = basename(persisted.path || persisted.key || "");
  return {
    id: `i_${file.replace(/\.[^.]+$/, "")}`,
    name: cleanImageUploadName(name, extname(file) || ".jpg"),
    src: persisted.url,
    url: persisted.url,
    media_path: persisted.mediaPath,
    path: persisted.path,
    key: persisted.key || null,
    tag: persisted.tag || null,
    provider: persisted.provider || "local",
    duplicate: Boolean(persisted.duplicate),
    bytes: persisted.bytes,
    mime: persisted.mime,
    added_at: Date.now(),
  };
}

function imageTimestamp(value) {
  const ts = Date.parse(value || "");
  return Number.isFinite(ts) ? ts : Date.now();
}

function repoImagePayload(image) {
  const key = String(image?.key || "");
  const url = String(image?.url || "");
  const tag = String(image?.tag || imageRepoTag || "");
  const file = basename(key || new URL(url || "https://local.invalid/image").pathname);
  const safeId = [tag, file || url]
    .filter(Boolean)
    .join("_")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || randomUUID();
  const addedAt = imageTimestamp(image?.lastModified || image?.last_modified || image?.createdAt || image?.created_at);

  return {
    id: `i_repo_${safeId}`,
    name: image?.name || image?.filename || `${tag || "image"}-${(file || safeId).slice(0, 10)}`,
    src: url,
    url,
    media_path: url,
    path: null,
    key: key || null,
    tag: tag || null,
    provider: "imagerepo",
    cloud: true,
    bytes: image?.size ?? image?.bytes ?? null,
    mime: image?.contentType || image?.content_type || null,
    added_at: addedAt,
    addedAt,
  };
}

async function listImagesFromRepo({ limit = 100, cursor = "", tag = imageRepoTag } = {}) {
  assertImageRepoConfigured();

  const endpoint = new URL(`${imageRepoBaseUrl}/api/images`);
  endpoint.searchParams.set("limit", String(limit));
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  if (tag) endpoint.searchParams.set("tag", tag);

  const response = await fetch(endpoint, {
    headers: {
      "x-upload-key": imageRepoUploadKey,
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw httpError(
      response.status || 502,
      payload?.error?.code || "image_repo_list_failed",
      payload?.error?.message || payload?.error || `Image repository list failed with HTTP ${response.status}.`,
      payload
    );
  }

  return {
    images: Array.isArray(payload.images) ? payload.images.map(repoImagePayload) : [],
    nextCursor: payload.nextCursor || null,
    total: payload.total ?? null,
    tag,
    provider: "imagerepo",
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
  if (isShuttingDown) return;
  if (!task || task.status !== "succeeded" || task.artifactUrl || artifactInflight.has(id)) return;
  if (!(task.sourceVideoUrl || task.videoUrl)) return;

  scheduleBackgroundTimer(() => {
    trackBackgroundJob(cacheTaskArtifact(id, reason).catch((error) => {
      console.error(`artifact cache failed ${id}`, publicError(error));
    }));
  }, 0);
}

function scheduleCoverGeneration(id, reason = "task") {
  const task = tasks.get(id);
  if (isShuttingDown) return;
  if (!task || task.status !== "succeeded" || task.coverUrl || coverInflight.has(id)) return;
  if (!task.artifactPath) return;

  scheduleBackgroundTimer(() => {
    trackBackgroundJob(generateTaskCover(id, reason).catch((error) => {
      console.error(`cover generation failed ${id}`, publicError(error));
    }));
  }, 0);
}

async function cacheTaskArtifact(id, reason = "task") {
  const task = tasks.get(id);
  if (isShuttingDown) return;
  if (!task || task.status !== "succeeded" || task.artifactUrl || artifactInflight.has(id)) return;

  const sourceUrl = task.sourceVideoUrl || task.videoUrl;
  if (!sourceUrl || sourceUrl.startsWith("/media/")) return;

  artifactInflight.add(id);
  const { controller, release } = createShutdownController();
  let tmpPath = null;

  try {
    task.artifactStatus = "caching";
    task.artifactError = null;
    task.updatedAt = Date.now();
    saveTasks();

    const res = await fetch(sourceUrl, { signal: controller.signal });
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

    await pipeline(Readable.fromWeb(res.body), counter, createWriteStream(tmpPath), { signal: controller.signal });
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
    if (isShutdownAbort(error)) {
      task.artifactStatus = null;
      task.artifactError = null;
      task.updatedAt = Date.now();
      saveTasks();
      return;
    }
    task.artifactStatus = "failed";
    task.artifactError = publicError(error);
    task.updatedAt = Date.now();
    saveTasks();
    throw error;
  } finally {
    release();
    artifactInflight.delete(id);
  }
}

async function generateTaskCover(id, reason = "task") {
  const task = tasks.get(id);
  if (isShuttingDown) return;
  if (!task || task.status !== "succeeded" || task.coverUrl || coverInflight.has(id)) return;

  const artifactPath = task.artifactPath ? resolve(publicDataDir, task.artifactPath) : null;
  if (!artifactPath || !artifactPath.startsWith(publicDataDir) || !existsSync(artifactPath)) return;

  coverInflight.add(id);
  const { controller, release } = createShutdownController();
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
      ], { timeout: 30_000, maxBuffer: 1024 * 1024, signal: controller.signal });
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
    if (isShutdownAbort(error)) {
      task.coverStatus = null;
      task.coverError = null;
      task.updatedAt = Date.now();
      saveTasks();
      return;
    }
    task.coverStatus = "failed";
    task.coverError = publicError(error);
    task.updatedAt = Date.now();
    saveTasks();
    throw error;
  } finally {
    release();
    coverInflight.delete(id);
  }
}

async function normalizeGenerateInput(input, mediaBaseUrl = publicBaseUrl) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) {
    throw httpError(400, "prompt_required", "Prompt is required.");
  }
  assertVideoPromptDoesNotUseReferenceAsFirstFrame(prompt);

  let rawImageUrl = input.image_url || input.imageUrl || input.image?.src || null;
  const rawLastFrameImageUrl = input.last_frame_image_url
    || input.lastFrameImageUrl
    || input.last_image_url
    || input.lastImageUrl
    || null;
  let rawReferenceImageUrls = normalizeUrlList([
    ...normalizeUrlList(input.reference_image_url || input.referenceImageUrl || input.character_reference_url || input.characterReferenceUrl),
    ...normalizeUrlList(input.reference_image_urls || input.referenceImageUrls || input.character_reference_urls || input.characterReferenceUrls),
  ]);

  const requestedImageRole = normalizeImageRole(input.image_role || input.imageRole || input.image?.role);
  if (requestedImageRole && requestedImageRole !== "scene_first_frame" && requestedImageRole !== "character_reference") {
    throw httpError(400, "image_role_invalid", "image_role must be scene_first_frame or character_reference.");
  }
  const inferredReferenceRole = !requestedImageRole && rawImageUrl && rawReferenceImageUrls.length === 0 && promptMentionsReferenceAsset(prompt);
  if (rawImageUrl && (requestedImageRole === "character_reference" || inferredReferenceRole)) {
    rawReferenceImageUrls = normalizeUrlList([...rawReferenceImageUrls, rawImageUrl]);
    rawImageUrl = null;
  }
  if (rawLastFrameImageUrl && !rawImageUrl) {
    throw httpError(400, "last_frame_requires_first_frame", "last_frame_image_url requires image_url as the first frame.");
  }
  if ((rawImageUrl || rawLastFrameImageUrl) && rawReferenceImageUrls.length > 0) {
    throw httpError(400, "mixed_frame_and_reference_not_supported", [
      "Ark video generation does not allow first/last frame content to be mixed with reference media content.",
      "For controlled character video, first use imagegen with thinking to create a scene frame from the character reference, then call create_video_task with only that scene frame as image_url.",
      "For Ark reference-guided generation, pass only reference_image_url and no image_url.",
    ].join(" "));
  }
  const persistedImage = await uploadImageToRepo(rawImageUrl, input.image?.name || input.image_name || input.imageName || "first-frame.jpg", "First frame image");
  const persistedLastFrameImage = await uploadImageToRepo(rawLastFrameImageUrl, input.last_frame_name || input.lastFrameName || "last-frame.jpg", "Last frame image");
  const persistedReferenceImages = await Promise.all(rawReferenceImageUrls.map((url, index) => (
    uploadImageToRepo(url, input.reference_image_names?.[index] || input.referenceImageNames?.[index] || `reference-${index + 1}.jpg`, "Reference image")
  )));
  const imageUrl = persistedImage?.url || rawImageUrl;
  const lastFrameImageUrl = persistedLastFrameImage?.url || rawLastFrameImageUrl;
  const referenceImageUrls = rawReferenceImageUrls.map((url, index) => persistedReferenceImages[index]?.url || url);
  const storedReferenceImageUrls = rawReferenceImageUrls.map((url, index) => persistedReferenceImages[index]?.mediaPath || referenceImageUrls[index]);
  const rawThumb = input.thumb || null;
  const safeThumb = String(rawThumb || "").startsWith("data:") ? null : rawThumb;
  const thumb = safeThumb
    && safeThumb !== rawImageUrl
    && safeThumb !== imageUrl
    && safeThumb !== rawLastFrameImageUrl
    && safeThumb !== lastFrameImageUrl
    && !rawReferenceImageUrls.includes(safeThumb)
    && !referenceImageUrls.includes(safeThumb)
    ? safeThumb
    : null;

  const mode = imageUrl ? "i2v" : referenceImageUrls.length ? "ref2v" : "t2v";
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
    lastFrameImagePath: persistedLastFrameImage?.path || null,
    lastFrameImageUrl: persistedLastFrameImage?.mediaPath || lastFrameImageUrl || null,
    lastFrameImageBytes: persistedLastFrameImage?.bytes || null,
    lastFrameImageMime: persistedLastFrameImage?.mime || null,
    referenceImagePath: persistedReferenceImages[0]?.path || null,
    referenceImagePaths: persistedReferenceImages.map((item) => item?.path || null).filter(Boolean),
    referenceImageUrl: storedReferenceImageUrls[0] || null,
    referenceImageUrls: storedReferenceImageUrls,
    referenceImageBytes: persistedReferenceImages[0]?.bytes || null,
    referenceImageMimes: persistedReferenceImages.map((item) => item?.mime || null),
    imageRole: imageUrl ? "scene_first_frame" : referenceImageUrls.length ? "character_reference" : "none",
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
    title: "Untitled take",
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
    content.push({
      type: "image_url",
      image_url: { url: input.imageUrl },
      role: "first_frame",
    });
  }
  if (input.lastFrameImageUrl) {
    content.push({
      type: "image_url",
      image_url: { url: input.lastFrameImageUrl },
      role: "last_frame",
    });
  }
  for (const referenceImageUrl of input.referenceImageUrls || []) {
    content.push({
      type: "image_url",
      image_url: { url: referenceImageUrl },
      role: "reference_image",
    });
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

async function createArkTask(input, localTaskId = randomUUID(), signal = undefined) {
  const body = toArkBody(input, localTaskId);
  const result = await arkFetch("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });

  if (!result.id) {
    throw httpError(502, "upstream_bad_response", "Ark did not return a task id.");
  }

  return { localTaskId, arkTaskId: result.id };
}

async function getArkTask(taskId, signal = undefined) {
  return arkFetch(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, { signal });
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
  if (isShuttingDown) return;
  const task = tasks.get(id);
  if (!task || terminalStatuses.has(task.status) || pollInflight.has(id)) return;

  pollInflight.add(id);
  const { controller, release } = createShutdownController();
  try {
    const raw = await getArkTask(task.arkTaskId, controller.signal);
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
    if (isShutdownAbort(error)) return;

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
    release();
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
  if (isShuttingDown) return;
  if (!task || terminalStatuses.has(task.status) || pollTimers.has(id)) return;
  const timer = setTimeout(() => {
    pollTimers.delete(id);
    if (isShuttingDown) return;
    trackBackgroundJob(pollTask(id).catch((error) => {
      console.error(`task poll failed ${id}`, publicError(error));
    }));
  }, delayMs);
  timer.unref?.();
  pollTimers.set(id, timer);
}

async function handleGenerate(req, res) {
  const task = await createVideoTask(await readJson(req), publicBaseUrl || requestPublicBaseUrl(req));
  sendJson(res, 202, publicTask(task));
}

async function handleUploadImage(req, res) {
  const input = await readJson(req);
  const image = input.image || input.image_url || input.data_url || input.src;
  if (!image) {
    throw httpError(400, "image_required", "Image data URL is required.");
  }

  const persisted = await uploadImageToRepo(image, input.name || input.filename || "image.jpg", "Image");
  if (!persisted) {
    throw httpError(400, "image_invalid", "Image must be a JPEG, PNG, or WEBP data URL.");
  }

  sendJson(res, 201, { image: uploadedImagePayload(persisted, input.name || input.filename) });
}

async function handleListImages(req, res, url) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 100);
  const cursor = url.searchParams.get("cursor") || "";
  const tag = url.searchParams.has("tag") ? String(url.searchParams.get("tag") || "").trim() : imageRepoTag;
  sendJson(res, 200, await listImagesFromRepo({ limit, cursor, tag }));
}

async function createVideoTask(rawInput, mediaBaseUrl = publicBaseUrl) {
  if (isShuttingDown) {
    throw httpError(503, "server_shutting_down", "Server is shutting down. Retry on the next deployment.");
  }

  const input = await normalizeGenerateInput(rawInput, mediaBaseUrl);
  const localTaskId = randomUUID();
  const now = Date.now();
  const id = localTaskId;
  const task = {
    id,
    arkTaskId: null,
    status: "queued",
    progress: monitorMode === "poll" ? 1 : null,
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
    lastFrameImagePath: input.lastFrameImagePath,
    lastFrameImageUrl: input.lastFrameImageUrl,
    lastFrameImageBytes: input.lastFrameImageBytes,
    lastFrameImageMime: input.lastFrameImageMime,
    referenceImagePath: input.referenceImagePath,
    referenceImagePaths: input.referenceImagePaths,
    referenceImageUrl: input.referenceImageUrl,
    referenceImageUrls: input.referenceImageUrls,
    referenceImageBytes: input.referenceImageBytes,
    referenceImageMimes: input.referenceImageMimes,
    imageRole: input.imageRole,
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
    submissionStatus: "pending",
  };

  tasks.set(id, task);
  saveTasks();
  scheduleArkSubmit(id, 0);
  return task;
}

function inputFromTask(task) {
  return {
    prompt: task.prompt,
    imageUrl: publicMediaUrl(task.inputImageUrl) || null,
    lastFrameImageUrl: publicMediaUrl(task.lastFrameImageUrl) || null,
    referenceImageUrls: normalizeUrlList(task.referenceImageUrls || task.referenceImageUrl).map((url) => publicMediaUrl(url)),
    resolution: task.resolution,
    aspect: task.aspect,
    duration: task.duration,
    camera: task.camera,
    seed: task.seed,
    arkModel: task.arkModel || resolveModel(),
  };
}

function scheduleArkSubmit(id, delayMs = 0) {
  const task = tasks.get(id);
  if (isShuttingDown) return;
  if (!task || task.arkTaskId || terminalStatuses.has(task.status) || submissionInflight.has(id)) return;

  scheduleBackgroundTimer(() => {
    trackBackgroundJob(submitArkTask(id).catch((error) => {
      console.error(`task submit failed ${id}`, publicError(error));
    }));
  }, delayMs);
}

async function updateTaskTitle(id, input, signal = undefined) {
  const title = await generateTaskTitle(input, signal);
  const task = tasks.get(id);
  if (!task || task.title === title) return;

  task.title = title;
  task.updatedAt = Date.now();
  saveTasks();
}

async function submitArkTask(id) {
  if (isShuttingDown) return;
  const task = tasks.get(id);
  if (!task || task.arkTaskId || terminalStatuses.has(task.status) || submissionInflight.has(id)) return;

  submissionInflight.add(id);
  const { controller, release } = createShutdownController();
  try {
    task.submissionStatus = "submitting";
    task.lastSubmitError = null;
    task.updatedAt = Date.now();
    saveTasks();

    const input = inputFromTask(task);
    updateTaskTitle(id, input, controller.signal).catch((error) => {
      console.warn(`title update failed ${id}`, publicError(error));
    });

    const { arkTaskId } = await createArkTask(input, id, controller.signal);
    const latest = tasks.get(id);
    if (!latest) return;

    latest.arkTaskId = arkTaskId;
    latest.status = normalizeStatus(latest.status || "queued");
    latest.submissionStatus = "submitted";
    latest.updatedAt = Date.now();
    latest.pollCount = latest.pollCount || 0;
    tasks.set(id, latest);
    saveTasks();

    if (monitorMode === "poll") {
      schedulePoll(id, 1500);
    }
    console.log(`task submit: ${id} -> ${arkTaskId}`);
  } catch (error) {
    const failed = tasks.get(id);
    if (isShutdownAbort(error)) {
      if (failed) {
        failed.submissionStatus = "pending";
        failed.lastSubmitError = null;
        failed.updatedAt = Date.now();
        tasks.set(id, failed);
        saveTasks();
      }
      return;
    }

    if (failed) {
      failed.status = "failed";
      failed.error = publicError(error);
      failed.finishedAt = Date.now();
      failed.updatedAt = Date.now();
      failed.submissionStatus = "failed";
      failed.lastSubmitError = publicError(error);
      tasks.set(id, failed);
      saveTasks();
    }
    throw error;
  } finally {
    release();
    submissionInflight.delete(id);
  }
}

async function handleGetTask(req, res, id) {
  const task = tasks.get(id);
  if (!task) {
    sendJson(res, 404, { error: { code: "task_not_found", message: "Task not found." } });
    return;
  }

  if (!task.arkTaskId && !terminalStatuses.has(task.status)) {
    scheduleArkSubmit(id, 0);
  } else if (monitorMode === "poll" && !terminalStatuses.has(task.status) && Date.now() - (task.lastPolledAt || 0) > 4_000) {
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
  if (task.lastFrameImagePath) {
    const lastFrameImagePath = resolve(publicDataDir, task.lastFrameImagePath);
    if (lastFrameImagePath.startsWith(publicDataDir)) {
      try { rmSync(lastFrameImagePath, { force: true }); } catch {}
    }
  }
  for (const rawPath of normalizeUrlList(task.referenceImagePaths || task.referenceImagePath)) {
    const referenceImagePath = resolve(publicDataDir, rawPath);
    if (referenceImagePath.startsWith(publicDataDir)) {
      try { rmSync(referenceImagePath, { force: true }); } catch {}
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

  if (arkTaskId && !task.arkTaskId) {
    task.arkTaskId = arkTaskId;
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

function webAuthorized(req, url) {
  if (!webAccessToken) return true;
  const header = String(req.headers.authorization || "");
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1] || "";
  const queryToken = url.searchParams.get("access_token") || "";
  return bearer === webAccessToken || queryToken === webAccessToken;
}

function mcpTools() {
  return [
    {
      name: "upload_image",
      description: "Upload a JPEG/PNG/WEBP data URL to Studio's image library. The server stores it in imagerepo with IMAGE_REPO_TAG=studio and returns the public image URL.",
      inputSchema: {
        type: "object",
        properties: {
          image: { type: "string", description: "JPEG/PNG/WEBP data URL to upload." },
          data_url: { type: "string", description: "Alias for image." },
          name: { type: "string", description: "Optional filename for the uploaded image." },
        },
        additionalProperties: true,
      },
    },
    {
      name: "create_video_task",
      description: "Create a Studio/Seedance 2.0 Pro video task from text, actual first/last scene frames, or Ark reference image(s). Do not mix first/last-frame inputs with reference-media inputs in one task. Character sheets, info graphs, turnarounds, and reference boards must be passed as reference_image_url(s), never as image_url. For best shot control, use imagegen with thinking to make the real storyboard/scene frame first, then pass that scene frame as image_url.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Video prompt for the real scene action. Do not describe a character sheet/info graph/reference board as the opening frame or first frame." },
          image_url: { type: "string", description: "Optional actual scene first-frame image URL for image-to-video. Sent to Ark with role=first_frame. Never pass a character sheet, info graph, turnaround, or reference board here. Do not combine with reference_image_url(s); Ark rejects mixed first/last-frame and reference-media inputs." },
          last_frame_image_url: { type: "string", description: "Optional actual final scene frame image URL. Sent to Ark with role=last_frame. Requires image_url and cannot be combined with reference_image_url(s)." },
          image_role: { type: "string", enum: ["scene_first_frame", "character_reference"], description: "Role of image_url. Use scene_first_frame for an actual opening scene frame; use character_reference only when intentionally passing a character sheet/info graph as reference input." },
          reference_image_url: { type: "string", description: "Optional character reference image URL. Sent to Ark as an image_url content item with role=reference_image, not as the first frame. Do not combine with image_url/last_frame_image_url; use imagegen to bake the character into a scene frame when first-frame control is needed." },
          reference_image_urls: { type: "array", items: { type: "string" }, description: "Optional multiple character reference image URLs. Each is sent with role=reference_image. Do not combine with first/last frame images." },
          image_id: { type: "string", description: "Optional reference image id." },
          thumb: { type: "string", description: "Optional preview thumbnail URL. Do not pass the character reference image as the thumbnail." },
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
  if (name === "upload_image") {
    const image = args.image || args.data_url || args.image_url || args.src;
    if (!image) {
      throw httpError(400, "image_required", "Image data URL is required.");
    }
    const uploaded = await uploadImageToRepo(image, args.name || args.filename || "image.jpg", "Image");
    if (!uploaded) {
      throw httpError(400, "image_invalid", "Image must be a JPEG, PNG, or WEBP data URL.");
    }
    return mcpTextResult({ image: uploadedImagePayload(uploaded, args.name || args.filename) });
  }

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
    if (url.pathname === "/api/auth/config") {
      sendJson(res, 200, { authRequired: Boolean(webAccessToken) });
      return true;
    }

    if (url.pathname === "/api/auth/verify") {
      if (!webAuthorized(req, url)) {
        sendJson(res, 401, { error: { code: "unauthorized", message: "Invalid access token." } });
      } else {
        sendJson(res, 200, { ok: true });
      }
      return true;
    }

    if (url.pathname === "/mcp") {
      await handleMcp(req, res, url);
      return true;
    }

    if (url.pathname === "/api/ark/webhook" && req.method === "POST") {
      await handleArkWebhook(req, res, url);
      return true;
    }

    if (url.pathname.startsWith("/api/") && !webAuthorized(req, url)) {
      sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in to continue." } });
      return true;
    }

    if (url.pathname === "/api/generate" && req.method === "POST") {
      await handleGenerate(req, res);
      return true;
    }

    if ((url.pathname === "/api/images" || url.pathname === "/api/images/upload") && req.method === "POST") {
      await handleUploadImage(req, res);
      return true;
    }

    if (url.pathname === "/api/images" && req.method === "GET") {
      await handleListImages(req, res, url);
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

function parseRangeHeader(rangeHeader, size) {
  const match = String(rangeHeader || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { invalid: true };

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { invalid: true };
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number.parseInt(startRaw, 10);
  const end = endRaw ? Number.parseInt(endRaw, 10) : size - 1;

  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end < start) {
    return { invalid: true };
  }

  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function sendFile(req, res, filePath, cacheControl) {
  const ext = extname(filePath);
  const { size } = statSync(filePath);
  const baseHeaders = {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": cacheControl,
    "accept-ranges": "bytes",
  };

  const range = parseRangeHeader(req.headers.range, size);
  if (range?.invalid) {
    res.writeHead(416, {
      ...baseHeaders,
      "content-range": `bytes */${size}`,
      "content-length": "0",
    });
    res.end();
    return;
  }

  if (range) {
    const chunkSize = range.end - range.start + 1;
    res.writeHead(206, {
      ...baseHeaders,
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
      "content-length": String(chunkSize),
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    ...baseHeaders,
    "content-length": String(size),
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
}

function scheduleBackgroundTimer(callback, delayMs) {
  if (isShuttingDown) return null;
  const timer = setTimeout(() => {
    backgroundTimers.delete(timer);
    if (!isShuttingDown) callback();
  }, delayMs);
  timer.unref?.();
  backgroundTimers.add(timer);
  return timer;
}

function trackBackgroundJob(promise) {
  const tracked = Promise.resolve(promise).finally(() => {
    backgroundJobs.delete(tracked);
  });
  backgroundJobs.add(tracked);
  return tracked;
}

function createShutdownController() {
  const controller = new AbortController();
  shutdownControllers.add(controller);
  return {
    controller,
    release: () => shutdownControllers.delete(controller),
  };
}

function isShutdownAbort(error) {
  return isShuttingDown && (error?.name === "AbortError" || error?.code === "ABORT_ERR");
}

function clearScheduledWork() {
  for (const timer of pollTimers.values()) {
    clearTimeout(timer);
  }
  pollTimers.clear();

  for (const timer of backgroundTimers) {
    clearTimeout(timer);
  }
  backgroundTimers.clear();
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function closeServer(server) {
  return new Promise((resolveClose) => {
    server.close((error) => {
      if (error) {
        console.error("server close failed", publicError(error));
      }
      resolveClose();
    });
  });
}

async function shutdown(signal) {
  if (isShuttingDown) {
    console.warn(`received ${signal} while shutdown is already in progress; forcing open connections closed`);
    server.closeAllConnections?.();
    for (const socket of activeSockets) {
      socket.destroy();
    }
    return;
  }

  isShuttingDown = true;
  console.log(`received ${signal}; starting graceful shutdown with ${shutdownGraceMs}ms grace`);

  clearScheduledWork();
  for (const controller of shutdownControllers) {
    controller.abort();
  }

  try {
    saveTasks();
  } catch (error) {
    console.error("failed to save tasks during shutdown", publicError(error));
  }

  server.closeIdleConnections?.();

  const forceCloseTimer = setTimeout(() => {
    console.warn(`shutdown grace exceeded; forcing ${activeSockets.size} open connection(s) closed`);
    server.closeAllConnections?.();
    for (const socket of activeSockets) {
      socket.destroy();
    }
  }, shutdownGraceMs);

  await Promise.race([
    Promise.allSettled([
      closeServer(server),
      Promise.allSettled([...backgroundJobs]),
    ]),
    wait(shutdownGraceMs),
  ]);

  clearTimeout(forceCloseTimer);

  try {
    saveTasks();
  } catch (error) {
    console.error("failed to save tasks after shutdown", publicError(error));
  }

  console.log("graceful shutdown complete");
  process.exit(0);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (isShuttingDown) {
    res.setHeader("connection", "close");
    sendJson(res, 503, { error: { code: "server_shutting_down", message: "Server is shutting down." } });
    return;
  }

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
      image_repo: {
        base_url: imageRepoBaseUrl,
        tag: imageRepoTag || null,
        upload_key_configured: Boolean(imageRepoUploadKey),
      },
      artifacts: [...tasks.values()].filter((task) => task.artifactUrl).length,
      covers: [...tasks.values()].filter((task) => task.coverUrl).length,
      input_images: [...tasks.values()].filter((task) => task.inputImagePath).length,
      last_frame_images: [...tasks.values()].filter((task) => task.lastFrameImagePath).length,
      reference_images: [...tasks.values()].reduce((total, task) => total + normalizeUrlList(task.referenceImagePaths || task.referenceImagePath).length, 0),
    });
    return;
  }

  if (url.pathname === "/state/tasks.json") {
    if (!webAuthorized(req, url)) {
      sendJson(res, 401, { error: { code: "unauthorized", message: "Sign in to continue." } });
      return;
    }
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
});

server.on("connection", (socket) => {
  activeSockets.add(socket);
  socket.on("close", () => {
    activeSockets.delete(socket);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`videogen listening on :${port}`);
  console.log(`task store: ${tasksFile}`);
  console.log(`artifact store: ${artifactsDir}`);
  console.log(`task monitor mode: ${monitorMode}`);
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error("graceful shutdown failed", publicError(error));
    process.exit(1);
  });
});

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error("graceful shutdown failed", publicError(error));
    process.exit(1);
  });
});
