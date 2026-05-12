import { useState, useRef, useMemo, useEffect } from 'react';
import { Icon, DropZone, VideoPlayer, GenerationProgress, useToast } from './components';
import { useStore, useHashRoute, relTime, fmtDate } from './store';

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

const ACTIVE_TASK_STATUSES = new Set(["queued", "running", "pending", "processing"]);
const TERMINAL_TASK_STATUSES = new Set(["succeeded", "failed", "cancelled", "expired"]);

function isActiveTask(status) {
  return ACTIVE_TASK_STATUSES.has(String(status || "").toLowerCase());
}

function videoPatchFromTask(task, current = {}) {
  const status = task.status || current.status || "queued";
  const monitorMode = task.monitor_mode || current.monitorMode || "poll";
  const progress = task.progress ?? (monitorMode === "webhook" && isActiveTask(status) ? null : current.progress ?? 0);

  return {
    id: current.id || task.id,
    taskId: task.id,
    arkTaskId: task.task_id,
    status,
    progress,
    monitorMode,
    title: task.title || current.title || "Untitled take",
    prompt: task.prompt || current.prompt || "",
    src: task.video_url || current.src || "",
    thumb: current.thumb || task.thumb || "",
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
  return "preview later";
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

async function fetchJson(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || `Request failed with HTTP ${res.status}`);
  }
  return data;
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
        timer = setTimeout(sync, hasActive ? 3000 : 15000);
      }
    };

    sync();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [updateVideo, upsertVideo]);

  return null;
}

export function Nav({ route, navigate }) {
  const { state } = useStore();
  const activeCount = state.videos.filter((v) => isActiveTask(v.status)).length;
  const items = [
    { path: "/", icon: "home", label: "Home", kbd: "1" },
    { path: "/create", icon: "sparkle", label: "Create", kbd: "2" },
    { path: "/library", icon: "grid", label: "Library", kbd: "3" },
    { path: "/queue", icon: "refresh", label: "Queue", kbd: activeCount ? String(activeCount) : "4" },
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
          : <div style={{ width: "100%", height: "100%", background: "linear-gradient(135deg,#222,#000)" }}/>}
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

function QueueEmptyState({ onCreate }) {
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
      <SectionHeader title="Pending Tasks" sub="server ledger · visible after tab close · supports parallel renders" count={activeVideos.length} />
      <div className="queue-note">
        <span className={activeVideos.length ? "spinner" : "queue-dot"} />
        <span>{activeVideos.length
          ? "Rendering tasks are tracked by the server. Open any card to watch its preview placeholder."
          : "This queue is empty now. It will stay visible so you always know where in-flight renders go."}</span>
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
        <QueueEmptyState onCreate={() => navigate("/create")} />
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
      <section style={{
        position: "relative", padding: "56px 64px 48px",
        borderBottom: "1px solid var(--line)",
      }}>
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
          Start from a reference plate or write the shot fresh. Every previous take is on the wall &mdash; click one to roll a variation.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary btn-lg" onClick={() => navigate("/create")}>
            <Icon name="plus" size={14}/> Roll new take
          </button>
          <button className="btn btn-lg" onClick={() => navigate("/library")}>
            <Icon name="grid" size={14}/> Asset locker
          </button>
        </div>

        <div style={{
          position: "absolute", right: 64, top: 56,
          fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-3)",
          textAlign: "right", lineHeight: 1.8,
        }}>
          <div>BAY · 02</div>
          <div>FPS · 24</div>
          <div>STOCK · {videos.length.toString().padStart(2, "0")} TAKES</div>
          <div>QUEUE · {activeVideos.length.toString().padStart(2, "0")} TASKS</div>
          <div style={{ color: activeVideos.length ? "var(--accent)" : "var(--accent-2)" }}>● {activeVideos.length ? "RENDERING" : "REC READY"}</div>
        </div>
      </section>

      <section style={{ padding: "32px 64px 0" }}>
        <PendingTaskList videos={videos} navigate={navigate} onTemplate={applyTemplate} />
      </section>

      <section style={{ padding: "32px 64px 64px" }}>
        <SectionHeader title="Dailies" sub="recent finished takes · click to revisit · grab as template" count={readyVideos.length} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 20 }}>
          {readyVideos.map((v) => <VideoCard key={v.id} v={v} onClick={() => navigate("/preview", { id: v.id })} onTemplate={() => applyTemplate(v)} />)}
        </div>
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

