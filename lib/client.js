window.__ModuleLoader__.load({ id: "dsh-vision-cloud", factory: (require) => {
var __modules = Object.create(null); var __cache = Object.create(null);
__modules["./index.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.VisionSettingsController = void 0;
exports.apply = apply;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * DSH Vision Tools browser plugin: a minimal Settings section (pick an app
 * model + test read) plus the paste/drop-to-path image bridge. No tool cards,
 * no artifact previews, no credentials.
 */
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
const paste_images_tsx_1 = __load_("./paste-images.js");
const NS = 'vision-cloud';
const SETTINGS_ROUTE = '/_dsh/vision-cloud/settings';
const en = {
    nav: 'Vision Tools',
    settingsTitle: 'Vision Tools',
    settingsIntro: 'Pick a model configured in DSH so vision_cloud_tool can read images through it.',
    model: 'Vision model',
    modelHint: 'Leave "Off" to keep vision_cloud_tool unregistered. Selecting a model registers the tool immediately.',
    off: 'Off (disabled)',
    provider: 'Provider',
    modelName: 'Model',
    testRead: 'Test read',
    testing: 'Testing…',
    save: 'Save and apply',
    saving: 'Saving…',
    reload: 'Reload',
    saved: 'Settings saved.',
    readOnly: 'Settings are read-only.',
    advanced: 'Advanced',
    advancedHint: 'Output language and resource limits.',
    language: 'Output language',
    timeout: 'Request timeout (ms)',
    maxBytes: 'Maximum image bytes',
    maxPixels: 'Maximum image pixels',
    concurrency: 'Concurrent calls per session',
    maxImages: 'Maximum images per call',
    allowedDirs: 'Additional allowed directories',
    allowedDirsHint: 'One path per line. The session workspace is always allowed.',
    pluginVersion: 'Plugin',
    positiveInteger: '{field} must be a positive integer.',
    testOk: 'Test read succeeded.',
    testFailed: 'Test read failed',
    noModel: 'Select a vision model and save before testing.',
    pasteToPath: 'Paste/drop-to-path bridge',
    pasteToPathHint: 'Convert pasted or dropped images into workspace paths for text-only models. Leave off to keep image input native.',
    reasoningEffort: 'Thinking effort',
    reasoningDefault: 'Default (model default)',
    imageCapableOnlyHint: 'Only models that accept image input are listed here.',
    modelUnsupportedLabel: 'no image input',
};
const zh = {
    nav: '视觉工具',
    settingsTitle: '视觉工具',
    settingsIntro: '选择一个 DSH 应用内已配置的模型，让 vision_cloud_tool 通过它读取图片。',
    model: '视觉模型',
    modelHint: '保持“不开启”则不会注册 vision_cloud_tool；选择模型后立即生效。',
    off: '不开启（默认）',
    provider: '服务商',
    modelName: '模型',
    testRead: '测试读取',
    testing: '测试中…',
    save: '保存设置',
    saving: '保存中…',
    reload: '重新加载',
    saved: '设置已保存。',
    readOnly: '设置为只读，无法修改。',
    advanced: '高级设置',
    advancedHint: '结果语言与资源限制。',
    language: '结果语言',
    timeout: '单次请求超时（毫秒）',
    maxBytes: '单张图片大小上限（字节）',
    maxPixels: '单张图片最大像素数',
    concurrency: '单个会话最大并发数',
    maxImages: '单次调用最多图片数',
    allowedDirs: '允许读取的其他目录',
    allowedDirsHint: '每行一个目录；会话工作目录始终可用。',
    pluginVersion: '插件版本',
    positiveInteger: '{field}必须为正整数。',
    testOk: '测试读取成功。',
    testFailed: '测试读取失败',
    noModel: '请先选择视觉模型并保存，再测试读取。',
    pasteToPath: '粘贴/拖拽路径桥',
    pasteToPathHint: '把粘贴或拖拽的图片转换为工作区路径（供纯文本模型使用）。关闭则图片输入保持原生附件。',
    reasoningEffort: '思考程度',
    reasoningDefault: '默认（模型默认）',
    imageCapableOnlyHint: '此处仅列出支持图片输入的模型。',
    modelUnsupportedLabel: '不支持图片',
};
async function apiRequest(init) {
    const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin', ...init });
    const body = await response.json();
    if (!response.ok || !body.ok) {
        const failure = body;
        throw new Error(failure.error?.message ?? `Vision Tools request failed with HTTP ${response.status}`);
    }
    return body.value;
}
/** Small external store shared by the Settings route and pushed invalidations. */
class VisionSettingsController {
    state = { status: 'idle' };
    listeners = new Set();
    generation = 0;
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    snapshot = () => this.state;
    set(next) {
        this.state = next;
        for (const listener of this.listeners)
            listener();
    }
    async load() {
        const generation = ++this.generation;
        this.set({ ...this.state, status: 'loading', error: undefined, message: undefined });
        try {
            const snapshot = await apiRequest();
            if (generation !== this.generation)
                return;
            this.set({ status: 'ready', snapshot });
        }
        catch (error) {
            if (generation !== this.generation)
                return;
            this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) });
        }
    }
    refreshIfLoaded() {
        if (this.state.status === 'idle' || this.state.action === 'save')
            return;
        void this.load();
    }
    async save(value, expectedRevision) {
        this.set({ ...this.state, action: 'save', error: undefined, message: undefined });
        try {
            const snapshot = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'save', expectedRevision, value }),
            });
            this.set({ status: 'ready', snapshot, message: 'saved' });
            return true;
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
            return false;
        }
    }
    async testRead() {
        this.set({ ...this.state, action: 'test', error: undefined, message: undefined });
        try {
            const snapshot = await apiRequest({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'testRead' }),
            });
            this.set({ ...this.state, action: undefined, snapshot, message: 'testOk' });
        }
        catch (error) {
            this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) });
        }
    }
}
exports.VisionSettingsController = VisionSettingsController;
function draftOf(value) {
    return {
        provider: value.model?.provider ?? '',
        model: value.model?.model ?? '',
        reasoningEffort: value.model?.reasoningEffort ?? '',
        language: value.language ?? 'zh',
        timeoutMs: String(value.timeoutMs ?? 180000),
        maxImageBytes: String(value.maxImageBytes ?? 10485760),
        maxImagePixels: String(value.maxImagePixels ?? 40000000),
        concurrency: String(value.concurrency ?? 4),
        maxImages: String(value.maxImages ?? 8),
        allowedDirs: (value.allowedDirs ?? []).join('\n'),
        pasteToPath: value.pasteToPath ?? true,
    };
}
function positiveInteger(raw, label, t) {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(t('positiveInteger', { field: label }));
    return value;
}
function valueOf(draft, t) {
    const value = {
        language: draft.language,
        timeoutMs: positiveInteger(draft.timeoutMs, t('timeout'), t),
        maxImageBytes: positiveInteger(draft.maxImageBytes, t('maxBytes'), t),
        maxImagePixels: positiveInteger(draft.maxImagePixels, t('maxPixels'), t),
        concurrency: positiveInteger(draft.concurrency, t('concurrency'), t),
        maxImages: positiveInteger(draft.maxImages, t('maxImages'), t),
        allowedDirs: draft.allowedDirs.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean),
        pasteToPath: draft.pasteToPath,
    };
    if (draft.provider !== '' && draft.model !== '') {
        value.model = {
            provider: draft.provider,
            model: draft.model,
            ...(draft.reasoningEffort.trim() === '' ? {} : { reasoningEffort: draft.reasoningEffort.trim() }),
        };
    }
    return value;
}
function Field({ label, children, hint }) {
    return (0, jsx_runtime_1.jsxs)("label", { className: "dvt-field", children: [(0, jsx_runtime_1.jsx)("span", { children: label }), children, hint === undefined ? null : (0, jsx_runtime_1.jsx)("small", { children: hint })] });
}
/** Encode a provider+model pair into one selectable option value. */
function modelKey(provider, model) {
    return JSON.stringify({ provider, model });
}
function SettingsSection({ controller, t }) {
    if (controller === undefined || t === undefined)
        return null;
    return (0, jsx_runtime_1.jsx)(LoadedSettings, { controller: controller, t: t });
}
function LoadedSettings({ controller, t }) {
    const state = (0, react_1.useSyncExternalStore)(controller.subscribe, controller.snapshot, controller.snapshot);
    const snapshot = state.snapshot;
    const [draft, setDraft] = (0, react_1.useState)(undefined);
    const [draftError, setDraftError] = (0, react_1.useState)(undefined);
    (0, react_1.useEffect)(() => { if (state.status === 'idle')
        void controller.load(); }, [controller, state.status]);
    (0, react_1.useEffect)(() => {
        if (snapshot !== undefined)
            setDraft(draftOf(snapshot.settings.value));
    }, [snapshot]);
    if (state.status === 'idle' || (state.status === 'loading' && snapshot === undefined)) {
        return (0, jsx_runtime_1.jsx)("div", { className: "dvt-settings", children: (0, jsx_runtime_1.jsx)("div", { className: "dvt-loading", children: t('testing') }) });
    }
    if (snapshot === undefined || draft === undefined) {
        return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error ?? t('reload') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", onClick: () => { void controller.load(); }, children: t('reload') })] });
    }
    const update = (key, value) => setDraft(current => current === undefined ? current : { ...current, [key]: value });
    const providers = snapshot.providers;
    const busy = state.action !== undefined;
    const selectedModel = providers.find(entry => entry.provider === draft.provider)?.models.find(model => model.id === draft.model);
    const reasoningEfforts = selectedModel?.reasoningEfforts ?? [];
    const applyModelSelection = (key) => {
        if (key === '') {
            update('provider', '');
            update('model', '');
            return;
        }
        try {
            const parsed = JSON.parse(key);
            if (typeof parsed.provider === 'string' && typeof parsed.model === 'string') {
                update('provider', parsed.provider);
                update('model', parsed.model);
            }
        }
        catch {
            // Ignore malformed keys.
        }
    };
    const save = () => {
        try {
            setDraftError(undefined);
            void controller.save(valueOf(draft, t), snapshot.settings.revision);
        }
        catch (error) {
            setDraftError(error instanceof Error ? error.message : String(error));
        }
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsxs)("header", { className: "dvt-settings-header", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-kicker", children: "DSH plugin" }), (0, jsx_runtime_1.jsx)("h2", { children: t('settingsTitle') }), (0, jsx_runtime_1.jsx)("p", { children: t('settingsIntro') })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-release", children: (0, jsx_runtime_1.jsxs)("span", { children: [t('pluginVersion'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.pluginVersion })] }) })] }), !snapshot.writable ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert warning", children: t('readOnly') }) : null, draftError === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: draftError }), state.error === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error }), state.message === 'saved' ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('saved') }) : null, state.message === 'testOk' ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('testOk') }) : null, (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel dvt-essential", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('model') }), (0, jsx_runtime_1.jsx)("p", { children: t('modelHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${snapshot.enabled ? 'ok' : 'error'}`, children: snapshot.enabled && draft.model !== '' ? draft.model : t('off') })] }), (0, jsx_runtime_1.jsx)(Field, { label: t('model'), hint: t('imageCapableOnlyHint'), children: (0, jsx_runtime_1.jsxs)("select", { className: "dvt-select", "aria-label": t('model'), disabled: !snapshot.writable || busy, value: draft.provider !== '' && draft.model !== '' ? modelKey(draft.provider, draft.model) : '', onChange: (event) => { applyModelSelection(event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: t('off') }), selectedModel !== undefined && !selectedModel.inputModalities.includes('image')
                                    ? (0, jsx_runtime_1.jsxs)("option", { value: modelKey(draft.provider, draft.model), disabled: true, children: [selectedModel.name, " \u00B7 ", t('modelUnsupportedLabel')] })
                                    : null, providers.map(entry => ((0, jsx_runtime_1.jsx)("optgroup", { label: entry.name, children: entry.models
                                        .filter(model => model.inputModalities.includes('image'))
                                        .map(model => ((0, jsx_runtime_1.jsx)("option", { value: modelKey(entry.provider, model.id), children: model.name }, model.id))) }, entry.provider)))] }) }), reasoningEfforts.length > 0 ? ((0, jsx_runtime_1.jsx)(Field, { label: t('reasoningEffort'), children: (0, jsx_runtime_1.jsxs)("select", { className: "dvt-select", "aria-label": t('reasoningEffort'), disabled: busy || draft.model === '', value: draft.reasoningEffort, onChange: (event) => { update('reasoningEffort', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: t('reasoningDefault') }), reasoningEfforts.map(effort => (0, jsx_runtime_1.jsx)("option", { value: effort, children: effort }, effort))] }) })) : null, (0, jsx_runtime_1.jsxs)("label", { className: "dvt-check", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: draft.pasteToPath, disabled: busy, onChange: (event) => { update('pasteToPath', event.target.checked); } }), (0, jsx_runtime_1.jsx)("span", { children: t('pasteToPath') }), (0, jsx_runtime_1.jsx)("small", { children: t('pasteToPathHint') })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-save-row", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "primary", disabled: !snapshot.writable || busy, onClick: save, children: state.action === 'save' ? t('saving') : t('save') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy || !snapshot.enabled, onClick: () => { void controller.testRead(); }, children: state.action === 'test' ? t('testing') : t('testRead') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy, onClick: () => { void controller.load(); }, children: t('reload') })] }), (0, jsx_runtime_1.jsxs)("details", { className: "dvt-advanced", children: [(0, jsx_runtime_1.jsxs)("summary", { children: [(0, jsx_runtime_1.jsxs)("span", { children: [(0, jsx_runtime_1.jsx)("strong", { children: t('advanced') }), (0, jsx_runtime_1.jsx)("small", { children: t('advancedHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: "dvt-details-chevron", "aria-hidden": "true", children: "\u2304" })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-advanced-body", children: (0, jsx_runtime_1.jsx)("section", { className: "dvt-panel", children: (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('language'), children: (0, jsx_runtime_1.jsxs)("select", { className: "dvt-select", "aria-label": t('language'), disabled: busy, value: draft.language, onChange: (event) => { update('language', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "zh", children: "\u4E2D\u6587" }), (0, jsx_runtime_1.jsx)("option", { value: "en", children: "English" })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('timeout'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('timeout'), inputMode: "numeric", disabled: busy, value: draft.timeoutMs, onChange: (event) => { update('timeoutMs', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxBytes'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('maxBytes'), inputMode: "numeric", disabled: busy, value: draft.maxImageBytes, onChange: (event) => { update('maxImageBytes', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxPixels'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('maxPixels'), inputMode: "numeric", disabled: busy, value: draft.maxImagePixels, onChange: (event) => { update('maxImagePixels', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('concurrency'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('concurrency'), inputMode: "numeric", disabled: busy, value: draft.concurrency, onChange: (event) => { update('concurrency', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxImages'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('maxImages'), inputMode: "numeric", disabled: busy, value: draft.maxImages, onChange: (event) => { update('maxImages', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('allowedDirs'), hint: t('allowedDirsHint'), children: (0, jsx_runtime_1.jsx)("textarea", { "aria-label": t('allowedDirs'), rows: 3, disabled: busy, value: draft.allowedDirs, onChange: (event) => { update('allowedDirs', event.target.value); } }) })] }) }) })] })] }));
}
const CSS = `
.dvt-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-label-primary)}
.dvt-settings-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:4px 2px 12px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dvt-settings-header h2{font-size:20px;letter-spacing:-.02em;margin:3px 0 5px}.dvt-settings-header p{max-width:620px;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dvt-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dsw-alias-state-business-primary);font-weight:700}.dvt-release{display:grid;gap:4px;min-width:170px;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-release span{display:flex;justify-content:space-between;gap:12px;white-space:nowrap}.dvt-release strong{color:var(--dsw-alias-label-primary)}
.dvt-select{width:100%;height:32px;box-sizing:border-box;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;cursor:pointer}.dvt-select:hover{border-color:var(--dsw-alias-border-l2)}.dvt-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dvt-select:disabled{opacity:.55;cursor:default}.dvt-select optgroup{font-weight:650;color:var(--dsw-alias-label-secondary)}
.dvt-field textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;resize:vertical;min-height:60px}.dvt-field textarea:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dvt-field textarea:disabled{opacity:.55}
.dvt-check{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:8px;row-gap:2px;cursor:pointer}.dvt-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dvt-check span{font-size:12px}.dvt-check small{grid-column:2;font-size:10px;color:var(--dsw-alias-label-caption);line-height:1.4}
.dvt-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5}.dvt-alert.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-alert.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dvt-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}.dvt-panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dvt-panel-title h3{font-size:14px;margin:0}.dvt-panel-title p{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin:4px 0 0;max-width:620px}.dvt-badge{font-size:10px;padding:3px 8px;border-radius:999px;white-space:nowrap}.dvt-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-badge.error{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 14%,transparent);color:var(--dsw-alias-label-secondary)}
.dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dvt-field{display:grid;gap:5px}.dvt-field>span{font-size:11px;color:var(--dsw-alias-label-secondary)}.dvt-field small{font-size:10px;color:var(--dsw-alias-label-caption);line-height:1.4}
.dvt-save-row{display:flex;gap:8px;flex-wrap:wrap}.dvt-essential{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,var(--dsw-alias-border-l1));box-shadow:var(--dsw-shadow-lv1),0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,transparent)}
.dvt-advanced{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dvt-advanced>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 15px;cursor:pointer;list-style:none}.dvt-advanced>summary::-webkit-details-marker{display:none}.dvt-advanced>summary>span:first-child{display:grid;gap:3px}.dvt-advanced>summary strong{font-size:13px}.dvt-advanced>summary small{font-size:10px;line-height:1.45;color:var(--dsw-alias-label-secondary);font-weight:400}.dvt-details-chevron{font-size:15px;opacity:.55;transition:transform .16s ease}.dvt-advanced[open] .dvt-details-chevron{transform:rotate(180deg)}.dvt-advanced-body{display:grid;gap:12px;padding:0 12px 12px}.dvt-advanced-body>.dvt-panel{box-shadow:none}
.dvt-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:8px;padding:0 2px 6px}.dvt-paste-item{position:relative;width:64px;height:64px;border-radius:10px;overflow:visible}.dvt-paste-preview{position:relative;width:100%;height:100%;box-sizing:border-box;display:block;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);padding:0;cursor:zoom-in}.dvt-paste-preview:hover{border-color:var(--dsw-alias-border-l2)}.dvt-paste-preview:disabled{cursor:default;opacity:.8}.dvt-paste-preview[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-preview[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-preview-img{display:block;width:100%;height:100%;object-fit:cover}.dvt-paste-preview[data-status=copying] .dvt-paste-preview-img{opacity:.5}.dvt-paste-img-text{display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-caption);font-size:11px;padding:0 6px;overflow:hidden}.dvt-paste-status{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.62));color:#fff;font-size:10px;text-align:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dvt-paste-status[data-kind=error]{background:var(--dsw-alias-state-error-primary);text-align:center;padding:1px 4px}.dvt-paste-remove{position:absolute;top:-7px;right:-7px;width:20px;height:20px;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:50%;padding:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);font:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:0}.dvt-paste-item:hover .dvt-paste-remove,.dvt-paste-remove:focus-visible{opacity:1}.dvt-paste-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-remove:disabled{opacity:0;cursor:default}
.dvt-user-row{flex-direction:column;align-items:flex-end;gap:6px;display:flex}.dvt-user-row[data-pending-steering=true]{opacity:.55}.dvt-user-stack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}.dvt-bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px;white-space:pre-wrap;overflow-wrap:anywhere}.dvt-ref-chip{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:0 4px;margin:0 1px;display:inline}.dvt-img-gallery{flex-direction:column;align-items:flex-end;gap:8px;max-width:100%;display:flex}.dvt-img-frame{position:relative;overflow:hidden;border:0;padding:0;background:var(--dsw-alias-interactive-bg-hover);border-radius:14px;cursor:zoom-in;display:grid;place-items:center;max-width:100%}.dvt-img-frame img{display:block;width:100%;height:100%;object-fit:cover}.dvt-img-frame[data-variant=tile]{width:64px;height:64px}.dvt-img-frame:not([data-variant]){min-width:64px;min-height:64px}.dvt-img-text{color:var(--dsw-alias-label-caption);font-size:12px;padding:6px 10px}.dvt-img-error{color:var(--dsw-alias-state-error-primary)}.dvt-msg-actions{align-items:center;gap:10px;height:28px;display:flex}.dvt-msg-time{color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-right:12px;font-size:14px;line-height:24px}@media (hover:hover){[data-time-hover-root] .dvt-msg-time{opacity:0;transition:opacity 80ms}[data-time-hover-root]:hover .dvt-msg-time,[data-time-hover-root]:focus-within .dvt-msg-time{opacity:1}}.dvt-msg-action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex;flex:none}.dvt-msg-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dvt-lightbox{position:fixed;inset:0;z-index:99999;display:grid;place-items:center}.dvt-lightbox-mask{position:absolute;inset:0;background:rgba(0,0,0,.7);cursor:zoom-out}.dvt-lightbox-img{position:relative;max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.5)}.dvt-lightbox-close{position:absolute;top:16px;right:16px;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}.dvt-lightbox-close:hover{background:rgba(255,255,255,.22)}
@media(max-width:720px){.dvt-settings-header{display:grid}.dvt-form-grid{grid-template-columns:1fr}.dvt-panel-title{flex-direction:column}}
`;
function installStyles() {
    const id = 'dsh-vision-cloud/client';
    const existing = document.querySelector(`style[data-plugin-css="${id}"]`);
    if (existing !== null)
        return () => { };
    const style = document.createElement('style');
    style.dataset.plugin = 'dsh-vision-cloud';
    style.dataset.pluginCss = id;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { style.remove(); };
}
/** Required client services. */
exports.inject = ['slots', 'locale', 'remote', 'conversation', 'sessions'];
/** Register the Vision Settings section and the paste-to-path bridge. */
function apply(ctx) {
    ctx.effect(installStyles, 'dsh-vision-cloud: styles');
    ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-vision-cloud: locale');
    (0, paste_images_tsx_1.installPasteImages)(ctx);
    const t = ctx.locale.bind(NS);
    const controller = new VisionSettingsController();
    ctx.effect(() => {
        const refresh = () => { controller.refreshIfLoaded(); };
        const legacyRemote = ctx.remote;
        const currentEvents = ctx;
        const disposers = typeof legacyRemote.$on === 'function'
            ? [legacyRemote.$on('settings/document-updated', refresh)]
            : [currentEvents.on('settings/changed', refresh)];
        disposers.push(ctx.on('connection/reset', refresh));
        return () => { for (const dispose of disposers)
            dispose(); };
    }, 'dsh-vision-cloud: Settings invalidations');
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'vision-cloud',
        order: 30,
        label: () => t('nav'),
        inject: () => ({ controller, t }),
    }, SettingsSection));
}
};
__modules["./paste-images.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PasteImageController = exports.PASTE_IMAGES_ROUTE = void 0;
exports.PasteImageDock = PasteImageDock;
exports.installPasteImages = installPasteImages;
const jsx_runtime_1 = require("react/jsx-runtime");
/** Clipboard and drag-and-drop multi-image input for DSH Web. */
const react_1 = require("react");
const user_message_view_tsx_1 = __load_("./user-message-view.js");
const SOURCE = 'vision-cloud-pasted-image';
exports.PASTE_IMAGES_ROUTE = '/_dsh/vision-cloud/paste-images';
const MAX_IMAGES = 20;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
const CORDIS_ORIGINAL = Symbol.for('cordis.original');
function registryIdentity(registry) {
    let current = registry;
    while (true) {
        const original = current[CORDIS_ORIGINAL];
        if ((typeof original !== 'object' && typeof original !== 'function') || original === null || original === current) {
            return current;
        }
        current = original;
    }
}
let fallbackId = 0;
function id() {
    if (typeof globalThis.crypto?.randomUUID === 'function')
        return globalThis.crypto.randomUUID();
    fallbackId += 1;
    return `paste-${Date.now()}-${fallbackId}`;
}
function humanBytes(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 ** 2)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
function imageFiles(data) {
    if (data === null)
        return [];
    const itemFiles = Array.from(data.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file) => file !== null);
    const candidates = itemFiles.length > 0 ? itemFiles : Array.from(data.files);
    return candidates.filter(file => file.type.toLowerCase().startsWith('image/'));
}
/**
 * Extract our bridge file-route URLs from every drag/clipboard flavor.
 * Dragging a rendered tile out of a bridged bubble carries no files — the
 * payload is the (browser-absolutized) file-route URL as uri-list/text/html.
 * Scanning those flavors catches the drop before the textarea swallows the
 * raw markup (session evidence: agentHome b98c935b, 2026-08-16).
 */
function bridgeRefsFromPayload(data) {
    if (data === null)
        return [];
    const chunks = [];
    const types = Array.isArray(data.types) ? (data.types) : [];
    for (const type of types) {
        if (type === 'Files')
            continue;
        let value = '';
        try {
            value = data.getData(type);
        }
        catch {
            value = '';
        }
        if (value !== '')
            chunks.push(value);
    }
    const refs = [];
    const seen = new Set();
    for (const chunk of chunks) {
        for (const match of chunk.matchAll(/\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu)) {
            const url = match[0];
            if (seen.has(url))
                continue;
            seen.add(url);
            let sessionId;
            let name;
            for (const pair of url.slice(url.indexOf('?') + 1).split('&')) {
                const eq = pair.indexOf('=');
                if (eq < 0)
                    continue;
                const key = pair.slice(0, eq);
                const value = pair.slice(eq + 1);
                if (key === 'sessionId')
                    sessionId = decodeURIComponent(value);
                else if (key === 'name')
                    name = decodeURIComponent(value);
            }
            if (sessionId !== undefined && name !== undefined && sessionId !== '' && name !== '') {
                refs.push({ sessionId, name });
            }
        }
    }
    return refs;
}
/**
 * Strip this plugin's own bridge markup out of a drop/paste text payload.
 * Dragging a bridged tile produces a "File + URL text" payload: the DSH
 * message drag materializes the image as a File and puts the file-route URL
 * (plus adjacent bridge markup) into the drag text. Without stripping, the
 * URL leaks into the draft and then into the sent message. Returns '' when
 * the payload carried only bridge markup.
 */
function sanitizeBridgeText(text) {
    if (text.includes('/_dsh/vision-cloud/paste-images/file?')) {
        // The payload came from one of our bridged bubbles. Besides the markup
        // stripped below, the DSH message drag sometimes prefixes the URL with a
        // materialized-file label ("url-<uuid>-<name>.<ext>"); drop that token so
        // the whole line collapses (agentHome b98c935b, 2026-08-16).
        text = text.replace(/url-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[^.\s"'<>]*)?(?:\.[a-z0-9]{2,5})?(?=[\s"'<>()[\]\\]|$)/giu, '');
    }
    let value = text;
    value = value.replace(/!\[[^\]]*\]\(<[^)]+>\)/gu, '');
    value = value.replace(/https?:\/\/[^\s"'<>]*\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '');
    value = value.replace(/\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '');
    value = value.replace(/\[Pasted image available at absolute path: "[^"]*"\]/gu, '');
    value = value.replace(/\[pasted image: [^\]]*\]/gu, '');
    return value.replace(/\s+/gu, ' ').trim();
}
/**
 * Remove leaked bridge serialization markup from a draft while preserving the
 * user's real text. Used defensively during model-switch reconciliation: a
 * multimodal paste/drop of a bridged tile can leave the raw path+markdown in
 * the draft, and the subsequent native→bridge migration must not keep it.
 */
function stripBridgeMarkup(text) {
    return text
        .replace(/!\[[^\]]*\]\(<[^)]+>\)/gu, '')
        .replace(/https?:\/\/[^\s"'<>]*\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '')
        .replace(/\/_dsh\/vision-cloud\/paste-images\/file\?[^\s"'<>()]+/gu, '')
        .replace(/\[Pasted image available at absolute path: "[^"]*"\]/gu, '')
        .replace(/\[pasted image: [^\]]*\]/gu, '')
        .replace(/url-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[^.\s"'<>]*)?(?:\.[a-z0-9]{2,5})?(?=[\s"'<>()[\]\\]|$)/giu, '')
        .replace(/[ \t]+\n/gu, '\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim();
}
function validateImages(files) {
    if (files.length > MAX_IMAGES)
        throw new Error(`Paste at most ${MAX_IMAGES} images at a time`);
    let total = 0;
    for (const file of files) {
        if (!file.type.toLowerCase().startsWith('image/'))
            throw new Error(`${file.name || 'clipboard item'} is not an image`);
        if (file.size <= 0)
            throw new Error(`${file.name || 'clipboard image'} is empty`);
        if (file.size > MAX_IMAGE_BYTES)
            throw new Error(`${file.name || 'clipboard image'} exceeds ${humanBytes(MAX_IMAGE_BYTES)}`);
        total += file.size;
    }
    if (total > MAX_BATCH_BYTES)
        throw new Error(`Pasted images exceed ${humanBytes(MAX_BATCH_BYTES)} in total`);
}
async function responseJson(response) {
    const body = await response.json();
    if (!response.ok || body.ok !== true)
        throw new Error(body.error?.message ?? `Image copy failed (${response.status})`);
    return body;
}
function pasteLabel(file, index, saved) {
    return saved?.trim() || file.name.trim() || `clipboard-image-${index + 1}`;
}
/** Owns browser File objects until DSH serializes the corresponding text references. */
class PasteImageController {
    ctx;
    records = new Map();
    listeners = new Set();
    revision = 0;
    /** Draft ids shown in the host's native in-card attachment rail for bridge records. */
    nativePreviews = new Map();
    previewUnsubscribes = new Map();
    submitGuards = new WeakSet();
    pendingSubmitGuards = new WeakSet();
    constructor(ctx) {
        this.ctx = ctx;
    }
    subscribe = (listener) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    snapshot = () => this.revision;
    changed() {
        this.revision += 1;
        for (const listener of this.listeners)
            listener();
    }
    VERDICT_MAX_AGE_MS = 60000;
    VERDICT_RETRY_MS = 30000;
    verdicts = new Map();
    routeAvailable = true;
    routeRetryAt = 0;
    replaying = false;
    lastBridgeNoticeAt = 0;
    subscribedDirectories = new Set();
    reconciliations = new Map();
    /** Best-effort current model selector label (used only without modelDirectories). */
    currentModelLabel() {
        const buttons = document.querySelectorAll('button[aria-label]');
        for (const button of buttons) {
            const label = button.getAttribute('aria-label') ?? '';
            if (/选择模型|select model|current model|当前模型/i.test(label))
                return label;
        }
        return '';
    }
    modelDirectoriesService() {
        const ctx = this.ctx;
        const service = typeof ctx.get === 'function' ? ctx.get('modelDirectories') : undefined;
        if (service === undefined || typeof service.directoryFor !== 'function')
            return undefined;
        return service;
    }
    /**
     * The composer's current model selection, freshest source first:
     * the live model-selection store (exact provider/model) followed by the
     * DOM selector label as a legacy fallback (subagent sessions throw here).
     */
    currentPick(sessionId) {
        this.tryArmSubmitGuard(sessionId);
        const service = this.modelDirectoriesService();
        if (service !== undefined) {
            try {
                const directory = service.directoryFor(sessionId);
                if (directory?.store) {
                    this.subscribeDirectory(sessionId, directory.store);
                    const current = directory.store.getSnapshot().current;
                    if (current !== null && current !== undefined
                        && typeof current.provider === 'string' && typeof current.model === 'string'
                        && current.provider !== '' && current.model !== '') {
                        return { provider: current.provider, model: current.model, label: current.model };
                    }
                }
            }
            catch {
                // Subagent composers or unknown scopes: fall back to the DOM label.
            }
        }
        return { label: this.currentModelLabel() };
    }
    /** Flush cached verdicts and prefetch on selection changes (one per session). */
    subscribeDirectory(sessionId, store) {
        if (this.subscribedDirectories.has(sessionId))
            return;
        this.subscribedDirectories.add(sessionId);
        if (typeof store.subscribe !== 'function')
            return;
        try {
            store.subscribe(() => {
                this.flushVerdicts(sessionId);
                this.prefetch();
                void this.reconcileDraftMedia(sessionId);
            });
        }
        catch {
            // Keep the DOM label fallback when the store rejects listeners.
        }
    }
    flushVerdicts(sessionId) {
        const prefix = `${sessionId}\u0000`;
        for (const key of this.verdicts.keys())
            if (key.startsWith(prefix))
                this.verdicts.delete(key);
    }
    verdictKey(sessionId, pick) {
        if (pick.provider !== undefined && pick.model !== undefined && pick.provider !== '' && pick.model !== '') {
            return `${sessionId}\u0000p\u0000${pick.provider}\u0000${pick.model}`;
        }
        if (pick.label.trim() === '')
            return undefined;
        return `${sessionId}\u0000l\u0000${pick.label}`;
    }
    /**
     * Fetch the takeover verdict for one selection. Resolves the effective
     * takeover (`true` = bridge, `false` = native) or `undefined` when the
     * verdict could not be obtained (fetch failure, route down, rate-limited
     * retry window) — callers then apply the text-safe bridge fallback (GA20).
     */
    refreshVerdict(sessionId, pick) {
        const key = this.verdictKey(sessionId, pick);
        if (key === undefined)
            return Promise.resolve(false);
        if (!this.routeAvailable && Date.now() < this.routeRetryAt)
            return Promise.resolve(undefined);
        const cached = this.verdicts.get(key);
        if (cached?.pending && cached.task !== undefined)
            return cached.task;
        const entry = { takeover: cached?.takeover, at: cached?.at ?? 0, pending: true, task: undefined };
        this.verdicts.set(key, entry);
        entry.task = (async () => {
            // Optimistic probe: a 404 marks the route down only for a retry window,
            // after which refreshVerdict re-checks instead of giving up forever (GA6).
            this.routeAvailable = true;
            try {
                const query = new URLSearchParams({ sessionId });
                if (pick.provider !== undefined && pick.model !== undefined) {
                    query.set('provider', pick.provider);
                    query.set('model', pick.model);
                }
                else {
                    query.set('model', pick.label);
                }
                const res = await fetch(`${exports.PASTE_IMAGES_ROUTE}?${query.toString()}`);
                if (res.status === 404) {
                    this.routeAvailable = false;
                    this.routeRetryAt = Date.now() + this.VERDICT_RETRY_MS;
                    return undefined;
                }
                if (!res.ok)
                    return undefined;
                const body = await res.json();
                entry.takeover = body.takeover === true;
                entry.at = Date.now();
                entry.pending = false;
                return entry.takeover;
            }
            catch {
                return undefined;
            }
            finally {
                entry.pending = false;
            }
        })();
        return entry.task;
    }
    /**
     * Cached takeover for the current selection: `true`/`false` only for a
     * fresh verdict; `undefined` (or a stale/empty signal) leaves the event
     * held for the async decide-then-act flow.
     */
    syncTakeover(sessionId) {
        const pick = this.currentPick(sessionId);
        const key = this.verdictKey(sessionId, pick);
        // No model signal is NOT a native verdict: returning `false` here would
        // pass the event straight through to the native handler without a
        // preventDefault, inserting a raw image block that pi-ai text-only
        // models reject with UNSUPPORTED_CONTENT (the harness agent composer has
        // no model picker at all). Hold instead; the decide-then-act flow below
        // routes the no-signal case to the text-safe bridge.
        if (key === undefined)
            return undefined;
        const cached = this.verdicts.get(key);
        if (cached !== undefined && !cached.pending && cached.takeover !== undefined
            && cached.at > 0 && Date.now() - cached.at <= this.VERDICT_MAX_AGE_MS) {
            return cached.takeover;
        }
        return undefined;
    }
    /** Prefetch the paste/drop takeover verdict (called on composer focus/drag enter). */
    prefetch() {
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return;
        const pick = this.currentPick(String(sessionId));
        if (this.verdictKey(String(sessionId), pick) === undefined)
            return;
        void this.refreshVerdict(String(sessionId), pick);
    }
    /**
     * One-way draft reconciliation: when the selected model becomes text-only
     * and the draft still carries native image ids from a multimodal paste,
     * convert those images to bridge references before the host rejects the
     * next send. No destructive fallback: if the verdict is unknown the draft
     * stays exactly as the user left it.
     */
    reconcileDraftMedia(sessionId) {
        const previous = this.reconciliations.get(sessionId);
        if (previous !== undefined)
            return previous;
        const task = (async () => {
            try {
                const pick = this.currentPick(sessionId);
                const key = this.verdictKey(sessionId, pick);
                if (key === undefined)
                    return;
                let input;
                try {
                    input = this.inputFor(sessionId);
                }
                catch {
                    return; // Subagent/no composer scope has no draft rail to reconcile.
                }
                const before = input.state.getSnapshot();
                if (before.phase !== 'plain' || before.imageIds.length === 0)
                    return;
                const verdict = await this.refreshVerdict(sessionId, pick);
                if (verdict === undefined) {
                    input.notify('error', 'The image bridge is temporarily unreachable; native draft images were left unchanged.');
                    return;
                }
                if (verdict !== true)
                    return;
                // The selection may have changed again while the GET was in flight.
                if (this.verdictKey(sessionId, this.currentPick(sessionId)) !== key)
                    return;
                const snapshot = input.state.getSnapshot();
                if (snapshot.phase !== 'plain' || snapshot.imageIds.length === 0)
                    return;
                await this.bridgeNativeDraft(sessionId, input, snapshot.imageIds);
            }
            catch (error) {
                console.warn('dsh-vision-cloud could not reconcile draft images with the selected model', error);
            }
            finally {
                this.reconciliations.delete(sessionId);
            }
        })();
        this.reconciliations.set(sessionId, task);
        return task;
    }
    conversationDraftService() {
        const ctx = this.ctx;
        const service = typeof ctx.get === 'function' ? ctx.get('conversation') : undefined;
        if (typeof service !== 'object' || service === null)
            return undefined;
        return service;
    }
    /** Copy a draft File's bytes so they survive the host releasing the draft image. */
    cloneDraftFile(file, fallbackName) {
        return new File([file], file.name.trim() || fallbackName, { type: file.type || 'image/png' });
    }
    sameImageIds(left, right) {
        return left.length === right.length && left.every((value, index) => value === right[index]);
    }
    async bridgeNativeDraft(sessionId, input, imageIds, admitPreviews = true) {
        const face = this.conversationDraftService();
        const shell = input;
        if (typeof face?.draftImages !== 'function' || typeof shell.removeImage !== 'function') {
            input.notify('error', 'The composer draft-image API is unavailable; remove the image and paste it again after selecting a text-only model.');
            return false;
        }
        // Display-only previews created for bridge records must NOT be re-bridged:
        // they already have a live bridge occurrence in the draft.
        const previewIds = new Set();
        for (const [id, preview] of this.nativePreviews) {
            if (preview.sessionId === sessionId)
                previewIds.add(id);
        }
        const nativeImageIds = imageIds.filter(id => !previewIds.has(id));
        if (nativeImageIds.length === 0)
            return false;
        const attachments = face.draftImages(nativeImageIds);
        if (attachments.length !== nativeImageIds.length || !this.sameImageIds(nativeImageIds, attachments.map(attachment => attachment.id))) {
            input.notify('error', 'Some native draft images are no longer available; removed them and paste again.');
            return false;
        }
        const files = attachments.map((attachment, index) => this.cloneDraftFile(attachment.file, attachment.file.name || `clipboard-image-${index + 1}`));
        validateImages(files);
        // Re-check immediately before the mutation: insert first so a failed CAS
        // rollback leaves the original native ids untouched.
        let snapshot = input.state.getSnapshot();
        const cleanedDraft = stripBridgeMarkup(snapshot.draft);
        if (cleanedDraft !== snapshot.draft) {
            input.setDraft(cleanedDraft);
            snapshot = input.state.getSnapshot();
        }
        if (!this.sameImageIds(snapshot.imageIds.filter(id => !previewIds.has(id)), nativeImageIds))
            return false;
        const cursor = snapshot.draft.length;
        this.insertRecords(sessionId, input, files, cursor, admitPreviews);
        for (const id of nativeImageIds)
            shell.removeImage(id);
        try {
            face.releaseDraftImages?.(attachments);
        }
        catch {
            // The migrated bridge records are independent File copies already.
        }
        return true;
    }
    source() {
        return {
            trigger: '@',
            name: SOURCE,
            order: 1000,
            candidates: () => Promise.resolve([]),
            onPick: () => undefined,
            codec: {
                clipboardText: (ref) => {
                    const record = this.records.get(ref);
                    return `[pasted image: ${record === undefined ? ref : pasteLabel(record.file, 0, record.filename)}]`;
                },
                serialize: (ref, signal) => this.serialize(ref, signal),
            },
        };
    }
    recordsFor(occurrences) {
        return occurrences
            .filter(occurrence => occurrence.source === SOURCE)
            .map(occurrence => this.records.get(occurrence.ref))
            .filter((record) => record !== undefined);
    }
    inputFor(sessionId) {
        const actx = this.ctx.sessions.scope(sessionId);
        if (actx === undefined)
            throw new Error('Open a live session before pasting images');
        const input = this.ctx.conversation.input.for(actx);
        this.armSubmitGuard(sessionId, input);
        return input;
    }
    insertText(input, text, start, end = start) {
        if (text === '')
            return start;
        const snapshot = input.state.getSnapshot();
        input.setDraft(snapshot.draft.slice(0, start) + text + snapshot.draft.slice(end));
        return start + text.length;
    }
    /** One batch's cleanup: drop records once every occurrence referencing them is gone. */
    bindBatchCleanup(batch, input) {
        batch.unsubscribe = input.state.subscribe(() => {
            const alive = new Set(input.state.getSnapshot().occurrences
                .filter(occurrence => occurrence.source === SOURCE)
                .map(occurrence => occurrence.ref));
            let changed = false;
            for (const record of batch.records) {
                if (alive.has(record.ref) || record.batch.inflight !== undefined)
                    continue;
                changed = this.records.delete(record.ref) || changed;
            }
            if (batch.records.every(record => !this.records.has(record.ref)) && batch.inflight === undefined) {
                batch.unsubscribe?.();
                batch.unsubscribe = undefined;
            }
            if (changed)
                this.changed();
        });
    }
    /**
     * Insert object references for resolved records at `cursor`. `owned` lists
     * the records created by THIS insertion (rolled back and dropped on
     * failure); records reused from earlier uploads survive a failed insert.
     */
    insertExistingRefs(input, records, owned, cursor) {
        const draftBeforeReferences = input.state.getSnapshot().draft;
        try {
            const before = input.state.getSnapshot().draft.slice(0, cursor);
            if (before !== '' && !/\s$/u.test(before))
                cursor = this.insertText(input, ' ', cursor);
            for (const [index, record] of records.entries()) {
                const label = pasteLabel(record.file, index, record.filename);
                const snapshot = input.state.getSnapshot();
                const accepted = input.insertReference({
                    source: SOURCE,
                    ref: record.ref,
                    label,
                    clipboardText: `[pasted image: ${label}]`,
                }, { start: cursor, end: cursor, draftRev: snapshot.draftRev });
                if (!accepted)
                    throw new Error('The composer changed before pasted images could be inserted');
                cursor += 1;
                const hasNext = index + 1 < records.length;
                const suffix = input.state.getSnapshot().draft.slice(cursor);
                if (hasNext || (suffix !== '' && !/^\s/u.test(suffix)))
                    cursor = this.insertText(input, ' ', cursor);
            }
            this.changed();
            return cursor;
        }
        catch (error) {
            input.setDraft(draftBeforeReferences);
            for (const record of owned)
                this.records.delete(record.ref);
            throw error;
        }
    }
    insertRecords(sessionId, input, files, cursor, admitPreviews = true) {
        const batch = { sessionId, records: [] };
        for (const file of files) {
            const record = { ref: id(), file, batch, status: 'ready' };
            batch.records.push(record);
            this.records.set(record.ref, record);
        }
        const next = this.insertExistingRefs(input, batch.records, batch.records, cursor);
        this.bindBatchCleanup(batch, input);
        // Prefer the host’s native in-card attachment rail; the custom dock above the composer
        // stays available as an error/fallback surface when the draft-image API is absent.
        // Submit-triggered migrations pass false: the message is leaving immediately, so
        // re-adding display-only previews would only race with the submit guard.
        if (admitPreviews)
            this.admitNativePreviews(sessionId, input, batch.records);
        return next;
    }
    /** Whether a bridge record already has a resident native input-card preview. */
    hasNativePreview(ref) {
        for (const preview of this.nativePreviews.values()) {
            if (preview.ref === ref)
                return true;
        }
        return false;
    }
    /**
     * Remove one native preview attachment without interpreting the removal as
     * an intentional bridge-record deletion (bookkeeping is already detached).
     */
    detachNativePreview(id, input, face) {
        const unsubscribe = this.previewUnsubscribes.get(id);
        if (unsubscribe !== undefined) {
            unsubscribe();
            this.previewUnsubscribes.delete(id);
        }
        this.nativePreviews.delete(id);
        const shell = input;
        if (input.state.getSnapshot().imageIds.includes(id))
            shell.removeImage?.(id);
        try {
            face?.releaseDraftImage?.(id);
        }
        catch {
            // The preview attachment may already have been released by the host rail.
        }
    }
    /**
     * Drop display-only native preview ids immediately before the host snapshots
     * imageIds for a submit. The bridge occurrences stay untouched: they carry
     * the prompt the text-only model can actually read.
     */
    dropNativePreviews(sessionId, input, face) {
        for (const [id, preview] of this.nativePreviews) {
            if (preview.sessionId !== sessionId)
                continue;
            this.detachNativePreview(id, input, face);
        }
    }
    /**
     * Try to arm the shell's single submit entry for a session. currentPick
     * invokes this on paste/drop and model-directory refreshes, so the guard is
     * present as soon as the composer is known — including the issue-1 path
     * where a multimodal paste never admitted a display preview.
     */
    tryArmSubmitGuard(sessionId) {
        try {
            this.inputFor(sessionId);
        }
        catch {
            // No live composer scope for this session yet.
        }
    }
    /**
     * Patch the host's single submit entry for a session shell. Both the
     * composer send control (shell.actions.submit) and the public facade
     * (ctx.conversation.input.for(...).submit) resolve through this method.
     *
     * This wrapper is the last-line guarantee for issue 1: the Host validates
     * the outgoing content synchronously at prompt time and refuses the whole
     * request as MODEL_DOES_NOT_SUPPORT_IMAGES whenever a native image block
     * accompanies a text-only selection. Model-store reconciliation is async by
     * contract, so a fast model-switch + send can beat the migration. Here the
     * wrapper strips display-only preview ids, then:
     * - fresh takeover=false: keep native images and submit untouched;
     * - fresh takeover=true: migrate the remaining native ids to bridge refs
     *   and submit only after the mutation succeeds;
     * - unknown/pending: hold this submit, fetch the verdict, migrate on true,
     *   submit untouched on false, and stop rather than hand the Host an image
     *   block it is known to reject when the bridge is unreachable.
     */
    armSubmitGuard(sessionId, input) {
        if (this.submitGuards.has(input))
            return;
        const shell = input;
        if (typeof shell.submit !== 'function')
            return;
        this.submitGuards.add(input);
        const original = shell.submit;
        shell.submit = (mode) => { this.guardedSubmit(sessionId, input, shell, original, mode); };
    }
    /** Re-enable and forward a guarded submit, then clear its pending flag. */
    releaseSubmit(sessionId, input, shell, original, mode) {
        // Safety net: never forward display-only preview ids to the host submit.
        // A submit-triggered migration may have just re-added them; they must be
        // stripped before the text-only model sees the request.
        const face = this.conversationDraftService();
        if (face !== undefined)
            this.dropNativePreviews(sessionId, input, face);
        this.pendingSubmitGuards.delete(input);
        if (input.state.getSnapshot().phase !== 'plain')
            return;
        original.call(shell, mode);
    }
    /** Migrate cached-true native ids and submit exactly once on success. */
    submitBridged(sessionId, input, shell, original, mode, nativeIds) {
        if (this.pendingSubmitGuards.has(input))
            return;
        this.pendingSubmitGuards.add(input);
        const release = () => this.releaseSubmit(sessionId, input, shell, original, mode);
        void this.bridgeNativeDraft(sessionId, input, nativeIds, false).then((ok) => {
            if (ok)
                release();
            else
                this.pendingSubmitGuards.delete(input);
        }, (error) => {
            this.pendingSubmitGuards.delete(input);
            input.notify('error', message(error));
        });
    }
    /**
     * One guarded submit pass. It never forwards a native image block to a
     * model that the current capability verdict says is text-only.
     */
    guardedSubmit(sessionId, input, shell, original, mode) {
        const face = this.conversationDraftService();
        if (face !== undefined)
            this.dropNativePreviews(sessionId, input, face);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain') {
            original.call(shell, mode);
            return;
        }
        const pick = this.currentPick(sessionId);
        const key = this.verdictKey(sessionId, pick);
        if (key === undefined) {
            original.call(shell, mode);
            return;
        }
        const previewIds = new Set();
        for (const [id, preview] of this.nativePreviews) {
            if (preview.sessionId === sessionId)
                previewIds.add(id);
        }
        const imageIds = snapshot.imageIds;
        const nativeIds = imageIds.filter(id => !previewIds.has(id));
        if (nativeIds.length === 0) {
            original.call(shell, mode);
            return;
        }
        const cached = this.verdicts.get(key);
        if (cached !== undefined && !cached.pending && cached.takeover !== undefined
            && cached.at > 0 && Date.now() - cached.at <= this.VERDICT_MAX_AGE_MS) {
            if (cached.takeover)
                this.submitBridged(sessionId, input, shell, original, mode, nativeIds);
            else
                original.call(shell, mode);
            return;
        }
        // Unknown capability: don't leak the native block into prompt validation.
        if (this.pendingSubmitGuards.has(input))
            return;
        this.pendingSubmitGuards.add(input);
        void (async () => {
            try {
                const verdict = await this.refreshVerdict(sessionId, pick);
                // The selection may have changed while the verdict was in flight.
                if (this.verdictKey(sessionId, this.currentPick(sessionId)) !== key)
                    return;
                const now = input.state.getSnapshot();
                if (now.phase !== 'plain')
                    return;
                const nowImageIds = now.imageIds;
                const nowNativeIds = nowImageIds.filter(id => !previewIds.has(id));
                if (nowNativeIds.length === 0) {
                    this.releaseSubmit(sessionId, input, shell, original, mode);
                    return;
                }
                if (verdict === undefined) {
                    this.notifyBridgeDown(input);
                    return;
                }
                if (verdict !== true) {
                    this.releaseSubmit(sessionId, input, shell, original, mode);
                    return;
                }
                const migrated = await this.bridgeNativeDraft(sessionId, input, nowNativeIds, false);
                if (!migrated)
                    return;
                this.releaseSubmit(sessionId, input, shell, original, mode);
            }
            catch (error) {
                this.pendingSubmitGuards.delete(input);
                input.notify('error', message(error));
            }
            finally {
                this.pendingSubmitGuards.delete(input);
            }
        })().catch(error => {
            this.pendingSubmitGuards.delete(input);
            input.notify('error', message(error));
        });
    }
    /** Remove the bridge occurrence for one ref (native preview was removed). */
    removeBridgeOccurrence(sessionId, input, ref) {
        const occurrence = input.state.getSnapshot().occurrences.find(candidate => candidate.source === SOURCE && candidate.ref === ref);
        if (occurrence !== undefined) {
            this.remove(sessionId, occurrence);
            return;
        }
        if (this.records.delete(ref))
            this.changed();
    }
    /**
     * Reconcile resident native previews with input state. A preview survives
     * only while its bridge occurrence AND image id are alive. If the user
     * removed it from the native rail, remove the bridge occurrence; if the
     * prompt was sent (occurrence gone), release the leftover preview draft.
     */
    reconcileNativePreviews(sessionId, input) {
        if (this.nativePreviews.size === 0)
            return;
        const snapshot = input.state.getSnapshot();
        const pending = [];
        for (const [id, preview] of this.nativePreviews) {
            if (preview.sessionId !== sessionId)
                continue;
            pending.push({
                id,
                ref: preview.ref,
                occurrenceAlive: snapshot.occurrences.some(candidate => candidate.source === SOURCE && candidate.ref === preview.ref),
                imageAlive: snapshot.imageIds.includes(id),
            });
        }
        for (const entry of pending) {
            if (entry.occurrenceAlive && entry.imageAlive)
                continue;
            this.detachNativePreview(entry.id, input, this.conversationDraftService());
            if (!entry.imageAlive && entry.occurrenceAlive) {
                this.removeBridgeOccurrence(sessionId, input, entry.ref);
            }
        }
    }
    bindNativePreviewRemoval(sessionId, input, id) {
        const unsubscribe = input.state.subscribe(() => {
            this.reconcileNativePreviews(sessionId, input);
        });
        this.previewUnsubscribes.set(id, unsubscribe);
    }
    /**
     * Show bridge records in the host's native in-card attachment rail. This is
     * display-only for text models: the submit guard removes these ids before
     * serialization, while the bridge path text remains the model payload.
     * Falls back to the plugin rail above the composer when the draft-image API
     * is unavailable (e.g. older harness builds).
     */
    admitNativePreviews(sessionId, input, records) {
        const face = this.conversationDraftService();
        const shell = input;
        if (typeof face?.createDraftImages !== 'function' || typeof shell.addImages !== 'function')
            return false;
        const pending = records.filter(record => !this.hasNativePreview(record.ref));
        if (pending.length === 0)
            return true;
        try {
            const attachments = face.createDraftImages(pending.map(record => record.file));
            if (attachments.length !== pending.length) {
                if (attachments.length > 0)
                    face.releaseDraftImages?.(attachments);
                return false;
            }
            const ids = attachments.map(attachment => attachment.id);
            if (!shell.addImages(ids)) {
                face.releaseDraftImages?.(attachments);
                return false;
            }
            this.armSubmitGuard(sessionId, input);
            for (const [index, record] of pending.entries()) {
                const id = ids[index];
                this.nativePreviews.set(id, { sessionId, ref: record.ref });
                this.bindNativePreviewRemoval(sessionId, input, id);
            }
            return true;
        }
        catch (error) {
            console.warn('dsh-vision-cloud could not show pasted images in the native composer rail', error);
            return false;
        }
    }
    /** Rail records not already represented by a native in-card preview. */
    recordsForDock(occurrences) {
        const records = this.recordsFor(occurrences);
        return records.filter(record => !this.hasNativePreview(record.ref));
    }
    /**
     * Insert the held paste through the paste-to-path bridge. Shared by the
     * cached-true fast path and the async hold-and-decide settle (GA3).
     */
    finishBridge(sessionId, input, files, text, start, end, target, dragEnd = false) {
        if (dragEnd)
            window.dispatchEvent(new Event('dragend'));
        const snapshot = input.state.getSnapshot();
        const safeStart = Math.max(0, Math.min(start, snapshot.draft.length));
        const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length));
        let cursor = this.insertText(input, text, safeStart, safeEnd);
        validateImages(files);
        cursor = this.insertRecords(sessionId, input, files, cursor);
        requestAnimationFrame(() => {
            target.focus({ preventScroll: true });
            target.setSelectionRange(cursor, cursor);
        });
    }
    /**
     * Bridge a held payload that may mix files with bridge-route URL text
     * (dragging a bridged tile: DSH materializes the image as a File and puts
     * its file-route URL into the drag text). The text is sanitized HERE so
     * the URL never reaches the draft; when the payload comes down to one
     * file whose URL names an upload this tab still owns, that record is
     * reused instead of uploading a duplicate copy (agentHome b98c935b,
     * 2026-08-16).
     */
    finishPayload(sessionId, input, files, refs, text, start, end, target, dragEnd = false) {
        // The payload text is sanitized HERE: dragging a bridged tile carries the
        // file-route URL (plus adjacent bridge markup) in the drag text, and it
        // must never leak into the draft (agentHome b98c935b, 2026-08-16).
        const clean = sanitizeBridgeText(text);
        if (files.length === 1 && refs.length === 1 && clean === '') {
            const existing = this.findUploadedRecord(refs[0]);
            if (existing !== undefined) {
                if (dragEnd)
                    window.dispatchEvent(new Event('dragend'));
                const snapshot = input.state.getSnapshot();
                const safeStart = Math.max(0, Math.min(start, snapshot.draft.length));
                const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length));
                const cursorStart = this.insertText(input, '', safeStart, safeEnd);
                const cursor = this.insertExistingRefs(input, [existing], [], cursorStart);
                this.admitNativePreviews(sessionId, input, [existing]);
                requestAnimationFrame(() => {
                    target.focus({ preventScroll: true });
                    target.setSelectionRange(cursor, cursor);
                });
                return;
            }
        }
        this.finishBridge(sessionId, input, files, clean, start, end, target, dragEnd);
    }
    /** Notify once per retry window that the bridge is unreachable (GA20). */
    notifyBridgeDown(input) {
        if (Date.now() - this.lastBridgeNoticeAt < this.VERDICT_RETRY_MS)
            return;
        this.lastBridgeNoticeAt = Date.now();
        input.notify('error', 'The image bridge is temporarily unreachable; pasted images were routed through it as a text-safe fallback.');
    }
    /**
     * Release the held event natively for a confirmed multimodal model.
     * Preferred: the conversation service's public image-draft API so the
     * attachment rail updates exactly like a trusted paste (GA21). Fallback:
     * one untrusted synthetic replay of the same event (guarded against
     * reentrancy); this degrades silently if the app gates on isTrusted.
     */
    releaseNatively(input, files, text, start, end, target, kind) {
        if (this.replaying)
            return;
        const ctx = this.ctx;
        const conversation = typeof ctx.get === 'function' ? ctx.get('conversation') : undefined;
        const face = conversation;
        const shell = input;
        if (typeof face?.createDraftImages === 'function' && typeof shell.addImages === 'function') {
            try {
                // Call as a method: `createDraftImages` reads internal state off its
                // receiver (`this.draftAttachments`), so a detached call throws
                // "Cannot read properties of undefined".
                const images = face.createDraftImages(files);
                if (shell.addImages(images.map(image => image.id))) {
                    const snapshot = input.state.getSnapshot();
                    const safeStart = Math.max(0, Math.min(start, snapshot.draft.length));
                    const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length));
                    this.insertText(input, text, safeStart, safeEnd);
                    return;
                }
            }
            catch (error) {
                input.notify('error', message(error));
                return;
            }
        }
        this.replaying = true;
        try {
            const event = new Event(kind, { bubbles: true, cancelable: true });
            const data = {
                items: files.map(file => ({ kind: 'file', type: file.type, getAsFile: () => file })),
                files,
                getData: (mediaType) => mediaType === 'text/plain' ? text : '',
            };
            Object.defineProperty(event, kind === 'drop' ? 'dataTransfer' : 'clipboardData', { value: data });
            target.dispatchEvent(event);
        }
        finally {
            this.replaying = false;
        }
    }
    async settlePaste(sessionId, pick, input, files, refs, text, start, end, target, kind) {
        try {
            const verdict = await this.refreshVerdict(sessionId, pick);
            if (verdict === undefined) {
                // Verdict unavailable: bridge is the text-safe direction for a
                // possibly text-only model, plus a one-time notice (GA20).
                this.notifyBridgeDown(input);
                if (input.state.getSnapshot().phase !== 'plain')
                    return;
                this.finishPayload(sessionId, input, files, refs, text, start, end, target, kind === 'drop');
                return;
            }
            if (verdict === true) {
                if (input.state.getSnapshot().phase !== 'plain')
                    return;
                this.finishPayload(sessionId, input, files, refs, text, start, end, target, kind === 'drop');
                return;
            }
            if (input.state.getSnapshot().phase !== 'plain')
                return;
            this.releaseNatively(input, files, sanitizeBridgeText(text), start, end, target, kind);
        }
        catch (error) {
            input.notify('error', message(error));
        }
    }
    handlePaste(event) {
        if (this.replaying)
            return false;
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement) || target.closest('[data-composer-card]') === null)
            return false;
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return false;
        const files = imageFiles(event.clipboardData);
        const refs = bridgeRefsFromPayload(event.clipboardData);
        if (files.length === 0 && refs.length === 0)
            return false;
        // A fresh cached verdict decides synchronously so a native (multimodal)
        // paste still reaches the app handlers untouched.
        const cached = this.syncTakeover(String(sessionId));
        // A bridged file-route URL pasted as text: hold it and re-materialize
        // the image through the same verdict chain as the drop counterpart.
        if (files.length === 0 && refs.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            const input = this.inputFor(sessionId);
            const snapshot = input.state.getSnapshot();
            const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
            const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length));
            const session = String(sessionId);
            if (cached === false) {
                void this.materializeNativeDroppedRefs(input, refs, start, end, target, 'paste')
                    .catch(error => input.notify('error', message(error)));
                return true;
            }
            const pick = this.currentPick(session);
            if (cached === true || this.verdictKey(session, pick) === undefined) {
                if (snapshot.phase !== 'plain')
                    return true;
                void this.bridgeDroppedRefs(session, input, refs, start, end, target)
                    .catch(error => input.notify('error', message(error)));
                return true;
            }
            void this.settleDroppedRefs(session, pick, input, refs, start, end, target, 'paste');
            return true;
        }
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length));
        const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '');
        if (cached === false) {
            // Confirmed multimodal: let the host add the image natively, but never
            // let a bridged-tile payload leak its raw path/markdown into the draft
            // (A29 mixed payload on the native verdict path).
            if (refs.length === 0)
                return false;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (snapshot.phase !== 'plain')
                return true;
            try {
                this.releaseNatively(input, files, sanitizeBridgeText(text), start, end, target, 'paste');
            }
            catch (error) {
                input.notify('error', message(error));
            }
            return true;
        }
        if (cached === true) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (snapshot.phase !== 'plain')
                return true;
            try {
                this.finishPayload(String(sessionId), input, files, refs, text, start, end, target);
            }
            catch (error) {
                input.notify('error', message(error));
            }
            return true;
        }
        // Unknown verdict: hold the event — it must not reach the native handler
        // with an unconfirmed text-only model — then decide asynchronously (GA3).
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const pick = this.currentPick(String(sessionId));
        if (this.verdictKey(String(sessionId), pick) === undefined) {
            // No model signal at all — e.g. the harness agent composer has no model
            // picker — so bridge: the text-safe direction. A native release here
            // puts an image block straight into the message and pi-ai text-only
            // models reject the whole request with UNSUPPORTED_CONTENT (session
            // evidence: agentHome 41683fc5, 2026-08-16).
            if (snapshot.phase !== 'plain')
                return true;
            try {
                this.finishPayload(String(sessionId), input, files, refs, text, start, end, target);
            }
            catch (error) {
                input.notify('error', message(error));
            }
            return true;
        }
        void this.settlePaste(String(sessionId), pick, input, files, refs, text, start, end, target, 'paste');
        return true;
    }
    handleDrop(event) {
        if (this.replaying)
            return false;
        // Find the composer textarea the drop landed on, falling back to the
        // focused composer when the drop target is a decorative child.
        const target = event.target;
        const card = target instanceof Element ? target.closest('[data-composer-card]') : null;
        const textarea = card?.querySelector('textarea')
            ?? (document.activeElement instanceof HTMLTextAreaElement
                && document.activeElement.closest('[data-composer-card]') !== null
                ? document.activeElement
                : null)
            ?? document.querySelector('[data-composer-card] textarea');
        if (!(textarea instanceof HTMLTextAreaElement))
            return false;
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return false;
        const files = imageFiles(event.dataTransfer);
        const refs = bridgeRefsFromPayload(event.dataTransfer);
        if (files.length === 0 && refs.length === 0)
            return false;
        // A fresh cached verdict decides synchronously so a native (multimodal)
        // file drop still reaches the app handlers untouched.
        const cached = this.syncTakeover(String(sessionId));
        // URL-only drop of a bridged tile: hold it — never let the textarea
        // swallow the raw file-route URL/markup (agentHome b98c935b) — then
        // re-materialize through the same verdict chain as a file drop.
        if (files.length === 0 && refs.length > 0) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            window.dispatchEvent(new Event('dragend'));
            const input = this.inputFor(sessionId);
            const snapshot = input.state.getSnapshot();
            const start = Math.max(0, Math.min(textarea.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
            const end = Math.max(start, Math.min(textarea.selectionEnd ?? start, snapshot.draft.length));
            const session = String(sessionId);
            if (cached === false) {
                // Confirmed multimodal: fetch the bytes and insert a real image
                // block (direct vision, native bubble) instead of path text.
                void this.materializeNativeDroppedRefs(input, refs, start, end, textarea, 'drop')
                    .catch(error => input.notify('error', message(error)));
                return true;
            }
            const pick = this.currentPick(session);
            if (cached === true || this.verdictKey(session, pick) === undefined) {
                // Bridged text model (cached) or no model signal at all (harness
                // agent composer): bridge, the text-safe direction.
                if (snapshot.phase !== 'plain')
                    return true;
                void this.bridgeDroppedRefs(session, input, refs, start, end, textarea)
                    .catch(error => input.notify('error', message(error)));
                return true;
            }
            void this.settleDroppedRefs(session, pick, input, refs, start, end, textarea, 'drop');
            return true;
        }
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        const start = Math.max(0, Math.min(textarea.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        const end = Math.max(start, Math.min(textarea.selectionEnd ?? start, snapshot.draft.length));
        const text = (event.dataTransfer?.getData('text/plain') ?? '').replaceAll('\uFFFC', '');
        if (cached === false) {
            // Confirmed multimodal: let the host add the image natively, but never
            // let a bridged-tile payload leak its raw path/markdown into the draft
            // (A29 mixed payload on the native verdict path).
            if (refs.length === 0)
                return false;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            window.dispatchEvent(new Event('dragend'));
            if (snapshot.phase !== 'plain')
                return true;
            try {
                this.releaseNatively(input, files, sanitizeBridgeText(text), start, end, textarea, 'drop');
            }
            catch (error) {
                input.notify('error', message(error));
            }
            return true;
        }
        // The native DSH drop handler normally resets its drag overlay here; since
        // this capture-phase takeover stops that handler, tell it to reset now.
        if (cached === true) {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            window.dispatchEvent(new Event('dragend'));
            if (snapshot.phase !== 'plain')
                return true;
            try {
                this.finishPayload(String(sessionId), input, files, refs, text, start, end, textarea, true);
            }
            catch (error) {
                input.notify('error', message(error));
            }
            return true;
        }
        // Unknown verdict: hold the drop, then decide asynchronously (GA3).
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        window.dispatchEvent(new Event('dragend'));
        const pick = this.currentPick(String(sessionId));
        if (this.verdictKey(String(sessionId), pick) === undefined) {
            // No model signal at all: bridge, the text-safe direction (see the
            // paste counterpart above).
            if (snapshot.phase !== 'plain')
                return true;
            try {
                this.finishPayload(String(sessionId), input, files, refs, text, start, end, textarea, true);
            }
            catch (error) {
                input.notify('error', message(error));
            }
            return true;
        }
        void this.settlePaste(String(sessionId), pick, input, files, refs, text, start, end, textarea, 'drop');
        return true;
    }
    remove(sessionId, occurrence) {
        const record = this.records.get(occurrence.ref);
        if (record?.batch.inflight !== undefined)
            return;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return;
        const current = snapshot.occurrences.find(candidate => candidate.source === SOURCE
            && candidate.occurrenceId === occurrence.occurrenceId
            && candidate.ref === occurrence.ref);
        if (current === undefined)
            return;
        const accepted = input.insertText('', {
            start: current.offset,
            end: current.offset + 1,
            draftRev: snapshot.draftRev,
        });
        if (!accepted)
            return;
        this.records.delete(occurrence.ref);
        this.changed();
    }
    /** A same-tab record whose uploaded workspace file is the dropped one. */
    findUploadedRecord(ref) {
        for (const record of this.records.values()) {
            if (record.batch.sessionId !== ref.sessionId)
                continue;
            if (record.absolutePath === undefined)
                continue;
            if (record.absolutePath.split(/[\\/]/u).pop() === ref.name)
                return record;
        }
        return undefined;
    }
    /** Download one bridged image back over the session-authorized file route. */
    async fetchBridgeFile(ref) {
        const url = `${exports.PASTE_IMAGES_ROUTE}/file?sessionId=${encodeURIComponent(ref.sessionId)}&name=${encodeURIComponent(ref.name)}`;
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok)
            throw new Error(`Pasted image is no longer available in this workspace (${response.status})`);
        const mediaType = (response.headers.get('content-type') ?? 'image/png').split(';')[0]?.trim() ?? 'image/png';
        const ext = /\.(png|jpe?g|gif|webp)\b/iu.exec(ref.name)?.[1] ?? '';
        const type = mediaType.toLowerCase().startsWith('image/') ? mediaType : `image/${ext || 'png'}`;
        const bytes = new Uint8Array(await response.arrayBuffer());
        return new File([bytes], ref.name, { type });
    }
    /**
     * Re-materialize bridge file-route URLs as text-safe references: reuse a
     * same-tab uploaded record, otherwise download the bytes and treat them as
     * a fresh File (the ordinary bridge copies it at serialize time). The
     * dropped URL text itself is NEVER written into the draft.
     */
    async bridgeDroppedRefs(sessionId, input, refs, start, end, target) {
        const snapshot = input.state.getSnapshot();
        const safeStart = Math.max(0, Math.min(start, snapshot.draft.length));
        const safeEnd = Math.max(safeStart, Math.min(end, snapshot.draft.length));
        const cursorStart = this.insertText(input, '', safeStart, safeEnd);
        const batch = { sessionId, records: [] };
        const records = [];
        for (const ref of refs) {
            const existing = this.findUploadedRecord(ref);
            if (existing !== undefined) {
                records.push(existing);
                continue;
            }
            const fetched = await this.fetchBridgeFile(ref);
            const record = { ref: id(), file: fetched, batch, status: 'ready' };
            batch.records.push(record);
            this.records.set(record.ref, record);
            records.push(record);
        }
        const cursor = this.insertExistingRefs(input, records, batch.records, cursorStart);
        if (batch.records.length > 0)
            this.bindBatchCleanup(batch, input);
        this.admitNativePreviews(sessionId, input, records);
        requestAnimationFrame(() => {
            target.focus({ preventScroll: true });
            target.setSelectionRange(cursor, cursor);
        });
    }
    /** Multimodal verdict: give the model a real image block, not path text. */
    async materializeNativeDroppedRefs(input, refs, start, end, target, kind) {
        if (input.state.getSnapshot().phase !== 'plain')
            return;
        const files = await Promise.all(refs.map(ref => this.fetchBridgeFile(ref)));
        this.releaseNatively(input, files, '', start, end, target, kind);
    }
    /** Held URL payload: verdict false → native block; true/unavailable → bridge. */
    async settleDroppedRefs(sessionId, pick, input, refs, start, end, target, kind) {
        try {
            const verdict = await this.refreshVerdict(sessionId, pick);
            if (verdict === false) {
                if (input.state.getSnapshot().phase !== 'plain')
                    return;
                const files = await Promise.all(refs.map(ref => this.fetchBridgeFile(ref)));
                this.releaseNatively(input, files, '', start, end, target, kind);
                return;
            }
            if (verdict === undefined)
                this.notifyBridgeDown(input);
            if (input.state.getSnapshot().phase !== 'plain')
                return;
            await this.bridgeDroppedRefs(sessionId, input, refs, start, end, target);
        }
        catch (error) {
            input.notify('error', message(error));
        }
    }
    async upload(batch, signal) {
        if (batch.inflight !== undefined)
            return batch.inflight;
        const active = batch.records.filter(record => this.records.get(record.ref) === record);
        if (active.length === 0)
            throw new Error('Pasted images were removed before sending');
        const pending = active.filter(record => record.absolutePath === undefined);
        if (pending.length === 0)
            return;
        const task = (async () => {
            for (const record of pending) {
                record.status = 'copying';
                record.error = undefined;
            }
            this.changed();
            try {
                const failures = await Promise.all(pending.map(async (record) => {
                    try {
                        if (signal.aborted)
                            throw signal.reason ?? new DOMException('Aborted', 'AbortError');
                        const query = new URLSearchParams({
                            sessionId: batch.sessionId,
                            name: record.file.name || 'clipboard-image',
                            size: String(record.file.size),
                        });
                        const body = await responseJson(await fetch(`${exports.PASTE_IMAGES_ROUTE}?${query.toString()}`, {
                            method: 'POST',
                            headers: { 'Content-Type': record.file.type },
                            body: record.file,
                            signal,
                        }));
                        const absolutePath = body.value?.absolutePath;
                        if (typeof absolutePath !== 'string' || absolutePath === '') {
                            throw new Error('Image copy response contained an invalid path');
                        }
                        record.absolutePath = absolutePath;
                        const filename = body.value?.filename;
                        if (typeof filename === 'string' && filename.trim() !== '')
                            record.filename = filename.trim();
                        record.status = 'copied';
                        record.error = undefined;
                        return undefined;
                    }
                    catch (error) {
                        const failure = error instanceof Error ? error : new Error(message(error));
                        record.status = 'error';
                        record.error = failure.message;
                        return failure;
                    }
                }));
                this.changed();
                const failure = failures.find((error) => error !== undefined);
                if (failure !== undefined)
                    throw failure;
            }
            finally {
                batch.inflight = undefined;
                this.changed();
            }
        })();
        batch.inflight = task;
        return task;
    }
    async serialize(ref, signal) {
        const record = this.records.get(ref);
        if (record === undefined)
            throw new Error('Pasted image is no longer available in this browser tab');
        await this.upload(record.batch, signal);
        if (record.absolutePath === undefined)
            throw new Error('Pasted image was not copied into the workspace');
        const leaf = record.absolutePath.split(/[\\/]/u).pop() ?? 'pasted-image';
        const label = (record.filename ?? record.file.name).trim().replace(/[[\]]/g, '') || leaf;
        const fileUrl = `${exports.PASTE_IMAGES_ROUTE}/file?sessionId=${encodeURIComponent(record.batch.sessionId)}&name=${encodeURIComponent(leaf)}`;
        return `[Pasted image available at absolute path: ${JSON.stringify(record.absolutePath)}]\n\n![${label}](<${fileUrl}>)`;
    }
}
exports.PasteImageController = PasteImageController;
/** One bridged image in the composer rail: large clickable thumbnail, no visible filename. */
function PasteImagePreview(props) {
    const [url, setUrl] = (0, react_1.useState)('');
    const [failed, setFailed] = (0, react_1.useState)(false);
    const [open, setOpen] = (0, react_1.useState)(false);
    (0, react_1.useEffect)(() => {
        if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function')
            return undefined;
        const objectUrl = URL.createObjectURL(props.file);
        setUrl(objectUrl);
        setFailed(false);
        return () => { URL.revokeObjectURL(objectUrl); };
    }, [props.file]);
    const removeLabel = `移除 ${props.name}`;
    const previewLabel = `预览 ${props.name}`;
    return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-paste-item", "data-status": props.status, children: [(0, jsx_runtime_1.jsxs)("button", { type: "button", className: "dvt-paste-preview", "data-status": props.status, disabled: failed || url === '', title: props.status === 'error' ? props.error ?? props.name : props.name, "aria-label": previewLabel, onClick: () => { setOpen(true); }, children: [url === '' || failed
                        ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-img-text", children: failed ? '图片加载失败' : null })
                        : (0, jsx_runtime_1.jsx)("img", { className: "dvt-paste-preview-img", src: url, alt: props.name, onError: () => { setFailed(true); } }), props.status === 'copying' ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-status", "aria-hidden": "true", children: "\u590D\u5236\u4E2D\u2026" }) : null, props.status === 'error' ? (0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-status", "data-kind": "error", "aria-hidden": "true", children: "!" }) : null] }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-paste-remove", "aria-label": removeLabel, disabled: props.disabled, onClick: props.onRemove, children: "\u00D7" }), open && (0, jsx_runtime_1.jsx)(user_message_view_tsx_1.ImageLightbox, { src: url, alt: props.name, dialog: "\u56FE\u7247\u9884\u89C8", close: "\u5173\u95ED\u9884\u89C8", onClose: () => { setOpen(false); } })] });
}
/**
 * Fallback preview rail above the composer. Bridged images normally render in
 * the host’s native in-card attachment rail; this surface remains for copies,
 * errors, and harness builds whose guest input has no draft-image API.
 */
