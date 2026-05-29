// MCPDrawer — export / stitch panel.
// Pick zones, pick template, see live preview composed of selected zones' currently-set-use versions.
// "Download PNG" composes via canvas. "Copy MCP endpoint" gives a URL.
const { useState: useStateMD, useMemo: useMemoMD, useEffect: useEffectMD } = React;

const MCP_TEMPLATES = [
  { id: "sheet",    label: "Character Sheet",   sub: "Full reference"  },
  { id: "contact",  label: "Contact Sheet",     sub: "Grid"            },
  { id: "lookbook", label: "Lookbook Page",     sub: "Hero + thumbs"   },
  { id: "social",   label: "Social Tile",       sub: "Square"          },
];

window.MCPDrawer = function MCPDrawer({ character, onClose, onToast }) {
  const allZones = window.IG.ZONE_DEFS;
  const [selected, setSelected] = useStateMD(() => {
    return new Set(allZones.filter(z => character.zones[z.id]?.versions.length > 0).map(z => z.id));
  });
  const [template, setTemplate] = useStateMD("sheet");
  const [dedup, setDedup] = useStateMD(true);
  const [size, setSize] = useStateMD(1600);
  const [busy, setBusy] = useStateMD(false);

  function toggle(id) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  }
  function selectAll() { setSelected(new Set(allZones.map(z => z.id).filter(id => character.zones[id]?.versions.length))); }
  function clearAll() { setSelected(new Set()); }

  const picks = useMemoMD(() => {
    const seen = new Set();
    const out = [];
    for (const z of allZones) {
      if (!selected.has(z.id)) continue;
      const zd = character.zones[z.id];
      const v = zd?.versions[zd?.selectedIndex];
      if (!v) continue;
      if (dedup && seen.has(v.url)) continue;
      seen.add(v.url);
      out.push({ zone: z, url: v.url, ver: v.id });
    }
    return out;
  }, [character, selected, dedup]);

  // build a deterministic export filename
  const fileName = `${character.id}_${template}_${picks.length}zones.png`;
  const endpoint = `https://igraph.local/mcp/v1/stitch?id=${character.id}&tpl=${template}&z=${[...selected].join(",")}&dedup=${dedup}&w=${size}`;

  function copyEndpoint() {
    navigator.clipboard?.writeText(endpoint);
    onToast?.("MCP endpoint copied", "good");
  }

  async function downloadComposite() {
    if (picks.length === 0) { onToast?.("Pick at least one zone"); return; }
    setBusy(true);
    try {
      const canvas = await composeCanvas(picks, template, size);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = fileName;
      a.click();
      onToast?.("Downloaded " + fileName, "good");
    } catch (e) {
      console.error(e);
      onToast?.("Compose failed — see console");
    } finally { setBusy(false); }
  }

  // preview grid layout per template
  const preview = renderPreview(template, picks);

  const filledCount = allZones.filter(z => character.zones[z.id]?.versions.length).length;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer wide">
        <div className="drawer-head">
          <div>
            <div className="title">Export · MCP Stitch</div>
            <div className="id">{character.id} · {character.name} · {filledCount}/{allZones.length} zones available</div>
          </div>
          <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="drawer-body">
          {/* template */}
          <div className="ze-section">
            <h4>Template</h4>
            <div className="mcp-templates">
              {MCP_TEMPLATES.map(t => (
                <div key={t.id} className={"t" + (template === t.id ? " on" : "")} onClick={() => setTemplate(t.id)}>
                  <div className="icon-box">
                    <TemplateIcon id={t.id} />
                  </div>
                  <div className="name">{t.label}</div>
                  <div style={{ fontSize: 10, color: "var(--ink-mute)", marginTop: 3 }}>{t.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {/* zone select + preview */}
          <div className="ze-section">
            <h4>
              <span>Zones · {selected.size} selected</span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" onClick={selectAll}>Select all</button>
                <button className="btn ghost sm" onClick={clearAll}>Clear</button>
              </span>
            </h4>

            <div className="mcp-grid">
              <div className="mcp-zones">
                {allZones.map(z => {
                  const has = character.zones[z.id]?.versions.length > 0;
                  const cur = character.zones[z.id]?.versions[character.zones[z.id]?.selectedIndex];
                  return (
                    <div
                      key={z.id}
                      className={"item " + (selected.has(z.id) ? "on " : "") + (!has ? "disabled" : "")}
                      onClick={() => has && toggle(z.id)}
                      style={{ opacity: has ? 1 : .35, cursor: has ? "pointer" : "not-allowed" }}
                    >
                      <div className="check">
                        {selected.has(z.id) && <Icon name="check" size={10} stroke={2.2} />}
                      </div>
                      <span style={{ flex: 1 }}>{z.label}</span>
                      <span className="mono" style={{ fontSize: 9.5, color: "var(--ink-faint)" }}>
                        {cur ? cur.id : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="mcp-preview">
                <div className="row" style={{ justifyContent: "space-between", color: "var(--ink-mute)", fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>
                  <span>Preview · {template}</span>
                  <span>{picks.length} tiles{dedup ? " · dedup ON" : ""}</span>
                </div>
                <div className="mcp-preview-canvas" style={preview.style}>
                  {picks.length === 0 ? (
                    <div style={{ gridColumn: "1 / -1", display: "grid", placeItems: "center", color: "var(--ink-faint)", fontSize: 12, fontFamily: "var(--f-mono)" }}>
                      Empty — pick zones from the left.
                    </div>
                  ) : preview.tiles(picks)}
                </div>
              </div>
            </div>
          </div>

          {/* options */}
          <div className="ze-section">
            <h4>Options</h4>
            <div className="row" style={{ gap: 18, flexWrap: "wrap" }}>
              <label className="row" style={{ gap: 8, cursor: "pointer" }}>
                <span className={"toggle " + (dedup ? "on" : "")} onClick={() => setDedup(!dedup)} />
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase" }}>
                  Dedup identical images
                </span>
              </label>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ fontFamily: "var(--f-mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--ink-mute)" }}>Width</span>
                <div className="seg" style={{ display: "inline-flex", border: "1px solid var(--line)", borderRadius: 4, overflow: "hidden" }}>
                  {[1200, 1600, 2400].map(s => (
                    <button key={s}
                      onClick={() => setSize(s)}
                      style={{
                        padding: "5px 10px", fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: ".1em",
                        background: size === s ? "var(--ink)" : "transparent",
                        color: size === s ? "var(--paper)" : "var(--ink-mute)",
                        borderRight: "1px solid var(--line)",
                      }}>{s}px</button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* endpoint */}
          <div className="ze-section">
            <h4>MCP endpoint</h4>
            <div className="code-block">
              <button className="btn sm ghost copy" onClick={copyEndpoint}><Icon name="copy" size={11} /> Copy</button>
              {endpoint}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink-mute)", marginTop: 8, lineHeight: 1.5 }}>
              Returns a single composed PNG. Idempotent: same parameters → same image hash.
              Add <span className="mono">&dl=zip</span> to receive originals + composite as a zip.
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          <div className="row">
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
              {picks.length} zones · {(picks.length * size * (template === "social" ? 1 : 1.33) / 1e6).toFixed(1)} MP est.
            </span>
          </div>
          <div className="row">
            <button className="btn ghost" onClick={onClose}>Close</button>
            <button className="btn solid" onClick={copyEndpoint}><Icon name="link" size={12} /> Copy URL</button>
            <button className="btn accent" onClick={downloadComposite} disabled={busy}>
              <Icon name="download" size={12} />
              {busy ? "Composing…" : "Download PNG"}
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

function TemplateIcon({ id }) {
  const sp = { fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" };
  if (id === "sheet") return (
    <svg viewBox="0 0 40 30" width="40" height="30">
      <rect x="1" y="1" width="38" height="28" rx="1" {...sp} />
      <rect x="3" y="3" width="9" height="14" {...sp} />
      <rect x="3" y="19" width="9" height="8" {...sp} />
      <rect x="14" y="3" width="6" height="14" {...sp} />
      <rect x="22" y="3" width="6" height="14" {...sp} />
      <rect x="30" y="3" width="7" height="14" {...sp} />
      <rect x="14" y="19" width="11" height="8" {...sp} />
      <rect x="27" y="19" width="10" height="8" {...sp} />
    </svg>
  );
  if (id === "contact") return (
    <svg viewBox="0 0 40 30" width="40" height="30">
      <rect x="1" y="1" width="38" height="28" rx="1" {...sp} />
      {[0,1,2,3].map(c => [0,1,2].map(r => (
        <rect key={c+"-"+r} x={3 + c*9} y={3 + r*8} width="7" height="6" {...sp} />
      )))}
    </svg>
  );
  if (id === "lookbook") return (
    <svg viewBox="0 0 40 30" width="40" height="30">
      <rect x="1" y="1" width="38" height="28" rx="1" {...sp} />
      <rect x="3" y="3" width="20" height="24" {...sp} />
      <rect x="25" y="3" width="12" height="7" {...sp} />
      <rect x="25" y="12" width="12" height="7" {...sp} />
      <rect x="25" y="21" width="12" height="6" {...sp} />
    </svg>
  );
  if (id === "social") return (
    <svg viewBox="0 0 40 30" width="40" height="30">
      <rect x="6" y="1" width="28" height="28" rx="1" {...sp} />
      <rect x="8" y="3" width="24" height="24" {...sp} />
    </svg>
  );
}

// build the preview grid + tile renderer for a template
function renderPreview(template, picks) {
  if (template === "sheet") {
    return {
      style: { gridTemplateColumns: "1fr 1fr 1fr 1fr", gridAutoRows: "1fr" },
      tiles: (p) => p.map((it, i) => (
        <div key={i} className="ct" data-label={it.zone.label} style={{ backgroundImage: `url(${it.url})` }} />
      )),
    };
  }
  if (template === "contact") {
    return {
      style: { gridTemplateColumns: "repeat(5, 1fr)" },
      tiles: (p) => p.map((it, i) => (
        <div key={i} className="ct" data-label={it.zone.label} style={{ backgroundImage: `url(${it.url})`, aspectRatio: "1 / 1" }} />
      )),
    };
  }
  if (template === "lookbook") {
    return {
      style: { gridTemplateColumns: "2fr 1fr 1fr" },
      tiles: (p) => p.map((it, i) => (
        <div
          key={i}
          className="ct"
          data-label={it.zone.label}
          style={{
            gridColumn: i === 0 ? "span 1" : "span 1",
            gridRow: i === 0 ? "span 3" : "span 1",
            backgroundImage: `url(${it.url})`,
          }}
        />
      )),
    };
  }
  if (template === "social") {
    return {
      style: { gridTemplateColumns: "1fr 1fr", gridAutoRows: "1fr" },
      tiles: (p) => p.slice(0,4).map((it, i) => (
        <div key={i} className="ct" data-label={it.zone.label} style={{ backgroundImage: `url(${it.url})`, aspectRatio: "1 / 1" }} />
      )),
    };
  }
  return { style: {}, tiles: () => null };
}

// Compose a real canvas PNG of the selection + template
async function composeCanvas(picks, template, width) {
  function loadImg(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  let cols, aspect, header = 80;
  if (template === "sheet")   { cols = 4; aspect = 0.75; }
  else if (template === "contact") { cols = 5; aspect = 1; }
  else if (template === "lookbook") { cols = 3; aspect = 0.75; }
  else { cols = 2; aspect = 1; }

  // load all (failures fall back to neutral tile)
  const imgs = await Promise.all(picks.map(async (p) => {
    try { return await loadImg(p.url); } catch { return null; }
  }));

  const pad = Math.round(width / 80);
  const innerW = width - pad * 2;
  const cellW = (innerW - pad * (cols - 1)) / cols;
  const cellH = cellW / aspect;
  const rows = Math.ceil(picks.length / cols);
  const height = header + pad + rows * cellH + (rows - 1) * pad + pad * 2;

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = Math.ceil(height);
  const ctx = canvas.getContext("2d");

  // background
  ctx.fillStyle = "#f3eee2"; ctx.fillRect(0, 0, canvas.width, canvas.height);

  // header
  ctx.fillStyle = "#1a1814";
  ctx.font = "500 18px JetBrains Mono, monospace";
  ctx.fillText("IDENTITY GRAPH · " + template.toUpperCase(), pad, 28);
  ctx.font = "400 13px Geist, system-ui, sans-serif";
  ctx.fillText(picks.map(p => p.zone.label).join(" · "), pad, 50);
  // divider
  ctx.strokeStyle = "#1a1814"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, header - 4); ctx.lineTo(width - pad, header - 4); ctx.stroke();

  for (let i = 0; i < picks.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = pad + c * (cellW + pad);
    const y = header + pad + r * (cellH + pad);
    ctx.fillStyle = "#ece5d2";
    ctx.fillRect(x, y, cellW, cellH);
    const img = imgs[i];
    if (img) {
      // cover fit
      const ir = img.width / img.height;
      const cr = cellW / cellH;
      let sw, sh, sx, sy;
      if (ir > cr) {
        sh = img.height; sw = img.height * cr;
        sx = (img.width - sw) / 2; sy = 0;
      } else {
        sw = img.width; sh = img.width / cr;
        sx = 0; sy = 0;
      }
      ctx.drawImage(img, sx, sy, sw, sh, x, y, cellW, cellH);
    }
    ctx.strokeStyle = "#1a1814";
    ctx.strokeRect(x + .5, y + .5, cellW - 1, cellH - 1);
    // zone label tag
    ctx.fillStyle = "rgba(0,0,0,.78)";
    const txt = picks[i].zone.label.toUpperCase();
    ctx.font = "500 10px JetBrains Mono, monospace";
    const w = ctx.measureText(txt).width + 12;
    ctx.fillRect(x + 6, y + 6, w, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(txt, x + 12, y + 17);
  }

  return canvas;
}
