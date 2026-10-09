---
title: "Image Generation"
sidebar:
  order: 1
---

TomoriBot can generate images from a text prompt or by editing a reference image. Use
`/generate image`, or describe what you want in chat ("draw a red panda drinking coffee").

## What She Can Do

- **Text-to-image**: generate an image from a description.
- **Image-to-image**: edit or restyle an existing image.
- **Inpainting**: redraw a specific region while keeping the rest.
- **Outpainting**: extend the canvas beyond the original frame.
- **Customizable aspect ratios**.
- **Reference images**: draw from message attachments, stickers, emojis, or user and
  persona avatars. Mention a user or persona to pull their avatar in as a reference.

Which editing modes are available depends on the active backend. Text-to-image and
image-to-image work on cloud providers (Google, Vertex, OpenRouter). Inpainting and
outpainting are supported by local [ComfyUI](/self-hosting/local-endpoints/setup-comfyui/)
custom endpoints and depend on that endpoint's declared capabilities. Modes your setup
does not support are hidden from the model automatically.

When she generates an image, she combines your persona's appearance tags with server-wide
positive and negative tags (where supported). The result arrives as a Discord media gallery
with generation details, including any referenced users or personas.

## Tag Customization
<!-- anchor: tag-customization -->

Every tag source can be edited in place with a pre-filled modal:

- **`/config` > Persona > Image Generation Details**: the selected persona's
  `Physical Appearance` tags (how she looks). Requires the Manage Server permission.
- **`/personal config`**: your own appearance tags, applied whenever an image generation
  references you. Follows you across every server (see
  [Personalization](/features/knowledge/personalization/)).
- **`/config` > Models > Image Generation Defaults**: use `Edit Positive` and `Edit Negative`
  to set default tags added to, or steered away from, every generation. Negative tags only
  apply when the backend supports negative prompts. Submitting an empty box resets to the
  built-in defaults.

## Setup

1. Configure an image model with `/config` > Models > Switch Models.
2. Enable image generation in `/config` > Permissions (`imagegen_enabled`).
3. Ask her in chat, or run `/generate image`.

## Provider Support

Native image generation is available on Google, Vertex AI, Vertex AI Express, OpenRouter,
Z.ai, NVIDIA NIM, and NovelAI (anime-styled). For the full provider matrix, see
[Providers & Models](/features/setup-administration/providers-and-models/#supported-providers).

For local generation on your own hardware via ComfyUI, see
[Setup: ComfyUI](/self-hosting/local-endpoints/setup-comfyui/).
