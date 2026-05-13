import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Icon, DropZone, VideoPlayer, GenerationProgress, useToast } from './components';
import { useStore, useHashRoute, relTime, fmtDate } from './store';
import { authHeader, clearToken, getToken } from './auth';

const HOST_PARAMS = {
  resolutions: ["720p", "1080p", "2K"],
  aspects: ["16:9", "9:16", "1:1"],
  durationMin: 5,
  durationMax: 15,
  cameras: ["fixed", "dynamic"],
  models: [
    { id: "seedance-pro", label: "2.0 Pro", note: "highest quality · up to 2K · multi-shot" },
  ],
};

const ACTIVE_TASK_STATUSES = new Set([
  "created",
  "queued",
  "running",
  "pending",
  "processing",
  "rendering",
  "submitted",
  "scheduled",
  "waiting",
  "not_started",
  "in_queue",
  "in_progress",
  "executing",
  "started",
]);
const TERMINAL_TASK_STATUSES = new Set(["succeeded", "failed", "cancelled", "expired"]);

function isActiveTask(status) {
  return ACTIVE_TASK_STATUSES.has(String(status || "").toLowerCase());
}

function videoPatchFromTask(task, current = {}) {
  const status = task.status || current.status || "queued";
  const monitorMode = task.monitor_mode || current.monitorMode || "poll";
  const progress = task.progress ?? (monitorMode === "webhook" && isActiveTask(status) ? null : current.progress ?? 0);
  const remoteThumb = task.cover_url || (task.thumb && !String(task.thumb).startsWith("data:") ? task.thumb : "");
  const referenceImageUrl = task.source_frame_url || task.reference_image_url || current.referenceImageUrl || null;

  return {
    id: current.id || task.id,
    taskId: task.id,
    arkTaskId: task.task_id,
    status,
    progress,
    monitorMode,
    coverUrl: task.cover_url || current.coverUrl || null,
    coverStatus: task.cover_status || current.coverStatus || null,
    title: task.title || current.title || "Untitled take",
    prompt: task.prompt || current.prompt || "",
    src: task.video_url || current.src || "",
    thumb: remoteThumb || "",
    referenceImageUrl,
    duration: task.duration || current.duration || 5,
    resolution: task.resolution || current.resolution || "1080p",
    aspect: task.aspect || current.aspect || "16:9",
    model: task.model || current.model || "seedance-pro",
    mode: task.mode || current.mode || "t2v",
    camera: task.camera || current.camera || "dynamic",
    seed: task.seed ?? current.seed ?? 0,
    imageId: task.image_id || current.imageId,
    error: task.error || current.error || null,
    createdAt: task.created_at || current.createdAt || Date.now(),
    updatedAt: task.updated_at || Date.now(),
    finishedAt: task.finished_at || current.finishedAt,
  };
}

function taskRuntimeText(v) {
  if (!isActiveTask(v.status)) return `${v.duration}s · ${v.resolution}`;
  if (v.monitorMode === "poll" && Number.isFinite(v.progress)) return `${Math.round(v.progress)}%`;
  return "rendering";
}

function taskBadgeText(v) {
  const active = isActiveTask(v.status);
  const failed = TERMINAL_TASK_STATUSES.has(v.status) && v.status !== "succeeded";
  if (active && v.monitorMode === "webhook") return "RENDERING";
  if (active || failed) return String(v.status || "queued").toUpperCase();
  return v.mode === "i2v" ? "I→V" : "T→V";
}

