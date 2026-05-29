// Character page — the full identity dossier.
const { useState: useStateCP, useEffect: useEffectCP, useMemo: useMemoCP, useRef: useRefCP, useCallback: useCallbackCP } = React;

window.CharacterPage = function CharacterPage() {
  const [state, setState] = useStateCP(() => window.IG.load());
  const id = useMemoCP(() => {
    const q = new URLSearchParams(window.location.search);
    return q.get("id") || state.activeId || state.characters[0].id;
  }, []);
  const character = useMemoCP(() => window.IG.getCharacter(state, id), [state, id]);
  const [openZone, setOpenZone] = useStateCP(null);
  const [openMCP, setOpenMCP] = useStateCP(false);
  const [openInit, setOpenInit] = useStateCP(false);
  const [openGenLab, setOpenGenLab] = useStateCP(false);
  const [generatingAll, setGeneratingAll] = useStateCP(false);
  const [generatingZones, setGeneratingZones] = useStateCP(new Set());
  const [toasts, setToasts] = useStateCP([]);

  // tweaks
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "accent": "#2d5a3d",
    "density": "comfortable",
    "showGrid": true,
    "theme": "light"
  }/*EDITMODE-END*/;
  const [t, setTweak] = window.useTweaks(TWEAK_DEFAULTS);

  // apply tweaks to root
  useEffectCP(() => {
    const root = document.documentElement;
    root.setAttribute("data-density", t.density);
    root.setAttribute("data-theme", t.theme);
    root.style.setProperty("--accent", t.accent);
    if (t.accent === "#2d5a3d") root.style.setProperty("--accent-deep", "#1f3f2b");
    else if (t.accent === "#a8434e") root.style.setProperty("--accent-deep", "#761b27");
    else if (t.accent === "#2a4fa6") root.style.setProperty("--accent-deep", "#1a3577");
    else if (t.accent === "#a85d17") root.style.setProperty("--accent-deep", "#7a4310");
    else if (t.accent === "#1a1814") root.style.setProperty("--accent-deep", "#000");
    document.body.classList.toggle("hide-grid", !t.showGrid);
  }, [t]);

  function showToast(text, kind = "") {
    const id = Math.random().toString(36).slice(2);
    setToasts((p) => [...p, { id, text, kind }]);
    setTimeout(() => setToasts((p) => p.filter(x => x.id !== id)), 2600);
  }

  function updateChar(mut) {
    setState((s) => {
      const c = s.characters.find(x => x.id === id);
      if (!c) return s;
      mut(c);
      window.IG.save(s);
      return { ...s };
    });
  }
  function updateZone(zoneId, mut) {
    updateChar((c) => {
      c.zones[zoneId] = c.zones[zoneId] || { versions: [], selectedIndex: -1, prompt: "", history: [] };
      mut(c.zones[zoneId]);
    });
  }

  function handleSetUse(zoneId, idx) {
    updateZone(zoneId, (z) => { z.selectedIndex = idx; });
    showToast("Set Use → " + zoneId.replace("_"," ").toUpperCase() + " · V" + String.fromCharCode(65 + idx), "good");
  }

  function generateZone(zoneId) {
    if (generatingZones.has(zoneId)) return;
    setGeneratingZones((s) => new Set(s).add(zoneId));
    setTimeout(() => {
      const seed = (zoneId.length + Math.floor(Math.random() * 16)) % window.GEN_POOL_LEN;
      const photo = window.GEN_POOL[seed];
      const cropRoot = character?.generation?.outputs?.find(o => o.label === "VLM crops")?.url;
      const zoneCrop = cropRoot ? cropRoot + zoneId + ".png" : null;
      const refUrl = character?.generation?.references?.find(r => r.url)?.url;
      const compiled = window.IG.compileGenerationPrompt(character, zoneId, character?.prompt);
      updateZone(zoneId, (z) => {
        const newId = "V" + String.fromCharCode(65 + z.versions.length);
        z.versions.push({
          id: newId,
          url: zoneCrop || refUrl || window.IG.U(photo, 700),
          prompt: compiled || z.prompt || "",
          createdAt: Date.now(),
          note: character?.generation ? "Generated · compiled pipeline mock" : "Generated · batch",
        });
        z.selectedIndex = z.versions.length - 1;
      });
      setGeneratingZones((s) => { const n = new Set(s); n.delete(zoneId); return n; });
    }, 900 + Math.random() * 1000);
  }

  function generateAll() {
    if (generatingAll) return;
    setGeneratingAll(true);
    const empties = window.IG.ZONE_DEFS.filter(z => (character.zones[z.id]?.versions.length || 0) === 0);
    if (empties.length === 0) {
      showToast("All zones already have versions");
      setGeneratingAll(false);
      return;
    }
    showToast("Rendering " + empties.length + " zones…");
    empties.forEach((z, i) => setTimeout(() => generateZone(z.id), i * 220));
    setTimeout(() => setGeneratingAll(false), empties.length * 220 + 1800);
  }

  function toggleSetUseTarget(targetId) {
    updateChar((c) => {
      c.setUse = c.setUse || [];
      if (c.setUse.includes(targetId)) c.setUse = c.setUse.filter(x => x !== targetId);
      else c.setUse.push(targetId);
    });
  }

  function toggleLock() {
    updateChar((c) => { c.identityLock = !c.identityLock; });
  }

  // current zone for the right rail — defaults to first with versions
  const railZoneId = openZone || window.IG.ZONE_DEFS.find(z => character.zones[z.id]?.versions.length)?.id || window.IG.ZONE_DEFS[0].id;
  const railZone = window.IG.ZONE_DEFS.find(z => z.id === railZoneId);

  if (!character) {
    return (
      <div className="char-page">
        <window.IGHeader active="roster" />
        <div style={{ padding: 80, textAlign: "center", color: "var(--ink-mute)" }}>
          Identity not found. <a href="index.html" style={{ color: "var(--ink)" }}>Back to roster</a>
        </div>
      </div>
    );
  }

  return (
    <div className="char-page">
      <window.IGHeader active="roster" />

      <div className="char-subhead">
        <div className="crumbs">
          <a href="index.html">Roster</a>
          <span className="sep">/</span>
          <span className="mono" style={{ color: "var(--ink-mute)" }}>{character.id}</span>
          <span className="sep">/</span>
          <strong>{character.name}</strong>
        </div>
        <div className="actions">
          <button className="btn ghost sm" onClick={() => {
            if (character.generation) setOpenGenLab(true);
            else showToast("Analyzed — spec refreshed");
          }}>
            <Icon name="eye" size={11} /> Analyze refs
          </button>
          <button className="btn ghost sm" onClick={() => setOpenGenLab(true)}>
            <Icon name="wand" size={11} /> Image pipeline
          </button>
          <button className="btn ghost sm" onClick={generateAll} disabled={generatingAll}>
            <Icon name="sparkle" size={11} /> {generatingAll ? "Rendering…" : "Render sheet"}
          </button>
          <button className="btn ghost sm" onClick={() => setOpenInit(true)}>
            <Icon name="upload" size={11} /> Import + split
          </button>
          <button className="btn accent sm" onClick={() => setOpenMCP(true)}>
            <Icon name="download" size={11} /> Export · MCP
          </button>
        </div>
      </div>

      <div className="sheet-stage">
        <div className="sheet">
          {/* connectors */}
          {t.showGrid && (
            <svg className="connectors" data-grid="true" aria-hidden="true" preserveAspectRatio="none">
              {/* drawn in CSS via approximate placement — simpler dashed lines */}
              <line x1="280" y1="160" x2="320" y2="160" strokeDasharray="2 3" opacity=".3" />
              <line x1="280" y1="540" x2="320" y2="540" strokeDasharray="2 3" opacity=".3" />
            </svg>
          )}

          {/* LEFT — source + spec */}
          <div className="sheet-left">
            <div
              className="source-card frame"
            >
              <div className="frame__label">Source</div>
              <div className="src-inner" style={{ backgroundImage: `url(${character.source})`, backgroundPosition: character.sourcePos || "center top" }} />
              <div className="upload-hint">Origin · single ref</div>
            </div>

            <div className="spec-card frame">
              <div className="frame__label">Spec</div>
              <div className="name-block">
                <div className="id mono">{character.id}</div>
                <div className="nm serif">{character.name}</div>
              </div>
              <div className="row-spec"><b>Age</b><span>{character.spec.age}</span></div>
              <div className="row-spec"><b>Ethnicity</b><span>{character.spec.ethnicity}</span></div>
              <div className="row-spec"><b>Occupation</b><span>{character.spec.occupation}</span></div>
              <div className="row-spec"><b>Personality</b><span>{character.spec.personality}</span></div>
              <hr />
              <div className="row-spec"><b>Hair</b><span>{character.spec.hair}</span></div>
              <div className="row-spec"><b>Eyes</b><span>{character.spec.eyes}</span></div>
              <div className="row-spec"><b>Build</b><span>{character.spec.build}</span></div>
              <div className="row-spec"><b>Expression</b><span>{character.spec.expression}</span></div>
              <hr />
              <div className="row-spec"><b>Wardrobe</b><span>{character.spec.wardrobe}</span></div>
              <div className="row-spec"><b>Accessories</b><span>{character.spec.accessories}</span></div>
              <div className="row-spec"><b>Style</b><span>{character.spec.style}</span></div>
              <hr />
              <div className="row-spec"><b>Lighting</b><span>{character.spec.lighting}</span></div>
              <div className="row-spec"><b>Background</b><span>{character.spec.background}</span></div>

              <div className="lock-row">
                <span className="label">Identity Lock</span>
                <div className={"toggle " + (character.identityLock ? "on" : "")} onClick={toggleLock} />
              </div>
            </div>
          </div>

          {/* MIDDLE — zones */}
          <div className="sheet-mid">
            <div className="zone-row body">
              {["full_front","full_side","full_back","half_body"].map(zid => {
                const z = window.IG.ZONE_DEFS.find(x => x.id === zid);
                return (
                  <ZoneTile
                    key={zid}
                    zone={z}
                    data={character.zones[zid]}
                    aspect="3 / 4"
                    active={openZone === zid}
                    generating={generatingZones.has(zid)}
                    onOpen={() => setOpenZone(zid)}
                    onDrop={(file) => { setOpenZone(zid); /* file handled by editor's drop */ }}
                  />
                );
              })}
            </div>

            <div className="zone-row face">
              {["face_front","face_left","face_right"].map(zid => {
                const z = window.IG.ZONE_DEFS.find(x => x.id === zid);
                return (
                  <ZoneTile
                    key={zid}
                    zone={z}
                    data={character.zones[zid]}
                    aspect="1 / 1"
                    active={openZone === zid}
                    generating={generatingZones.has(zid)}
                    onOpen={() => setOpenZone(zid)}
                  />
                );
              })}
            </div>

            <div className="zone-row items">
              {["outfit","shoes","bag"].map(zid => {
                const z = window.IG.ZONE_DEFS.find(x => x.id === zid);
                return (
                  <ZoneTile
                    key={zid}
                    zone={z}
                    data={character.zones[zid]}
                    aspect="1 / 1"
                    active={openZone === zid}
                    generating={generatingZones.has(zid)}
                    onOpen={() => setOpenZone(zid)}
                  />
                );
              })}
            </div>

            {character.generation && (
              <GenerationSummary
                character={character}
                onOpen={() => setOpenGenLab(true)}
                onApply={() => {
                  const compiled = window.IG.compileGenerationPrompt(character, null, character.prompt);
                  updateChar(c => { c.prompt = compiled; });
                  showToast("Compiled prompt applied", "good");
                }}
              />
            )}

            {/* PROMPT + SET USE */}
            <div className="bottom-row">
              <div className="prompt-card frame">
                <div className="frame__label">Prompt</div>
                <div className="eyebrow" style={{ marginTop: 2 }}>Master prompt · applied to every generation in this sheet</div>
                <textarea
                  value={character.prompt}
                  onChange={(e) => updateChar(c => { c.prompt = e.target.value; })}
                />
                <div className="helper">
                  <span>{character.prompt.length} chars · {character.prompt.split(/\s+/).filter(Boolean).length} tokens est.</span>
                  <span className="row" style={{ gap: 6 }}>
                    <button className="btn ghost sm" onClick={() => {
                      const v = window.IG.imaginePrompts("full_front", character.spec.style);
                      updateChar(c => { c.prompt = v[0].text; });
                      showToast("Prompt rewritten", "good");
                    }}>
                      <Icon name="wand" size={11} /> Rewrite
                    </button>
                    <button className="btn ghost sm" onClick={() => {
                      navigator.clipboard?.writeText(character.prompt);
                      showToast("Prompt copied", "good");
                    }}>
                      <Icon name="copy" size={11} /> Copy
                    </button>
                  </span>
                </div>
              </div>

              <div className="setuse-card frame">
                <div className="frame__label">Set Use</div>
                <div className="eyebrow" style={{ marginTop: 2 }}>Surfaces where this identity is approved</div>
                <div className="targets">
                  {window.IG.SET_USE_TARGETS.map(t2 => {
                    const on = character.setUse.includes(t2.id);
                    return (
                      <button key={t2.id} className={"target " + (on ? "on" : "")} onClick={() => toggleSetUseTarget(t2.id)}>
                        <Icon name={t2.icon} size={22} stroke={1.4} />
                        <span className="lab">{t2.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT — version rail */}
          <div className="sheet-right">
            <VersionRail
              zone={railZone}
              data={character.zones[railZoneId]}
              onSelectVersion={(i) => updateZone(railZoneId, z => { z.selectedIndex = i; })}
              onSetUse={(i) => handleSetUse(railZoneId, i)}
              onOpen={() => setOpenZone(railZoneId)}
            />
            <button className="btn ghost sm" onClick={() => setOpenMCP(true)} style={{ justifyContent: "center" }}>
              <Icon name="download" size={11} /> Open MCP export
            </button>
          </div>
        </div>
      </div>

      {/* drawers */}
      {openZone && (
        <ZoneEditor
          zone={window.IG.ZONE_DEFS.find(z => z.id === openZone)}
          data={character.zones[openZone]}
          character={character}
          onClose={() => setOpenZone(null)}
          onUpdate={(mut) => updateZone(openZone, mut)}
          onToast={showToast}
        />
      )}

      {openMCP && (
        <MCPDrawer character={character} onClose={() => setOpenMCP(false)} onToast={showToast} />
      )}

      {openGenLab && (
        <GenerationLab
          character={character}
          onClose={() => setOpenGenLab(false)}
          onToast={showToast}
          onApplyPrompt={(text) => updateChar(c => { c.prompt = text; })}
        />
      )}

      {openInit && (
        <InitDrawer character={character} onClose={() => setOpenInit(false)} onToast={showToast} onSplit={(file) => {
          // mock: distribute the same file to all empty zones
          const reader = new FileReader();
          reader.onload = () => {
            const url = reader.result;
            window.IG.ZONE_DEFS.forEach(z => {
              const zd = character.zones[z.id];
              if (!zd || zd.versions.length === 0) {
                updateZone(z.id, x => {
                  x.versions.push({ id: "VA", url, prompt: "VLM split", createdAt: Date.now(), note: "Auto-split from sheet" });
                  x.selectedIndex = 0;
                });
              }
            });
            setOpenInit(false);
            showToast("Sheet split into " + window.IG.ZONE_DEFS.length + " zones", "good");
          };
          reader.readAsDataURL(file);
        }} />
      )}

      {/* toasts */}
      <div className="toast-wrap">
        {toasts.map(tt => (
          <div key={tt.id} className={"toast " + (tt.kind || "")}>
            {tt.kind === "good" && <Icon name="check" size={11} stroke={2.2} />}
            {tt.text}
          </div>
        ))}
      </div>

      {/* tweaks panel */}
      <CharacterTweaks t={t} setTweak={setTweak} />
    </div>
  );
};

function GenerationSummary({ character, onOpen, onApply }) {
  const g = character.generation;
  const refs = g.references || [];
  const loaded = refs.filter(r => r.url).length;
  const gates = g.qualityGates || [];

  return (
    <div className="gen-summary frame">
      <div className="frame__label">Image Pipeline</div>
      <div className="gen-summary__head">
        <div>
          <div className="eyebrow">Route · {g.renderRoute || "Generate + refine"}</div>
          <h3>{g.assetType || "Identity-preserving image"}</h3>
        </div>
        <div className="row">
          <span className="tag green"><Icon name="lock" size={10} /> Identity contract</span>
          <button className="btn ghost sm" onClick={onApply}><Icon name="wand" size={11} /> Compile</button>
          <button className="btn solid sm" onClick={onOpen}><Icon name="settings" size={11} /> Open</button>
        </div>
      </div>

      <div className="gen-metrics">
        <div><b>{refs.length}</b><span>Reference roles</span></div>
        <div><b>{loaded}</b><span>File-backed refs</span></div>
        <div><b>{g.refinementPasses?.length || 0}</b><span>Refine passes</span></div>
        <div><b>{gates.length}</b><span>Quality gates</span></div>
      </div>

      <div className="gen-refstrip">
        {refs.map((r) => (
          <div key={r.id} className={"gen-refchip " + (r.url ? "loaded" : "")}>
            <span>{r.label}</span>
            <small>{r.url ? "loaded" : "text contract"}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function GenerationLab({ character, onClose, onToast, onApplyPrompt }) {
  const g = character.generation || {
    references: [],
    identityContract: [],
    dogContract: [],
    sceneRules: [],
    qualityGates: [],
    refinementPasses: [],
  };
  const [compiled, setCompiled] = useStateCP(() => window.IG.compileGenerationPrompt(character, null, character.prompt));

  function copyPrompt() {
    navigator.clipboard?.writeText(compiled);
    onToast?.("Compiled prompt copied", "good");
  }

  function applyPrompt() {
    onApplyPrompt(compiled);
    onToast?.("Applied to master prompt", "good");
  }

  function addRefinement(pass) {
    const next = compiled + "\n\nRefinement pass — " + pass.label + ":\n" + pass.instruction;
    setCompiled(next);
    onToast?.("Refinement added: " + pass.label, "good");
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer wide">
        <div className="drawer-head">
          <div>
            <div className="title">Image Pipeline</div>
            <div className="id">{character.id} · {character.name} · {g.useCase || "identity-preserve"}</div>
          </div>
          <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>

        <div className="drawer-body">
          <div className="gen-lab-grid">
            <section className="gen-panel">
              <h4>Reference Stack</h4>
              <div className="gen-ref-list">
                {(g.references || []).map((r) => (
                  <div className="gen-ref" key={r.id}>
                    <div className="thumb" style={{ backgroundImage: r.url ? `url(${r.url})` : "none" }}>
                      {!r.url && <Icon name="image" size={20} />}
                    </div>
                    <div>
                      <div className="name">{r.label}</div>
                      <div className="role">{r.role}</div>
                      <p>{r.lock}</p>
                      <span className={"tag " + (r.url ? "green" : "")}>{r.url ? "Loaded" : "Written contract"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="gen-panel">
              <h4>Quality Gates</h4>
              <div className="gate-list">
                {(g.qualityGates || []).map((q) => (
                  <div className="gate" key={q.label}>
                    <Icon name="check" size={12} />
                    <div>
                      <b>{q.label}</b>
                      <p>{q.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="gen-panel">
            <h4>
              <span>Compiled Prompt</span>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" onClick={() => setCompiled(window.IG.compileGenerationPrompt(character, null, character.prompt))}>
                  <Icon name="refresh" size={11} /> Rebuild
                </button>
                <button className="btn ghost sm" onClick={copyPrompt}><Icon name="copy" size={11} /> Copy</button>
              </span>
            </h4>
            <textarea className="compiled-prompt" value={compiled} onChange={(e) => setCompiled(e.target.value)} />
          </section>

          <section className="gen-panel">
            <h4>Refinement Passes</h4>
            <div className="refine-grid">
              {(g.refinementPasses || []).map((pass) => (
                <button key={pass.id} className="refine-pass" onClick={() => addRefinement(pass)}>
                  <Icon name={pass.id === "text-clean" ? "crop" : pass.id === "hands-paws" ? "walk" : "wand"} size={18} />
                  <span>{pass.label}</span>
                  <small>{pass.instruction}</small>
                </button>
              ))}
            </div>
          </section>

          {g.negativePrompt && (
            <section className="gen-panel">
              <h4>Negative + Brand Guardrail</h4>
              <div className="code-block">{g.negativePrompt}</div>
            </section>
          )}
        </div>

        <div className="drawer-foot">
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>
            {compiled.length} chars · {compiled.split(/\s+/).filter(Boolean).length} tokens est.
          </span>
          <div className="row">
            <button className="btn ghost" onClick={onClose}>Close</button>
            <button className="btn accent" onClick={applyPrompt}><Icon name="wand" size={12} /> Apply Prompt</button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ---- generation pool exposed for character page batch use
window.GEN_POOL = [
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
window.GEN_POOL_LEN = window.GEN_POOL.length;

// ---- InitDrawer: upload a finished sheet, VLM-split into zones
function InitDrawer({ character, onClose, onSplit, onToast }) {
  const [drag, setDrag] = useStateCP(false);
  const [busy, setBusy] = useStateCP(false);
  const fileRef = useRefCP(null);

  function handle(file) {
    if (!file) return;
    setBusy(true);
    setTimeout(() => onSplit(file), 1100);
  }

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <div className="title">Import + Split</div>
            <div className="id">Upload a finished character sheet — VLM detects zones & assigns each crop.</div>
          </div>
          <button className="btn ghost icon" onClick={onClose}><Icon name="x" size={14} /></button>
        </div>
        <div className="drawer-body">
          <div
            className={"drop-zone " + (drag ? "over" : "")}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files?.length) handle(e.dataTransfer.files[0]); }}
            style={{ padding: "60px 16px" }}
          >
            <div className="big serif">Drop a full sheet</div>
            <div className="small">VLM will detect Full / Half / Face / Outfit / Shoes / Bag regions and assign crops</div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => handle(e.target.files?.[0])} />
          </div>

          <div style={{ marginTop: 20, padding: "14px 16px", background: "var(--paper-deep)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>What happens</div>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
              <li>VLM detects the {window.IG.ZONE_DEFS.length} zones from the source image.</li>
              <li>Each region becomes a new <b>Version A</b> for that zone.</li>
              <li>Empty zones are filled; existing versions are preserved.</li>
              <li>Identity-lock stays {character.identityLock ? "ON" : "OFF"}.</li>
            </ol>
          </div>

          {busy && (
            <div style={{ marginTop: 18, textAlign: "center", fontFamily: "var(--f-mono)", letterSpacing: ".14em", textTransform: "uppercase", fontSize: 11, color: "var(--ink-mute)" }}>
              <div className="pulse" style={{ width: 26, height: 26, borderRadius: "50%", border: "1.5px solid var(--ink)", margin: "0 auto 10px", animation: "pulse 1.1s infinite ease-in-out" }} />
              VLM analyzing…
            </div>
          )}
        </div>
        <div className="drawer-foot">
          <span className="mono" style={{ fontSize: 11, color: "var(--ink-mute)" }}>VLM · qwen-vl · region detection</span>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </aside>
    </>
  );
}

// ---- Tweaks panel for the character page
function CharacterTweaks({ t, setTweak }) {
  return (
    <window.TweaksPanel title="Tweaks · Identity Graph">
      <window.TweakSection label="Theme">
        <window.TweakRadio label="Mode" value={t.theme} options={[{value:"light",label:"Light"},{value:"dark",label:"Dark"}]} onChange={(v) => setTweak("theme", v)} />
        <window.TweakColor
          label="Accent"
          value={t.accent}
          options={["#2d5a3d","#2a4fa6","#a8434e","#a85d17","#1a1814"]}
          onChange={(v) => setTweak("accent", v)}
        />
      </window.TweakSection>
      <window.TweakSection label="Layout">
        <window.TweakRadio label="Density" value={t.density} options={[{value:"comfortable",label:"Comfortable"},{value:"compact",label:"Compact"}]} onChange={(v) => setTweak("density", v)} />
        <window.TweakToggle label="Connecting lines" value={t.showGrid} onChange={(v) => setTweak("showGrid", v)} />
      </window.TweakSection>
    </window.TweaksPanel>
  );
}