function PasteImageDock(props) {
    (0, react_1.useSyncExternalStore)(props.controller.subscribe, props.controller.snapshot);
    const occurrences = props.input.occurrences.filter(occurrence => occurrence.source === SOURCE);
    const records = props.controller.recordsForDock(occurrences);
    if (records.length === 0)
        return null;
    return (0, jsx_runtime_1.jsx)("div", { className: "dvt-paste-dock", role: "status", "aria-label": "\u5DF2\u6DFB\u52A0\u7684\u56FE\u7247", children: occurrences.map((occurrence) => {
            const record = props.controller.recordsFor([occurrence])[0];
            if (record === undefined)
                return null;
            const name = record.filename?.trim() || record.file.name.trim() || 'clipboard image';
            return (0, jsx_runtime_1.jsx)(PasteImagePreview, { file: record.file, name: name, status: record.status, error: record.error, disabled: props.input.phase !== 'plain' || record.status === 'copying', onRemove: () => { props.remove(occurrence); } }, occurrence.occurrenceId);
        }) });
}
/** Install capture interception, the text-reference codec, and composer feedback. */
function installPasteImages(ctx) {
    const controller = new PasteImageController(ctx);
    const registered = new WeakMap();
    const register = (scope, registry) => {
        scope.effect(() => {
            const identity = registryIdentity(registry);
            let registration = registered.get(identity);
            if (registration === undefined) {
                registration = { dispose: registry.registerSource(controller.source()), owners: 0 };
                registered.set(identity, registration);
            }
            registration.owners += 1;
            return () => {
                if (registered.get(identity) !== registration)
                    return;
                registration.owners -= 1;
                if (registration.owners > 0)
                    return;
                registered.delete(identity);
                registration.dispose();
            };
        }, 'dsh-vision-cloud: pasted image reference codec');
    };
    ctx.inject(['slash'], (scope) => {
        register(scope, scope.slash);
    });
    ctx.inject(['inputTriggers'], (scope) => {
        register(scope, scope.inputTriggers);
    });
    ctx.effect(() => {
        const listener = (event) => { controller.handlePaste(event); };
        const onDrop = (event) => { controller.handleDrop(event); };
        const onFocus = () => { controller.prefetch(); };
        const onDragEnter = (event) => {
            if (event.dataTransfer?.types.includes('Files') ?? false)
                controller.prefetch();
        };
        document.addEventListener('paste', listener, true);
        document.addEventListener('drop', onDrop, true);
        document.addEventListener('dragenter', onDragEnter, true);
        document.addEventListener('focusin', onFocus, true);
        return () => {
            document.removeEventListener('paste', listener, true);
            document.removeEventListener('drop', onDrop, true);
            document.removeEventListener('dragenter', onDragEnter, true);
            document.removeEventListener('focusin', onFocus, true);
        };
    }, 'dsh-vision-cloud: image capture');
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'vision-cloud-pasted-images',
        order: 6,
        inject: sessionId => ({
            controller,
            remove: (occurrence) => { controller.remove(String(sessionId), occurrence); },
        }),
    }, PasteImageDock));
    // Shadow the product's keyed user/steering message views at a very low
    // priority (DSH renders the lowest-priority live entry per keyed cell).
    // While installed, bridged paste-to-path messages render as image tiles plus
    // clean text instead of leaking the model-facing path markup, and every
    // other user message is re-rendered to match the product bubble. The error
    // boundary keeps this entry mounted even if a host UI primitive is missing,
    // so the product's raw-text view cannot take the seat back.
    ctx.slots.inject('conversation.chat.node', () => {
        const disposeUser = ctx.slots.register({
            name: 'conversation.chat.node',
            key: 'user',
            priority: -1000,
            locale: 'conversation',
        }, user_message_view_tsx_1.UserMessageShadowBoundary);
        const disposeSteering = ctx.slots.register({
            name: 'conversation.chat.node',
            key: 'steering',
            priority: -1000,
            locale: 'conversation',
        }, user_message_view_tsx_1.UserMessageShadowBoundary);
        return () => { disposeSteering(); disposeUser(); };
    });
}
};
__modules["./user-message-view.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserMessageShadowBoundary = exports.UserMessageNodeShadow = exports.BRIDGE_FILE_PREFIX = void 0;
exports.extractBridgeMarkup = extractBridgeMarkup;
exports.splitContent = splitContent;
exports.singleFit = singleFit;
exports.ImageLightbox = ImageLightbox;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * Shadow user/steering chat-node renderer (方案2).
 *
 * DSH renders the lowest-priority live entry of a keyed slot cell, so this
 * component is registered for the `user` and `steering` keys of
 * `conversation.chat.node` at priority -1 while the product registers the
 * same keys at priority 0. While the plugin runs this view replaces the
 * product's UserMessageNodeView; disposing the registration (or the slot
 * runtime abdicating this entry after a render error) restores it.
 *
 * Two duties:
 * 1. Reproduce the product's user bubble — image gallery for native image
 *    blocks (`loadImage`), plain-text bubble with `/skill` / `@agent` chips,
 *    JsonBlock extras, and the copy/time action row — so multimodal sessions
 *    look exactly like the default provider pipeline.
 * 2. Interpret the paste-to-path bridge's model-facing markers
 *    (`[Pasted image available at absolute path: "..."]` lines and
 *    `![name](</_dsh/vision-cloud/paste-images/file?...>)` links) as real
 *    image tiles and strip that markup from the visible text. The model still
 *    receives the full path text; only the rendering above it changes.
 */
