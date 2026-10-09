---
title: "NovelAI Inpainting Pipeline"
---

The inpainting pipeline edits existing images in response to natural language requests. It pairs
Google Gemini's spatial segmentation with NovelAI's latent diffusion infill API to redraw designated
regions while preserving surrounding artwork.

## Flow and ownership

Inpainting executes through three cooperating components:

1. `src/utils/image/imageExtractor.ts`: extracts image data and dimensions from Discord message
   attachments and Components V2 structures.
2. `src/utils/image/segmentationService.ts`: calls Gemini to locate the target region, constructs an
   elliptical mask, and quantizes it to the latent grid.
3. `src/tools/functionCalls/generateImageNaiTool.ts`: constructs the NovelAI infill payload,
   dispatches the HTTP generation request, and formats the output message.

```
Discord Message
  │  (collectImageUrlsFromMessage)
  ▼
imageExtractor.ts ───────────────► Source Image (base64, dimensions)
                                        │
                                        ▼
segmentationService.ts ──────────► Gemini Segmentation API (box_2d)
  │
  ├─► Elliptical mask with padding (NAI_INPAINT_PADDING = 0.15)
  ├─► Latent grid quantization (1/8 resolution snap)
  └─► RGBA PNG encoding (Alpha channel mask signal)
        │
        ▼
generateImageNaiTool.ts ─────────► NovelAI /ai/generate-image
                                   (action: "infill", strength: 1.0, add_original_image: true)
                                        │
                                        ▼
                              Inpainted Output to Discord
```

### 1. Source image extraction

When a user requests an image edit, `generateImageNaiTool.ts` identifies the referenced Discord
message. It invokes `collectImageUrlsFromMessage`, which inspects message attachments and parses
Components V2 structures (`MediaGallery`, `Thumbnail`, and `File`). The extracted image provides the
base dimensions, MIME type, and base64 payload.

### 2. Gemini region segmentation

`segmentationService.ts` submits the image along with the natural language target description to
Gemini:

- **Prompt ordering:** Text instructions lead before image data to optimize instruction following.
- **Output format:** Gemini returns bounding boxes (`box_2d`) with normalized coordinates
  (`[0, 1000]`).
- **Safety thresholds:** The configured safety categories use `HarmBlockThreshold.OFF` because
  artistic and stylized anime illustrations trigger false positives on default thresholds, causing
  requests to hang or return empty results.
- **Thinking:** The shared Google policy receives the `none` level to minimize latency on
  structured coordinate extraction.

### 3. Mask construction and latent quantization

Rather than using Gemini's per-pixel segmentation masks, which introduce rough edges and voids on
complex textures such as hair or fabric, the pipeline generates masks from bounding boxes:

- **Elliptical shape:** An ellipse is inscribed inside the bounding box. Rectangular masks create
  abrupt boundary discontinuities that diffusion models reproduce as visible seams; curved borders
  denoise more smoothly.
- **Padding:** Each bounding box dimension is expanded by 15% (`NAI_INPAINT_PADDING = 0.15`) before
  inscribing the ellipse, so wispy edges and hair strands are enclosed.
- **Latent grid quantization:** The mask processor uses nearest-neighbor resizing to keep redraw
  decisions binary at the backend's latent resolution. Smooth intermediate grey values can create
  partial-redraw halos. V4 requests return the quantized mask to the source dimensions;
  `segmentationService.ts` owns the model-specific sizing.
- **RGBA encoding:** The mask exports as an RGBA PNG where white pixels (`[255, 255, 255, 255]`)
  signal redraw regions and fully transparent black pixels (`[0, 0, 0, 0]`) signal preserved
  regions. The alpha channel provides the mask signal expected by NovelAI infill endpoints.

### 4. NovelAI infill dispatch

`generateImageNaiTool.ts` packages the source image and mask into the infill request:

- `action: "infill"` identifies the operation.
- `add_original_image: true` instructs NovelAI to overlay unmasked original pixels onto the output,
  preventing global image drift across redrawn boundaries.
- `strength: 1.0` (`NAI_INPAINT_STRENGTH`) applies full denoising to the masked area, preventing
  underlying colors from bleeding through the redrawn content.
- Source image dimensions are explicitly transmitted in the parameters to prevent scaling distortion.

## Cancellation and external effects

Inpainting needs separately resolved Google segmentation and NovelAI generation credentials.
The inpainting path does not forward the turn abort signal to either hosted operation. `/kill` stops
awaiting the tool; later abort checks suppress result delivery and application quota charging, while
provider work can continue and incur provider charges. Debug DMs are attempted before the final abort
check and are not retracted.

## Debugging

Setting `NAI_INPAINT_DEBUG=true` causes the service to retain the raw generated mask and an overlay
image depicting the original canvas with bounding boxes and inscribed ellipses. These assets are
delivered directly to the calling user for diagnostic inspection.

## Source pointers

- `src/utils/image/segmentationService.ts`: Gemini API integration, bounding box parsing, elliptical
  mask construction, and latent grid quantization.
- `src/tools/functionCalls/generateImageNaiTool.ts`: NovelAI infill payload construction and execution.
- `src/utils/image/imageExtractor.ts`: Discord attachment and Components V2 image extraction.
- `src/utils/image/naiImageParams.ts`: Diffusion parameter defaults and constants.
