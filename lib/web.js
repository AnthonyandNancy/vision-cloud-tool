/**
 * Optional Web-profile routes: the minimal Settings endpoint (model list, save,
 * test read) plus the paste-images route. No secrets, no health/credential
 * surface — the DSH app owns the model's endpoint and key.
 * @module dsh-vision-cloud/web
 */
import { PASTE_IMAGES_ROUTE } from "./paste-images.js";
import { resolveConfig, VISION_TOOLKIT_SETTINGS_NAMESPACE, } from "./config.js";
import { PLUGIN_VERSION } from "./version.js";
import { sameOriginPost } from "./web-request.js";
/** Exact route used by the browser Settings page. */
export const SETTINGS_ROUTE = '/_dsh/vision-cloud/settings';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function descriptorOf(ctx) {
    const descriptor = ctx.settings.describe().find(row => row.ns === VISION_TOOLKIT_SETTINGS_NAMESPACE);
    if (descriptor === undefined)
        throw new Error('vision-cloud Settings namespace is not registered');
    return descriptor;
}
function responseJson(res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.writeHead(status);
    res.end(bytes);
}
function requestError(res, status, code, message) {
    responseJson(res, status, { ok: false, error: { code, message } });
}
async function readJson(req, maxBytes = 64 * 1024) {
    const contentType = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json')
        throw new TypeError('Content-Type must be application/json');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
        const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += part.length;
        if (bytes > maxBytes)
            throw new RangeError(`request body exceeds ${maxBytes} bytes`);
        chunks.push(part);
    }
    if (chunks.length === 0)
        throw new TypeError('request body is empty');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function parseRequest(value) {
    if (!isRecord(value) || typeof value.action !== 'string')
        throw new TypeError('request action is required');
    if (value.action === 'testRead')
        return { action: 'testRead' };
    if (value.action === 'save') {
        if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) {
            throw new TypeError('save.expectedRevision must be a non-negative integer');
        }
        if (!isRecord(value.value))
            throw new TypeError('save.value must be an object');
        return {
            action: 'save',
            expectedRevision: value.expectedRevision,
            value: value.value,
        };
    }
    throw new TypeError(`unsupported action: ${value.action}`);
}
function publicMessage(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
/** Same-origin Settings handler. */
export class VisionToolkitWebBackend {
    ctx;
    runtimeSource;
    constructor(ctx, runtimeSource) {
        this.ctx = ctx;
        this.runtimeSource = runtimeSource;
    }
    async providers() {
        const out = [];
        for (const info of this.ctx.llm.listProviders()) {
            let models = [];
            try {
                const listed = await this.ctx.llm.listModels(info.id);
                models = await Promise.all(listed.map(async (model) => {
                    let reasoningEfforts = [];
                    try {
                        const resolved = await this.ctx.llm.resolveModelInfo(info.id, model.id);
                        reasoningEfforts = (resolved.reasoning?.efforts ?? []).map(effort => String(effort.id));
                    }
                    catch {
                        reasoningEfforts = [];
                    }
                    return {
                        id: model.id,
                        name: model.name,
                        inputModalities: [...(model.inputModalities ?? [])],
                        reasoningEfforts,
                    };
                }));
            }
            catch {
                models = [];
            }
            out.push({ provider: info.id, name: info.name, models });
        }
        return out;
    }
    /** Build the current settings/model snapshot without secrets. */
    async snapshot() {
        const descriptor = descriptorOf(this.ctx);
        const value = descriptor.value;
        return {
            schemaVersion: 1,
            writable: this.ctx.settings.writable,
            pluginVersion: PLUGIN_VERSION,
            enabled: resolveConfig(value).model !== undefined,
            pasteToPath: resolveConfig(value).pasteToPath,
            settings: {
                value,
                revision: descriptor.revision,
                applies: 'live',
            },
            providers: await this.providers(),
        };
    }
    async save(request) {
        if (!this.ctx.settings.writable)
            throw new Error('settings provider is read-only');
        await this.ctx.settings.replace(VISION_TOOLKIT_SETTINGS_NAMESPACE, request.value, request.expectedRevision);
        return this.snapshot();
    }
    async testRead() {
        const runtime = this.runtimeSource();
        if (runtime === undefined)
            throw new Error('no vision model selected; save a model first');
        const controller = new AbortController();
        await runtime.selfTest({
            signal: controller.signal,
            workspace: process.cwd(),
            sessionId: 'vision-cloud-settings',
        });
        return this.snapshot();
    }
    /** Handle the exact Settings route. */
    async handle(req, res) {
        if (req.method === 'GET') {
            try {
                responseJson(res, 200, { ok: true, value: await this.snapshot() });
            }
            catch (error) {
                this.ctx.logger.warn('dsh-vision-cloud Settings snapshot failed: %s', publicMessage(error));
                requestError(res, 503, 'settings-unavailable', 'Vision Cloud Settings are unavailable');
            }
            return;
        }
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'GET, POST');
            requestError(res, 405, 'method-not-allowed', 'Use GET or POST');
            return;
        }
        if (!sameOriginPost(req)) {
            requestError(res, 403, 'origin-rejected', 'The request must originate from this DSH Web application');
            return;
        }
        let parsed;
        try {
            parsed = parseRequest(await readJson(req));
        }
        catch (error) {
            requestError(res, error instanceof RangeError ? 413 : 400, 'invalid-request', publicMessage(error));
            return;
        }
        try {
            if (parsed.action === 'testRead') {
                responseJson(res, 200, { ok: true, value: await this.testRead() });
            }
            else {
                responseJson(res, 200, { ok: true, value: await this.save(parsed) });
            }
        }
        catch (error) {
            this.ctx.logger.warn('dsh-vision-cloud Web action=%s failed: %s', parsed.action, publicMessage(error));
            requestError(res, 400, 'settings-rejected', publicMessage(error));
        }
    }
}
/**
 * Attach optional Web routes whenever a webServer service is present.
 * @param ctx - plugin context owning route effects.
 * @param backend - Settings handler.
 * @param pastedImages - paste-image upload handler.
 */
export function installVisionToolkitWeb(ctx, backend, pastedImages) {
    ctx.inject(['webServer'], (webCtx) => {
        webCtx.effect(() => {
            const disposeSettings = webCtx.webServer.register({
                kind: 'exact',
                path: SETTINGS_ROUTE,
                handler: (req, res) => backend.handle(req, res),
            });
            const disposePasteImages = webCtx.webServer.register({
                kind: 'exact',
                path: PASTE_IMAGES_ROUTE,
                handler: (req, res) => pastedImages.handle(req, res),
            });
            return () => {
                disposePasteImages();
                disposeSettings();
            };
        }, 'dsh-vision-cloud: Web routes');
    });
}
//# sourceMappingURL=web.js.map