function GenerationOverlay({ progress, label }) {
  return (
    <div style={{
      minHeight: "calc(100vh - 80px)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 40, gap: 24,
    }}>
      <GenerationProgress progress={progress} label={label}/>
      <div className="mono muted" style={{ fontSize: 11, letterSpacing: ".15em", textTransform: "uppercase", maxWidth: 420, textAlign: "center", lineHeight: 1.7 }}>
        The task is saved on the server. You can close this tab and find it later in the Rendering Queue or Library.
      </div>
    </div>
  );
}

export function CreatePage() {
  const { state, addImage, addVideo } = useStore();
  const route = useHashRoute();
  const { navigate, query } = route;

  const tmpl = useMemo(() => state.videos.find((v) => v.id === query.from), [query.from, state.videos]);

  const [prompt, setPrompt] = useState(tmpl ? tmpl.prompt : "");
  const [model, setModel] = useState(tmpl ? tmpl.model : "seedance-pro");
  const [resolution, setResolution] = useState(tmpl ? tmpl.resolution : "1080p");
  const [aspect, setAspect] = useState(tmpl ? tmpl.aspect : "16:9");
  const [duration, setDuration] = useState(tmpl ? tmpl.duration : 5);
  const [camera, setCamera] = useState(tmpl ? tmpl.camera : "dynamic");
  const [seed, setSeed] = useState(() => (tmpl ? tmpl.seed : Math.floor(Math.random() * 99999)));
  const [image, setImage] = useState(null);
  const mode = image ? "i2v" : "t2v";

  const [gen, setGen] = useState(null);
  const { show, node } = useToast();

  const onPickFile = (img) => {
    const item = img.id ? img : addImage({ name: img.name || "upload.png", src: img.src });
    setImage(item);
  };

  const startGen = async () => {
    if (!prompt.trim()) { show("Write a prompt to generate"); return; }
    setGen({ progress: 2, label: "Submitting task" });

    try {
      const task = await fetchJson("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          image_url: image?.src,
          image_id: image?.id,
          thumb: image?.src,
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
        thumb: image?.src,
        imageId: image?.id,
      }));
      setGen(null);
      navigate("/preview", { id: v.id });
    } catch (error) {
      setGen(null);
      show(error.message || "Failed to submit task");
    }
  };

  if (gen) return <GenerationOverlay {...gen} />;

  return (
    <div style={{ padding: "32px 64px", maxWidth: 1400, margin: "0 auto" }}>
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

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr .9fr", gap: 28 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <div>
            <label className="label">
              Reference image · <em style={{ color: "var(--fg-3)", fontStyle: "normal" }}>optional — leave empty for text-to-video</em>
            </label>
            <DropZone onFile={onPickFile} image={image} onClear={() => setImage(null)} hint={"Drop image for I→V, or skip for T→V"} />
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
                ? "Describe motion: 'camera pushes in slowly, steam curls, light flickers...'"
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
            {image ? "Image → Video" : "Text → Video"} · auto
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

          <button className="btn btn-primary btn-lg" onClick={startGen} style={{ marginTop: 4 }}>
            <Icon name="sparkle" size={14}/> Generate video
          </button>
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
              Rendering
            </div>
            <h2 className="display" style={{ color: "#fff", fontSize: 30, margin: "0 0 12px", lineHeight: 1.1 }}>
              Preview will appear here later.
            </h2>
            <p style={{ color: "rgba(255,255,255,.72)", maxWidth: 520, lineHeight: 1.55, margin: "0 auto" }}>
              This task is stored on the server. You can close this tab; reopen Home, Library, or this preview page to see the result after the callback arrives.
            </p>
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

  useEffect(() => {
    videoRef.current = v;
  }, [v]);

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

        if (!TERMINAL_TASK_STATUSES.has(task.status)) {
          timer = setTimeout(poll, 2500);
        }
      } catch (error) {
        if (!stopped) {
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
    <div style={{ padding: 64, textAlign: "center" }}>
      <p className="muted">Loading task...</p>
      <button className="btn" onClick={() => navigate("/")}>← Back to gallery</button>
    </div>
  );

  const onDownload = () => {
    if (!v.src) {
      show("Video is not ready yet");
      return;
    }
    const a = document.createElement("a");
    a.href = v.src;
    a.download = `${v.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.mp4`;
    a.target = "_blank";
    a.click();
    show("Download started");
  };
  const onDelete = () => {
    if (!confirm("Delete this video permanently?")) return;
    removeVideo(v.id);
    navigate("/");
  };
  const onTemplate = () => navigate("/create", { from: v.id });
  const ready = Boolean(v.src) && (!v.status || v.status === "succeeded");

  return (
    <div style={{ padding: "32px 64px", maxWidth: 1400, margin: "0 auto" }}>
      {node}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
        <button className="btn btn-ghost" onClick={() => navigate("/")}>
          <Icon name="arrowLeft" size={14}/> Back to gallery
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onTemplate}><Icon name="copy" size={14}/> Use as template</button>
          <button className="btn" onClick={onDownload} disabled={!v.src}><Icon name="download" size={14}/> Download</button>
          <button className="btn" onClick={onDelete} title="Delete"><Icon name="trash" size={14}/></button>
        </div>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1.6fr .9fr", gap: 28 }}>
        <div>
          {ready ? <VideoPlayer src={v.src} poster={v.thumb} autoplay/> : <TaskWaitPanel v={v} />}
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
          {v.imageId && (() => {
            const ref = state.images.find((i) => i.id === v.imageId);
            if (!ref) return null;
            return (
              <div>
                <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 8 }}>Reference</div>
                <div className="img-tile" style={{ aspectRatio: "16/9", height: 140 }}>
                  <img src={ref.src} alt=""/>
                </div>
              </div>
            );
          })()}
        </aside>
      </div>
    </div>
  );
}

