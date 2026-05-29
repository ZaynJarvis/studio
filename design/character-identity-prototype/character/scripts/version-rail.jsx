// VersionRail — right-side column showing currently selected version + alt version(s).
// Matches the reference: VERSION A (selected, with SET USE) + VERSION B preview.
const { useState: useStateVR } = React;

window.VersionRail = function VersionRail({ zone, data, onSelectVersion, onOpen, onSetUse }) {
  if (!zone || !data) {
    return (
      <div>
        <div className="version-rail-head">
          <span>Versions</span>
          <span style={{ color: "var(--ink-faint)" }}>—</span>
        </div>
        <div className="frame thin" style={{ padding: 22, textAlign: "center", color: "var(--ink-mute)", fontSize: 12 }}>
          Select a zone to compare versions.
        </div>
      </div>
    );
  }

  const versions = data.versions || [];
  const selIdx = data.selectedIndex;

  return (
    <div>
      <div className="version-rail-head" style={{ marginBottom: 10 }}>
        <span>Versions · {zone.label}</span>
        <button className="btn ghost sm" onClick={onOpen}>
          <Icon name="layers" size={11} /> All
        </button>
      </div>

      {versions.length === 0 ? (
        <div className="frame thin" style={{ padding: 22, textAlign: "center", color: "var(--ink-mute)", fontSize: 12 }}>
          No versions yet.
          <div style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={onOpen}>
              <Icon name="sparkle" size={11} /> Generate first
            </button>
          </div>
        </div>
      ) : (
        versions.map((v, i) => (
          <div key={v.id} className={"version-card" + (i === selIdx ? " selected" : "")} onClick={() => onSelectVersion(i)} style={{ marginBottom: 14, cursor: "pointer" }}>
            <div className="vc-head">
              <span>Version {String.fromCharCode(65 + i)}</span>
              <span style={{ color: "var(--ink-faint)" }}>{relTime(v.createdAt)}</span>
            </div>
            <div className="vc-img" style={{ backgroundImage: `url(${v.url})` }} />
            <div className="vc-foot">
              {i === selIdx ? (
                <button className="set-use-btn is-set" onClick={(e) => { e.stopPropagation(); onSetUse(i); }}>
                  <Icon name="check" size={12} /> Set Use
                </button>
              ) : (
                <button className="set-use-btn" onClick={(e) => { e.stopPropagation(); onSetUse(i); }}>
                  Set Use
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
};

function relTime(ts) {
  if (!ts) return "—";
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return Math.floor(d) + "s";
  if (d < 3600) return Math.floor(d / 60) + "m";
  if (d < 86400) return Math.floor(d / 3600) + "h";
  return Math.floor(d / 86400) + "d";
}
