import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Icon, DropZone, VideoPlayer, GenerationProgress, useToast } from './components';
import { useStore, useHashRoute, relTime, fmtDate } from './store';
import { authHeader, clearToken, getToken } from './auth';
import { prepareUploadImage } from './imageUpload';

const HOST_PARAMS = {
  resolutions: ["720p", "1080p"],
  aspects: ["16:9", "9:16", "1:1"],
  durationMin: 5,
  durationMax: 15,
  cameras: ["fixed", "dynamic"],
};

const INPUT_MODES = [
  { id: "text", label: "Text" },
  { id: "frames", label: "Frames" },
  { id: "references", label: "References" },
];

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
  const characterReferenceUrls = Array.isArray(task.character_reference_urls) && task.character_reference_urls.length
    ? task.character_reference_urls
    : task.character_reference_url
      ? [task.character_reference_url]
      : current.characterReferenceUrls || [];
  const characterReferenceUrl = characterReferenceUrls[0] || current.characterReferenceUrl || null;
  const referenceAudioUrls = Array.isArray(task.reference_audio_urls) && task.reference_audio_urls.length
    ? task.reference_audio_urls
    : task.reference_audio_url
      ? [task.reference_audio_url]
      : current.referenceAudioUrls || [];

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
    lastFrameUrl: task.last_frame_url || current.lastFrameUrl || null,
    characterReferenceUrl,
    characterReferenceUrls,
    referenceAudioUrls,
    generateAudio: task.generate_audio ?? current.generateAudio ?? true,
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
  if (v.mode === "ref2v") return "REF→V";
  return v.mode === "i2v" ? "I→V" : "T→V";
}

function modeLabel(mode) {
  if (mode === "i2v") return "image → video";
  if (mode === "ref2v") return "reference → video";
  return "text → video";
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

function imageFromUploadResponse(data, fallback = {}) {
  const image = data?.image || data || {};
  const src = image.src || image.url;
  if (!src) {
    throw new Error("Image upload did not return a URL.");
  }

  return {
    id: image.id || fallback.id,
    name: image.name || fallback.name || "upload.png",
    src,
    url: image.url || src,
    mediaPath: image.media_path || fallback.mediaPath,
    path: image.path || fallback.path,
    bytes: image.bytes || fallback.bytes,
    mime: image.mime || fallback.mime,
    addedAt: image.added_at || fallback.addedAt || Date.now(),
    cloud: true,
  };
}

function imageFromListResponse(image) {
  const src = image?.src || image?.url;
  if (!src) return null;
  const addedAt = image.addedAt
    || (typeof image.added_at === "number" ? image.added_at : Date.parse(image.added_at || image.lastModified || image.last_modified || ""))
    || Date.now();

  return {
    id: image.id || image.key || src,
    name: image.name || image.filename || "imagerepo image",
    src,
    url: image.url || src,
    mediaPath: image.mediaPath || image.media_path || image.url || src,
    path: image.path || null,
    key: image.key || null,
    tag: image.tag || null,
    provider: image.provider || "imagerepo",
    bytes: image.bytes || image.size || null,
    mime: image.mime || image.contentType || image.content_type || null,
    addedAt,
    cloud: true,
  };
}

async function uploadImageAsset(img) {
  const src = String(img?.src || "");
  if (!src) {
    throw new Error("Image is missing.");
  }
  if (!src.startsWith("data:")) {
    return { ...img, cloud: true };
  }

  const data = await fetchJson("/api/images", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: img.name, image: src }),
  });
  return imageFromUploadResponse(data, img);
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
  const fallback = String(v?.taskId || v?.id || "studio-render").slice(0, 24) || "studio-render";
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

export function RemoteImageSync() {
  const { mergeImages } = useStore();

  useEffect(() => {
    let stopped = false;

    const sync = async () => {
      try {
        const data = await fetchJson("/api/images?limit=100");
        if (stopped) return;
        mergeImages((data.images || []).map(imageFromListResponse).filter(Boolean));
      } catch (error) {
        console.warn("image library sync failed", error);
      }
    };

    sync();
    window.addEventListener("focus", sync);

    return () => {
      stopped = true;
      window.removeEventListener("focus", sync);
    };
  }, [mergeImages]);

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
      <div id="zouk-studio-chat-slot" className="studio-chat-slot" />
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
      {sub && <span className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase" }}>{sub}</span>}
    </div>
  );
}

