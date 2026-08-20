# vision-cloud-tool DSH rc6+ Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `vision-cloud-tool` to use public capability detection for DSH rc6/rc7/rc8+ while preserving the text-only path bridge, real bridge-image UI, native multimodal routing, public attachment reads, and regression coverage.

**Architecture:** Add two pure adapters: `normalizeDshFileReference()` classifies DSH file/session/plain references, and `resolveModelCapability()` normalizes available model catalog APIs to `image`, `text`, or `unknown`. Route runtime, paste verdicts, prompt assembly, and Settings through those adapters; retain content-addressed bridge storage and public `ctx.attachments` reads. Constrain the shadow renderer to bridge presentation and confirmed native/structured blocks, while avoiding blanket `@` agent chips and JSON-dumping unknown blocks.

**Tech Stack:** TypeScript, React 18, Cordis/DSH rc6 public APIs, Node.js 22+, Vitest 4, Testing Library/jsdom, pnpm.

## Global Constraints

- Support DeepSeek Harness `0.1.0-rc.6`, `0.1.0-rc.7`, `0.1.0-rc.8`, and later prereleases where the same public capabilities are available.
- Do not branch production behavior on `rc6`, `rc7`, `rc8`, `dshVersion`, or semver comparisons.
- Preserve `.dsh-vision-cloud/tmp/pasted-images/<session>/` content-addressed bridge storage and session isolation.
- Preserve workspace/allowed-directory security, image hash, max byte/pixel limits, URL validation, `sha256:` support, modlens v2, bridge preview, and lightbox.
- Use DSH native image blocks only when a model explicitly exposes `inputModalities.includes('image')`.
- Treat missing, empty, failed, or unusable capability information as `unknown`, and route `unknown` through the text-safe bridge.
- Never read or infer DSH private attachment paths; use only the public attachment abstraction such as `ctx.attachments.readImage(...)`.
- Never convert the plugin bridge marker to official `@file` syntax.
- `@file` normalization must precede HOME expansion and existing workspace/path validation.
- DSH session references must not be stripped into filesystem paths.
- Ordinary `@xxx` tokens must not universally become agent chips.
- Unknown future message blocks must not default to `JsonBlock` as their final user-facing representation.
- Production code must retain the native-image/text-only two-route invariant; fixture version labels are test metadata only.
- Every production behavior change requires a failing regression test before implementation and a focused passing test after implementation.

---

## File map and responsibilities

### New files

- `src/file-references.ts` — Pure normalization of `@file`, quoted file references, session references, and unclassified `@` values.
- `src/model-capability.ts` — Pure-facing feature detector for `resolveModelInfo`/`listModels`, exact model matching, and `image`/`text`/`unknown` results.
- `tests/file-references.spec.ts` — Red-green tests for reference normalization and session discrimination.
- `tests/model-capability.spec.ts` — Red-green tests for public model API fallback and conservative unknown handling.
- `tests/compat/shared/file-reference.contract.ts` — Shared file-reference contract test registration.
- `tests/compat/shared/model-capability.contract.ts` — Shared capability contract test registration.
- `tests/compat/shared/attachment.contract.ts` — Shared public attachment contract helpers/tests.
- `tests/compat/shared/renderer.contract.ts` — Shared renderer/reference/block contract test registration.
- `tests/compat/rc6/contract.spec.ts` — rc6-labelled contract entry point.
- `tests/compat/rc7/contract.spec.ts` — rc7-labelled contract entry point.
- `tests/compat/rc8/contract.spec.ts` — rc8-labelled contract entry point.
- `scripts/compat-matrix.mjs` — Isolated dependency/build/test matrix runner; no production runtime use.
- `docs/compatibility-matrix.md` — Actual versions, command output summaries, scenario evidence, and unresolved risks.

### Modified files

- `src/runtime.ts` — Normalize tool image references before URL/path resolution; reject session/plain references before filesystem access.
- `src/paste-images.ts` — Replace local model capability branches with shared resolver while preserving client-selection precedence and bridge storage.
- `src/web.ts` — Use capability resolver for provider model listing and selected-model validation; preserve unknown as non-selectable/non-vision.
- `src/vision-context.ts` — Collect only image paths/URLs and image attachments; exclude text files, sessions, and unclassified `@` tokens.
- `src/prompt-assembly.ts` — Use shared capability resolver and preserve image/text/unknown routing semantics.
- `src/system-prompt.ts` — Explicitly document native image, text-only bridge, `@file`, `@session`, and non-image file routing.
- `src/tools.ts` — Update `vision_cloud_tool` description and parameter notes for `@file`, native visibility, and text-file exclusions.
- `src/client/user-message-view.tsx` — Structured message-part/reference classification, conservative chips, official-renderer preference if exposed, and non-JSON unknown-block fallback while retaining bridge gallery/lightbox.
- `src/client/paste-images.tsx` — Only adjust shared capability/renderer integration if tests demonstrate a needed client-side compatibility change; preserve native release, bridge migration, submit guard, and image rail.
- `tests/runtime-find-image-ref.spec.ts` — Add attachment ID normalization and public-ref shape regressions when the shared attachment boundary changes.
- `tests/runtime-url-guard.spec.ts` — Add `@file`, quoted filename, session/plain rejection, HOME/path integration cases.
- `tests/vision-context.spec.ts` — Add `@image`, quoted image, `@src/App.vue`, `@session`, and direct-image route cases.
- `tests/prompt-assembly.spec.ts` — Add `listModels` fallback, empty modalities, unknown bridge policy, and native route assertions.
- `tests/system-prompt.spec.ts` — Assert updated route/file guidance.
- `tests/user-message-view.spec.ts` — Add structured file/session/agent/unknown block and mixed gallery assertions.
- `tests/paste-images-client.spec.ts` — Preserve/add model-switch, native-vs-bridge, and no-double-upload regressions.
- `package.json` — Add `test:compat` script; keep rc6 minimum peer ranges and add only reproducible matrix dependencies/scripts needed.
- `docs/test-cases.md` — Map required rc6/rc7/rc8 scenarios to automated/manual evidence.
- `pnpm-lock.yaml` — Update only if package scripts or matrix tooling add dependencies.