function taskSort(a, b) {
  const activeDelta = Number(isActiveTask(b.status)) - Number(isActiveTask(a.status));
  if (activeDelta) return activeDelta;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

async function fetchJson(path, options = {}) {
  const merged = {
    ...options,
    headers: { ...(options.headers || {}), ...authHeader() },
  };
  const res = await fetch(path, merged);
  if (res.status === 401) {
    if (getToken()) {
      clearToken();
      window.location.reload();
    }
    const error = new Error("Session expired. Sign in again.");
    error.status = 401;
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error?.message || `Request failed with HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function deleteRemoteTask(v) {
  const id = v?.taskId || v?.id;
  if (!id || (!v?.taskId && !v?.arkTaskId)) return;

  try {
    await fetchJson(`/api/task/${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (error) {
    if (!String(error.message || "").toLowerCase().includes("not found")) {
      throw error;
    }
  }
}

function isAppleTouchDevice() {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return /iP(hone|ad|od)/.test(ua)
    || /iP(hone|ad|od)/.test(platform)
    || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function canAttemptFileShare() {
  return typeof navigator !== "undefined"
    && typeof navigator.share === "function"
    && typeof navigator.canShare === "function"
    && typeof File === "function";
}

function canShareVideoFile(file) {
  if (!canAttemptFileShare()) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function videoExtensionFromSrc(src) {
  try {
    const ext = new URL(src, window.location.href).pathname.match(/\.(mp4|m4v|mov|webm)$/i)?.[0];
    if (ext) return ext.toLowerCase();
  } catch {
    // Use the default below when the URL cannot be parsed.
  }
  return ".mp4";
}

function videoMimeFromExtension(ext) {
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".webm") return "video/webm";
  return "video/mp4";
}

function videoFileName(v) {
  const fallback = String(v?.taskId || v?.id || "videogen-render").slice(0, 24) || "videogen-render";
  const base = String(v?.title || fallback)
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || fallback;
  return `${base}${videoExtensionFromSrc(v?.src || "")}`;
}

async function fetchVideoFile(src, filename) {
  if (typeof File !== "function") {
    throw new Error("This browser cannot prepare videos for sharing.");
  }

  const res = await fetch(src, { credentials: "same-origin", cache: "force-cache" });
  if (!res.ok) {
    throw new Error(`Video download failed with HTTP ${res.status}`);
  }

  const blob = await res.blob();
  const ext = videoExtensionFromSrc(filename);
  const type = blob.type || videoMimeFromExtension(ext);
  return new File([blob], filename, { type, lastModified: Date.now() });
}

function downloadVideoLink(src, filename) {
  const a = document.createElement("a");
  a.href = src;
  a.download = filename;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ServerTaskSync() {
  const { state, updateVideo, upsertVideo } = useStore();
  const videosRef = useRef(state.videos);

  useEffect(() => {
    videosRef.current = state.videos;
  }, [state.videos]);

  useEffect(() => {
    let stopped = false;
    let timer = null;

    const sync = async () => {
      try {
        const data = await fetchJson("/api/tasks");
        if (stopped) return;

        const remoteTasks = data.tasks || [];
        for (const task of remoteTasks) {
          const local = videosRef.current.find((v) => v.taskId === task.id || v.id === task.id);
          const patch = videoPatchFromTask(task, local || { id: task.id });
          if (local) updateVideo(local.id, patch);
          else upsertVideo(patch);
        }

        const remoteHasActive = remoteTasks.some((task) => isActiveTask(task.status));
        if (remoteHasActive) {
          timer = setTimeout(sync, 3000);
          return;
        }
      } catch {
        // The app can still render seed/local videos if the API is unavailable.
      }

      if (!stopped) {
        const hasActive = videosRef.current.some((v) => isActiveTask(v.status));
        timer = setTimeout(sync, hasActive ? 2500 : 5000);
      }
    };

    sync();
    const syncNow = () => {
      if (timer) clearTimeout(timer);
      sync();
    };
    window.addEventListener("focus", syncNow);
    window.addEventListener("hashchange", syncNow);
    document.addEventListener("visibilitychange", syncNow);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", syncNow);
      window.removeEventListener("hashchange", syncNow);
      document.removeEventListener("visibilitychange", syncNow);
    };
  }, [updateVideo, upsertVideo]);

  return null;
}

export function Nav({ route, navigate }) {
  const items = [
    { path: "/", icon: "home", label: "Home", kbd: "1" },
    { path: "/create", icon: "sparkle", label: "Create", kbd: "2" },
    { path: "/library", icon: "grid", label: "Library", kbd: "3" },
  ];

  return (
    <nav className="nav">
      <div className="nav-brand">
        <span className="dot"></span>
        <span>VIDEOGEN<small>STUDIO · DECK 02</small></span>
      </div>
      <div className="nav-section">Workspace</div>
      <div className="nav-items">
        {items.map((it) => (
          <button key={it.path}
             className={"nav-item" + (route.path === it.path ? " active" : "")}
             onClick={() => navigate(it.path)}>
            <Icon name={it.icon} size={16} />
            <span>{it.label}</span>
            <span className="kbd">{it.kbd}</span>
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }}></div>
      <div style={{ position: "relative", marginTop: "auto", padding: "12px 8px 0" }}>
        <div className="btn" style={{ width: "100%", justifyContent: "flex-start", cursor: "default" }}>
          <Icon name="key" size={14}/>
          <span style={{ flex: 1, textAlign: "left" }}>Ark key</span>
          <span className="mono" style={{
            fontSize: 9, letterSpacing: ".12em", textTransform: "uppercase",
            color: "var(--good)",
          }}>● server</span>
        </div>
      </div>
    </nav>
  );
}

function SectionHeader({ title, sub, count }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", margin: "8px 0 20px", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
        <h2 className="display" style={{ fontSize: 26, margin: 0 }}>{title}</h2>
        {count != null && <span className="mono muted-2" style={{ fontSize: 11, letterSpacing: ".14em" }}>{String(count).padStart(2,"0")}</span>}
      </div>
      <span className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>{sub}</span>
    </div>
  );
}

function VideoCard({ v, onClick, onTemplate }) {
  const active = isActiveTask(v.status);
  const badge = taskBadgeText(v);

  return (
    <article className="video-card" onClick={onClick}>
      <div className="video-thumb">
        {v.thumb
          ? <img src={v.thumb} alt="" loading="lazy"/>
          : <div className={"video-thumb-placeholder" + (active ? " active" : "")}>
              {active && <span className="spinner" />}
            </div>}
        <div className="play"><div className={"play-ic" + (active ? " play-ic-active" : "")}><Icon name={active ? "refresh" : "play"} size={16}/></div></div>
        <div className="video-badge">{badge}</div>
        <div className="video-runtime">{taskRuntimeText(v)}</div>
      </div>
      <div className="video-meta">
        <h3 className="video-title">{v.title}</h3>
        <div className="video-sub">
          <span>{v.model.replace("seedance-", "")}</span>
          <span>·</span>
          <span>{v.aspect}</span>
          <span>·</span>
          <span>{relTime(v.createdAt)}</span>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 9px" }}
            onClick={(e) => { e.stopPropagation(); onTemplate(); }}>
            <Icon name="copy" size={11}/> Use as template
          </button>
        </div>
      </div>
    </article>
  );
}

function PendingEmptyState({ onCreate }) {
  return (
    <div className="queue-empty">
      <div className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 8 }}>
        No pending tasks
      </div>
      <p style={{ margin: "0 0 14px", color: "var(--fg-2)", lineHeight: 1.55 }}>
        New renders appear here immediately after submission. You can close the tab; the server keeps the task record and this list reloads from `/api/tasks`.
      </p>
      <button className="btn btn-primary" onClick={onCreate}>
        <Icon name="plus" size={14}/> New render
      </button>
    </div>
  );
}

function PendingTaskList({ videos, navigate, onTemplate }) {
  const activeVideos = videos.filter((v) => isActiveTask(v.status));

  return (
    <>
      <SectionHeader title="Pending Tasks" sub="server-saved renders · safe after refresh" count={activeVideos.length} />
      <div className="queue-note">
        <span className={activeVideos.length ? "spinner" : "queue-dot"} />
        <span>{activeVideos.length
          ? `${activeVideos.length} active render${activeVideos.length > 1 ? "s" : ""}. Open a card for its persistent preview page.`
          : "No rendering tasks right now. New submissions will appear here while the server waits for results."}</span>
      </div>
      {activeVideos.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
          {activeVideos.map((v) => (
            <VideoCard
              key={v.id}
              v={v}
              onClick={() => navigate("/preview", { id: v.id })}
              onTemplate={() => onTemplate(v)}
            />
          ))}
        </div>
      ) : (
        <PendingEmptyState onCreate={() => navigate("/create")} />
      )}
    </>
  );
}

export function HomePage() {
  const { state } = useStore();
  const { navigate } = useHashRoute();
  const videos = useMemo(() => [...state.videos].sort(taskSort), [state.videos]);
  const activeVideos = videos.filter((v) => isActiveTask(v.status));
  const readyVideos = videos.filter((v) => !isActiveTask(v.status));

  const applyTemplate = (v) => {
    navigate("/create", { from: v.id });
  };

  return (
    <div>
      <section className="home-hero">
        <div className="mono" style={{ fontSize: 10, letterSpacing: ".24em", color: "var(--accent)", textTransform: "uppercase", marginBottom: 22, display: "flex", alignItems: "center", gap: 10 }}>
          <span>REEL 14/26</span>
          <span style={{ width: 14, height: 1, background: "var(--accent)" }}></span>
          <span>SEEDANCE · BAY 02</span>
        </div>
        <h1 className="display" style={{ fontSize: "min(82px,8vw)", margin: 0 }}>
          Tonight&rsquo;s shoot:<br/>
          <em style={{ color: "var(--fg-2)" }}>your next shot.</em>
        </h1>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: "var(--fg-2)", maxWidth: 540, margin: "20px 0 28px" }}>
          Start from a scene frame or write the shot fresh. Every previous take is on the wall &mdash; click one to roll a variation.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/create")}>
            <Icon name="plus" size={14}/> Roll new take
          </button>
          <button className="btn btn-lg" onClick={() => navigate("/library")}>
            <Icon name="grid" size={14}/> Asset locker
          </button>
        </div>

        <div className="hero-stats">
          <div>BAY · 02</div>
          <div>FPS · 24</div>
          <div>STOCK · {videos.length.toString().padStart(2, "0")} TAKES</div>
          <div>TASKS · {activeVideos.length.toString().padStart(2, "0")} ACTIVE</div>
          <div style={{ color: activeVideos.length ? "var(--accent)" : "var(--accent-2)" }}>● {activeVideos.length ? "RENDERING" : "REC READY"}</div>
        </div>
      </section>

      <section className="page-section compact">
        <PendingTaskList videos={videos} navigate={navigate} onTemplate={applyTemplate} />
      </section>

      <section className="page-section">
        <SectionHeader title="Dailies" sub="recent finished takes · click to revisit · grab as template" count={readyVideos.length} />
        {readyVideos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
            {readyVideos.map((v) => <VideoCard key={v.id} v={v} onClick={() => navigate("/preview", { id: v.id })} onTemplate={() => applyTemplate(v)} />)}
          </div>
        ) : (
          <div className="queue-empty">
            <div className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 8 }}>
              No finished takes
            </div>
            <p style={{ margin: 0, color: "var(--fg-2)", lineHeight: 1.55 }}>
              Completed renders will land here with their first-frame cover as soon as Ark returns the video.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ParamRow({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function DurationSlider({ value, onChange, min, max }) {
  const ticks = [];
  for (let i = min; i <= max; i++) ticks.push(i);
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <div style={{ position: "relative", padding: "10px 0 6px" }}>
        <div style={{ position: "relative", height: 4, background: "var(--bg-3)", borderRadius: 2, border: "1px solid var(--line)" }}>
          <div style={{ position: "absolute", inset: 0, width: pct + "%", background: "var(--accent)", borderRadius: 2 }}/>
        </div>
        <input type="range" min={min} max={max} step={1} value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          style={{
            position: "absolute", left: 0, right: 0, top: 6, width: "100%",
            opacity: 0, height: 20, cursor: "pointer", margin: 0,
          }}/>
        <div style={{
          position: "absolute", left: `calc(${pct}% - 8px)`, top: 4,
          width: 16, height: 16, borderRadius: "50%", background: "var(--fg)",
          border: "3px solid var(--accent)", pointerEvents: "none",
          boxShadow: "0 1px 4px rgba(0,0,0,.3)",
        }}/>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {ticks.map((t) => (
          <span key={t} className="mono" style={{
            fontSize: 9.5, color: t === value ? "var(--accent)" : "var(--fg-3)",
            letterSpacing: ".05em", fontWeight: t === value ? 600 : 400,
          }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

export function CreatePage() {
  const { state, addImage, addVideo } = useStore();
  const route = useHashRoute();
  const { navigate, query } = route;

  const tmpl = useMemo(() => state.videos.find((v) => v.id === query.from), [query.from, state.videos]);
  const imageFromRoute = useMemo(() => state.images.find((img) => img.id === query.fromImage), [query.fromImage, state.images]);

  const [prompt, setPrompt] = useState(tmpl ? tmpl.prompt : "");
  const [model, setModel] = useState(tmpl ? tmpl.model : "seedance-pro");
  const [resolution, setResolution] = useState(tmpl ? tmpl.resolution : "1080p");
  const [aspect, setAspect] = useState(tmpl ? tmpl.aspect : "16:9");
  const [duration, setDuration] = useState(tmpl ? tmpl.duration : 5);
  const [camera, setCamera] = useState(tmpl ? tmpl.camera : "dynamic");
  const [seed, setSeed] = useState(() => (tmpl ? tmpl.seed : Math.floor(Math.random() * 99999)));
  const [image, setImage] = useState(imageFromRoute || null);
  const mode = image ? "i2v" : "t2v";

  const [submitting, setSubmitting] = useState(false);
  const { show, node } = useToast();

  const onPickFile = (img) => {
    const item = img.id ? img : addImage({ name: img.name || "upload.png", src: img.src });
    setImage(item);
  };

  const startGen = async () => {
    if (submitting) return;
    if (!prompt.trim()) { show("Write a prompt to generate"); return; }
    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const imageSrc = image?.src;
      const task = await fetchJson("/api/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          image_url: imageSrc,
          image_role: imageSrc ? "scene_first_frame" : undefined,
          image_id: image?.id,
          model,
          resolution,
          aspect,
          duration,
          camera,
          seed,
        }),
      });
      const v = addVideo(videoPatchFromTask(task, {
        id: task.id,
        referenceImageUrl: image?.src || null,
        imageId: image?.id,
      }));
      navigate("/preview", { id: v.id });
    } catch (error) {
      setSubmitting(false);
      show(error.name === "AbortError" ? "Submit timed out. Try a smaller image or retry." : error.message || "Failed to submit task");
    } finally {
      clearTimeout(timeout);
    }
  };

  return (
    <div className="page-shell">
      {node}
      <header style={{ marginBottom: 28, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 6 }}>
            Bay 02 / New take
          </div>
          <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
            {tmpl ? "Remix this shot" : "New generation"}
          </h1>
          {tmpl && (
            <div className="mono muted-2" style={{ fontSize: 11, letterSpacing: ".12em", marginTop: 8, textTransform: "uppercase" }}>
              Forked from &laquo;{tmpl.title}&raquo;
            </div>
          )}
        </div>
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          <Icon name="arrowLeft" size={14}/> Cancel
        </button>
      </header>

      <div className="create-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <label className="label">
              Scene first frame · <em style={{ color: "var(--fg-3)", fontStyle: "normal" }}>optional — leave empty for text-to-video</em>
            </label>
            <DropZone onFile={onPickFile} image={image} onClear={() => setImage(null)} hint={"Drop an actual scene frame for I→V, or skip for T→V"} />
            {state.images.length > 0 && !image && (
              <div style={{ marginTop: 14 }}>
                <div className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 8 }}>
                  Or reuse from library
                </div>
                <div className="scroll-x" style={{ display: "flex", gap: 8, paddingBottom: 4 }}>
                  {state.images.slice(0, 8).map((img) => (
                    <button key={img.id}
                      onClick={() => setImage(img)}
                      style={{
                        width: 64, height: 64, padding: 0,
                        border: "1px solid var(--line)", borderRadius: "var(--radius)",
                        background: "transparent", overflow: "hidden", flexShrink: 0,
                        cursor: "pointer",
                      }}>
                      <img src={img.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label">Prompt</label>
            <textarea
              className="textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={mode === "i2v"
                ? "Describe motion after this scene frame: 'camera pushes in slowly, steam curls, light flickers...'"
                : "Describe the shot: subject, environment, motion, lens, mood, lighting..."}
              style={{ minHeight: 140 }}
            />
            <div className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".1em", marginTop: 6, display: "flex", justifyContent: "space-between" }}>
              <span>Be specific: subject · motion · lens · lighting · mood</span>
              <span>{prompt.length} chars</span>
            </div>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="chip" style={{ alignSelf: "flex-start" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: image ? "var(--accent-2)" : "var(--fg-3)", display: "inline-block" }}/>
            {image ? "Scene frame → Video" : "Text → Video"} · auto
          </div>

          <ParamRow label="Model">
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {HOST_PARAMS.models.map((m) => (
                <button key={m.id}
                  className={"surface"}
                  onClick={() => setModel(m.id)}
                  style={{
                    padding: "10px 12px", textAlign: "left", cursor: "pointer",
                    borderColor: model === m.id ? "var(--accent)" : "var(--line)",
                    background: model === m.id ? "color-mix(in oklab,var(--accent) 8%,var(--bg-2))" : undefined,
                  }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Seedance {m.label}</div>
                  <div className="mono muted-2" style={{ fontSize: 10, marginTop: 3, letterSpacing: ".06em" }}>{m.note}</div>
                </button>
              ))}
            </div>
          </ParamRow>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <ParamRow label="Resolution">
              <div className="seg">
                {HOST_PARAMS.resolutions.map((r) => (
                  <button key={r} className={"seg-opt" + (resolution === r ? " active" : "")} onClick={() => setResolution(r)}>{r}</button>
                ))}
              </div>
            </ParamRow>
            <ParamRow label={`Duration · ${duration}s`}>
              <DurationSlider value={duration} onChange={setDuration} min={HOST_PARAMS.durationMin} max={HOST_PARAMS.durationMax} />
            </ParamRow>
            <ParamRow label="Aspect">
              <div className="seg">
                {HOST_PARAMS.aspects.map((a) => (
                  <button key={a} className={"seg-opt" + (aspect === a ? " active" : "")} onClick={() => setAspect(a)}>{a}</button>
                ))}
              </div>
            </ParamRow>
            <ParamRow label="Camera">
              <div className="seg">
                {HOST_PARAMS.cameras.map((c) => (
                  <button key={c} className={"seg-opt" + (camera === c ? " active" : "")} onClick={() => setCamera(c)}>{c}</button>
                ))}
              </div>
            </ParamRow>
          </div>

          <ParamRow label="Seed">
            <div style={{ display: "flex", gap: 8 }}>
              <input className="input mono" type="number" value={seed} onChange={(e) => setSeed(parseInt(e.target.value || 0))} />
              <button className="btn btn-icon" onClick={() => setSeed(Math.floor(Math.random() * 99999))} title="Randomize">
                <Icon name="refresh" size={14}/>
              </button>
            </div>
          </ParamRow>

          <button className="btn btn-primary btn-lg" onClick={startGen} disabled={submitting} aria-busy={submitting} style={{ marginTop: 4 }}>
            <Icon name={submitting ? "refresh" : "sparkle"} size={14} className={submitting ? "spin-ic" : undefined}/>
            {submitting ? "Submitting task" : "Generate video"}
          </button>
          <div className="submit-note">
            {submitting
              ? "Creating the server task. The preview page will open as soon as the task id is ready."
              : "Generation runs in the background. Closing the tab will not cancel the render."}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Spec({ rows }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {rows.map(([k, val], i) => (
        <div key={k} style={{
          display: "flex", justifyContent: "space-between", gap: 12,
          padding: "8px 0",
          borderBottom: i < rows.length - 1 ? "1px solid var(--line)" : "none",
        }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--fg-3)", letterSpacing: ".1em", textTransform: "uppercase" }}>{k}</span>
          <span className="mono" style={{ fontSize: 12, color: "var(--fg)" }}>{val}</span>
        </div>
      ))}
    </div>
  );
}

function TaskWaitPanel({ v }) {
  const status = String(v.status || "queued");
  const failed = TERMINAL_TASK_STATUSES.has(status) && status !== "succeeded";
  const label = failed ? status : status === "running" ? "Rendering task" : "Queued task";
  const showProgress = v.monitorMode === "poll" && Number.isFinite(v.progress);
  const shortTaskId = (v.arkTaskId || v.taskId || v.id || "").slice(0, 24);

  return (
    <div style={{
      position: "relative", background: "#000", borderRadius: "var(--radius-lg)",
      overflow: "hidden", aspectRatio: "16/9", width: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
      border: "1px solid var(--line)",
    }}>
      {v.thumb && <img src={v.thumb} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: .28 }} />}
      <div style={{ position: "relative", zIndex: 1, padding: 32, textAlign: "center" }}>
        {failed ? (
          <>
            <div className="mono" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--accent-2)", marginBottom: 12 }}>
              Task failed
            </div>
            <p style={{ color: "#fff", maxWidth: 520, lineHeight: 1.55, margin: 0 }}>
              {v.error?.message || "Seedance did not return a playable video."}
            </p>
          </>
        ) : showProgress ? (
          <GenerationProgress progress={v.progress || 0} label={label} />
        ) : (
          <div className="rendering-state" aria-live="polite">
            <div className="rendering-mark">
              <Icon name="refresh" size={28}/>
            </div>
            <div className="mono" style={{ fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: "var(--accent)", marginBottom: 12 }}>
              {status}
            </div>
            <h2 className="display" style={{ color: "#fff", fontSize: 30, margin: "0 0 12px", lineHeight: 1.1 }}>
              Rendering in the background
            </h2>
            <p style={{ color: "rgba(255,255,255,.72)", maxWidth: 520, lineHeight: 1.55, margin: "0 auto" }}>
              This preview page is backed by the server task. Keep it open or come back later; the video will replace this state when Ark sends the result.
            </p>
            <div className="rendering-pills">
              <span>{v.resolution}</span>
              <span>{v.aspect}</span>
              <span>{v.duration}s</span>
              {shortTaskId && <span>{shortTaskId}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function PreviewPage() {
  const { state, removeVideo, updateVideo, upsertVideo } = useStore();
  const { query, navigate } = useHashRoute();
  const v = state.videos.find((x) => x.id === query.id);
  const { show, node } = useToast();
  const taskId = v?.taskId || query.id;
  const shouldPoll = taskId && (!v || v.taskId || isActiveTask(v.status));
  const videoRef = useRef(v);
  const [taskError, setTaskError] = useState(null);
  const shareFileRef = useRef(null);
  const shareFilePromiseRef = useRef(null);
  const [iosShareStatus, setIosShareStatus] = useState("idle");
  const videoId = v?.id;
  const videoTaskId = v?.taskId;
  const videoSrc = v?.src;
  const videoTitle = v?.title;
  const shareVideo = useMemo(() => videoSrc ? {
    id: videoId,
    taskId: videoTaskId,
    src: videoSrc,
    title: videoTitle,
  } : null, [videoId, videoTaskId, videoSrc, videoTitle]);

  useEffect(() => {
    videoRef.current = v;
  }, [v]);

  const beginIosShareFileLoad = useCallback((video) => {
    if (!video?.src) return Promise.reject(new Error("Video is not ready yet"));
    const filename = videoFileName(video);
    const cached = shareFileRef.current;
    if (cached?.src === video.src && cached.filename === filename) {
      setIosShareStatus(canShareVideoFile(cached.file) ? "ready" : "unavailable");
      return Promise.resolve(cached.file);
    }

    const pending = shareFilePromiseRef.current;
    if (pending?.src === video.src && pending.filename === filename) {
      return pending.promise;
    }

    setIosShareStatus("preparing");
    let entry = null;
    const promise = fetchVideoFile(video.src, filename)
      .then((file) => {
        shareFileRef.current = { src: video.src, filename, file };
        setIosShareStatus(canShareVideoFile(file) ? "ready" : "unavailable");
        return file;
      })
      .catch((error) => {
        setIosShareStatus("unavailable");
        throw error;
      })
      .finally(() => {
        if (shareFilePromiseRef.current === entry) {
          shareFilePromiseRef.current = null;
        }
      });

    entry = { src: video.src, filename, promise };
    shareFilePromiseRef.current = entry;
    promise.catch(() => {});
    return promise;
  }, []);

  useEffect(() => {
    shareFileRef.current = null;
    shareFilePromiseRef.current = null;
  }, [videoSrc]);

  useEffect(() => {
    if (!shareVideo?.src || !isAppleTouchDevice() || !canAttemptFileShare()) return undefined;
    let cancelled = false;
    beginIosShareFileLoad(shareVideo)
      .then((file) => {
        if (!cancelled) setIosShareStatus(canShareVideoFile(file) ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setIosShareStatus("unavailable");
      });
    return () => { cancelled = true; };
  }, [shareVideo, beginIosShareFileLoad]);

  useEffect(() => {
    if (!shouldPoll) return undefined;

    let stopped = false;
    let timer = null;

    const poll = async () => {
      try {
        const task = await fetchJson(`/api/task/${encodeURIComponent(taskId)}`);
        if (stopped) return;

        const currentVideo = videoRef.current;
        const patch = videoPatchFromTask(task, currentVideo || { id: task.id });
        if (currentVideo) updateVideo(currentVideo.id, patch);
        else upsertVideo(patch);
        setTaskError(null);

        if (!TERMINAL_TASK_STATUSES.has(task.status)) {
          timer = setTimeout(poll, 2500);
        }
      } catch (error) {
        if (!stopped) {
          if (error.status === 404) {
            setTaskError(error.message || "Task not found");
            return;
          }
          show(error.message || "Failed to fetch task status");
          timer = setTimeout(poll, 5000);
        }
      }
    };

    poll();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [shouldPoll, taskId, updateVideo, upsertVideo, show]);

  if (!v) return (
    <div className="page-shell">
      <div className="queue-empty" style={{ margin: "64px auto", textAlign: "center" }}>
        <div className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", marginBottom: 8 }}>
          {taskError ? "Task unavailable" : "Loading task"}
        </div>
        <p style={{ margin: "0 0 14px", color: "var(--fg-2)", lineHeight: 1.55 }}>
          {taskError || "Fetching the server record for this preview."}
        </p>
        <button className="btn" onClick={() => navigate("/")}>← Back to gallery</button>
      </div>
    </div>
  );

  const onDownload = async () => {
    if (!v.src) {
      show("Video is not ready yet");
      return;
    }
    if (isAppleTouchDevice() && canAttemptFileShare()) {
      try {
        const file = await beginIosShareFileLoad(v);
        if (canShareVideoFile(file)) {
          show("Choose Save Video to add it to Photos");
          await navigator.share({
            files: [file],
            title: v.title || "Videogen render",
          });
          show("Share completed");
          return;
        }
        show("This video format cannot be shared to Photos here");
      } catch (error) {
        if (error?.name === "AbortError") {
          show("Share cancelled");
          return;
        }
        const cached = shareFileRef.current;
        if (error?.name === "NotAllowedError" && cached?.src === v.src) {
          show("Video prepared. Tap Save to Photos again.");
          return;
        }
        console.warn("iOS video share failed", error);
        show("Opening normal download");
      }
    }
    downloadVideoLink(v.src, videoFileName(v));
    show("Download started");
  };
  const onDelete = async () => {
    if (!confirm("Delete this video permanently?")) return;
    try {
      await deleteRemoteTask(v);
      removeVideo(v.id);
      navigate("/");
    } catch (error) {
      show(error.message || "Failed to delete task");
    }
  };
  const onTemplate = () => navigate("/create", { from: v.id });
  const ready = Boolean(v.src) && (!v.status || v.status === "succeeded");
  const onCopyLink = async () => {
    const link = `${window.location.origin}${window.location.pathname}#/preview?id=${encodeURIComponent(v.id)}`;
    try {
      await navigator.clipboard.writeText(link);
      show("Preview link copied");
    } catch {
      show(link);
    }
  };

  return (
    <div className="page-shell">
      {node}
      <header className="preview-header">
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          <Icon name="arrowLeft" size={14}/> Back to gallery
        </button>
        <div className="preview-actions">
          <button className="btn" onClick={onCopyLink}><Icon name="copy" size={14}/> Copy link</button>
          <button className="btn" onClick={onTemplate}><Icon name="copy" size={14}/> Use as template</button>
          <button className="btn" onClick={onDownload} disabled={!v.src}>
            <Icon name="download" size={14}/> {isAppleTouchDevice() ? (iosShareStatus === "preparing" ? "Preparing" : "Save to Photos") : "Download"}
          </button>
          <button className="btn" onClick={onDelete} title="Delete"><Icon name="trash" size={14}/></button>
        </div>
      </header>

      <div className="preview-grid">
        <div>
          {ready ? <VideoPlayer src={v.src} poster={v.thumb} preload="metadata"/> : <TaskWaitPanel v={v} />}
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 8 }}>Title</div>
            <h1 className="display" style={{ fontSize: 28, margin: 0, lineHeight: 1.15 }}>{v.title}</h1>
          </div>
          <div>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 8 }}>Prompt</div>
            <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "var(--fg-2)" }}>{v.prompt}</p>
          </div>
          <div className="surface" style={{ padding: 16 }}>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 12 }}>Parameters</div>
            <Spec rows={[
              ["status", v.status || "ready"],
              ...(v.taskId ? [["task", v.taskId.slice(0, 22)]] : []),
              ["model", v.model],
              ["mode", v.mode === "i2v" ? "image → video" : "text → video"],
              ["resolution", v.resolution],
              ["aspect", v.aspect],
              ["duration", v.duration + "s · 24fps"],
              ["camera", v.camera],
              ["seed", v.seed],
              ["created", fmtDate(v.createdAt) + " · " + relTime(v.createdAt)],
            ]}/>
          </div>
          {(v.imageId || v.referenceImageUrl) && (() => {
            const ref = state.images.find((i) => i.id === v.imageId);
            const refSrc = ref?.src || v.referenceImageUrl;
            if (!refSrc) return null;
            return (
              <div>
                <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 8 }}>Scene frame</div>
                <div className="img-tile" style={{ aspectRatio: "16/9", height: 140 }}>
                  <img src={refSrc} alt=""/>
                </div>
              </div>
            );
          })()}
        </aside>
      </div>
    </div>
  );
}

