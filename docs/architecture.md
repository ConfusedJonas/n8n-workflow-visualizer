# Architecture

The application is deliberately split at data boundaries:

1. `src/n8n` decodes untrusted JSON into a small, permissive compatibility model.
2. `src/workspace` resolves imported IDs and builds directed workflow families.
3. `src/renderers` creates framework-agnostic scenes for Original, Dependency, and Expanded views.
4. `src/components` maps scenes to read-only React Flow elements.
5. `src/storage` keeps raw imports and UI state in IndexedDB.
6. `src/export` captures only the graph stage as PNG or SVG.

No imported data is executed. Sticky-note HTML is disabled, URI schemes are allowlisted, images are replaced with inert text, and imported values never reach `dangerouslySetInnerHTML`. The production CSP disables all network connections. There are no analytics, service workers, external fonts, CDNs, or application fetch calls.

Expanded layout is a pure geometric transformation: child-relative positions and parent Y coordinates are retained, calls are processed in stable X/Y/ID order, and only downstream or horizontally colliding parent elements move right. Dependency view is the only view that uses Dagre.

Original and Expanded workflow nodes use a compact 100×100 canvas footprint around a 64×64 visual tile. This matches the spacing model used by exported n8n coordinates without rewriting valid positions. Node appearance is selected locally from the normalized type string, with bundled brand glyphs where available and an explicit generic fallback for unknown future types. Connections use a bundled obstacle-aware orthogonal router; Expanded workflow boundaries are decorative containers and are deliberately excluded from its obstacle set.
