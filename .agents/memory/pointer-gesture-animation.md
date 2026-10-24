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
