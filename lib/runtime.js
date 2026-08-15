/**
 * Online vision runtime: structured requests in, modlens v2 structured results
 * out. Resolves image bytes from a workspace path, an http(s) URL, or a pasted
 * image attachment; enforces byte/pixel limits through a pure-JS header parser;
 * stores/reads images via the DSH attachment service; and reads them with the
 * DSH app's configured model through `ctx.llm.stream`.
 * @module dsh-vision-cloud/runtime
 */
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import { VisionToolkitError } from "./errors.js";
import { readImageHeader, sniffFormat } from "./image-header.js";
import { createPathPolicy, resolveInputFile, SUPPORTED_IMAGE_EXTENSIONS } from "./paths.js";
import { missingSchemaFields } from "./vision-schema.js";
import { buildVisionPrompt } from "./vision-prompt.js";
const FORMAT_MEDIA_TYPE = {
    png: 'image/png',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
};
const SUPPORTED_IMAGE_MEDIA_TYPES = new Set(Object.values(FORMAT_MEDIA_TYPE));
const SUPPORTED_IMAGE_MEDIA_TYPE_ALIASES = new Set(['image/jpg', 'image/pjpeg', 'image/x-png']);
const SUPPORTED_IMAGE_EXTENSION_SET = new Set(SUPPORTED_IMAGE_EXTENSIONS);
const OPAQUE_BINARY_MEDIA_TYPES = new Set(['application/octet-stream', 'binary/octet-stream']);
const FORMAT_NAME = {
    png: 'png',
    jpeg: 'jpeg',
    gif: 'gif',
    webp: 'webp',
};
const MAX_TIMEOUT_MS = 600_000;
const MAX_ATTEMPTS = 2;
const MAX_URL_BYTES = 25 * 1024 * 1024;
/** A tiny 4x4 RGB PNG used by the Settings self-test read (sharp-decodable). */
const SELF_TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVQImWOoCDgBRwzEcQCFUhkBi7FWdgAAAABJRU5ErkJggg==', 'base64');
/** Combine a caller abort signal with one hard operation timeout. */
export function createDeadline(signal, timeoutMs) {
    const controller = new AbortController();
    const state = { timedOut: false, cancelled: false };
    const onCallerAbort = () => {
        if (controller.signal.aborted)
            return;
        state.cancelled = true;
        controller.abort();
    };
    if (signal.aborted) {
        state.cancelled = true;
        controller.abort();
    }
    else {
        signal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const timer = setTimeout(() => {
        if (controller.signal.aborted)
            return;
        state.timedOut = true;
        controller.abort();
    }, timeoutMs);
    return {
        signal: controller.signal,
        get timedOut() { return state.timedOut; },
        get cancelled() { return state.cancelled; },
        cleanup() {
            clearTimeout(timer);
            signal.removeEventListener('abort', onCallerAbort);
        },
    };
}
/** FIFO bounded concurrency gate whose queued callers remain cancellable. */
export class Semaphore {
    limit;
    active = 0;
    waiters = [];
    constructor(limit) {
        this.limit = limit;
    }
    get idle() {
        return this.active === 0 && this.waiters.length === 0;
    }
    async acquire(signal) {
        if (signal.aborted)
            throw new VisionToolkitError('cancelled', 'vision-cloud: cancelled before execution');
        if (this.waiters.length === 0 && this.active < this.limit) {
            this.active += 1;
            return;
        }
        return new Promise((resolveAcquire, reject) => {
            const entry = {
                resolve: resolveAcquire,
                reject,
                signal,
                onAbort: () => { },
            };
            entry.onAbort = () => {
                const index = this.waiters.indexOf(entry);
                if (index >= 0)
                    this.waiters.splice(index, 1);
                reject(new VisionToolkitError('cancelled', 'vision-cloud: cancelled while waiting for a concurrency slot'));
            };
            this.waiters.push(entry);
            signal.addEventListener('abort', entry.onAbort, { once: true });
        });
    }
    release() {
        this.active = Math.max(0, this.active - 1);
        const next = this.waiters.shift();
        if (next !== undefined) {
            next.signal.removeEventListener('abort', next.onAbort);
            this.active += 1;
            next.resolve();
        }
    }
}
/** Parse a `Content-Type` header down to its lowercase essence, if any. */
function mediaTypeOf(response) {
    const header = response.headers.get('content-type');
    if (header === null)
        return undefined;
    const semicolon = header.indexOf(';');
    const mediaType = (semicolon >= 0 ? header.slice(0, semicolon) : header).trim().toLowerCase();
    return mediaType === '' ? undefined : mediaType;
}
/**
 * Reject non-image URL shapes before any network I/O. By default the URL
 * pathname must end in a supported image extension so arbitrary links (bare
 * domains, API paths, HTML pages) are never fetched. Set
 * `allowExtensionlessImageUrls` only for signed/dynamic CDN image endpoints;
 * even then Content-Type and magic-bytes checks below still apply.
 */
function assertImageUrlShape(url, allowExtensionlessImageUrls) {
    let pathname;
    try {
        pathname = new URL(url).pathname;
    }
    catch {
        if (allowExtensionlessImageUrls)
            return;
        throw new VisionToolkitError('input', `invalid image URL: ${url}`);
    }
    const extension = extname(pathname).toLowerCase();
    if (SUPPORTED_IMAGE_EXTENSION_SET.has(extension))
        return;
    if (allowExtensionlessImageUrls)
        return;
    const reason = extension === '' ? 'has no image file extension' : `ends with "${extension}"`;
    throw new VisionToolkitError('input', `image URL ${reason}; vision_cloud_tool only fetches direct image URLs ending in ${[...SUPPORTED_IMAGE_EXTENSION_SET].join(', ')}. `
        + 'Pass a downloaded workspace image file instead, or set allowExtensionlessImageUrls: true in the vision-cloud Settings for CDN endpoints without extensions. '
        + `Offending URL: ${url}`);
}
/**
 * Verify that a fetched response actually describes image bytes before its
 * body is downloaded. Opaque binary types (some CDNs and signed URLs) are
 * allowed through and must still pass the magic-bytes sniff in `readBytes`.
 */
function assertImageResponse(response, url) {
    if (!response.ok) {
        throw new VisionToolkitError('service', `image URL returned HTTP ${response.status}${response.statusText === '' ? '' : ` ${response.statusText}`}: ${url}`);
    }
    const mediaType = mediaTypeOf(response);
    if (mediaType === undefined || mediaType === '' || OPAQUE_BINARY_MEDIA_TYPES.has(mediaType))
        return;
    if (SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType) || SUPPORTED_IMAGE_MEDIA_TYPE_ALIASES.has(mediaType))
        return;
    const unsupportedImage = mediaType.startsWith('image/');
    throw new VisionToolkitError('input', unsupportedImage
        ? `unsupported image media type "${mediaType}"; supported: ${[...SUPPORTED_IMAGE_MEDIA_TYPES].join(', ')}: ${url}`
        : `URL does not point to a supported image (content-type: ${mediaType}); vision_cloud_tool only reads PNG/JPEG/GIF/WebP images, not video/audio or other media: ${url}`);
}
/**
 * Download a response body while enforcing MAX_URL_BYTES as chunks arrive, so
 * a large video or other stream cannot be buffered past the limit even when
 * the server omits Content-Length.
 */
