---
name: Pointer gestures and entry animations
description: Keep transform animations separate from draggable message elements.
---
Apply message entrance animations to a wrapper, not to the same element whose
inline transform follows a pointer gesture.

**Why:** a CSS transform animation with `animation-fill-mode: both` retains its
final transform and overrides the drag transform. A reply can be selected
successfully while the bubble appears not to move.

**How to apply:** separate the animated wrapper and draggable child. In browser
checks, measure the actual pointer-handler child’s computed transform and
bounding rectangle while the pointer is held, not the surrounding wrapper.

Validate mobile gestures with native touch input, not just a mouse in a narrow
viewport.

**Why:** mouse-driven checks passed while the user still reported that mobile
swiping did not work. A responsive viewport does not exercise touch arbitration
or the browser's cancellation of pointer events.

**How to apply:** measure translation while a touch is held, then verify the
release action. Check both directions and both sent and received messages;
test mouse dragging separately and preserve vertical scrolling.