---

### Task 1: Add DSH file-reference normalization

**Files:**
- Create: `src/file-references.ts`
- Create: `tests/file-references.spec.ts`
- Modify: `src/runtime.ts`
- Modify: `tests/runtime-url-guard.spec.ts`

**Interfaces:**
- Produces `DshReference` and `normalizeDshFileReference(raw: string): DshReference` for Tasks 2, 4, and 5.
- `DshReference.kind === 'file'` is the only result allowed into `resolveInputFile`/URL handling.
- `DshReference.kind === 'session'` preserves the original session marker and is rejected before filesystem access.
- `DshReference.kind === 'plain'` is not automatically an image or agent reference.

- [ ] **Step 1: Write failing unit tests for all required forms.**

```ts
import { describe, expect, it } from 'vitest'
import { normalizeDshFileReference } from '../src/file-references.ts'

describe('normalizeDshFileReference', () => {
  it.each([
    ['image.png', 'image.png'],
    ['./image.png', './image.png'],
    ['/path/image.png', '/path/image.png'],
    ['~/Pictures/image.png', '~/Pictures/image.png'],
    ['@image.png', 'image.png'],
    ['@./image.png', './image.png'],
    ['@~/Pictures/image.png', '~/Pictures/image.png'],
    ['@"image with spaces.png"', 'image with spaces.png'],
    ['@"./screenshots/foo bar.png"', './screenshots/foo bar.png'],
  ])('normalizes %s to a file reference', (raw, value) => {
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'file', value })
  })

  it('does not strip a structured DSH session reference into a path', () => {
    const raw = '@[session](dsh-session:abc123)'
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'session', value: raw })
  })

  it.each(['@agent', '@session', '@unknown-token'])('keeps unclassified %s plain', raw => {
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'plain', value: raw })
  })
})
```

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure.**

Run: `pnpm exec vitest run tests/file-references.spec.ts`

Expected: FAIL because `src/file-references.ts` does not exist.

- [ ] **Step 3: Implement the pure normalization function.**

```ts
export type DshReference =
  | { kind: 'file'; value: string }
  | { kind: 'session'; value: string }
  | { kind: 'plain'; value: string }

const SESSION_REFERENCE_RE = /^@\[[^\]]*\]\(dsh-session:[^)]+\)$/u
const QUOTED_FILE_RE = /^@"([\s\S]*)"$/u
const AT_FILE_RE = /^@((?:\.\.?[\\/]|~[\\/]|[A-Za-z]:[\\/]|\/|[^@\s][\s\S]*\.(?:png|jpe?g|gif|webp)(?:[?#].*)?))$/iu

export function normalizeDshFileReference(raw: string): DshReference {
  const value = raw.trim()
  if (SESSION_REFERENCE_RE.test(value)) return { kind: 'session', value }
  const quoted = value.match(QUOTED_FILE_RE)
  if (quoted?.[1] !== undefined && quoted[1] !== '') return { kind: 'file', value: quoted[1] }
  if (AT_FILE_RE.test(value)) return { kind: 'file', value: value.slice(1) }
  if (!value.startsWith('@')) return { kind: 'file', value }
  return { kind: 'plain', value }
}
```

The implementation must avoid treating arbitrary `@agent`/`@session` tokens as files while allowing supported image filenames with spaces after the quoted form. Keep the helper independent from Node, Cordis, and DSH internals.

- [ ] **Step 4: Run the focused test and verify it passes.**

Run: `pnpm exec vitest run tests/file-references.spec.ts`

Expected: all normalization tests PASS.

- [ ] **Step 5: Add runtime red tests for quoted/@ image paths and session/plain rejection.**

Add cases to `tests/runtime-url-guard.spec.ts` using an existing valid PNG fixture or a workspace file:

```ts
it('accepts @-prefixed and quoted local image references', async () => {
  const image = join(workspace, 'error screenshot.png')
  await writeFile(image, TINY_PNG)
  await expect(runtime().read({ images: ['@"error screenshot.png"'], attachments: [] }, undefined, options())).resolves.toMatchObject({ images: [{ format: 'png' }] })
})

it('rejects a session reference before filesystem resolution', async () => {
  await expect(runtime().read({ images: ['@[session](dsh-session:abc)'], attachments: [] }, undefined, options())).rejects.toMatchObject({ code: 'input' })
})
```

- [ ] **Step 6: Run the new runtime tests and verify they fail for the old path resolver.**

Run: `pnpm exec vitest run tests/runtime-url-guard.spec.ts -t 'prefixed|quoted|session'`

Expected: the new cases fail because the old runtime passes the raw `@` value into path resolution.

