# vision-cloud-tool DSH rc6+ Compatibility Upgrade Design

**Date:** 2026-08-20  
**Status:** Approved design baseline; implementation plan follows after user review  
**Scope:** DeepSeek Harness `0.1.0-rc.6`, `0.1.0-rc.7`, `0.1.0-rc.8`, and later prereleases where the same public capabilities are available

## 1. Goal

Upgrade the existing `vision-cloud-tool` plugin so one published plugin version can run against DSH rc6, rc7, rc8, and later compatible prereleases through capability and feature detection rather than DSH version-number branches.

The upgrade must preserve the existing text-only image path bridge and its image preview/lightbox, while allowing image-capable models to use DSH native image attachments without duplicate bridge storage or duplicate visual-model calls.

The primary architectural invariant is:

```text
DSH native multimodal capability  -> DSH native image block
Text-only or unknown capability   -> plugin path bridge -> vision_cloud_tool -> dedicated VLM
```

The plugin must continue to use the public attachment abstraction and must not inspect or reconstruct DSH's private attachment-object directory.

## 2. Existing context and constraints

The repository already contains:

- Content-addressed paste/drop storage below `.dsh-vision-cloud/tmp/pasted-images/<session>/`.
- A server-side model capability verdict used by paste/drop takeover.
- Client-side model-selection tracking, verdict caching, asynchronous decide-then-act paste handling, and native-draft-to-bridge migration.
- Public `ctx.attachments.readImage(...)` use for `sha256:` attachment references.
- A modlens v2 online vision runtime with byte, pixel, URL, workspace, and allowed-directory checks.
- A `conversation.chat.node` priority `-1` shadow renderer that displays native and bridge images, strips bridge markup from the visible bubble, and supplies a lightbox.
- Existing automated tests for path security, paste storage, model routing, attachment lookup, prompt assembly, client paste/drop behavior, and the shadow renderer.

The upgrade is limited to compatibility boundaries and regression coverage. It must not remove or unnecessarily redesign:

- `.dsh-vision-cloud/tmp/pasted-images` storage;
- image hashing and session isolation;
- workspace and allowed-directory security checks;
- maximum image byte/pixel checks;
- public `sha256:` attachment support;
- independent vision-model settings and `vision_cloud_tool` runtime;
- modlens v2 fields (`summary`, `ocr`, `layout`, `semantics`, `visual`, `uncertainty`);
- URL image validation;
- text-only fallback behavior;
- bridge preview and lightbox behavior.

## 3. Design decisions

### 3.1 Recommended approach

Use a capability adapter layer and conservatively narrow the existing shadow renderer. Do not maintain rc6/rc7/rc8 production branches.

The implementation keeps the current bridge and runtime architecture, then introduces two focused pure boundaries:

1. `src/file-references.ts` for DSH `@file` normalization and session-reference discrimination.
2. `src/model-capability.ts` for resolving `image`, `text`, or `unknown` from whatever public model capability APIs are present.

The rest of the plugin consumes these normalized results.

### 3.2 Rejected alternatives

**Immediate complete removal of the shadow renderer** was not selected for this release. It is the desired P2 direction, but it requires a stable public compositional renderer extension point across all three Harness baselines. Removing the shadow copy before that contract is verified could regress the core text-only image preview.

**Version-number branching** is explicitly rejected. Production behavior must not branch on `rc6`, `rc7`, `rc8`, `dshVersion`, or semver comparisons. Version names may appear only in test fixtures, installation scripts, and reports.

## 4. Architecture

### 4.1 File-reference normalization

Create a pure, Cordis-independent module:

```ts
export type DshReference =
  | { kind: 'file'; value: string }
  | { kind: 'session'; value: string }
  | { kind: 'plain'; value: string }

export function normalizeDshFileReference(raw: string): DshReference
```

Normalization rules:

| Input | Normalized result |
| --- | --- |
| `image.png` | `{ kind: 'file', value: 'image.png' }` |
| `./image.png` | file, unchanged |
| `/path/image.png` | file, unchanged |
| `~/Pictures/image.png` | file, unchanged until HOME expansion |
| `@image.png` | file, value `image.png` |
| `@./image.png` | file, value `./image.png` |
| `@~/Pictures/image.png` | file, value `~/Pictures/image.png` |
| `@"image with spaces.png"` | file, value `image with spaces.png` |
| `@"./screenshots/foo bar.png"` | file, value `./screenshots/foo bar.png` |
| `@[...](dsh-session:...)` | session; preserve the reference payload |
| a structured session reference object rendered as text | session when the known DSH marker is present |
| an unclassified `@xxx` | plain; do not assume agent or file |

The exact session-reference detector must recognize the DSH structured form before stripping `@`. A session reference must never become a path by simply removing its leading character.

The adapter does not read files and does not decide whether a file is an image. It only normalizes the reference kind and value.

### 4.2 File-resolution pipeline

`src/runtime.ts` will route each `images` entry through this pipeline:

```text
raw input
  -> normalizeDshFileReference
  -> session reference: reject before filesystem access
  -> plain unclassified @ reference: reject as non-image input
  -> file reference
  -> http(s) URL detection
  -> HOME expansion
  -> resolveInputFile
  -> workspace/allowedDirs realpath fence
  -> image bytes, header, limits, attachment save
```

Existing direct URLs retain their current rules: only HTTP(S) direct image URLs are accepted by default, supported extensions are required unless `allowExtensionlessImageUrls` is enabled, and response media type plus magic bytes remain validated.

HOME behavior remains:

```text
~       -> homedir()
~/foo   -> join(homedir(), 'foo')
```

The bridge marker remains the existing descriptive path marker and plugin-owned file-route markdown. It is not changed to `@path`, because `@file` is a Harness syntax and must remain distinguishable from the plugin's internal bridge serialization.

`@src/App.vue`, `@package.json`, and `@README.md` may be normalized as file references if explicitly passed to the vision tool, but the existing supported-image-extension and content checks reject them as non-image inputs. Normal conversation scanning must not add those text references to `vision_cloud_tool.images`; they remain available to Harness's ordinary file-reference/read mechanism.

### 4.3 Model capability adapter

Create a pure-facing adapter with no DSH version knowledge:

```ts
export type ModelCapability = 'image' | 'text' | 'unknown'

export async function resolveModelCapability(
  llm: unknown,
  provider: string,
  model: string,
  signal?: AbortSignal,
): Promise<ModelCapability>
```

The adapter probes public capabilities in this order:

1. If `llm.resolveModelInfo` is a function, call it and inspect `inputModalities`.
2. If that API is absent or fails, use `llm.listModels(provider)` when available and find an exact model `id` or `name` match.
3. If a model entry has an array `inputModalities`, inspect whether it includes `image`.
4. If no conclusive evidence exists, return `unknown`.

The only positive native-image condition is:

```ts
Array.isArray(inputModalities) && inputModalities.includes('image')
```

A non-empty modalities array without `image` is `text`. A missing, empty, or unusable capability declaration is `unknown`; the routing policy for `unknown` is still the text-safe bridge.

Consumers use the result as follows:

| Capability | Paste/drop | Native draft on model switch | Prompt/tool guidance |
| --- | --- | --- | --- |
| `image` | `takeover: false`; let DSH handle native attachment | keep native image | directly visible native images are handled by the model; fallback remains for paths/URLs |
| `text` | `takeover: true`; create bridge record | migrate native draft to bridge | require `vision_cloud_tool` for non-visible image inputs |
| `unknown` | `takeover: true`; text-safe bridge | do not send an uncertain native block | conservative visual-tool guidance |

The existing explicit provider/model selection remains authoritative over stale session `requestContext()` data. Verdict caches are still invalidated when the live model-selection store changes.

### 4.4 Attachment abstraction

The runtime continues to resolve `sha256:<id>` through the live session's structured image block and the public attachment service:

```text
sha256:<id>
  -> findImageRef(session, id)
  -> ctx.attachments.readImage(ref, signal)
  -> { data, name, source }
```

The implementation may tolerate rc6–rc8 message nesting differences (`data.content`, `data.message.content`, `result`, `tool-result`, `events`) but must only copy the leaf fields required for the operation. It must not stringify or recursively dump live Cordis objects.

