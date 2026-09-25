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

Original and Expanded workflow nodes use the exported position as the top-left of a 100×80 visual tile. Nodes with more than two visible input/output slots add a 32-pixel row per extra slot while retaining their exported anchor, which matches n8n's multi-input treatment without rewriting valid coordinates. IF nodes place their true and false outputs at 30% and 70% of the tile height so exported true-branch successors remain exactly aligned. Node appearance is selected locally from the normalized type string, with bundled brand glyphs where available, independently drawn core-node symbols, and an explicit generic fallback for unknown future types.

Connections use a small pure routing subsystem in the React renderer. Aligned forward handles connect with a straight segment; other forward paths use a rounded orthogonal midpoint route. Backward loops first try a target-aligned lane, then select the nearest clear lane below intervening node bounds. Every route is calculated from React Flow's measured node rectangles. Expanded workflow boundaries are decorative containers and are deliberately excluded from collision checks.