const react_dom_1 = require("react-dom");
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
exports.BRIDGE_FILE_PREFIX = '/_dsh/vision-cloud/paste-images/file';
const BRIDGE_PATH_RE = /\[Pasted image available at absolute path: "[^"]*"\]/gu;
const BRIDGE_IMAGE_RE = /!\[([^\]]*)\]\(<([^)]+)>\)/gu;
const CHIP_RE = /(^|\s)([/@][\w-]+)(?=\s|$)/gu;
const FALLBACK_LABELS = {
    copy: '复制',
    copied: '已复制',
    image: '图片',
    open: '查看原图',
    loading: '图片加载中…',
    loadFailed: '图片加载失败，点击重试',
    preview: '图片预览',
    closePreview: '关闭预览',
    extra: '附加内容',
};
function translate(t, key, params) {
    if (typeof t === 'function') {
        try {
            const value = t(key, params);
            if (typeof value === 'string' && value !== '')
                return value;
        }
        catch {
            // Fall through to the built-in label.
        }
    }
    const fallback = FALLBACK_LABELS[key];
    return fallback ?? key;
}
/**
 * Strip the paste-to-path bridge's model-facing markers from a message text
 * and collect the embedded image route. Non-bridge markdown images are left
 * untouched (user bubbles render plain text, like the product does).
 */