- [ ] **Step 7: Normalize runtime inputs before URL/path handling.**

In `src/runtime.ts`, import `normalizeDshFileReference` and update `resolveImageBytes`:

```ts
const reference = normalizeDshFileReference(raw)
if (reference.kind === 'session') {
  throw new VisionToolkitError('input', `DSH session reference is not an image file: ${raw}`)
}
if (reference.kind === 'plain') {
  throw new VisionToolkitError('input', `unclassified DSH reference is not an image file: ${raw}`)
}
const input = reference.value
if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
  if (!/^https?:\/\//i.test(input)) throw new VisionToolkitError('input', `only http(s) image URLs are supported: ${raw}`)
  return fetchUrlBytes(input, signal, allowExtensionlessImageUrls)
}
const resolved = await resolveInputFile(input, policy)
const data = await readFile(resolved.path)
return { data: new Uint8Array(data), source: resolved.path, name: basename(resolved.path) }
```

Do not alter `expandUserHome`, `resolveInputFile`, bridge storage, or image limits.

- [ ] **Step 8: Run focused and existing URL tests.**

Run: `pnpm exec vitest run tests/file-references.spec.ts tests/runtime-url-guard.spec.ts`

Expected: all tests PASS, including existing URL/media/path guards.

- [ ] **Step 9: Commit the reference boundary.**

```bash
git add src/file-references.ts tests/file-references.spec.ts src/runtime.ts tests/runtime-url-guard.spec.ts
git commit -m "feat: normalize DSH image file references"
```

---

### Task 2: Add model-capability feature detection

**Files:**
- Create: `src/model-capability.ts`
- Create: `tests/model-capability.spec.ts`

**Interfaces:**
- Produces `ModelCapability = 'image' | 'text' | 'unknown'`.
- Produces `resolveModelCapability(llm: unknown, provider: string, model: string, signal?: AbortSignal): Promise<ModelCapability>`.
- `image` requires a non-empty `inputModalities` array containing `image`.
- `text` requires a non-empty modalities array without `image`.
- Missing, empty, failed, or unusable capability is `unknown`.

- [ ] **Step 1: Write failing adapter tests.**

```ts
import { describe, expect, it, vi } from 'vitest'
import { resolveModelCapability } from '../src/model-capability.ts'

const signal = new AbortController().signal

describe('resolveModelCapability', () => {
  it('prefers resolveModelInfo and detects image input', async () => {
    const listModels = vi.fn()
    const llm = { resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: ['text', 'image'] }), listModels }
    await expect(resolveModelCapability(llm, 'p', 'm', signal)).resolves.toBe('image')
    expect(listModels).not.toHaveBeenCalled()
  })

  it('detects text-only models from a non-empty modality list', async () => {
    await expect(resolveModelCapability({ resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: ['text'] }) }, 'p', 'm', signal)).resolves.toBe('text')
  })

  it('falls back to an exact listModels id/name match', async () => {
    const llm = { listModels: vi.fn().mockResolvedValue([{ id: 'm', name: 'Display', inputModalities: ['text', 'image'] }]) }
    await expect(resolveModelCapability(llm, 'p', 'm', signal)).resolves.toBe('image')
  })

  it('returns unknown for absent, empty, throwing, or unmatched capability', async () => {
    await expect(resolveModelCapability({}, 'p', 'm', signal)).resolves.toBe('unknown')
    await expect(resolveModelCapability({ resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: [] }) }, 'p', 'm', signal)).resolves.toBe('unknown')
    await expect(resolveModelCapability({ resolveModelInfo: vi.fn().mockRejectedValue(new Error('offline')) }, 'p', 'm', signal)).resolves.toBe('unknown')
    await expect(resolveModelCapability({ listModels: vi.fn().mockResolvedValue([{ id: 'other', inputModalities: ['image'] }]) }, 'p', 'm', signal)).resolves.toBe('unknown')
  })
})
```

- [ ] **Step 2: Run the focused test and verify the expected missing-module failure.**

Run: `pnpm exec vitest run tests/model-capability.spec.ts`

Expected: FAIL because `src/model-capability.ts` does not exist.

- [ ] **Step 3: Implement the minimal adapter.**

```ts
export type ModelCapability = 'image' | 'text' | 'unknown'

type ModelInfo = { inputModalities?: unknown }
type ModelEntry = { id?: unknown; name?: unknown; inputModalities?: unknown }
type LlmLike = {
  resolveModelInfo?: (provider: string, model: string, signal?: AbortSignal) => Promise<ModelInfo>
  listModels?: (provider: string) => Promise<readonly ModelEntry[]>
}

function capabilityOf(value: unknown): ModelCapability {
  if (!Array.isArray(value) || value.length === 0 || !value.every(item => typeof item === 'string')) return 'unknown'
  return value.includes('image') ? 'image' : 'text'
}

export async function resolveModelCapability(llm: unknown, provider: string, model: string, signal?: AbortSignal): Promise<ModelCapability> {
  const candidate = llm as LlmLike
  if (typeof candidate.resolveModelInfo === 'function') {
    try {
      const resolved = await candidate.resolveModelInfo(provider, model, signal)
      const capability = capabilityOf(resolved?.inputModalities)
      if (capability !== 'unknown') return capability
    } catch {
      // Try the older catalog surface below.
    }
  }
  if (typeof candidate.listModels !== 'function') return 'unknown'
  try {
    const entries = await candidate.listModels(provider)
    const exact = entries.find(entry => entry.id === model || entry.name === model)
    return exact === undefined ? 'unknown' : capabilityOf(exact.inputModalities)
  } catch {
    return 'unknown'
  }
}
```