function VideoCard({ v, onClick, onTemplate, onDelete }) {
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
          <span>{v.aspect}</span>
          <span>·</span>
          <span>{relTime(v.createdAt)}</span>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 9px" }}
            onClick={(e) => { e.stopPropagation(); onTemplate(); }}>
            <Icon name="copy" size={11}/> Use as template
          </button>
          {onDelete && (
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "5px 9px" }}
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Delete">
              <Icon name="trash" size={11}/> Delete
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

export function HomePage() {
  const { state, removeVideo } = useStore();
  const { navigate } = useHashRoute();
  const { show, node } = useToast();
  const videos = useMemo(() => [...state.videos].sort(taskSort), [state.videos]);
  const activeVideos = videos.filter((v) => isActiveTask(v.status));
  const readyVideos = videos.filter((v) => !isActiveTask(v.status));

  const applyTemplate = (v) => {
    navigate("/create", { from: v.id });
  };

  const deleteVideo = async (v) => {
    try {
      await deleteRemoteTask(v);
      removeVideo(v.id);
      show("Video removed");
    } catch (error) {
      show(error.message || "Failed to delete task");
    }
  };

  return (
    <div>
      {node}
      <section className="home-actions">
        <button className="btn btn-primary btn-lg" onClick={() => navigate("/create")}>
          <Icon name="plus" size={14}/> Add
        </button>
      </section>

      <section className="page-section compact">
        <SectionHeader title="Running" count={activeVideos.length} />
        {activeVideos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
            {activeVideos.map((v) => (
              <VideoCard
                key={v.id}
                v={v}
                onClick={() => navigate("/preview", { id: v.id })}
                onTemplate={() => applyTemplate(v)}
                onDelete={() => deleteVideo(v)}
              />
            ))}
          </div>
        ) : (
          <div className="queue-empty">No running</div>
        )}
      </section>

      <section className="page-section">
        <SectionHeader title="Done" count={readyVideos.length} />
        {readyVideos.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
            {readyVideos.map((v) => (
              <VideoCard
                key={v.id}
                v={v}
                onClick={() => navigate("/preview", { id: v.id })}
                onTemplate={() => applyTemplate(v)}
                onDelete={() => deleteVideo(v)}
              />
            ))}
          </div>
        ) : (
          <div className="queue-empty">No done</div>
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

function usePhoneView() {
  const [phone, setPhone] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches
  ));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return phone;
}

function SelectedImagePreview({ image, label, onClear }) {
  if (!image) return null;
  return (
    <div className="selected-image-preview">
      <img src={image.src} alt="" />
      <div className="selected-image-meta">
        <span className="mono">{label}</span>
        <strong>{image.name || "image"}</strong>
      </div>
      <button className="btn btn-icon" onClick={onClear} title="Remove">
        <Icon name="x" size={13}/>
      </button>
    </div>
  );
}

export function CreatePage() {
  const { state, addImage, updateImage, addVideo } = useStore();
  const route = useHashRoute();
  const { navigate, query } = route;
  const phoneView = usePhoneView();

  const tmpl = useMemo(() => state.videos.find((v) => v.id === query.from), [query.from, state.videos]);
  const imageFromRoute = useMemo(() => state.images.find((img) => img.id === query.fromImage), [query.fromImage, state.images]);
  const imageFromUrl = useCallback((src, name = "template image") => {
    if (!src) return null;
    const found = state.images.find((img) => [img.src, img.url, img.mediaPath, img.media_path].filter(Boolean).includes(src));
    if (found) return found;
    return {
      id: `template_${src.replace(/[^a-zA-Z0-9]+/g, "_").slice(-48)}`,
      name,
      src,
      url: src,
      mediaPath: src,
      cloud: true,
      addedAt: Date.now(),
    };
  }, [state.images]);
  const templateFirstFrame = useMemo(() => (
    tmpl?.mode === "i2v" ? imageFromRoute || imageFromUrl(tmpl.referenceImageUrl, "template first frame") : null
  ), [imageFromRoute, imageFromUrl, tmpl]);
  const templateLastFrame = useMemo(() => (
    tmpl?.mode === "i2v" ? imageFromUrl(tmpl.lastFrameUrl, "template last frame") : null
  ), [imageFromUrl, tmpl]);
  const templateReferenceImages = useMemo(() => {
    if (imageFromRoute) return [imageFromRoute];
    if (tmpl?.mode !== "ref2v") return [];
    return Array.from(new Set([
      ...(Array.isArray(tmpl.characterReferenceUrls) ? tmpl.characterReferenceUrls : []),
      tmpl.characterReferenceUrl,
    ].filter(Boolean)))
      .map((src, index) => imageFromUrl(src, `template reference ${index + 1}`))
      .filter(Boolean);
  }, [imageFromRoute, imageFromUrl, tmpl]);
  const model = "seedance-pro";

  const [prompt, setPrompt] = useState(tmpl ? tmpl.prompt : "");
  const [resolution, setResolution] = useState(tmpl ? tmpl.resolution : "1080p");
  const [aspect, setAspect] = useState(tmpl ? tmpl.aspect : "9:16");
  const [duration, setDuration] = useState(tmpl ? tmpl.duration : 15);
  const [camera, setCamera] = useState(tmpl ? tmpl.camera : "dynamic");
  const [seed, setSeed] = useState(() => (tmpl ? tmpl.seed : Math.floor(Math.random() * 99999)));
  const [image, setImage] = useState(templateFirstFrame);
  const [lastFrame, setLastFrame] = useState(templateLastFrame);
  const [referenceImages, setReferenceImages] = useState(templateReferenceImages);
  const [referenceAudioText, setReferenceAudioText] = useState(() => (tmpl?.referenceAudioUrls || []).join("\n"));
  const [generateAudio, setGenerateAudio] = useState(tmpl ? tmpl.generateAudio !== false : true);
  const [inputMode, setInputMode] = useState(() => tmpl?.mode === "i2v" ? "frames" : "references");
  const mode = inputMode === "frames" && image
    ? "i2v"
    : inputMode === "references" && referenceImages.length
      ? "ref2v"
      : "t2v";

  const [submitting, setSubmitting] = useState(false);
  const [pendingImageUploads, setPendingImageUploads] = useState(0);
  const { show, node } = useToast();

  const toStoredImage = async (img) => {
    const remote = await uploadImageAsset(img);
    if (img.id) {
      const patch = {
        ...remote,
        id: img.id,
        addedAt: img.addedAt || remote.addedAt,
      };
      updateImage(img.id, patch);
      return { ...img, ...patch };
    }
    return addImage(remote);
  };

  const trackImageUpload = async (work) => {
    setPendingImageUploads((count) => count + 1);
    try {
      await work();
    } catch (error) {
      show(error.message || "Image upload failed");
      throw error;
    } finally {
      setPendingImageUploads((count) => Math.max(0, count - 1));
    }
  };

  const onPickFile = (img) => {
    return trackImageUpload(async () => {
      const item = await toStoredImage(img);
      setImage(item);
    });
  };

  const onPickLastFrame = (img) => {
    return trackImageUpload(async () => {
      const item = await toStoredImage(img);
      setLastFrame(item);
    });
  };

  const onPickReference = (img) => {
    return trackImageUpload(async () => {
      const item = await toStoredImage(img);
      setReferenceImages((items) => items.some((x) => x.id === item.id || x.src === item.src) ? items : [...items, item].slice(0, 6));
    });
  };

  const libraryStrip = (onSelect, selected = []) => {
    const selectedIds = new Set(selected.filter(Boolean).map((img) => img.id || img.src));
    const items = state.images.slice(0, 10);
    if (!items.length) return null;
    return (
      <div style={{ marginTop: 14 }}>
        <div className="mono muted-2" style={{ fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", marginBottom: 8 }}>
          Reuse from library
        </div>
        <div className="scroll-x" style={{ display: "flex", gap: 8, paddingBottom: 4 }}>
          {items.map((img) => {
            const selectedAlready = selectedIds.has(img.id || img.src);
            return (
            <button key={img.id}
              disabled={selectedAlready}
              onClick={() => !selectedAlready && onSelect(img)}
              title={selectedAlready ? "Selected" : img.name}
              style={{
                width: 64, height: 64, padding: 0,
                border: "1px solid var(--line)", borderRadius: "var(--radius)",
                background: "transparent", overflow: "hidden", flexShrink: 0,
                cursor: selectedAlready ? "default" : "pointer",
                opacity: selectedAlready ? .36 : 1,
                filter: selectedAlready ? "grayscale(1)" : "none",
              }}>
              <img src={img.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
            </button>
            );
          })}
        </div>
      </div>
    );
  };

  const startGen = async () => {
    if (submitting) return;
    if (pendingImageUploads > 0) { show("Wait for image upload to finish"); return; }
    if (!prompt.trim()) { show("Write a prompt to generate"); return; }
    if (inputMode === "frames" && lastFrame && !image) { show("Add a first frame before using a last frame"); return; }
    if (inputMode === "references" && referenceImages.length === 0) { show("Add at least one reference image"); return; }
    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    try {
      const imageSrc = inputMode === "frames" ? image?.src : null;
      const lastFrameSrc = inputMode === "frames" ? lastFrame?.src : null;
      const referenceImageUrls = inputMode === "references" ? referenceImages.map((img) => img.src) : [];
      const referenceAudioUrls = inputMode === "references"
        ? referenceAudioText.split(/[\n,]+/).map((url) => url.trim()).filter(Boolean)
        : [];
      const task = await fetchJson("/api/generate", {
        method: "POST",
        signal: controller.signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          image_url: imageSrc,
          image_role: imageSrc ? "scene_first_frame" : undefined,
          last_frame_image_url: lastFrameSrc,
          reference_image_urls: referenceImageUrls.length ? referenceImageUrls : undefined,
          reference_audio_urls: referenceAudioUrls.length ? referenceAudioUrls : undefined,
          generate_audio: generateAudio,
          image_id: inputMode === "frames" ? image?.id : undefined,
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
        referenceImageUrl: imageSrc || null,
        lastFrameUrl: lastFrameSrc || null,
        characterReferenceUrls: referenceImageUrls,
        referenceAudioUrls,
        generateAudio,
        imageId: inputMode === "frames" ? image?.id : undefined,
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
    <div className="page-shell create-page">
      {node}
      <header className="create-header">
        <div>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 6 }}>
            Bay 02 / New take
          </div>
          <h1 className="display create-title">
            {tmpl ? "Remix" : "New generation"}
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
            <label className="label">Input mode</label>
            <div className="seg" style={{ marginBottom: 16 }}>
              {INPUT_MODES.map((option) => (
                <button key={option.id}
                  className={"seg-opt" + (inputMode === option.id ? " active" : "")}
                  onClick={() => setInputMode(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>

            {inputMode === "frames" && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
                <div>
                  <label className="label">
                    First frame · <em style={{ color: "var(--fg-3)", fontStyle: "normal" }}>actual opening scene</em>
                  </label>
                  <DropZone compact onFile={onPickFile} image={null} onClear={() => setImage(null)} allowDrag={!phoneView} hint={phoneView ? "Tap to choose first frame" : "Drop or choose first frame"} />
                  <SelectedImagePreview image={image} label="First frame" onClear={() => setImage(null)} />
                  {libraryStrip(onPickFile, [image, lastFrame])}
                </div>
                <div>
                  <label className="label">
                    Last frame · <em style={{ color: "var(--fg-3)", fontStyle: "normal" }}>optional final scene</em>
                  </label>
                  <DropZone compact onFile={onPickLastFrame} image={null} onClear={() => setLastFrame(null)} allowDrag={!phoneView} hint={phoneView ? "Tap to choose last frame" : "Drop or choose last frame"} />
                  <SelectedImagePreview image={lastFrame} label="Last frame" onClear={() => setLastFrame(null)} />
                  {libraryStrip(onPickLastFrame, [image, lastFrame])}
                </div>
              </div>
            )}

            {inputMode === "references" && (
              <div>
                <label className="label">
                  Reference images · <em style={{ color: "var(--fg-3)", fontStyle: "normal" }}>identity and story references</em>
                </label>
                <DropZone compact onFile={onPickReference} image={null} allowDrag={!phoneView} hint={phoneView ? "Tap to choose reference" : "Drop or choose reference"} />
                {referenceImages.length > 0 && (
                  <div className="selected-image-grid">
                    {referenceImages.map((img) => (
                      <div key={img.id || img.src} className="img-tile selected-reference-tile">
                        <img src={img.src} alt="" />
                        <button className="btn btn-icon"
                          onClick={() => setReferenceImages((items) => items.filter((item) => item !== img))}
                          title="Remove reference"
                          style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, minWidth: 24, background: "rgba(0,0,0,.68)", color: "#fff", borderColor: "transparent" }}>
                          <Icon name="x" size={13}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {libraryStrip(onPickReference, referenceImages)}
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
                ? "Describe motion between the frame endpoints: 'camera pushes in slowly, light flickers...'"
                : mode === "ref2v"
                  ? "Describe the shot while using references for identity, wardrobe, props, or story beats..."
                  : "Describe the shot: subject, environment, motion, lens, mood, lighting..."}
              style={{ minHeight: 140 }}
            />
            <div className="mono muted-2 prompt-helper">
              <span>Be specific: subject · motion · lens · lighting · mood</span>
              <span>{prompt.length} chars</span>
            </div>
          </div>
        </div>

        <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="chip" style={{ alignSelf: "flex-start" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: mode === "t2v" ? "var(--fg-3)" : "var(--accent-2)", display: "inline-block" }}/>
            {modeLabel(mode)} · {inputMode}
          </div>

          <div className="param-grid">
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

          {inputMode === "references" && (
            <ParamRow label="Reference audio">
              <textarea
                className="textarea"
                value={referenceAudioText}
                onChange={(e) => setReferenceAudioText(e.target.value)}
                placeholder="https://..."
                style={{ minHeight: 72 }}
              />
            </ParamRow>
          )}

          <ParamRow label="Generate audio">
            <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--fg-2)" }}>
              <input type="checkbox" checked={generateAudio} onChange={(e) => setGenerateAudio(e.target.checked)} />
              <span>Enabled</span>
            </label>
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
  const [shareState, setShareState] = useState({ src: null, status: "idle" });
  const videoSrc = v?.src;
  const shareStatus = shareState.src === videoSrc ? shareState.status : "idle";
  const shareVideo = useMemo(() => videoSrc ? {
    id: v?.id,
    taskId: v?.taskId,
    src: videoSrc,
    title: v?.title,
  } : null, [v?.id, v?.taskId, v?.title, videoSrc]);

  useEffect(() => {
    videoRef.current = v;
  }, [v]);

  const setShareStatusForVideo = useCallback((src, status) => {
    setShareState({ src, status });
  }, []);

  const prepareShareFile = useCallback((video) => {
    if (!video?.src) return Promise.reject(new Error("Video is not ready yet"));
    const filename = videoFileName(video);
    const cached = shareFileRef.current;
    if (cached?.src === video.src && cached.filename === filename) {
      setShareStatusForVideo(video.src, canShareVideoFile(cached.file) ? "ready" : "unavailable");
      return Promise.resolve(cached.file);
    }

    const pending = shareFilePromiseRef.current;
    if (pending?.src === video.src && pending.filename === filename) {
      return pending.promise;
    }

    setShareStatusForVideo(video.src, "preparing");
    let entry = null;
    const promise = fetchVideoFile(video.src, filename)
      .then((file) => {
        shareFileRef.current = { src: video.src, filename, file };
        setShareStatusForVideo(video.src, canShareVideoFile(file) ? "ready" : "unavailable");
        return file;
      })
      .catch((error) => {
        setShareStatusForVideo(video.src, "unavailable");
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
  }, [setShareStatusForVideo]);

  useEffect(() => {
    shareFileRef.current = null;
    shareFilePromiseRef.current = null;
  }, [videoSrc]);

  useEffect(() => {
    if (!shareVideo?.src || !isAppleTouchDevice() || !canAttemptFileShare()) return undefined;
    let cancelled = false;
    prepareShareFile(shareVideo)
      .then((file) => {
        if (!cancelled) setShareStatusForVideo(shareVideo.src, canShareVideoFile(file) ? "ready" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setShareStatusForVideo(shareVideo.src, "unavailable");
      });
    return () => { cancelled = true; };
  }, [shareVideo, prepareShareFile, setShareStatusForVideo]);

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

  const onShare = async () => {
    if (!v.src) {
      show("Video is not ready yet");
      return;
    }
    if (!canAttemptFileShare()) {
      downloadVideoLink(v.src, videoFileName(v));
      show("Share is unavailable here; download started");
      return;
    }

    try {
      const file = await prepareShareFile(v);
      if (!canShareVideoFile(file)) {
        downloadVideoLink(v.src, videoFileName(v));
        show("This video cannot be shared here; download started");
        return;
      }
      await navigator.share({
        files: [file],
        title: v.title || "Videogen render",
      });
      show("Share completed");
    } catch (error) {
      if (error?.name === "AbortError") {
        show("Share cancelled");
        return;
      }
      if (error?.name === "NotAllowedError") {
        show("Video prepared. Tap Share again.");
        return;
      }
      console.warn("video share failed", error);
      downloadVideoLink(v.src, videoFileName(v));
      show("Share failed; download started");
    }
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
          <button className="btn" onClick={onTemplate}><Icon name="copy" size={14}/> Use as template</button>
          <button className="btn" onClick={onShare} disabled={!v.src || shareStatus === "preparing"}>
            <Icon name="share" size={14}/> {shareStatus === "preparing" ? "Preparing" : "Share"}
          </button>
          <button className="btn btn-icon" onClick={onCopyLink} title="Copy link" aria-label="Copy link"><Icon name="copy" size={14}/></button>
          <button className="btn btn-icon" onClick={onDelete} title="Delete" aria-label="Delete"><Icon name="trash" size={14}/></button>
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
          <details className="surface preview-fold">
            <summary>Prompt</summary>
            <div className="preview-fold-body">
              <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, color: "var(--fg-2)" }}>{v.prompt}</p>
            </div>
          </details>
          <details className="surface preview-fold">
            <summary>Parameters</summary>
            <div className="preview-fold-body">
              <Spec rows={[
                ["status", v.status || "ready"],
                ...(v.taskId ? [["task", v.taskId.slice(0, 22)]] : []),
                ["mode", modeLabel(v.mode)],
                ["resolution", v.resolution],
                ["aspect", v.aspect],
                ["duration", v.duration + "s · 24fps"],
                ["camera", v.camera],
                ["seed", v.seed],
                ["created", fmtDate(v.createdAt) + " · " + relTime(v.createdAt)],
              ]}/>
            </div>
          </details>
          {(() => {
            const ref = state.images.find((i) => i.id === v.imageId);
            const sceneFrameSrc = v.mode === "ref2v" ? null : ref?.src || v.referenceImageUrl;
            const referenceUrls = Array.from(new Set([
              ...(Array.isArray(v.characterReferenceUrls) ? v.characterReferenceUrls : []),
              v.characterReferenceUrl,
            ].filter(Boolean)));
            if (!sceneFrameSrc && !v.lastFrameUrl && referenceUrls.length === 0) return null;
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(sceneFrameSrc || v.lastFrameUrl) && (
                  <div>
                    <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 8 }}>
                      Scene frames
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10 }}>
                      {sceneFrameSrc && (
                        <div className="img-tile" style={{ aspectRatio: "16/9" }}>
                          <img src={sceneFrameSrc} alt=""/>
                        </div>
                      )}
                      {v.lastFrameUrl && (
                        <div className="img-tile" style={{ aspectRatio: "16/9" }}>
                          <img src={v.lastFrameUrl} alt=""/>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {referenceUrls.length > 0 && (
                  <div>
                    <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 8 }}>
                      Reference images
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(82px,1fr))", gap: 8 }}>
                      {referenceUrls.map((src, index) => (
                        <div key={`${src}-${index}`} className="img-tile" style={{ aspectRatio: "4/3" }}>
                          <img src={src} alt=""/>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
  const phoneView = usePhoneView();
  const [tab, setTab] = useState("images");
  const [search, setSearch] = useState("");
  const { show, node } = useToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const libraryVideos = useMemo(() => [...state.videos].sort(taskSort), [state.videos]);
  const visibleVideos = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return libraryVideos;
    return libraryVideos.filter((v) => [
      v.title,
      v.prompt,
      v.status,
      v.aspect,
      v.resolution,
    ].join(" ").toLowerCase().includes(q));
  }, [libraryVideos, search]);
  const activeVideos = libraryVideos.filter((v) => isActiveTask(v.status));

  const onUpload = async (files) => {
    const list = Array.from(files || []);
    if (!list.length || uploading) return;
    setUploading(true);
    try {
      const uploaded = await Promise.all(list.map(async (file) => {
        const src = await prepareUploadImage(file);
        return uploadImageAsset({ name: file.name, src });
      }));
      uploaded.forEach((img) => addImage(img));
      show(`Uploaded ${uploaded.length} image${uploaded.length === 1 ? "" : "s"}`);
    } catch (error) {
      show(error.message || "Image upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
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
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={uploading}>
              <Icon name="upload" size={14} className={uploading ? "spin-ic" : undefined}/> {uploading ? "Uploading" : "Upload images"}
            </button>
            <input ref={inputRef} type="file" accept="image/*" multiple
                   style={{ display: "none" }}
                   onChange={(e) => onUpload(e.target.files)} />
            {!phoneView && (
              <span className="mono muted-2" style={{ fontSize: 11, letterSpacing: ".1em", alignSelf: "center" }}>
                Drag any tile onto Create to use as a scene frame
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 14 }}>
            {state.images.length === 0 && (
              <div className="muted" style={{ gridColumn: "1/-1", padding: 64, textAlign: "center" }}>
                No images yet. Upload some to reuse across generations.
              </div>
            )}
            {state.images.map((img) => (
              <div key={img.id} className="img-tile"
                draggable={!phoneView}
                onDragStart={(e) => {
                  if (phoneView) return;
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
