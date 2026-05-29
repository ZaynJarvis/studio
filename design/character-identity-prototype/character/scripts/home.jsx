// Home / roster page — character gallery
const { useState, useMemo, useEffect } = React;

function fillRate(char) {
  const zones = window.IG.ZONE_DEFS;
  const filled = zones.filter(z => char.zones[z.id] && char.zones[z.id].versions.length > 0).length;
  return { filled, total: zones.length, pct: Math.round((filled / zones.length) * 100) };
}

function CharacterCard({ char }) {
  const fr = fillRate(char);
  const href = `character.html?id=${encodeURIComponent(char.id)}`;
  return (
    <a className="char-card" href={href}>
      <div className="ph" style={{ backgroundImage: `url(${char.source})`, backgroundPosition: char.sourcePos || "center top" }}>
        <div className="id-stamp">{char.id}</div>
        <div className={"lock " + (char.identityLock ? "" : "off")}>
          <Icon name={char.identityLock ? "lock" : "unlock"} size={10} stroke={1.6} />
          {char.identityLock ? "LOCK ON" : "OFF"}
        </div>
      </div>
      <div className="body">
        <div className="name">{char.name}</div>
        <div className="tagline">{char.tagline}</div>
        <div className="specrow">
          <span><b>Age</b> {char.spec.age}</span>
          <span><b>Eth</b> {char.spec.ethnicity}</span>
          <span><b>Occ</b> {char.spec.occupation}</span>
          <span><b>Style</b> {char.spec.style?.split(",")[0]}</span>
        </div>
      </div>
      <div className="foot">
        <span>{fr.filled}/{fr.total} zones</span>
        <span className="fill">
          <span className="fill-bar"><i style={{ width: fr.pct + "%" }} /></span>
          {fr.pct}%
        </span>
      </div>
    </a>
  );
}

function NewCard({ onCreate }) {
  return (
    <button className="char-card new" onClick={onCreate}>
      <div>
        <div className="plus">+</div>
        <div className="label">New Identity</div>
        <div className="sub">Import a source photo or start from a written spec.</div>
      </div>
    </button>
  );
}

window.Home = function Home() {
  const [state, setState] = useState(() => window.IG.load());
  const [view, setView] = useState("grid");
  const [sort, setSort] = useState("recent");

  const sorted = useMemo(() => {
    const arr = [...state.characters];
    if (sort === "name") arr.sort((a,b) => a.name.localeCompare(b.name));
    if (sort === "fill") arr.sort((a,b) => fillRate(b).pct - fillRate(a).pct);
    return arr;
  }, [state, sort]);

  const totals = useMemo(() => {
    const total = state.characters.length;
    const zones = state.characters.reduce((s, c) =>
      s + window.IG.ZONE_DEFS.filter(z => c.zones[z.id]?.versions.length).length, 0);
    const versions = state.characters.reduce((s, c) =>
      s + window.IG.ZONE_DEFS.reduce((a, z) => a + (c.zones[z.id]?.versions.length || 0), 0), 0);
    return { total, zones, versions };
  }, [state]);

  function handleCreate() {
    const fresh = window.IG.newCharacter(state);
    window.location.href = `character.html?id=${encodeURIComponent(fresh.id)}`;
  }

  function handleReset() {
    if (confirm("Reset all identities to seed data?")) {
      const s = window.IG.reset();
      setState(s);
    }
  }

  return (
    <div className="home">
      <window.IGHeader active="roster" />

      <section className="home-hero">
        <div>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Roster · {state.characters.length} active identities</div>
          <h1>A taxonomy<br/>of <em>characters.</em></h1>
          <div className="lead">
            Every identity is a multi-view dossier: source likeness, structured spec, ten alignment zones, and a versioned trail of every angle you’ve rendered. Lock the face. Iterate the wardrobe. Stitch on demand via MCP.
          </div>
        </div>
        <div className="meta">
          <div className="meta-row">
            <dl>
              <dt>Identities</dt>
              <dd><span className="num">{String(totals.total).padStart(2,"0")}</span></dd>
            </dl>
            <dl>
              <dt>Zones filled</dt>
              <dd><span className="num">{totals.zones}</span></dd>
            </dl>
            <dl>
              <dt>Versions on file</dt>
              <dd><span className="num">{totals.versions}</span></dd>
            </dl>
          </div>
          <dl>
            <dt>MCP endpoint</dt>
            <dd className="mono" style={{ fontSize: 12 }}>https://igraph.local/mcp/v1/&#8203;stitch</dd>
          </dl>
        </div>
      </section>

      <div className="home-subbar">
        <div className="left">
          <span>The Roster</span>
          <span style={{ color: "var(--ink-faint)" }}>—</span>
          <span>{sorted.length} entries</span>
        </div>
        <div className="left">
          <span>Sort</span>
          <div className="seg">
            <button className={sort === "recent" ? "on" : ""} onClick={() => setSort("recent")}>Recent</button>
            <button className={sort === "name" ? "on" : ""} onClick={() => setSort("name")}>Name</button>
            <button className={sort === "fill" ? "on" : ""} onClick={() => setSort("fill")}>Coverage</button>
          </div>
          <span style={{ marginLeft: 18 }}>View</span>
          <div className="seg">
            <button className={view === "grid" ? "on" : ""} onClick={() => setView("grid")}>Grid</button>
            <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}>List</button>
          </div>
          <button className="btn ghost sm" style={{ marginLeft: 12 }} onClick={handleReset}>
            <Icon name="refresh" size={12} /> Reset demo
          </button>
        </div>
      </div>

      {view === "grid" ? (
        <div className="home-grid">
          {sorted.map(c => <CharacterCard key={c.id} char={c} />)}
          <NewCard onCreate={handleCreate} />
        </div>
      ) : (
        <RosterList chars={sorted} onCreate={handleCreate} />
      )}

      <div className="home-footer">
        <span>Identity Graph · Editorial 0.4</span>
        <span>Built for studios, shoots, and synthetic dossiers · {new Date().getFullYear()}</span>
      </div>
    </div>
  );
};

