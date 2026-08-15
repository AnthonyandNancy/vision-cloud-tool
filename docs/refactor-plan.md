# Refactor Plan: online-only `vision_cloud_tool` (modlens v2)

Status: approved — executing on branch `feat/vision-cloud-tool`.

## Goal

Turn `dsh-vision-cloud` into a beginner-friendly, online-only, zero-Python
vision plugin:

- **One tool** `vision_cloud_tool`.
- Vision runs through the **DSH app's configured model** (`ctx.llm.stream`),
  URL/model/key resolved by DSH — the plugin holds no credential, no base URL.
- Output follows the **modlens v2** `result` contract.
- **Default = off**: the tool is only registered once a vision model is
  selected in Settings.
- Paste-path bridge is kept (no Python, no environment).

## Decisions (confirmed)

- Tool name: `vision_cloud_tool`.
- Model selection: Settings dropdown, default **not enabled** (tool unregistered).
- No skill / no progressive exposure: register the tool directly like modlens.
- No `mode` parameter: `images` + `prompt` cover all scenarios.
- Image cap: 1–8 images per call.
- Paste-path bridge (`src/paste-images.ts` + `src/client/paste-images.tsx`) kept.

## Removed

- All local tools: `vision_trace`, `vision_crop`, `vision_pixel_diff`,
  `vision_extract_foreground`, `vision_dominant_colors`, `vision_html_screenshot`,
  `vision_long_screenshot_ocr`, plus `vision_ground` / `vision_detect`.
- All Python: `vendor/**`, `runtime/**`, `src/upstream.ts`,
  `src/runtime-manager.ts`, `src/runtime-install.ts`.
- `src/skill.ts`, `src/exposure.ts`, `src/artifacts.ts`, `src/artifact-access.ts`.
- Upstream scripts and the UI-restoration example.

## New architecture

- `src/vision-schema.ts` — modlens v2 `VISION_RESULT_SCHEMA` + `missingSchemaFields`.
- `src/vision-prompt.ts` — modlens vision prompt (inline image mode).
- `src/image-header.ts` — pure-JS PNG/JPEG/GIF/WebP dimension + format parser
  (replaces Pillow probing; no full decode).
- `src/runtime.ts` — online runtime: resolve input (path or URL) → byte/pixel
  limits → `ctx.attachments.saveImage` → build user message (image blocks +
  prompt) → `ctx.llm.stream({provider, model, messages, signal})` → collect text
  → `JSON.parse` → validate against schema → retry once on shape failure.
- `src/tools.ts` — `defineTool({ name: 'vision_cloud_tool', ... })`.
- `src/index.ts` — register settings; register/unregister the tool live based on
  whether `model` is set; keep paste-images + web routes.
- `src/web.ts` — minimal Settings backend: model list (from
  `ctx.llm.listProviders()`/`listModels()`) + save + test read.
- `src/client/index.tsx` — minimal Settings section: model dropdown (default
  off) + test read + limits.

## Output contract (modlens v2)

`result` with six required fields: `summary`, `ocr`, `layout`, `semantics`,
`visual`, `uncertainty`. No pixel `bbox`, no numeric `confidence`.

## Config

```yaml
- id: vision-cloud
  config:
    model:            # absent = not enabled
      provider: <providerId>
      model: <modelId>
    language: zh
    timeoutMs: 60000
    maxImageBytes: 10485760
    maxImagePixels: 40000000
    concurrency: 4
    maxImages: 8
    allowedDirs: []
    allowExtensionlessImageUrls: false
```

`inject` = `['tools', 'settings', 'llm', 'attachments']` (web routes ride
`ctx.inject(['webServer'])`; paste-images needs `sessions` at runtime).