export function QueuePage() {
  const { state } = useStore();
  const { navigate } = useHashRoute();
  const videos = useMemo(() => [...state.videos].sort(taskSort), [state.videos]);
  const activeVideos = videos.filter((v) => isActiveTask(v.status));
  const completed = videos.filter((v) => !isActiveTask(v.status)).slice(0, 8);
  const applyTemplate = (v) => navigate("/create", { from: v.id });

  return (
    <div style={{ padding: "32px 64px", maxWidth: 1500, margin: "0 auto" }}>
      <header style={{ marginBottom: 28, display: "flex", alignItems: "end", justifyContent: "space-between", gap: 16 }}>
        <div>
          <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".18em", textTransform: "uppercase", marginBottom: 6 }}>
            Server task ledger
          </div>
          <h1 className="display" style={{ fontSize: 40, margin: 0 }}>
            Queue
          </h1>
        </div>
        <button className="btn btn-primary" onClick={() => navigate("/create")}>
          <Icon name="plus" size={14}/> New render
        </button>
      </header>

      <PendingTaskList videos={videos} navigate={navigate} onTemplate={applyTemplate} />

      <section style={{ marginTop: 42 }}>
        <SectionHeader title="Recent Previews" sub="completed tasks from the same server ledger" count={completed.length} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 18 }}>
          {completed.map((v) => (
            <VideoCard
              key={v.id}
              v={v}
              onClick={() => navigate("/preview", { id: v.id })}
              onTemplate={() => applyTemplate(v)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

export function LibraryPage() {
  const { state, removeImage, removeVideo, addImage } = useStore();
  const { navigate } = useHashRoute();
  const [tab, setTab] = useState("images");
  const { show, node } = useToast();
  const inputRef = useRef(null);
  const libraryVideos = useMemo(() => [...state.videos].sort(taskSort), [state.videos]);
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
    <div style={{ padding: "32px 64px", maxWidth: 1500, margin: "0 auto" }}>
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
              Drag any tile onto Create to use as reference
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
          <div className="queue-note" style={{ marginBottom: 18 }}>
            <span className={activeVideos.length ? "spinner" : "queue-dot"} />
            <span>{activeVideos.length
              ? `${activeVideos.length} rendering task${activeVideos.length > 1 ? "s" : ""} are tracked by the server and will update here when ready.`
              : "No pending tasks right now. The Queue page remains available from the sidebar."}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 18 }}>
          {state.videos.length === 0 && (
            <div className="muted" style={{ gridColumn: "1/-1", padding: 64, textAlign: "center" }}>
              No videos yet. Generate one from Create.
            </div>
          )}
          {libraryVideos.map((v) => (
            <div key={v.id} style={{ position: "relative" }}>
              <VideoCard v={v}
                onClick={() => navigate("/preview", { id: v.id })}
                onTemplate={() => navigate("/create", { from: v.id })}/>
              <button className="btn btn-icon"
                onClick={(e) => { e.stopPropagation(); if (confirm("Delete this video?")) { removeVideo(v.id); show("Video removed"); } }}
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