// ----- list view
function RosterList({ chars, onCreate }) {
  return (
    <div style={{ padding: "20px 48px 72px" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            {["", "ID", "Name", "Spec", "Coverage", "Lock", "Versions", ""].map((h, i) => (
              <th key={i} style={{
                fontFamily: "var(--f-mono)", fontSize: 10.5, letterSpacing: ".14em", textTransform: "uppercase",
                color: "var(--ink-mute)", padding: "10px 12px", borderBottom: "1px solid var(--line)",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chars.map(c => {
            const fr = fillRate(c);
            const versions = window.IG.ZONE_DEFS.reduce((a, z) => a + (c.zones[z.id]?.versions.length || 0), 0);
            return (
              <tr key={c.id} style={{ borderBottom: "1px solid var(--line-soft)" }}>
                <td style={{ padding: "10px 12px", width: 56 }}>
                  <div style={{
                    width: 44, height: 56, borderRadius: 4, border: "1px solid var(--ink)",
                    backgroundImage: `url(${c.source})`, backgroundSize: "cover", backgroundPosition: "center top",
                  }} />
                </td>
                <td className="mono" style={{ padding: "10px 12px" }}>{c.id}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontFamily: "var(--f-display)", fontSize: 19 }}>{c.name}</div>
                  <div style={{ color: "var(--ink-mute)", fontSize: 12 }}>{c.tagline}</div>
                </td>
                <td style={{ padding: "10px 12px", color: "var(--ink-mute)", maxWidth: 320 }}>
                  {c.spec.age} · {c.spec.ethnicity} · {c.spec.occupation}
                </td>
                <td style={{ padding: "10px 12px", width: 160 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span className="fill-bar" style={{ width: 80, height: 4, background: "var(--paper-deep)", borderRadius: 2, overflow: "hidden" }}>
                      <i style={{ display: "block", width: fr.pct + "%", height: "100%", background: "var(--accent)" }} />
                    </span>
                    <span className="mono" style={{ fontSize: 11 }}>{fr.filled}/{fr.total}</span>
                  </div>
                </td>
                <td style={{ padding: "10px 12px" }}>
                  <span className={"tag" + (c.identityLock ? " green" : "")}>
                    <Icon name={c.identityLock ? "lock" : "unlock"} size={10} />
                    {c.identityLock ? "ON" : "OFF"}
                  </span>
                </td>
                <td className="mono" style={{ padding: "10px 12px", fontSize: 11 }}>{versions}</td>
                <td style={{ padding: "10px 12px", textAlign: "right" }}>
                  <a className="btn sm" href={`character.html?id=${encodeURIComponent(c.id)}`}>
                    Open <Icon name="arrow_right" size={12} />
                  </a>
                </td>
              </tr>
            );
          })}
          <tr>
            <td colSpan={8} style={{ padding: "16px 12px" }}>
              <button className="btn ghost sm" onClick={onCreate}>
                <Icon name="plus" size={12} /> New identity
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
