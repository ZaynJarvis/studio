# Character Identity Prototype

This directory stores the Claude Design handoff package for the character / identity design flow.

## Source

- Provided by @alice on 2026-05-29 for @zaynjarvis.
- Original local source reported by Alice: `/Users/lululiang/code/c/character/`.
- Received in this environment as a three-part zip attachment, reassembled and verified with SHA256:
  `932df7244579b2cc22c9d8ffcb9fa689ba794a9b00ba0fd778039275fc80dd31`.

## Contents

- `character/DESIGN_README.md` - Claude Design handoff notes.
- `character/index.html` - Screen 01, Home / Roster prototype at 1280px viewport.
- `character/character.html` - Screen 02, Character Sheet / Identity Graph prototype at 1440px viewport.
- `character/scripts/` - React 18 + Babel standalone prototype scripts.
- `character/styles/` - Base, home, and character CSS, including the paper-grain treatment and the Instrument Serif / JetBrains Mono / Geist font stack.
- `character/characters/reference-dog-multiview.md` - Identity dossier schema/sample for the duoduo reference dog.
- `character/assets/` and `character/uploads/` - Reference images, generated sheets, cropped zones, and uploaded source imagery.

## Production Notes

- Treat this as visual/design reference material, not production Studio source.
- The prototype scripts attach components to `window.*` for Babel standalone. When moving pieces into Studio's Vite/React app, convert them to ES modules with explicit React imports and exports.
- The package's README refers to `character/chats/`, but that directory is not present in the delivered bundle. Use `character/character.html`, `character/styles/character.css`, and `character/characters/reference-dog-multiview.md` as the primary design intent sources.
- The design concept is an Identity Graph: one character/IP is split into reusable zones such as `full_front`, `face_front`, `half_body`, `outfit`, `shoes`, and `bag`.
- `character/scripts/split-generated-sheet.py` uses the 1531x1018 generated sheet coordinate system documented in `reference-dog-multiview.md`.
