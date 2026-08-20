# DSH Vision Cloud compatibility matrix

This matrix records the capability contracts used by `dsh-vision-cloud`. It is
feature-based: production code does not branch on the DSH release string.

| DSH line | Contract fixture | Capability strategy | Browser/content strategy | Status |
| --- | --- | --- | --- | --- |
| `0.1.0-rc.6` | legacy `resolveModelInfo(provider, model)`; text/image blocks | exact resolver, then exact catalog, otherwise `unknown` | native image blocks only when modalities include `image`; bridge otherwise | automated |
| `0.1.0-rc.7` | resolver failure plus `listModels(provider)` fallback | exact `id`/`name` catalog match; no partial label matches | `@file` normalization and `sha256:` attachments remain public APIs | automated |
| `0.1.0-rc.8` | merge-extensible content block and structured session reference | unknown/malformed capabilities are conservative `unknown` | unknown blocks are not sent to `JsonBlock`; `@[...](dsh-session:...)` is never a file | automated |
| later rc | same feature contracts, no version branch | capability detection continues to use method presence and returned shape | bridge and native routing remain invariant | contract coverage |

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
pnpm exec vitest run tests/compatibility-contract.spec.ts tests/model-capability.spec.ts tests/file-references.spec.ts tests/user-message-reference-regression.spec.ts
```

The contract fixtures deliberately model the public shapes rather than pinning
an installed package version, so they can run under the current rc6 dependency
floor while checking rc7/rc8 compatibility behavior.