Do not read a package version or compare semver. Do not treat an empty modality array as text-only.

- [ ] **Step 4: Run adapter tests and verify they pass.**

Run: `pnpm exec vitest run tests/model-capability.spec.ts`

Expected: all adapter tests PASS.

- [ ] **Step 5: Commit the capability boundary.**

```bash
git add src/model-capability.ts tests/model-capability.spec.ts
git commit -m "feat: detect model image capability by public APIs"
```

---

### Task 3: Route paste verdicts and Settings through the shared capability adapter

**Files:**
- Modify: `src/paste-images.ts`
- Modify: `src/web.ts`
- Modify: `tests/paste-images.spec.ts`
- Create or modify: `tests/web-settings.spec.ts`

**Interfaces:**
- Consumes `resolveModelCapability` from Task 2.
- Produces `takeover = capability !== 'image'` for exact model selection.
- Produces Settings model entries with the available public `inputModalities`, but only allows saving an explicitly image-capable model.
- Preserves explicit provider/model precedence, catalog label behavior, stale-session fallback, and text-safe unknown behavior.

- [ ] **Step 1: Add failing paste verdict tests for empty and fallback capability.**

Extend `tests/paste-images.spec.ts` with contexts that expose only `resolveModelInfo`, only `listModels`, or neither:

```ts
it('uses the shared resolver and bridges when modalities are empty', async () => {
  const ctx = {
    llm: { resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: [] }) },
    sessions: { get: () => undefined },
    logger: { warn: vi.fn() },
  }
  const { base } = await setupVerdict(ctx)
  const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?provider=p&model=m`)
  expect(await response.json()).toEqual({ takeover: true })
})

