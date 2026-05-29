// ZoneTile — the small grid card for each zone. Drag-drop, version dots, click to open.
const { useState: useStateZT } = React;

window.ZoneTile = function ZoneTile({ zone, data, aspect, onOpen, onDrop, generating, active }) {
  const [drag, setDrag] = useStateZT(false);
  const versions = data?.versions || [];
  const current = versions[data?.selectedIndex] || null;

  function handleDrop(e) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) onDrop?.(e.dataTransfer.files[0]);
  }

  return (
    <div
      className={"zone-tile frame " + (drag ? "dragover " : "") + (active ? "active " : "")}
      onClick={onOpen}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
    >
      <div className="frame__label">{zone.label}</div>
      <div
        className="zone-img"
        style={{
          aspectRatio: aspect,
          backgroundImage: current ? `url(${current.url})` : "none",
        }}
      >
        {!current && (
          <div className="empty">
            <div className="empty-inner">
              <Icon name="image" size={20} stroke={1.2} />
              Drop or generate
            </div>
          </div>
        )}
        {generating && (
          <div className="generating">
            <div>
              <div className="pulse" />
              Rendering…
            </div>
          </div>
        )}
      </div>
      <div className="meta">
        <span>{current ? current.id : "—"}</span>
        <span className="ver-pill">
          {versions.length === 0 ? <i /> :
            versions.map((v, i) => <i key={v.id} className={i === data.selectedIndex ? "on" : ""} />)}
        </span>
      </div>
    </div>
  );
};