function extractBridgeMarkup(text) {
    if (text === '')
        return { text: '', images: [] };
    const images = [];
    const cleaned = text
        .replace(BRIDGE_PATH_RE, '')
        .replace(BRIDGE_IMAGE_RE, (whole, alt, url) => {
        if (!url.startsWith(exports.BRIDGE_FILE_PREFIX) && url !== exports.BRIDGE_FILE_PREFIX)
            return whole;
        images.push({ url, alt: alt.trim() });
        return '';
    });
    const collapsed = cleaned.trim()
        .replace(/[ \t]+\n/gu, '\n')
        .replace(/\n{3,}/gu, '\n\n');
    return { text: collapsed, images };
}
/** Split message content into the parts the product bubble renders. */
function splitContent(content) {
    let text = '';
    const images = [];
    const rest = [];
    for (const raw of content) {
        if (raw === null || typeof raw !== 'object') {
            rest.push(raw);
            continue;
        }
        const block = raw;
        if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text;
        }
        else if (block.type === 'image' && block.attachment !== null && typeof block.attachment === 'object') {
            images.push(block.attachment);
        }
        else {
            rest.push(raw);
        }
    }
    return { text, images, rest };
}
/**
 * DeepSeek Chat lone-image box: long edge 240px, rendered aspect clamped to
 * [0.25, 4] with `object-fit: cover`, never upscaled past the natural size.
 */