it('allows native paste only for a public exact image capability', async () => {
  const ctx = {
    llm: { listModels: vi.fn().mockResolvedValue([{ id: 'm', inputModalities: ['text', 'image'] }]) },
    sessions: { get: () => undefined },
    logger: { warn: vi.fn() },
  }
  const { base } = await setupVerdict(ctx)
  const response = await fetch(`${base}${PASTE_IMAGES_ROUTE}?provider=p&model=m`)
  expect(await response.json()).toEqual({ takeover: false })
})
```

- [ ] **Step 2: Run the focused tests and confirm they fail against duplicated old logic.**

Run: `pnpm exec vitest run tests/paste-images.spec.ts -t 'empty|public exact image capability'`

Expected: FAIL or expose inconsistent old fallback behavior before shared routing is wired.

- [ ] **Step 3: Replace local exact-model capability logic with the adapter.**

In `src/paste-images.ts`, retain label/catalog and session-selection precedence, but replace `takeoverForExact` with:

```ts
private async takeoverForExact(provider: string, model: string): Promise<boolean> {
  const capability = await resolveModelCapability(this.ctx.llm, provider, model)
  return capability !== 'image'
}
```

Update `catalogScan` to use the exact adapter for a matched provider/model pair rather than returning native for an empty modalities list. If a label maps to multiple providers, return a definite native verdict only when the matched catalog entry explicitly contains `image`; otherwise use bridge-safe behavior.

- [ ] **Step 4: Run paste tests and verify existing bridge/native/model-switch behavior remains green.**

Run: `pnpm exec vitest run tests/paste-images.spec.ts tests/paste-images-client.spec.ts`

Expected: all existing and new verdict tests PASS, including native replay, bridge fallback, submit guard, and tile re-materialization.

- [ ] **Step 5: Add failing Settings tests for resolver fallback.**

Create `tests/web-settings.spec.ts` around `VisionToolkitWebBackend` with a minimal context:

```ts
it('rejects saving a model when public capability APIs are unavailable', async () => {
  const ctx = fakeSettingsContext({ llm: {} })
  const backend = new VisionToolkitWebBackend(ctx as never, () => undefined)
  const response = await postJson(backend, {
    action: 'save',
    expectedRevision: 0,
    value: { model: { provider: 'p', model: 'm' } },
  })
  expect(response.status).toBe(400)
  expect(response.body).toMatchObject({ ok: false, error: { code: 'settings-rejected' } })
})
```

Implement `postJson(backend, request)` in the test file with an in-memory `IncomingMessage`/`ServerResponse` pair, or use the repository's existing HTTP test helper if one is added in this task; do not add a production-only test hook.

- [ ] **Step 6: Run the Settings test and verify it fails before wiring the fallback.**

Run: `pnpm exec vitest run tests/web-settings.spec.ts`

Expected: FAIL because `web.ts` directly calls `resolveModelInfo` and does not tolerate the fallback surface.

- [ ] **Step 7: Update `src/web.ts` to use the shared capability adapter.**

In `providers()`, preserve listed model metadata and use `resolveModelInfo` only when present for reasoning efforts/modalities; otherwise keep the public `listModels` modalities. In `assertVisionCapableModel`, use:

```ts
const capability = await resolveModelCapability(this.ctx.llm, provider, model)
if (capability !== 'image') throw new Error(`model "${model}" does not declare image input; select a vision-capable model`)
```

Do not save a model as enabled when capability is unknown.

- [ ] **Step 8: Run Settings, paste, and existing configuration tests.**

Run: `pnpm exec vitest run tests/web-settings.spec.ts tests/paste-images.spec.ts tests/config.spec.ts`

Expected: all PASS.

- [ ] **Step 9: Commit shared routing integration.**

```bash
git add src/paste-images.ts src/web.ts tests/paste-images.spec.ts tests/web-settings.spec.ts
git commit -m "feat: route paste and settings by model capability"
```

---

### Task 4: Make vision context, prompt assembly, and tool guidance `@file`-aware

**Files:**
- Modify: `src/vision-context.ts`
- Modify: `src/prompt-assembly.ts`
- Modify: `src/system-prompt.ts`
- Modify: `src/tools.ts`
- Modify: `tests/vision-context.spec.ts`
- Modify: `tests/prompt-assembly.spec.ts`
- Modify: `tests/system-prompt.spec.ts`

**Interfaces:**
- Consumes `DshReference` from Task 1 and `ModelCapability`/`resolveModelCapability` from Task 2.
- Produces `VisionImageInputs` containing only image paths, direct image URLs, and image attachments.
- `renderVisionImageContext` keeps native attachments out for `image`, includes them for `text`/`unknown`, and never emits text-file/session references.

- [ ] **Step 1: Add failing scanner tests for `@image`, quoted image, text files, and sessions.**

Append to `tests/vision-context.spec.ts`:

```ts
it('collects DSH image-file references but ignores text files and sessions', () => {
  const session = sessionOf([userEvent([
    { type: 'text', text: '@image.png @"error screenshot.png" @src/App.vue @[session](dsh-session:abc)' },
  ])])
  const inputs = collectImageInputs(session)
  expect(inputs.paths).toEqual(['image.png', 'error screenshot.png'])
})
```

- [ ] **Step 2: Run the focused scanner test and verify it fails.**

Run: `pnpm exec vitest run tests/vision-context.spec.ts -t 'DSH image-file'`

Expected: FAIL because the current scanner only recognizes bridge markers and URL patterns.

- [ ] **Step 3: Implement token-safe image reference scanning.**

Add a helper in `src/vision-context.ts` that extracts whitespace-delimited reference candidates, calls `normalizeDshFileReference`, and appends only `kind: 'file'` values that end with `.png`, `.jpg`, `.jpeg`, `.gif`, or `.webp` (case-insensitive, with query/fragment support only for URLs). For quoted references, consume the entire `@"..."` token before splitting. Do not collect `@src/App.vue`, `@package.json`, `@README.md`, sessions, agents, or arbitrary `@xxx`.

- [ ] **Step 4: Run scanner tests and verify they pass.**

Run: `pnpm exec vitest run tests/vision-context.spec.ts`

Expected: all existing and new tests PASS, including deduplication and assistant/tool exclusion.

- [ ] **Step 5: Add failing prompt-assembly fallback tests.**

Add tests to `tests/prompt-assembly.spec.ts`:

```ts
it('uses listModels when resolveModelInfo is absent', async () => {
  const ctx = fakeContext({ listModels: vi.fn().mockResolvedValue([{ id: 'm', inputModalities: ['text', 'image'] }]) } as unknown as Context['llm'])
  const result = await applyVisionPromptEnrichment(ctx, assembly({ tools: [VISION_SCHEMA as never], variables: { provider: 'p', model: 'm' } }), { scope: {} })
  expect(result.sections.find(section => section.name === VISION_TOOL_SECTION_NAME)?.text.toLowerCase()).toContain('image-capable')
})

it('uses text-safe guidance for an empty capability declaration', async () => {
  const ctx = fakeContext({ resolveModelInfo: vi.fn().mockResolvedValue({ inputModalities: [] }) } as unknown as Context['llm'])
  const result = await applyVisionPromptEnrichment(ctx, assembly({ tools: [VISION_SCHEMA as never], variables: { provider: 'p', model: 'm' } }), { scope: {} })
  expect(result.sections.find(section => section.name === VISION_TOOL_SECTION_NAME)?.text.toLowerCase()).toContain('text-only')
})
```

- [ ] **Step 6: Run prompt tests and verify the expected failure.**

Run: `pnpm exec vitest run tests/prompt-assembly.spec.ts -t 'listModels|empty capability'`

Expected: FAIL before `prompt-assembly.ts` uses the shared adapter and unknown policy.

- [ ] **Step 7: Wire `prompt-assembly.ts` to the adapter and preserve unknown routing.**

Replace `resolveCapability` with an adapter call. Map `ModelCapability` directly to the existing `ConversationVisionCapability`; map unknown to `unknown`. Keep `routeInputs` so only native attachments are removed for confirmed `image`; paths/URLs remain routable through the tool. For text/unknown, preserve attachments, paths, and URLs.

- [ ] **Step 8: Update system/tool wording and tests.**

Include explicit guidance that:

```text
@image.png and @"error screenshot.png" are image file references;
@src/App.vue, @package.json, and @README.md remain ordinary Harness file/read references;
@[...](dsh-session:...) is a session reference, not an image path;
image-capable models do not call the tool for directly visible native images;
text-only and unknown-capability models use the tool in the same turn.
```

Update `tests/system-prompt.spec.ts` and add exact lower-case assertions for `@file`, `@session`, text-file exclusions, and native-vs-fallback routing.

- [ ] **Step 9: Run context/prompt/system/tool tests.**

Run: `pnpm exec vitest run tests/vision-context.spec.ts tests/prompt-assembly.spec.ts tests/system-prompt.spec.ts`

Expected: all PASS.

- [ ] **Step 10: Commit prompt/context integration.**

```bash
git add src/vision-context.ts src/prompt-assembly.ts src/system-prompt.ts src/tools.ts tests/vision-context.spec.ts tests/prompt-assembly.spec.ts tests/system-prompt.spec.ts
git commit -m "feat: route DSH file references through vision guidance"
```

---

### Task 5: Make shadow renderer safe for rc8 references and future blocks

**Files:**
- Modify: `src/client/user-message-view.tsx`
- Modify: `tests/user-message-view.spec.ts`

**Interfaces:**
- `splitContent` must continue returning text and native images, but must distinguish known references from unknown blocks without making `unknown -> JsonBlock` the default.
- `projectUserText` must render only confirmed `/skill` and structured agent references as chips.
- Bridge markers continue to produce `PastedBridgeImage` tiles and lightbox behavior.

- [ ] **Step 1: Add failing renderer tests.**

Add tests for structured and unclassified references:

```ts
it('does not turn file, session, or unknown @ references into agent chips', () => {
  const { container } = renderNode([text('@image.png @"error screenshot.png" @session @ordinary')], null)
  expect(container.querySelectorAll('[data-kind="agent"]')).toHaveLength(0)
  expect(container.textContent).toContain('@image.png')
  expect(container.textContent).toContain('@session')
})

