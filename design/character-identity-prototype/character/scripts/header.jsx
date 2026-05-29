// Shared header + brand mark
window.IGHeader = function IGHeader({ active = "roster", right = null }) {
  return (
    <header className="app-header">
      <a href="index.html" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
        <div className="brand__mark">◐</div>
        <div>
          <div className="brand__name">Identity Graph</div>
          <div className="brand__sub">v0.4 · multi-view alignment</div>
        </div>
      </a>
      <nav>
        <a href="index.html" className={active === "roster" ? "active" : ""}>Roster</a>
        <a href="#" onClick={(e) => e.preventDefault()} className={active === "library" ? "active" : ""}>Library</a>
        <a href="#" onClick={(e) => e.preventDefault()} className={active === "exports" ? "active" : ""}>Exports</a>
        <a href="#" onClick={(e) => e.preventDefault()} className={active === "mcp" ? "active" : ""}>MCP</a>
      </nav>
      <div className="row" style={{ gap: 8 }}>
        {right}
        <div className="tag dot" style={{ color: "var(--accent)" }}>MCP&nbsp;live</div>
        <div style={{
          width: 28, height: 28, borderRadius: "50%",
          background: "var(--paper-deep)", border: "1px solid var(--line)",
          display: "grid", placeItems: "center",
          fontFamily: "var(--f-mono)", fontSize: 11, color: "var(--ink-mute)",
        }}>YO</div>
      </div>
    </header>
  );
};
