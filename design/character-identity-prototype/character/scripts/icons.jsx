// Stroke-based icons. 1.4 stroke, currentColor.
window.Icon = function Icon({ name, size = 16, stroke = 1.4, style }) {
  const s = { width: size, height: size, ...style };
  const sp = { fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round" };
  const paths = {
    user: <g {...sp}><circle cx="12" cy="9" r="3.5" /><path d="M5.5 19c1.6-3.4 4-5 6.5-5s4.9 1.6 6.5 5" /></g>,
    screen: <g {...sp}><rect x="3.5" y="5" width="17" height="11" rx="1.2" /><path d="M9 20h6M12 16v4" /></g>,
    slide: <g {...sp}><rect x="3.5" y="4" width="17" height="13" rx="1.2" /><path d="M7 20h10M12 17v3" /></g>,
    phone: <g {...sp}><rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18.2h2" /></g>,
    book: <g {...sp}><path d="M4.5 5.5C7 4.5 9.5 4.5 12 5.5v14c-2.5-1-5-1-7.5 0v-14ZM19.5 5.5C17 4.5 14.5 4.5 12 5.5v14c2.5-1 5-1 7.5 0v-14Z" /></g>,
    lock: <g {...sp}><rect x="5" y="10.5" width="14" height="9.5" rx="1.5" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></g>,
    unlock: <g {...sp}><rect x="5" y="10.5" width="14" height="9.5" rx="1.5" /><path d="M8 10.5V7a4 4 0 0 1 7-2.8" /></g>,
    plus: <g {...sp}><path d="M12 5v14M5 12h14" /></g>,
    minus: <g {...sp}><path d="M5 12h14" /></g>,
    x: <g {...sp}><path d="M6 6l12 12M18 6L6 18" /></g>,
    check: <g {...sp}><path d="M4.5 12.5l4.5 4.5L20 5.5" /></g>,
    upload: <g {...sp}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2" /></g>,
    download: <g {...sp}><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2" /></g>,
    sparkle: <g {...sp}><path d="M12 3v6M12 15v6M3 12h6M15 12h6" /><path d="M6 6l3.5 3.5M14.5 14.5L18 18M6 18l3.5-3.5M14.5 9.5L18 6" /></g>,
    wand: <g {...sp}><path d="M4 20l12-12M14 4l2 2M18 8l2 2M9 13l2 2" /></g>,
    refresh: <g {...sp}><path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" /></g>,
    dots: <g {...sp}><circle cx="6" cy="12" r=".8" fill="currentColor" /><circle cx="12" cy="12" r=".8" fill="currentColor" /><circle cx="18" cy="12" r=".8" fill="currentColor" /></g>,
    grid: <g {...sp}><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></g>,
    eye: <g {...sp}><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z" /><circle cx="12" cy="12" r="2.5" /></g>,
    chev_right: <g {...sp}><path d="M9 6l6 6-6 6" /></g>,
    chev_left: <g {...sp}><path d="M15 6l-6 6 6 6" /></g>,
    chev_down: <g {...sp}><path d="M6 9l6 6 6-6" /></g>,
    image: <g {...sp}><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="9" cy="10" r="1.5" /><path d="M5 18l5-5 4 4 3-3 3 3" /></g>,
    layers: <g {...sp}><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 13l9 5 9-5M3 18l9 5 9-5" /></g>,
    copy: <g {...sp}><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></g>,
    link: <g {...sp}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11 7" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7L13 17" /></g>,
    settings: <g {...sp}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3" /></g>,
    arrow_right: <g {...sp}><path d="M5 12h14M13 6l6 6-6 6" /></g>,
    walk: <g {...sp}><circle cx="13" cy="4.5" r="1.5" /><path d="M9 21l3-7-2-3 5-3 3 4 2 1M9 11l-3 4" /></g>,
    folder: <g {...sp}><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V7Z" /></g>,
    crop: <g {...sp}><path d="M6 3v15h15M3 6h15v15" /></g>,
    history: <g {...sp}><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /><path d="M12 8v4l3 2" /></g>,
  };
  return (
    <svg viewBox="0 0 24 24" style={s} aria-hidden="true">{paths[name] || null}</svg>
  );
};