it('does not render unknown future blocks as JsonBlock', () => {
  const { container } = renderNode([text('hello'), { type: 'future-block', payload: { secret: true } }], null)
  expect(container.querySelectorAll('[data-testid="json-block"]').length).toBe(0)
  expect(container.textContent).toContain('hello')
})
```

Adapt selectors to the existing primitive stub if `JsonBlock` does not expose `data-testid`; the assertion must inspect the rendered primitive contract, not implementation internals.

- [ ] **Step 2: Run renderer tests and confirm old blanket chip/JsonBlock behavior fails.**

Run: `pnpm exec vitest run tests/user-message-view.spec.ts -t 'file, session|unknown future'`

Expected: FAIL because `CHIP_RE` currently turns every `@xxx` into an agent chip and `split.rest` maps every block to `JsonBlock`.

- [ ] **Step 3: Add structured reference/block classification.**

Define narrow internal predicates in `src/client/user-message-view.tsx`:

```ts
type ReferenceKind = 'skill' | 'agent' | 'file' | 'session' | 'unknown'

function referenceKind(value: unknown): ReferenceKind | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const kind = record.kind ?? record.referenceType ?? record.type
  if (kind === 'skill' || kind === 'agent' || kind === 'file' || kind === 'session') return kind
  return undefined
}
```

Use structured metadata from known block shapes first. For plain text, only `/skill` remains a chip by default. A plain `@xxx` remains text unless an explicit agent metadata map is present in node props.

- [ ] **Step 4: Replace blanket `CHIP_RE` logic with conservative token projection.**

Use separate `/skill` matching and an explicit `agentTokens` set/map sourced from structured node data when available:

```ts
function projectUserText(text: string, agentTokens: ReadonlySet<string> = new Set()): ReactNode {
  const tokenRe = /(^|\s)(\/[-\w]+|@[-\w]+)(?=\s|$)/gu
  // Render /skill as skill; render @token only if agentTokens.has(token); leave all other tokens in MessageText.
}
```

Quoted `@"file with spaces.png"` and session markdown must remain ordinary/native reference text unless the official renderer is available. Do not create an agent chip from the `@` prefix alone.

- [ ] **Step 5: Add a safe future-block fallback and official renderer hook.**

Extend `ChatNodeViewProps` handling by feature detection only. If props expose a function such as `renderBlock`/`renderMessageBlock`, call it for non-bridge known blocks. If no official renderer is exposed, render a neutral non-JSON placeholder or omit the unknown block while preserving bridge images and text. Do not pass the live block to `JsonBlock` by default.

Keep `JsonBlock` only for an explicitly known legacy extra block shape if current rc6 contract tests prove that shape is product-owned and safe.

- [ ] **Step 6: Run all renderer tests and verify native/bridge behavior.**

Run: `pnpm exec vitest run tests/user-message-view.spec.ts`

Expected: all existing image, lightbox, bridge extraction, copy/time, and new reference/block tests PASS.

- [ ] **Step 7: Commit renderer compatibility changes.**

```bash
git add src/client/user-message-view.tsx tests/user-message-view.spec.ts
git commit -m "feat: make user message renderer reference-safe"
```

---

### Task 6: Add shared rc6/rc7/rc8 compatibility contracts

**Files:**
- Create: `tests/compat/shared/file-reference.contract.ts`
- Create: `tests/compat/shared/model-capability.contract.ts`
- Create: `tests/compat/shared/attachment.contract.ts`
- Create: `tests/compat/shared/renderer.contract.ts`
- Create: `tests/compat/rc6/contract.spec.ts`
- Create: `tests/compat/rc7/contract.spec.ts`
- Create: `tests/compat/rc8/contract.spec.ts`
- Modify: `vitest.config.ts` if include needs to cover `tests/compat/**/*.spec.ts`

**Interfaces:**
- Every version entry executes the same shared contract suite.
- Version labels are test metadata only and do not alter source behavior.
- Shared attachment contracts use a fake `ctx.attachments.readImage` public surface; no private path fixtures exist.

- [ ] **Step 1: Write the shared contract helpers and red entry-point tests.**

Use a registration function so each version file stays small:

```ts
export interface CompatFixture {
  label: 'rc6' | 'rc7' | 'rc8'
  llm: unknown
  attachmentReader: { readImage: (ref: unknown, signal?: AbortSignal) => Promise<{ data: Uint8Array; name?: string }> }
  rendererFeatures: { officialBlockRenderer: boolean; fileReference: boolean; sessionReference: boolean }
}