function singleFit(width, height) {
    const natural = width / height;
    const ratio = Math.min(4, Math.max(0.25, natural));
    const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 };
    const scale = Math.min(1, width / box.width, height / box.height);
    return {
        width: Math.max(1, Math.round(box.width * scale)),
        height: Math.max(1, Math.round(box.height * scale)),
        objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
    };
}
function resolveLabels(t) {
    return {
        loading: translate(t, 'image.loading'),
        loadFailed: translate(t, 'image.loadFailed'),
        open: translate(t, 'image.openOriginal'),
        openNamed: label => translate(t, 'image.openOriginalLabel', { label }),
        preview: translate(t, 'image.preview'),
        closePreview: translate(t, 'image.closePreview'),
    };
}
/** Body-portal original-image preview; closes on Escape or backdrop press. Shared by chat bubbles and the composer paste rail. */
function ImageLightbox(props) {
    const { onClose } = props;
    (0, react_1.useEffect)(() => {
        const onKeyDown = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => { window.removeEventListener('keydown', onKeyDown); };
    }, [onClose]);
    return (0, react_dom_1.createPortal)((0, jsx_runtime_1.jsxs)("div", { className: "dvt-lightbox", role: "dialog", "aria-modal": "true", "aria-label": props.dialog, children: [(0, jsx_runtime_1.jsx)("div", { className: "dvt-lightbox-mask", "aria-hidden": "true", onMouseDown: onClose }), (0, jsx_runtime_1.jsx)("img", { className: "dvt-lightbox-img", src: props.src, alt: props.alt }), (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-lightbox-close", "aria-label": props.close, onClick: onClose, children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconCloseOutline16, {}) })] }), document.body);
}
/** Native image block: load through the session-authorized resolver. */
function NativeImageCell(props) {
    const { attachment } = props;
    const [src, setSrc] = (0, react_1.useState)('');
    const [failed, setFailed] = (0, react_1.useState)(false);
    const [open, setOpen] = (0, react_1.useState)(false);
    const [attempt, setAttempt] = (0, react_1.useState)(0);
    (0, react_1.useEffect)(() => {
        let live = true;
        setFailed(false);
        setSrc('');
        props.load(attachment).then((url) => {
            if (live)
                setSrc(url);
        }).catch(() => {
            if (live)
                setFailed(true);
        });
        return () => { live = false; };
    }, [attachment, attempt, props.load]);
    const fit = props.variant === 'single' && typeof attachment.width === 'number' && typeof attachment.height === 'number'
        ? singleFit(attachment.width, attachment.height)
        : undefined;
    if (failed) {
        return (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-img-frame dvt-img-error", "data-variant": props.variant, onClick: () => { setAttempt(previous => previous + 1); }, children: (0, jsx_runtime_1.jsx)("span", { className: "dvt-img-text", children: props.labels.loadFailed }) });
    }
    if (src === '') {
        return (0, jsx_runtime_1.jsx)("div", { className: "dvt-img-frame", "data-variant": props.variant, style: fit === undefined ? undefined : { width: fit.width, height: fit.height }, children: (0, jsx_runtime_1.jsx)("span", { className: "dvt-img-text", children: props.labels.loading }) });
    }
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-img-frame", "data-variant": props.variant, title: props.labels.open, "aria-label": props.labels.openNamed(props.name), style: fit === undefined ? undefined : { width: fit.width, height: fit.height }, onClick: () => { setOpen(true); }, children: (0, jsx_runtime_1.jsx)("img", { src: src, alt: props.name, style: fit === undefined ? undefined : { objectPosition: fit.objectPosition } }) }), open && (0, jsx_runtime_1.jsx)(ImageLightbox, { src: src, alt: props.name, dialog: props.labels.preview, close: props.labels.closePreview, onClose: () => { setOpen(false); } })] });
}
/** Bridge image: served directly by the paste-image file route. */
function BridgeImageCell(props) {
    const [failed, setFailed] = (0, react_1.useState)(false);
    const [attempt, setAttempt] = (0, react_1.useState)(0);
    const [open, setOpen] = (0, react_1.useState)(false);
    if (failed) {
        return (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-img-frame dvt-img-error", "data-variant": props.variant, onClick: () => { setFailed(false); setAttempt(previous => previous + 1); }, children: (0, jsx_runtime_1.jsx)("span", { className: "dvt-img-text", children: props.labels.loadFailed }) });
    }
    return (0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-img-frame", "data-variant": props.variant, title: props.labels.open, "aria-label": props.labels.openNamed(props.name), onClick: () => { setOpen(true); }, children: (0, jsx_runtime_1.jsx)("img", { src: props.item.url, alt: props.name, onError: () => { setFailed(true); } }, attempt) }), open && (0, jsx_runtime_1.jsx)(ImageLightbox, { src: props.item.url, alt: props.name, dialog: props.labels.preview, close: props.labels.closePreview, onClose: () => { setOpen(false); } })] });
}
function ShadowGallery(props) {
    if (props.items.length === 0)
        return null;
    const variant = props.items.length === 1 ? 'single' : 'tile';
    const labels = resolveLabels(props.t);
    return (0, jsx_runtime_1.jsx)("div", { className: "dvt-img-gallery", "data-align": "end", children: props.items.map((item, index) => {
            if (item.kind === 'native') {
                if (props.load === undefined) {
                    const name = item.name || `image-${index + 1}`;
                    return (0, jsx_runtime_1.jsx)("span", { className: "dvt-img-text", children: name }, `${name}-${index}`);
                }
                return (0, jsx_runtime_1.jsx)(NativeImageCell, { attachment: item.attachment, name: item.name, variant: variant, load: props.load, labels: labels }, `native-${String(item.attachment.attachmentId ?? index)}`);
            }
            return (0, jsx_runtime_1.jsx)(BridgeImageCell, { item: item.item, name: item.name, variant: variant, labels: labels }, `bridge-${item.item.url}-${index}`);
        }) });
}
/** Plain-text bubble fragment with `/skill` and `@agent` reference chips. */
function projectUserText(text) {
    if (text === '')
        return null;
    const pieces = [];
    let cursor = 0;
    CHIP_RE.lastIndex = 0;
    for (let match = CHIP_RE.exec(text); match !== null; match = CHIP_RE.exec(text)) {
        const index = match.index;
        if (index > cursor)
            pieces.push((0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.MessageText, { text: text.slice(cursor, index) }, `text-${pieces.length}`));
        const token = match[2] ?? match[0].trim();
        const prefix = match[1] ?? ' ';
        pieces.push((0, jsx_runtime_1.jsxs)("span", { className: "dvt-ref-chip", "data-kind": token.startsWith('@') ? 'agent' : 'skill', children: [prefix, token] }, `chip-${pieces.length}`));
        cursor = index + match[0].length;
    }
    if (cursor < text.length)
        pieces.push((0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.MessageText, { text: text.slice(cursor) }, `text-${pieces.length}`));
    return (0, jsx_runtime_1.jsx)(jsx_runtime_1.Fragment, { children: pieces });
}
function MessageActions(props) {
    const [copied, setCopied] = (0, react_1.useState)(false);
    const timer = (0, react_1.useRef)(undefined);
    (0, react_1.useEffect)(() => () => { if (timer.current !== undefined)
        clearTimeout(timer.current); }, []);
    (0, react_1.useEffect)(() => {
        if (!copied)
            return undefined;
        timer.current = setTimeout(() => { setCopied(false); }, 1000);
        return () => { if (timer.current !== undefined)
            clearTimeout(timer.current); };
    }, [copied]);
    const onCopy = (0, react_1.useCallback)(() => {
        (0, dsh_client_ui_primitives_1.writeClipboard)(props.text).then(() => { setCopied(true); }, () => { setCopied(true); });
    }, [props.text]);
    const copyLabel = copied ? translate(props.t, 'copied') : translate(props.t, 'copy');
    const clock = props.time === undefined ? null : new Date(props.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-msg-actions", children: [clock === null ? null : (0, jsx_runtime_1.jsx)("span", { className: "dvt-msg-time", children: clock }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Tooltip, { label: copyLabel, side: "bottom", children: (0, jsx_runtime_1.jsx)("button", { type: "button", className: "dvt-msg-action", "aria-label": copyLabel, onClick: onCopy, children: copied ? (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconCheckOutline16, {}) : (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.IconCopyOutline16, {}) }) })] });
}
/**
 * Priority -1 shadow of the product's keyed `user` / `steering` chat-node
 * views. Props are the framework's composed slot props (node, loadImage, t,
 * session kit). A render error here abdicates the entry, handily restoring
 * the product view instead of leaving an empty row.
 */
exports.UserMessageNodeShadow = (0, react_1.memo)(function UserMessageNodeShadow(props) {
    const { node, loadImage, t } = props;
    const data = (node?.data ?? {});
    const content = Array.isArray(data.content) ? data.content : [];
    const split = (0, react_1.useMemo)(() => splitContent(content), [content]);
    const bridge = (0, react_1.useMemo)(() => extractBridgeMarkup(split.text), [split.text]);
    const items = (0, react_1.useMemo)(() => [
        ...split.images.map((attachment, index) => ({ kind: 'native', attachment, name: attachment.name ?? `image-${index + 1}` })),
        ...bridge.images.map((item, index) => ({ kind: 'bridge', item, name: item.alt || `pasted-image-${index + 1}` })),
    ], [split.images, bridge.images]);
    const showBubble = bridge.text !== '' || split.rest.length > 0;
    return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-user-row", "data-pending-steering": data.pending === true ? 'true' : undefined, "data-time-hover-root": true, children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-user-stack", children: [(0, jsx_runtime_1.jsx)(ShadowGallery, { items: items, load: loadImage, t: t }), showBubble && (0, jsx_runtime_1.jsxs)("div", { className: "dvt-bubble", children: [projectUserText(bridge.text), split.rest.map((block, index) => (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.JsonBlock, { label: translate(t, 'extra'), payload: block }, `rest-${index}`))] })] }), (0, jsx_runtime_1.jsx)(MessageActions, { text: bridge.text, time: data.time, t: t })] });
});
/**
 * Primitive-only fallback used when the full shadow renderer throws (for
 * example a host build missing an optional UI primitive). It still strips the
 * bridge path/markdown and shows the image, so the product's raw text never
 * leaks even in the error path.
 */
function FallbackUserMessage(props) {
    const data = (props.node?.data ?? {});
    const content = Array.isArray(data.content) ? data.content : [];
    const split = splitContent(content);
    const bridge = extractBridgeMarkup(split.text);
    const items = [
        ...split.images.map((attachment, index) => ({ kind: 'native', attachment, name: attachment.name ?? `image-${index + 1}` })),
        ...bridge.images.map((item, index) => ({ kind: 'bridge', item, name: item.alt || `pasted-image-${index + 1}` })),
    ];
    return (0, jsx_runtime_1.jsx)("div", { className: "dvt-user-row", "data-time-hover-root": true, children: (0, jsx_runtime_1.jsxs)("div", { className: "dvt-user-stack", children: [items.map((item, index) => {
                    if (item.kind === 'bridge') {
                        return (0, jsx_runtime_1.jsx)("img", { className: "dvt-img-frame", src: item.item.url, alt: item.name, style: { maxWidth: 240, borderRadius: 14 } }, `bridge-${index}`);
                    }
                    return (0, jsx_runtime_1.jsx)("span", { className: "dvt-img-text", children: item.name }, `native-${index}`);
                }), bridge.text !== '' && (0, jsx_runtime_1.jsx)("div", { className: "dvt-bubble", children: bridge.text })] }) });
}
/**
 * Error boundary around the shadow renderer. A render failure abdicates the
 * raw slot entry and silently restores the product's raw-text bubble, which is
 * exactly what we must avoid for bridged images. This boundary keeps the
 * plugin's clean user-message view mounted and falls back to a primitive-only
 * renderer instead of letting the product view leak bridge markup.
 */
class UserMessageShadowBoundaryClass extends react_1.Component {
    state = { failed: false };
    static getDerivedStateFromError() {
        return { failed: true };
    }
    componentDidCatch(error) {
        console.warn('dsh-vision-cloud user message shadow failed; using fallback renderer', error);
    }
    render() {
        if (this.state.failed)
            return (0, jsx_runtime_1.jsx)(FallbackUserMessage, { ...this.props });
        return (0, jsx_runtime_1.jsx)(exports.UserMessageNodeShadow, { ...this.props });
    }
}
/**
 * Slot-safe wrapper around the shadow error boundary. The slot registry
 * accepts function components most reliably, so this memoized function is what
 * gets registered for the `user` / `steering` chat-node keys.
 */
exports.UserMessageShadowBoundary = (0, react_1.memo)(function UserMessageShadowBoundary(props) {
    return (0, jsx_runtime_1.jsx)(UserMessageShadowBoundaryClass, { ...props });
});
};
function __resolve(from, request) {
  if (!request.startsWith(".")) return request;
  var parts = from.slice(2).split("/"); parts.pop();
  for (var part of request.split("/")) { if (part === "." || part === "") continue; if (part === "..") parts.pop(); else parts.push(part); }
  return "./" + parts.join("/");
}
function __load(id) {
  if (__modules[id] === undefined) return require(id);
  if (__cache[id] !== undefined) return __cache[id].exports;
  var module = __cache[id] = { exports: {} };
  __modules[id](module, module.exports, require, function(request) { var resolved = __resolve(id, request); return __modules[resolved] === undefined ? require(request) : __load(resolved); });
  return module.exports;
}
return __load("./index.js"); } });
//# sourceMappingURL=client.js.map
