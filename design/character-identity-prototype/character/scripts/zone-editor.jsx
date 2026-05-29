// ZoneEditor — drawer that opens when you click a zone. The deep editor:
//   - Current selected version preview + version grid
//   - Drag-drop upload
//   - Description / prompt textarea
//   - "Agent Imagine" → curated prompt variations
//   - Generate button (mocks new version)
const { useState: useStateZE, useRef: useRefZE, useEffect: useEffectZE } = React;

const GEN_POOL = [
  "photo-1438761681033-6461ffad8d80",
  "photo-1517841905240-472988babdf9",
  "photo-1494790108377-be9c29b29330",
  "photo-1463453091185-61582044d556",
  "photo-1488161628813-04466f872be2",
  "photo-1531123897727-8f129e1688ce",
  "photo-1554151228-14d9def656e4",
  "photo-1500648767791-00dcc994a43e",
  "photo-1509909756405-be0199881695",
  "photo-1492562080023-ab3db95bfbce",
  "photo-1524504388940-b1c1722653e1",
  "photo-1542327897-d73f4005b533",
  "photo-1545167622-3a6ac756afa4",
  "photo-1599566150163-29194dcaad36",
  "photo-1521119989659-a83eee488004",
  "photo-1573497019418-b400bb3ab074",
];