export function runFileReferenceContract(): void { /* describe/it assertions */ }
export function runModelCapabilityContract(): void { /* describe/it assertions */ }
export function runAttachmentContract(): void { /* public readImage assertions */ }
export function runRendererContract(): void { /* bridge/native/reference/unknown assertions */ }
```

Each `contract.spec.ts` must call the shared suite with a fixture object and assert the same invariant set.

- [ ] **Step 2: Run the contract entries and verify missing contract modules fail.**

Run: `pnpm exec vitest run tests/compat`

Expected: FAIL until the shared suite and fixtures are implemented.

- [ ] **Step 3: Implement the shared contracts.**

The file-reference contract must include all plain, `@file`, quoted-space, HOME, and session cases. The capability contract must include `resolveModelInfo`, `listModels`, explicit image/text, empty/unknown, and no-version-branch behavior. The attachment contract must assert that only `readImage` is called and that its result is passed to the existing format/size/pixel checks. The renderer contract must assert native, bridge, mixed, `@file`, `@session`, `/skill`, structured agent, ordinary `@xxx`, and unknown block behavior.

- [ ] **Step 4: Run the contracts and verify they pass under the current rc6 dependency baseline.**

Run: `pnpm exec vitest run tests/compat`

Expected: all shared contract suites PASS under the installed baseline.

- [ ] **Step 5: Commit the compatibility fixtures.**

```bash
git add tests/compat vitest.config.ts
git commit -m "test: add rc6 rc7 rc8 compatibility contracts"
```

---

### Task 7: Add compatibility matrix runner and documentation

**Files:**
- Create: `scripts/compat-matrix.mjs`
- Create: `docs/compatibility-matrix.md`
- Modify: `package.json`
- Modify: `docs/test-cases.md`
- Modify: `pnpm-lock.yaml` only if dependencies change

**Interfaces:**
- Produces `pnpm test:compat` as a reproducible matrix command.
- Uses isolated temporary directories and does not modify production source for a version.
- Fails loudly when a requested rc package or real DSH binary is unavailable; it must not report a false pass.

- [ ] **Step 1: Write a failing script smoke test or dry-run assertion.**

Add a script-level test under `tests/compat-matrix.spec.ts` that runs:

```ts
const result = execaSync('node', ['scripts/compat-matrix.mjs', '--dry-run'], { cwd: repoRoot })
expect(result.stdout).toContain('rc6')
expect(result.stdout).toContain('rc7')
expect(result.stdout).toContain('rc8')
```

The test must import `execaSync` from the existing `execa` dev dependency and define `repoRoot` with `fileURLToPath(new URL('../', import.meta.url))`.

- [ ] **Step 2: Run the smoke test and verify the script is missing.**

Run: `pnpm exec vitest run tests/compat-matrix.spec.ts`

Expected: FAIL because `scripts/compat-matrix.mjs` does not exist.

- [ ] **Step 3: Implement the matrix runner.**

The runner must:

1. Parse `--dry-run`, `--skip-install`, and an optional artifact directory.
2. Print the three requested labels.
3. In non-dry mode, create a temporary directory per label.
4. Run the repository build and the shared compatibility tests in each environment.
5. Record command, exit code, stdout/stderr summary, resolved package versions, and test counts.
6. Exit non-zero if install/build/test fails or a requested version is unavailable.
7. Never alter production code or peer minimums based on the label.

Use Node `child_process.spawnSync`/`spawn` and `fs/promises`; do not add a runtime dependency just for orchestration.

- [ ] **Step 4: Add the package script and run the smoke test.**

Add:

```json
"test:compat": "node scripts/compat-matrix.mjs"
```

Run: `pnpm exec vitest run tests/compat-matrix.spec.ts`

Expected: PASS, with rc6/rc7/rc8 labels present.

- [ ] **Step 5: Write the compatibility evidence template.**

`docs/compatibility-matrix.md` must include tables for:

- actual DSH/package versions;
- build/typecheck/test exit codes;
- text-only paste/drop bridge;
- text-only UI thumbnail/lightbox;
- native multimodal no-takeover/no-duplicate-upload;
- model switch migration;
- `@image`, quoted image, HOME, absolute/relative paths;
- `@src/App.vue` ordinary read path;
- `@session` non-file handling;
- `sha256:` public attachment read;
- renderer known/unknown block behavior;
- remaining future-rc risks and unavailable environments.

Do not mark scenarios PASS until fresh command or real GUI evidence is recorded.

- [ ] **Step 6: Update `docs/test-cases.md` with mappings.**

Preserve the existing R/E/A cases and add a section mapping the new automated contract files and manual rc6/rc7/rc8 flows to their evidence points. Explicitly retain the existing bridge storage, path security, model-switch, modlens, URL, and lightbox cases.

- [ ] **Step 7: Run matrix dry-run and documentation checks.**

Run:

```text
node scripts/compat-matrix.mjs --dry-run
pnpm exec vitest run tests/compat-matrix.spec.ts
```

Expected: both PASS and the documentation contains no unverified PASS claims.

- [ ] **Step 8: Commit matrix tooling and evidence docs.**

```bash
git add scripts/compat-matrix.mjs tests/compat-matrix.spec.ts package.json docs/compatibility-matrix.md docs/test-cases.md pnpm-lock.yaml
git commit -m "test: add DSH compatibility matrix runner"
```

---

### Task 8: Preserve peer compatibility and run the full verification suite

**Files:**
- Modify: `package.json` only if semver metadata needs correction.
- Modify: `pnpm-lock.yaml` only if lockfile resolution changes.
- Modify: `docs/compatibility-matrix.md` with fresh results.

**Interfaces:**
- Peer minimum remains `^0.1.0-rc.6` for DSH packages.
- No source version branch is introduced.
- Final evidence names the exact commands and their exit codes/counts.

- [ ] **Step 1: Add a red check that peer ranges do not require rc8.**

Add a package metadata assertion to `tests/compat-matrix.spec.ts`:

```ts
it('keeps rc6 as the peer compatibility floor', () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { peerDependencies?: Record<string, string> }
  expect(Object.values(pkg.peerDependencies ?? {}).filter(value => value.includes('dsh-')).every(value => value.includes('rc.6'))).toBe(true)
})
```

- [ ] **Step 2: Run the metadata test and correct any range regression.**

Run: `pnpm exec vitest run tests/compat-matrix.spec.ts -t 'peer compatibility floor'`

Expected: PASS with existing rc6-floor metadata; if it fails, restore the affected DSH peer range to `^0.1.0-rc.6` and update the lockfile only as needed.

- [ ] **Step 3: Run the complete repository verification.**

Run:

```text
pnpm build
pnpm test
pnpm verify:portable
pnpm test:compat
```

Expected:

- `pnpm build`: exit 0; host/client TypeScript and bundle generated.
- `pnpm test`: exit 0; zero failed tests.
- `pnpm verify:portable`: exit 0; package metadata, links, artifacts, and bundle checks pass.
- `pnpm test:compat`: exit 0 for every environment actually available; unavailable rc environments must be reported as unavailable, never silently passed.

- [ ] **Step 4: Run the real DSH profile acceptance tests for each available version.**

For each available rc6/rc7/rc8 environment, run the clean-profile/plugin-install acceptance flow and record:

```text
paste/drop with text-only model -> bridge file -> thumbnail/lightbox -> vision_cloud_tool
multimodal paste -> native image -> no bridge/takeover
multimodal draft -> switch text-only -> bridge migration before send
sha256 attachment -> public readImage path
@image.png and @"error screenshot.png" -> visual route for text-only
@src/App.vue -> ordinary Harness read route
@session -> not filesystem path
```

Use the actual GUI/profile commands available in the environment and record URLs, profile names, package versions, and evidence paths in `docs/compatibility-matrix.md`.

- [ ] **Step 5: Search production code for forbidden version/path patterns.**

Run:

```text
pnpm exec vitest run tests/compat
```

Then search only production TypeScript files with the repository grep tool for `rc6|rc7|rc8|dshVersion|attachments/v1/objects` under `src/`. The search must return no matches. Test fixtures and documentation may mention version labels and must be reported separately.

- [ ] **Step 6: Run final formatting and status checks.**

Run:

```text
git diff --check
git status --short --branch
git log --oneline -8
```

Expected: no whitespace errors; all intended files tracked; commit history contains the design, adapters, routing, renderer, contracts, and matrix changes.

- [ ] **Step 7: Update final evidence and commit the verified release state.**

```bash
git add package.json pnpm-lock.yaml docs/compatibility-matrix.md
git commit -m "chore: record DSH rc compatibility verification"
```

Do not state that a version or scenario passes unless its fresh command or real-runtime evidence is in the matrix document.

---

## Final implementation checklist

- [ ] `normalizeDshFileReference()` passes plain, `@file`, quoted, HOME, absolute, relative, and session tests.
- [ ] Runtime rejects session/plain references before filesystem access and preserves existing path security.
- [ ] `resolveModelCapability()` prefers `resolveModelInfo`, falls back to exact `listModels`, and returns conservative unknown.
- [ ] Paste/drop native takeover occurs only for explicit image capability; unknown remains bridge-safe.
- [ ] Settings uses public capability detection and never enables an unknown/non-image model.
- [ ] Prompt context includes `@image` but excludes text files, sessions, and arbitrary `@xxx`.
- [ ] Tool/system descriptions distinguish native vision from text-only fallback.
- [ ] Public `ctx.attachments.readImage` remains the only attachment byte source.
- [ ] Shadow renderer keeps native/bridge/mixed image UI, retry, and lightbox.
- [ ] `@file`, `@session`, and unclassified `@xxx` do not become agent chips.
- [ ] Unknown future blocks do not default to final `JsonBlock` output.
- [ ] rc6/rc7/rc8 shared contracts run without production version branches.
- [ ] Peer ranges retain rc6 floor.
- [ ] Build, unit tests, portable verification, compatibility runner, and available real profiles have fresh evidence.
- [ ] Future rc risks and unavailable environments are explicitly documented.
