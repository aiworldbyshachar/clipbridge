# Review — ClipBridge demo film

Checked with `hyperframes check` (passes) and snapshots of every scene, its middle and each cut.

## Fixed during review
- The bridge read as a hook stuck to the Mac's corner → a real arch between the two screens, hidden during close-ups.
- Wide shot had the computers small in a big wall → camera framed 10% tighter.
- History list was empty until the search: a later `fromTo` rendered its start state at load → `immediateRender: false`.
- Same bug would have flashed the search result early → fixed.
- History window floated to one side of an empty frame → centred, with both computers sending each new item into it.
- Star never filled (GSAP can't swap class names; CSS specificity) → a gold star fades in over it.
- Search text sat mid-field behind the hidden placeholder → placeholder positioned absolutely.
- Tray menu highlight used the same class trick → colour tweens and a ✓ that fades in.
- Idle cursors visible before they act (history, privacy, payoff) → hidden until needed.
- Pairing scene opened on an empty frame for 0.15 s → windows start on frame 0.
- First-frame states set at time 0 inside the timeline didn't render → `gsap.set` at load.

## Known and accepted
- Contrast warnings on placeholder/muted text: these are the app's own greys, copied from its stylesheet.
- Desk wall extends past the frame on purpose (camera moves).
- UI text is Segoe UI via `local()`: renders on Windows. Font files are not committed (Microsoft licence).
- Audio: levels and timing were measured, not listened to.
