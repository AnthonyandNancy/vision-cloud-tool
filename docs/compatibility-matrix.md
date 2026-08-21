# DSH Vision Cloud compatibility matrix

This matrix records the capability contracts used by `dsh-vision-cloud`. It is
feature-based: production code does not branch on the DSH release string.

| DSH line | Contract fixture | Capability strategy | Browser/content strategy | Status |
| --- | --- | --- | --- | --- |
| `0.1.0-rc.6` | legacy `resolveModelInfo(provider, model)`; text/image blocks | exact resolver, then exact catalog, otherwise `unknown` | native image blocks only when modalities include `image`; bridge otherwise | automated |
| `0.1.0-rc.7` | resolver failure plus `listModels(provider)` fallback | exact `id`/`name` catalog match; no partial label matches | `@file` normalization and `sha256:` attachments remain public APIs | automated |
| `0.1.0-rc.8` | merge-extensible content block and structured session reference | unknown/malformed capabilities are conservative `unknown` | unknown blocks are not sent to `JsonBlock`; `@[...](dsh-session:...)` is never a file | automated |
| `0.1.0-rc.8` | inline `@label` references and host-owned message images | unchanged | occurrence spans are read from the host; native history images are delegated to `conversation.message.images` | automated |
| `0.1.0-rc.6`–`rc.8` | model-directory selection store, draft-image APIs, native-only assembly gate | provider + model from `modelDirectories.directoryFor(...).store` when present, DOM label only as legacy fallback | bridge occurrences with a held `File` promote to native only on a confirmed image-capable verdict; native draft ids demote to bridge immediately on a text/unknown selection, before submit; native-only image assembly removes the `vision_cloud_tool` schema, section, and context for that request; image + path/URL assemblies retain the tool for external inputs | automated |
| later rc | same feature contracts, no version branch | capability detection continues to use method presence and returned shape | bridge and native routing remain invariant | contract coverage |

## Composer reference rules

The host owns the inline display form of an inserted reference, so the plugin
never assumes a span width:

- older builds mint a single placeholder glyph, so the occurrence covers one
  character;
- rc8 mints the full `@<label>` display text, reports its width as the
  occurrence `length`, and appends its own separating gap;
- rc8 also drops any occurrence whose range an edit intersects. Advancing a
  cursor by a hardcoded `1` therefore writes the separator *inside* the
  reference and destroys the occurrence — which silently removes both the chip
  decoration and the submit-time `serialize()` call, so a text-only model would
  receive the literal `@image.png` instead of a bridged workspace path.

The plugin consequently reads the minted occurrence back from the published
state, advances by `length ?? 1`, only inserts a separator when the reference is
not already followed by whitespace, and deletes `offset + (length ?? 1)` when a
bridged image is dismissed.

## Message-image presentation rules

The shadow user-message renderer follows whichever image currency the host
supplies to `conversation.chat.node` renderers:

- `loadImage` present → the plugin resolves and renders native tiles itself;
- rc8 supplies `renderMessageImages` (the `conversation.message.images` slot)
  and no `loadImage` → native blocks are handed back to that entry, so
  multimodal bubbles keep real thumbnails instead of degrading to a filename;
- neither present → the filename fallback remains as the last resort.

Bridged tiles are always rendered locally: they load from the session-authorized
file route and need no attachment resolver.

## Capability rules

- non-empty `inputModalities` containing `image` → `image`;
- non-empty modalities without `image` → `text`;
- missing, empty, malformed, or failed resolution → `unknown`;
- `image` routes direct/native image blocks to the model and does not duplicate
  them through `vision_cloud_tool`;
- `text` and `unknown` route invisible image inputs through the bridge/tool path.

## Reference rules

The runtime accepts `@image.png`, `@./image.png`, `@~/Pictures/image.png`, and
quoted `@"image with spaces.png"`. It does not strip or read
`@[label](dsh-session:...)`, arbitrary `@agent`, or ordinary text-file
references such as `@README.md`.

## Evidence command

```powershell
pnpm exec vitest run tests/compatibility-contract.spec.ts tests/model-capability.spec.ts tests/file-references.spec.ts tests/user-message-reference-regression.spec.ts tests/paste-images-client.spec.ts tests/user-message-view.spec.ts
```

The contract fixtures deliberately model the public shapes rather than pinning
an installed package version, so they can run under the current rc6 dependency
floor while checking rc7/rc8 compatibility behavior. `paste-images-client.spec.ts`
exercises both composer generations against the same production code: the
placeholder-glyph machine of the dependency floor and an `rc8InputMachine` that
mints `@label` text and drops intersected occurrences.