No code may read, join, glob, or infer a private DSH attachment path such as `<DSH_HOME>/attachments/v1/objects/...`. If the public attachment API is missing or fails, the tool returns a controlled error and does not use a private-directory fallback.

### 4.5 Prompt and tool routing

`src/system-prompt.ts`, `src/tools.ts`, `src/vision-context.ts`, and `src/prompt-assembly.ts` must express the two-route model clearly:

- An image-capable model must directly analyze native image content that is visible in the conversation and must not call `vision_cloud_tool` for that image.
- A text-only model must call `vision_cloud_tool` in the same turn for bridge paths, direct image URLs, and image attachment IDs.
- An image-capable model still uses `vision_cloud_tool` for an image that is only represented by a path, URL, or attachment reference and is not directly visible.
- `@image.png` and `@"error screenshot.png"` are image file references and enter the visual route when the current model cannot see them.
- `@src/App.vue`, `@package.json`, `@README.md`, and other text files stay with Harness's ordinary read/file-reference capability.
- Videos, audio, JSON, YAML, logs, HTML pages, API endpoints, and other non-image inputs are not claimed by the visual tool.
- An `@[...](dsh-session:...)` reference is not added to `vision_cloud_tool.images`.

The runtime context scanner must collect only image-shaped paths and URLs plus native image attachment IDs. It must not treat every `@xxx` token as an image or agent reference.

### 4.6 Renderer compatibility strategy

The current `conversation.chat.node` shadow registration remains temporarily, because bridge images require plugin-owned presentation. Its responsibilities are narrowed:

1. Detect and render only the plugin's bridge markers as real image tiles.
2. Render native image blocks using the `loadImage` capability supplied by Harness.
3. Preserve ordinary user text.
4. Use structured reference metadata when available to identify `/skill` and `@agent` chips.
5. Leave `@file`, `@session`, and unclassified `@xxx` as ordinary text or pass them to an official renderer.
6. Prefer an official Harness renderer/renderer callback for known non-bridge blocks.
7. Use a safe non-JSON fallback only when no official or known renderer is available for a future block.

The renderer must not use this as its default future-block policy:

```text
unknown block -> JsonBlock as final user-facing UI
```

If a public compositional UserMessageNodeView or block-renderer capability is available in a target runtime, the implementation should use it for all ordinary text, native images, file references, session references, skills, agents, and new blocks, with the plugin handling only bridge markers. If that capability is unavailable, the shadow renderer remains as a compatibility fallback, but messages without bridge markers should give the official renderer priority where possible.

The `@` chip parser changes from the current blanket `/[/@][\\w-]+/` behavior. `/skill` remains eligible for a skill chip. An `@agent` chip requires structured metadata or an equivalent confirmed Harness reference kind. `@file`, `@session`, and unclassified `@xxx` are not agent chips.

Bridge display behavior is unchanged:

```text
model-facing message:
[Pasted image available at absolute path: "..."]

![name](</_dsh/vision-cloud/paste-images/file?...>)

user-facing message:
real thumbnail, hidden bridge path, clickable lightbox, visible user text
```

Native images, bridge images, and mixtures of both must continue to render. Retry, session-bound file routes, `nosniff`, and path/session isolation remain in force.

## 5. Error handling and security

| Condition | Required behavior |
| --- | --- |
| DSH session reference is sent to visual input | reject before filesystem access and state that Harness-native session handling is required |
| unclassified `@xxx` is sent to visual input | reject as unclassified/non-image rather than guessing |
| explicit text file is sent to visual input | existing extension/content validation rejects it |
| model explicitly declares `image` | do not create bridge storage or duplicate upload |
| model explicitly lacks `image` | use bridge and visual fallback |
| model capability is unknown | use text-safe bridge; never assume native image support |
| capability API is unavailable | follow the same unknown policy |
| public attachment API is unavailable | controlled attachment-read error; no private-path probing |
| bridge route temporarily fails | preserve existing retry window and user notification; do not permanently disable future recovery |
| native-to-bridge migration cannot complete | keep the native draft intact and notify the user |
| renderer encounters an unsupported block | prefer official view; otherwise retain a safe placeholder/fallback without JSON-dumping the live block |
| path or symlink escapes workspace/allowedDirs | reject using existing realpath fence |

