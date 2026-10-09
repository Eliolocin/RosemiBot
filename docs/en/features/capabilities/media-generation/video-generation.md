---
title: "Video Generation"
sidebar:
  order: 2
---

TomoriBot can generate short videos from a text prompt or by animating an existing image.
Use `/generate video`, or ask her directly in chat.

## What She Can Do

- **Text-to-video**: generate a short clip from a description.
- **Image-to-video**: animate an image. The first image from a referenced message becomes
  the starting frame.
- **Looping image-to-video**: when requested through chat, supported models can reuse the
  starting image as the final frame.
- **Customizable aspect ratios**.

Image-to-video and looping depend on the selected model's first and last frame support.
TomoriBot checks OpenRouter's model catalog before submitting a generation, and prompts you
if an image or looping needs to be removed for the chosen model.

Generating video takes time: TomoriBot submits the job to the provider, checks for completion
in the background, and posts the finished video to the channel when ready.

## Setup

1. Select a video model in `/config` > Models > Switch Models.
2. Confirm video generation is enabled in `/config` > Permissions (`video_generation_enabled`).
3. Ask her in chat, or run `/generate video`.

## Provider Support

Native video generation is available on Google, OpenRouter, and Z.ai. See the full
matrix in [Providers & Models](/features/setup-administration/providers-and-models/#supported-providers).

For local video generation via ComfyUI (such as WAN image-to-video workflows), see
[Setup: ComfyUI](/self-hosting/local-endpoints/setup-comfyui/).

For the internal generation and polling architecture, see the reference on
[video generation](/architecture/subsystems/video-generation/).
