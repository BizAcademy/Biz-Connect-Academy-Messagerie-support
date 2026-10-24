---
name: Local image editing
description: Keep photo annotations and cropping local until the final image is sent.
---
Perform photo annotation and cropping in the browser before uploading. Send only
the flattened result, with the message caption kept separate.

**Why:** the owner wants both image-editing tools and low data consumption.
Uploading an original first adds unnecessary traffic and may retain areas the
user intended to crop out.

**How to apply:** new editing tools must affect exported pixels, not just a visual
overlay. Preserve the lightweight outgoing-image budget and explicit send step;
do not introduce automatic original-image uploads as an editing prerequisite.
