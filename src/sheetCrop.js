// Client-side contact-sheet cropping.
// The server returns ONE square 3×3 contact sheet (data URL preferred so the
// canvas is never tainted). We slice it into one square image per zone here.

function loadSheetImage(imgOrDataUrl) {
  if (typeof imgOrDataUrl !== "string") {
    // Already an HTMLImageElement that finished loading.
    return Promise.resolve(imgOrDataUrl);
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    // crossOrigin only matters for remote URLs; data URLs ignore it and stay clean.
    if (!imgOrDataUrl.startsWith("data:")) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not load the generated sheet image."));
    image.src = imgOrDataUrl;
  });
}

// grid: { rows, cols }. cells: [{ zone_id, index, row, col }].
// Returns [{ zone_id, dataUrl }] — one square JPEG data URL per cell.
export async function cropSheetToCells(imgOrDataUrl, grid, cells) {
  const cols = Math.max(1, Number(grid?.cols) || 3);
  const rows = Math.max(1, Number(grid?.rows) || Math.ceil((cells?.length || 9) / cols));
  const image = await loadSheetImage(imgOrDataUrl);
  const sheetW = image.naturalWidth || image.width;
  const sheetH = image.naturalHeight || image.height;
  if (!sheetW || !sheetH) throw new Error("The generated sheet had no pixels to crop.");

  const cellW = sheetW / cols;
  const cellH = sheetH / rows;
  // Small inset (~1.5% of the cell) to avoid bleeding the neutral gutters.
  const insetX = cellW * 0.015;
  const insetY = cellH * 0.015;

  const list = Array.isArray(cells) && cells.length
    ? cells
    : Array.from({ length: rows * cols }, (_, index) => ({ zone_id: `cell_${index}`, index }));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  return list.map((cell) => {
    const index = Number.isFinite(cell.index) ? cell.index : list.indexOf(cell);
    const col = Number.isFinite(cell.col) ? cell.col : index % cols;
    const row = Number.isFinite(cell.row) ? cell.row : Math.floor(index / cols);

    const sx = Math.max(0, col * cellW + insetX);
    const sy = Math.max(0, row * cellH + insetY);
    const sw = Math.max(1, cellW - insetX * 2);
    const sh = Math.max(1, cellH - insetY * 2);

    // Square output tile; longest source side drives resolution, capped for upload size.
    const out = Math.round(Math.min(1024, Math.max(sw, sh)));
    canvas.width = out;
    canvas.height = out;
    ctx.clearRect(0, 0, out, out);
    // Center-crop the (near-square) cell into a square tile.
    const side = Math.min(sw, sh);
    const offX = sx + (sw - side) / 2;
    const offY = sy + (sh - side) / 2;
    ctx.drawImage(image, offX, offY, side, side, 0, 0, out, out);

    return { zone_id: cell.zone_id, dataUrl: canvas.toDataURL("image/jpeg", 0.92) };
  });
}