window.ZoneEditor = function ZoneEditor({ zone, data, character, onClose, onUpdate, onToast }) {
  const [prompt, setPrompt] = useStateZE(data?.prompt || "");
  const [variants, setVariants] = useStateZE([]);
  const [busy, setBusy] = useStateZE(false);
  const fileRef = useRefZE(null);
  const [drag, setDrag] = useStateZE(false);

  useEffectZE(() => { setPrompt(data?.prompt || ""); setVariants([]); }, [zone?.id]);

  if (!zone) return null;
  const versions = data?.versions || [];
  const selIdx = data?.selectedIndex ?? -1;
  const current = versions[selIdx] || null;

  function pickFile() { fileRef.current?.click(); }
  function handleFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result;
      const id = "V" + String.fromCharCode(65 + versions.length);
      const newV = { id, url, prompt, createdAt: Date.now(), note: "Uploaded — " + file.name };
      onUpdate(d => {
        d.versions.push(newV);
        d.selectedIndex = d.versions.length - 1;
      });
      onToast?.("Uploaded as " + id, "good");
    };
    reader.readAsDataURL(file);
  }

  function imagine() {
    const list = window.IG.imaginePrompts(zone.id, character?.spec?.style);
    setVariants(list);
  }

  function compilePrompt() {
    const next = window.IG.compileGenerationPrompt(character, zone.id, prompt || character?.prompt);
    setPrompt(next);
    onToast?.("Compiled identity prompt", "good");
  }

  function applyRefinement(pass) {
    const next = (prompt || window.IG.compileGenerationPrompt(character, zone.id, character?.prompt)) +
      "\n\nRefinement pass — " + pass.label + ":\n" + pass.instruction;
    setPrompt(next);
    onToast?.("Added refinement: " + pass.label, "good");
  }

  function generate() {
    if (busy) return;
    setBusy(true);
    setTimeout(() => {
      // pick deterministic-ish photo from pool based on zone + count
      const seed = (zone.id.length + versions.length + Math.floor(Math.random() * 11)) % GEN_POOL.length;
      const photo = GEN_POOL[seed];
      const cropRoot = character?.generation?.outputs?.find(o => o.label === "VLM crops")?.url;
      const zoneCrop = cropRoot ? cropRoot + zone.id + ".png" : null;
      const refUrl = character?.generation?.references?.find(r => r.url)?.url;
      const url = zoneCrop || refUrl || window.IG.U(photo, 700);
      const id = "V" + String.fromCharCode(65 + versions.length);
      const compiled = window.IG.compileGenerationPrompt(character, zone.id, prompt || character?.prompt);
      onUpdate(d => {
        d.versions.push({
          id, url,
          prompt: compiled || "(no prompt)",
          createdAt: Date.now(),
          note: character?.generation ? "Generated · compiled pipeline mock" : "Generated · seed " + seed,
        });
        d.selectedIndex = d.versions.length - 1;
        d.prompt = compiled;
      });
      setBusy(false);
      onToast?.("Generated " + id, "good");
    }, 1400);
  }

  function selectVersion(i) {
    onUpdate(d => { d.selectedIndex = i; });
  }
  function deleteVersion(i) {
    onUpdate(d => {
      d.versions.splice(i, 1);
      d.selectedIndex = Math.min(d.selectedIndex, d.versions.length - 1);
    });
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="title">{zone.label}</div>
            <div className="id">Zone · {zone.id.replace("_", " ").toUpperCase()} · {versions.length} versions</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </div>

        <div className="drawer-body">
          {/* current */}
          <div className="ze-current">
            <div className={"preview" + (!current ? " empty" : "")} style={{ backgroundImage: current ? `url(${current.url})` : "none" }}>
              {!current && <Icon name="image" size={28} style={{ opacity: .4 }} />}
            </div>
            <div className="meta-stack">
              <div>
                <div className="eyebrow">In Use</div>
                <h3>{current ? `Version ${current.id.replace("V","")}` : "No version selected"}</h3>
              </div>
              {current && (
                <>
                  <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{current.note}</div>
                  <div className="eyebrow">Source URL</div>
                  <div className="code-block" style={{ fontSize: 10.5, padding: "6px 8px" }}>{shortUrl(current.url)}</div>
                </>
              )}
              <div className="row" style={{ marginTop: 6 }}>
                {current && <button className="btn ghost sm" onClick={() => deleteVersion(selIdx)}><Icon name="x" size={11} /> Delete</button>}
                <button className="btn sm" onClick={pickFile}><Icon name="upload" size={11} /> Replace</button>
              </div>
            </div>
          </div>

          {/* versions grid */}
          <div className="ze-section">
            <h4>
              <span>All Versions <span style={{ color: "var(--ink-faint)" }}>· {versions.length}</span></span>
              <button className="btn ghost sm" onClick={() => onUpdate(d => { d.selectedIndex = -1; })} disabled={selIdx === -1}>
                <Icon name="eye" size={11} /> Clear use
              </button>
            </h4>
            {versions.length === 0 ? (
              <div style={{ color: "var(--ink-mute)", fontSize: 12.5, padding: "12px 0" }}>
                No versions yet — drop an image below or hit Generate.
              </div>
            ) : (
              <div className="versions-grid">
                {versions.map((v, i) => (
                  <div key={v.id} className={"v" + (i === selIdx ? " selected" : "")} onClick={() => selectVersion(i)}>
                    <div className="vimg" style={{ backgroundImage: `url(${v.url})` }} />
                    <div className="vlabel">
                      <span>{v.id} · {relTimeEZ(v.createdAt)}</span>
                      {i === selIdx ? <Icon name="check" size={11} /> : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* upload */}
          <div
            className={"drop-zone " + (drag ? "over" : "")}
            onClick={pickFile}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault(); setDrag(false);
              if (e.dataTransfer.files?.length) handleFile(e.dataTransfer.files[0]);
            }}
          >
            <div className="big serif">Drop an image, or click to upload</div>
            <div className="small">PNG, JPG, WEBP — added as a new version</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files?.[0])} />
          </div>

          {/* prompt + agent imagine */}
          <div className="ze-section" style={{ marginTop: 24 }}>
            <h4>
              <span>Description / Prompt</span>
              <span className="row" style={{ gap: 6 }}>
                {character?.generation && (
                  <button className="btn ghost sm" onClick={compilePrompt}>
                    <Icon name="settings" size={11} /> Compile
                  </button>
                )}
                <button className="btn ghost sm" onClick={imagine}>
                  <Icon name="wand" size={11} /> Agent imagine
                </button>
              </span>
            </h4>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={"Describe this " + zone.label.toLowerCase() + ". Identity lock will preserve the face."}
              style={{
                width: "100%",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                padding: 12,
                background: "var(--paper)",
                color: "var(--ink)",
                fontFamily: "var(--f-sans)",
                fontSize: 13,
                lineHeight: 1.55,
                minHeight: 92,
              }}
            />
            {variants.length > 0 && (
              <div className="prompt-variants" style={{ marginTop: 10 }}>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Agent suggestions · click to use</div>
                {variants.map((v, i) => (
                  <div key={v.id} className="pv" onClick={() => setPrompt(v.text)}>
                    <div className="num">Variant {String.fromCharCode(65 + i)}</div>
                    {v.text}
                  </div>
                ))}
              </div>
            )}
            {character?.generation?.refinementPasses?.length > 0 && (
              <div className="zone-refine">
                <div className="eyebrow" style={{ marginBottom: 6 }}>Targeted refine · append pass to prompt</div>
                <div className="zone-refine-grid">
                  {character.generation.refinementPasses.map((pass) => (
                    <button key={pass.id} className="zone-refine-btn" onClick={() => applyRefinement(pass)}>
                      <Icon name={pass.id === "text-clean" ? "crop" : pass.id === "hands-paws" ? "walk" : "wand"} size={14} />
                      {pass.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-foot">
          <div className="row" style={{ gap: 10 }}>
            <span className={"tag" + (character?.identityLock ? " green" : "")}>
              <Icon name={character?.identityLock ? "lock" : "unlock"} size={10} />
              {character?.identityLock ? "Identity locked" : "Identity unlocked"}
            </span>
            {busy && <span className="mono" style={{ color: "var(--ink-mute)", fontSize: 11 }}>Rendering…</span>}
          </div>
          <div className="row">
            <button className="btn ghost" onClick={onClose}>Close</button>
            <button className="btn accent" onClick={generate} disabled={busy}>
              <Icon name="sparkle" size={12} />
              {busy ? "Generating…" : "Generate version"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

function shortUrl(u) {
  if (!u) return "";
  if (u.startsWith("data:")) return "data:image/* (uploaded · " + Math.round(u.length / 1024) + " KB)";
  try {
    const parts = new URL(u).pathname.split("/");
    return ".../" + parts[parts.length - 1].slice(0, 36) + "…";
  } catch (e) { return u.slice(0, 48) + "…"; }
}
function relTimeEZ(ts) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "now";
  if (d < 3600) return Math.floor(d/60) + "m";
  if (d < 86400) return Math.floor(d/3600) + "h";
  return Math.floor(d/86400) + "d";
}