Every new listener, route, timer, cache subscription, preview attachment, and renderer registration remains owned by the current Cordis fiber and is disposed on plugin stop/update.

## 6. Test design

### 6.1 Pure file-reference tests

Add tests for:

```text
image.png
./image.png
~/image.png
/path/image.png
@image.png
@./image.png
@~/image.png
@"image with spaces.png"
@"./screenshots/foo bar.png"
@[...](dsh-session:...)
@agent
@session
@src/App.vue
```

Assertions cover exact normalization, quoted spaces, HOME preservation, session discrimination, and no accidental agent/file classification.

### 6.2 Capability and routing tests

Test the adapter with:

- `resolveModelInfo` returning `[text, image]`, `[text]`, an empty/missing modalities field, or throwing;
- only `listModels` available;
- exact `id` and exact `name` matches;
- no matching model;
- absent and throwing APIs.

Then test integration routing:

- image capability gives `takeover: false`;
- text capability gives `takeover: true`;
- unknown capability gives `takeover: true`;
- explicit current provider/model overrides stale `requestContext()`;
- model changes clear verdicts and trigger reconciliation;
- multimodal native draft becomes bridge when switching to text-only;
- migration failure preserves the original native draft;
- native model paste/drop creates no bridge upload.

### 6.3 Attachment tests

Retain and extend `sha256:` tests for:

- prefixed and unprefixed IDs;
- top-level and nested session message content;
- missing attachment references;
- public `readImage` success and failure;
- byte, format, dimension, and pixel-limit checks after reading;
- no private attachment path access.

### 6.4 Renderer tests

Extend jsdom tests for:

```text
ordinary text
native image
bridge image
native + bridge mixture
@file
@"file with spaces.png"
@session
/skill
structured agent reference
ordinary @xxx
known non-bridge block
unknown future block
```

Required assertions:

- native images use `loadImage`;
- bridge images render as real `<img>` elements;
- bridge path markup is hidden from visible text;
- retry and lightbox remain available;
- mixed galleries render all image kinds;
- only structured agent references become agent chips;
- file/session/unclassified references do not become agent chips;
- unknown blocks do not default to `JsonBlock`;
- official renderer capability is preferred when available.

### 6.5 Compatibility fixture layout

Add a shared contract suite and three version-labelled entry points:

```text
tests/compat/
├── shared/
│   ├── file-reference.contract.ts
│   ├── model-capability.contract.ts
│   ├── attachment.contract.ts
│   └── renderer.contract.ts
├── rc6/contract.spec.ts
├── rc7/contract.spec.ts
└── rc8/contract.spec.ts
```

The fixture labels are test metadata only. They must not alter production behavior. Each fixture describes which public capability methods are present and which message/reference blocks are exposed by that Harness baseline.

Add a matrix runner (`scripts/compat-matrix.mjs`, or the equivalent repository script) that creates isolated temporary install environments, installs the three prerelease baselines, runs build/typecheck/contract tests, and records exit codes and test counts. It must fail clearly when a requested version package is unavailable instead of reporting a false pass.

## 7. Files and responsibilities

Expected implementation surface:

- **Create `src/file-references.ts`:** pure DSH file/session/plain reference normalization.
- **Create `src/model-capability.ts`:** public capability feature detection and normalized result.
- **Modify `src/runtime.ts`:** normalize image inputs before URL/path/attachment resolution and preserve existing limits/runtime behavior.
- **Modify `src/paste-images.ts`:** consume the shared capability adapter while retaining explicit-selection precedence and bridge storage.
- **Modify `src/web.ts`:** use capability fallback for model listing/validation without claiming unknown models are image-capable.
- **Modify `src/vision-context.ts`:** collect image references without stealing ordinary text-file/session references.
- **Modify `src/prompt-assembly.ts`, `src/system-prompt.ts`, and `src/tools.ts`:** align model-facing instructions and route behavior with native-vs-bridge capability results.
- **Modify `src/client/user-message-view.tsx`:** structured reference classification, official-renderer preference where exposed, conservative unknown-block handling, and bridge-only custom presentation.
- **Modify `src/client/paste-images.tsx` only where required:** preserve native release/reconciliation and make any shared capability or reference behavior consistent; do not rewrite paste storage logic.
- **Add/modify tests under `tests/`:** red-green regression tests for every new boundary and existing behavior.
- **Create `tests/compat/` fixtures:** shared contracts and rc6/rc7/rc8 entry points.
- **Create or modify `scripts/compat-matrix.mjs` and `package.json`:** reproducible compatibility command without production version branches.
- **Create `docs/compatibility-matrix.md`:** actual dependency versions, commands, evidence, and unresolved risks.
- **Update `docs/test-cases.md`:** map the new `@file`, `@session`, unknown-block, attachment, and version cases to automated and manual evidence.