export function LibraryPage() {
  const { state, removeImage, removeVideo, addImage } = useStore();
  const { navigate } = useHashRoute();
  const [tab, setTab] = useState("images");
  const [search, setSearch] = useState("");
  const { show, node } = useToast();
  const inputRef = useRef(null);
  const libraryVideos = useMemo(() => [...state.videos].sort(taskSort), [state.videos]);
  const visibleVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return libraryVideos;
    return libraryVideos.filter((v) => [
      v.title,
      v.prompt,
      v.status,
      v.model,
      v.aspect,
      v.resolution,
    ].join(" ").toLowerCase().includes(q));
  }, [libraryVideos, search]);
  const activeVideos = libraryVideos.filter((v) => isActiveTask(v.status));

  const onUpload = (files) => {
    if (!files) return;
    Array.from(files).forEach((f) => {
      const r = new FileReader();
      r.onload = (e) => addImage({ name: f.name, src: e.target.result });
      r.readAsDataURL(f);
    });
    show("Added to library");
  };

  return (
    <div className="page-shell wide">
      {node}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 28, gap: 16 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 6 }}>
            Asset locker
          </div>
          <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
            Library
          </h1>
        </div>
        <div className="seg" style={{ width: "auto" }}>
          <button className={"seg-opt" + (tab === "images" ? " active" : "")} onClick={() => setTab("images")} style={{ padding: "8px 18px" }}>
            Images · {state.images.length}
          </button>
          <button className={"seg-opt" + (tab === "videos" ? " active" : "")} onClick={() => setTab("videos")} style={{ padding: "8px 18px" }}>
            Videos · {state.videos.length}
          </button>
        </div>
      </header>

      {tab === "images" && (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()}>
              <Icon name="upload" size={14}/> Upload images
            </button>
            <input ref={inputRef} type="file" accept="image/*" multiple
                   style={{ display: "none" }}
                   onChange={(e) => onUpload(e.target.files)} />
            <span className="mono muted-2" style={{ fontSize: 11, letterSpacing: ".1em", alignSelf: "center" }}>
              Drag any tile onto Create to use as a scene frame
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 14 }}>
            {state.images.length === 0 && (
              <div className="muted" style={{ gridColumn: "1/-1", padding: 64, textAlign: "center" }}>
                No images yet. Upload some to reuse across generations.
              </div>
            )}
            {state.images.map((img) => (
              <div key={img.id} className="img-tile"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("application/x-vgs-image", JSON.stringify(img));
                }}
                onClick={() => navigate("/create", { fromImage: img.id })}
              >
                <img src={img.src} alt={img.name}/>
                <button className="img-tile-del" onClick={(e) => { e.stopPropagation(); removeImage(img.id); show("Image removed"); }}>
                  <Icon name="trash" size={12}/>
                </button>
                <div style={{
                  position: "absolute", left: 0, right: 0, bottom: 0,
                  padding: "16px 10px 8px",
                  background: "linear-gradient(180deg,transparent,rgba(0,0,0,.75))",
                  color: "#fff",
                }}>
                  <div className="mono" style={{ fontSize: 10, letterSpacing: ".06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {img.name}
                  </div>
                  <div className="mono" style={{ fontSize: 9.5, opacity: .7, letterSpacing: ".12em", textTransform: "uppercase" }}>
                    {relTime(img.addedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "videos" && (
        <>
          <div className="library-video-tools">
            <div className="queue-note" style={{ margin: 0 }}>
              <span className={activeVideos.length ? "spinner" : "queue-dot"} />
              <span>{activeVideos.length
                ? `${activeVideos.length} rendering task${activeVideos.length > 1 ? "s" : ""} will update here when ready.`
                : "No pending tasks right now. New renders appear on Home and here."}</span>
            </div>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter videos..."
              style={{ maxWidth: 320 }}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 18 }}>
          {state.videos.length === 0 && (
            <div className="muted" style={{ gridColumn: "1/-1", padding: 64, textAlign: "center" }}>
              No videos yet. Generate one from Create.
            </div>
          )}
          {state.videos.length > 0 && visibleVideos.length === 0 && (
            <div className="muted" style={{ gridColumn: "1/-1", padding: 64, textAlign: "center" }}>
              No videos match that filter.
            </div>
          )}
          {visibleVideos.map((v) => (
            <div key={v.id} style={{ position: "relative" }}>
              <VideoCard v={v}
                onClick={() => navigate("/preview", { id: v.id })}
                onTemplate={() => navigate("/create", { from: v.id })}/>
              <button className="btn btn-icon"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm("Delete this video?")) return;
                  try {
                    await deleteRemoteTask(v);
                    removeVideo(v.id);
                    show("Video removed");
                  } catch (error) {
                    show(error.message || "Failed to delete task");
                  }
                }}
                style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,.7)", color: "#fff", borderColor: "transparent" }}>
                <Icon name="trash" size={12}/>
              </button>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