async function readResponseBytes(response) {
    const stream = response.body;
    if (stream === null)
        return new Uint8Array(await response.arrayBuffer());
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        const bytes = chunk;
        total += bytes.byteLength;
        if (total > MAX_URL_BYTES) {
            await stream.cancel().catch(() => { });
            throw new VisionToolkitError('capacity', `image URL exceeds the ${MAX_URL_BYTES}-byte limit`);
        }
        chunks.push(bytes);
    }
    return new Uint8Array(Buffer.concat(chunks, total));
}
async function fetchUrlBytes(url, signal, allowExtensionlessImageUrls) {
    assertImageUrlShape(url, allowExtensionlessImageUrls);
    const controller = new AbortController();
    const onAbort = () => { controller.abort(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        let response;
        try {
            response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
        }
        catch (error) {
            if (signal.aborted)
                throw error;
            throw new VisionToolkitError('service', `failed to fetch image URL: ${url}`, { cause: error });
        }
        assertImageResponse(response, url);
        const length = Number(response.headers.get('content-length') ?? 0);
        if (Number.isFinite(length) && length > 0 && length > MAX_URL_BYTES) {
            throw new VisionToolkitError('capacity', `image URL exceeds the ${MAX_URL_BYTES}-byte limit`);
        }
        const buffer = Buffer.from(await readResponseBytes(response));
        if (buffer.length > MAX_URL_BYTES) {
            throw new VisionToolkitError('capacity', `image URL exceeds the ${MAX_URL_BYTES}-byte limit`);
        }
        let name = 'image';
        try {
            const pathname = new URL(url).pathname;
            const leaf = basename(pathname);
            if (leaf.length > 0 && leaf !== '/')
                name = leaf;
        }
        catch {
            name = 'image';
        }
        return { data: new Uint8Array(buffer), source: url, name };
    }
    finally {
        signal.removeEventListener('abort', onAbort);
    }
}
async function resolveImageBytes(raw, policy, signal, allowExtensionlessImageUrls) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        if (!/^https?:\/\//i.test(raw)) {
            throw new VisionToolkitError('input', `only http(s) image URLs are supported: ${raw}`);
        }
        return fetchUrlBytes(raw, signal, allowExtensionlessImageUrls);
    }
    const resolved = await resolveInputFile(raw, policy);
    const data = await readFile(resolved.path);
    return { data: new Uint8Array(data), source: resolved.path, name: basename(resolved.path) };
}
function normalizeAttachmentId(value) {
    return value.replace(/^sha256:/u, '').trim();
}
/** Find a pasted image attachment's full reference in the session history. */
function findImageRef(session, attachmentId) {
    if (session === undefined || !Array.isArray(session.events))
        return undefined;
    const wanted = normalizeAttachmentId(attachmentId);
    for (const event of session.events) {
        if (typeof event !== 'object' || event === null)
            continue;
        const content = event.data?.content;
        if (!Array.isArray(content))
            continue;
        for (const block of content) {
            if (typeof block !== 'object' || block === null)
                continue;
            const candidate = block;
            if (candidate.type !== 'image' || candidate.attachment === undefined)
                continue;
            if (normalizeAttachmentId(String(candidate.attachment.attachmentId)) === wanted) {
                return candidate.attachment;
            }
        }
    }
    return undefined;
}
function parseVisionJson(text) {
    const trimmed = text.trim();
    try {
        return JSON.parse(trimmed);
    }
    catch {
        // Fall through to fence stripping.
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try {
            return JSON.parse(trimmed.slice(start, end + 1));
        }
        catch {
            // Fall through to the failure below.
        }
    }
    throw new VisionToolkitError('output', 'vision model did not return a single JSON object');
}
const MAX_FAILURE_MESSAGE_LENGTH = 400;
function summarizeFailureMessage(raw) {
    const normalized = raw.replace(/\s+/gu, ' ').trim();
    return normalized.length <= MAX_FAILURE_MESSAGE_LENGTH
        ? normalized
        : `${normalized.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}…`;
}
function collectText(stream) {
    return (async () => {
        let text = '';
        for await (const chunk of stream) {
            if (chunk.type === 'text-delta') {
                text += chunk.text;
            }
            else if (chunk.type === 'finish') {
                if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') {
                    const { failure } = chunk.reason;
                    const status = failure.status === undefined ? '' : ` (HTTP ${failure.status})`;
                    throw new VisionToolkitError('service', `vision model request failed${status} [${failure.code}]: ${summarizeFailureMessage(failure.message)}`);
                }
            }
        }
        return text;
    })();
}
/** Runtime facade used by the `vision_cloud_tool` and the Settings self-test. */
export class VisionToolkitRuntime {
    ctx;
    config;
    semaphores = new Map();
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
    }
    /** The selected app model, when the tool is enabled. */
    get model() {
        return this.config.model;
    }
    timeout(options) {
        const value = options.timeoutMs ?? this.config.timeoutMs;
        if (!Number.isInteger(value) || value < 1000 || value > MAX_TIMEOUT_MS) {
            throw new VisionToolkitError('input', `timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}`);
        }
        return value;
    }
    semaphore(options) {
        const key = options.sessionId ?? `workspace:${options.workspace}`;
        const value = this.semaphores.get(key) ?? new Semaphore(this.config.concurrency);
        this.semaphores.set(key, value);
        return { key, value };
    }
    async run(options, action) {
        const deadline = createDeadline(options.signal, this.timeout(options));
        const gate = this.semaphore(options);
        try {
            await gate.value.acquire(deadline.signal);
        }
        catch (error) {
            deadline.cleanup();
            throw error;
        }
        try {
            const value = await action(deadline.signal);
            if (deadline.signal.aborted) {
                if (deadline.cancelled)
                    throw new VisionToolkitError('cancelled', 'vision_cloud_tool: cancelled');
                throw new VisionToolkitError('timeout', 'vision_cloud_tool: timed out');
            }
            return value;
        }
        finally {
            gate.value.release();
            deadline.cleanup();
            if (gate.value.idle)
                this.semaphores.delete(gate.key);
        }
    }
    async resolveAttachmentBytes(session, raw, signal) {
        const ref = findImageRef(session, raw);
        if (ref === undefined) {
            throw new VisionToolkitError('input', `image attachment not found in the session: ${raw}`);
        }
        const stored = await this.ctx.attachments.readImage(ref, signal);
        return {
            data: stored.data,
            source: `attachment:${String(ref.attachmentId)}`,
            name: ref.name ?? 'attachment',
        };
    }
    async readBytes(sources, prompt, signal, warnings) {
        const model = this.config.model;
        if (model === undefined) {
            throw new VisionToolkitError('config', 'vision_cloud_tool is not enabled; select a vision model in Settings');
        }
        const images = [];
        const content = [];
        for (const source of sources) {
            const bytes = source.data;
            if (bytes.length > this.config.maxImageBytes) {
                throw new VisionToolkitError('capacity', `image is ${bytes.length} bytes, exceeding maxImageBytes ${this.config.maxImageBytes}`);
            }
            const format = sniffFormat(bytes);
            if (format === undefined) {
                throw new VisionToolkitError('input', `image content is not a supported format: ${source.source}`);
            }
            const header = readImageHeader(bytes);
            const pixels = header.width * header.height;
            if (!Number.isSafeInteger(pixels) || pixels > this.config.maxImagePixels) {
                throw new VisionToolkitError('capacity', `image is ${header.width}x${header.height} (${pixels} pixels), exceeding maxImagePixels ${this.config.maxImagePixels}`);
            }
            const mediaType = FORMAT_MEDIA_TYPE[format];
            const attachment = await this.ctx.attachments.saveImage({
                data: bytes,
                mediaType,
                name: source.name,
            });
            content.push({ type: 'image', attachment });
            images.push({
                path: source.source,
                bytes: bytes.length,
                width: header.width,
                height: header.height,
                format: FORMAT_NAME[format],
            });
        }
        const result = await this.streamRead(content, prompt, signal, warnings);
        return { images, result };
    }
    async streamRead(content, prompt, signal, warnings) {
        const model = this.config.model;
        if (model === undefined) {
            throw new VisionToolkitError('config', 'vision_cloud_tool is not enabled; select a vision model in Settings');
        }
        const messages = [createUserMessage({
                source: { kind: 'plugin', plugin: 'dsh-vision-cloud' },
                content: [
                    ...content,
                    { type: 'text', text: buildVisionPrompt({
                            language: this.config.language,
                            ...(prompt === undefined ? {} : { extraPrompt: prompt }),
                        }) },
                ],
            })];
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const text = await collectText(this.ctx.llm.stream({
                provider: model.provider,
                model: model.model,
                messages,
                signal,
                ...(model.reasoningEffort === undefined ? {} : { reasoningEffort: ReasoningEffortId(model.reasoningEffort) }),
            }));
            const parsed = parseVisionJson(text);
            const missing = missingSchemaFields(parsed);
            if (missing.length === 0)
                return parsed;
            if (attempt < MAX_ATTEMPTS) {
                warnings.push(`retried after the model returned a result missing: ${missing.join(', ')}`);
            }
            else {
                throw new VisionToolkitError('output', `vision model result does not match the schema: missing ${missing.join(', ')}`);
            }
        }
        throw new VisionToolkitError('output', 'vision model did not return a schema-valid result');
    }
    /** Read one or more images (paths/URLs/attachments) through the app model. */
    async read(request, prompt, options) {
        return this.run(options, async (signal) => {
            const images = request.images ?? [];
            const attachments = request.attachments ?? [];
            const total = images.length + attachments.length;
            if (total === 0)
                throw new VisionToolkitError('input', 'vision_cloud_tool requires at least one image or attachment');
            if (total > this.config.maxImages) {
                throw new VisionToolkitError('input', `vision_cloud_tool accepts at most ${this.config.maxImages} images`);
            }
            const policy = await createPathPolicy(options.workspace, this.config.allowedDirs);
            const started = Date.now();
            const warnings = [];
            const pathSources = await Promise.all(images.map(raw => resolveImageBytes(raw, policy, signal, this.config.allowExtensionlessImageUrls)));
            const attachmentSources = await Promise.all(attachments.map(raw => this.resolveAttachmentBytes(options.session, raw, signal)));
            const sources = [...pathSources, ...attachmentSources];
            const { images: resolved, result } = await this.readBytes(sources, prompt, signal, warnings);
            this.ctx.logger.info('dsh-vision-cloud tool=%s outcome=ok totalMs=%d images=%d model=%s', 'vision_cloud_tool', Date.now() - started, resolved.length, this.config.model?.model ?? 'unknown');
            return {
                images: resolved,
                result,
                meta: {
                    model: this.config.model?.model ?? 'unknown',
                    durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
                    attempts: warnings.length > 0 ? MAX_ATTEMPTS : 1,
                    warnings,
                },
            };
        });
    }
    /** One tiny real read used by the Settings "test read" action. */
    async selfTest(options) {
        return this.run(options, async (signal) => {
            const warnings = [];
            const sources = [{
                    data: new Uint8Array(SELF_TEST_PNG),
                    source: 'settings-self-test.png',
                    name: 'self-test.png',
                }];
            const { images, result } = await this.readBytes(sources, undefined, signal, warnings);
            return {
                images,
                result,
                meta: {
                    model: this.config.model?.model ?? 'unknown',
                    durationSeconds: 0,
                    attempts: warnings.length > 0 ? MAX_ATTEMPTS : 1,
                    warnings,
                },
            };
        });
    }
}
//# sourceMappingURL=runtime.js.map