The implementation plan may merge a small adapter into an existing focused file if the repository's public API shape makes a separate module unnecessary, but it must preserve the two boundaries and their independent tests.

## 8. Validation and delivery evidence

Required repository commands after implementation:

```text
pnpm build
pnpm test
pnpm verify:portable
pnpm test:compat
```

The actual command names may be adjusted only to match the repository's package scripts; any renamed command must be recorded in the compatibility document.

Real-runtime evidence must cover:

### rc6 + text-only model

```text
paste/drop image -> bridge file appears -> UI thumbnail/lightbox -> path remains in model message -> vision_cloud_tool reads it
```

### rc7 + text-only model

The rc6 text-only flow plus `sha256:` attachment resolution and model-switch regression.

### rc8 + text-only model

```text
paste image
@image.png
@"error screenshot.png"
~/Pictures/test.png
@src/App.vue -> ordinary Harness file/read path
@session -> not a filesystem image path
```

### rc8 + multimodal model

```text
paste/drop image -> native DSH image block -> no bridge file -> no plugin takeover -> model sees the image natively
```

### rc8 model switch

```text
multimodal native draft -> switch to text-only before send -> bridge migration -> no unsupported native-image request
```

The final report must list:

1. Changed files and each purpose;
2. rc6/rc7/rc8 feature-detection strategy;
3. Whether bridge path behavior changed;
4. Shadow renderer changes and official-renderer interaction;
5. Native-vs-text-only routing behavior;
6. New automated/manual tests;
7. Fresh command and real-runtime results;
8. Remaining future-rc risks;
9. Any unverified environment or capability contract.

No completion claim may be made from code inspection alone. A version or scenario is marked passing only when the corresponding fresh build/test/runtime evidence is recorded.

## 9. Acceptance criteria

The upgrade is accepted only if all of the following are demonstrated:

- rc6, rc7, and rc8 build/typecheck/contract-test runs complete successfully in available isolated environments;
- text-only paste/drop bridge remains functional;
- text-only users continue to see real bridge thumbnails and lightboxes;
- native image-capable models are not bridged, duplicated, or forced through `vision_cloud_tool`;
- native drafts migrate safely when switching to text-only models;
- all listed plain, `@file`, quoted, HOME, and absolute paths normalize correctly;
- DSH session references are not treated as files;
- ordinary text-file references remain with Harness's normal read/file path;
- `sha256:` attachment reads use only the public attachment abstraction;
- ordinary `@xxx` tokens are not universally rendered as agent chips;
- known and future message blocks are not incorrectly finalized as JSON attachments;
- existing image format, size, pixel, workspace, URL, hash, session, modlens, and bridge UI regressions remain green;
- compatibility documentation contains evidence, not only a compatibility assertion.

## 10. Future risks and P2 direction

The main remaining future risk is that a later Harness release changes the public slot props or removes the currently available compositional renderer capability. The plugin should therefore continue to isolate bridge rendering from ordinary message rendering and record any renderer capability assumptions in the compatibility matrix.

The P2 direction is:

```text
Harness official UserMessageNodeView
  + plugin bridge-marker/image extension
```

At that point the plugin should stop copying the complete user-message view and retain only the bridge image presentation, allowing future native blocks, `@file`, `@session`, `/skill`, `@agent`, and other Harness features to evolve without shadow-renderer updates.
