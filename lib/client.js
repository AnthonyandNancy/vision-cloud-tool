window.__ModuleLoader__.load({ id: "dsh-vision-cloud", factory: (require) => {
var __modules = Object.create(null); var __cache = Object.create(null);
__modules["./index.js"] = function(module, exports, require, __load_) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inject = exports.VisionSettingsController = void 0;
exports.apply = apply;
const jsx_runtime_1 = require("react/jsx-runtime");
/**
 * DSH Vision Cloud browser plugin: a minimal Settings section (pick an app
 * model + test read) plus the paste/drop-to-path image bridge. No tool cards, no
 * artifact previews, no credentials.
 */
const react_1 = require("react");
const dsh_client_ui_primitives_1 = require("@deepseek-ai/dsh-client-ui-primitives");
const paste_images_tsx_1 = __load_("./paste-images.js");
const NS = 'vision-cloud';
const SETTINGS_ROUTE = '/_dsh/vision-cloud/settings';
const en = {
    nav: 'Vision Cloud',
    settingsTitle: 'Vision Cloud',
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
};
const zh = {
    nav: '视觉云',
    settingsTitle: '视觉云',
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
};
async function apiRequest(init) {
    const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin', ...init });
    const body = await response.json();
    if (!response.ok || !body.ok) {
        const failure = body;
        throw new Error(failure.error?.message ?? `Vision Cloud request failed with HTTP ${response.status}`);
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
    return ((0, jsx_runtime_1.jsxs)("div", { className: "dvt-settings", children: [(0, jsx_runtime_1.jsxs)("header", { className: "dvt-settings-header", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-kicker", children: "DSH plugin" }), (0, jsx_runtime_1.jsx)("h2", { children: t('settingsTitle') }), (0, jsx_runtime_1.jsx)("p", { children: t('settingsIntro') })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-release", children: (0, jsx_runtime_1.jsxs)("span", { children: [t('pluginVersion'), " ", (0, jsx_runtime_1.jsx)("strong", { children: snapshot.pluginVersion })] }) })] }), !snapshot.writable ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert warning", children: t('readOnly') }) : null, draftError === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: draftError }), state.error === undefined ? null : (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert error", children: state.error }), state.message === 'saved' ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('saved') }) : null, state.message === 'testOk' ? (0, jsx_runtime_1.jsx)("div", { className: "dvt-alert success", children: t('testOk') }) : null, (0, jsx_runtime_1.jsxs)("section", { className: "dvt-panel dvt-essential", children: [(0, jsx_runtime_1.jsxs)("div", { className: "dvt-panel-title", children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: t('model') }), (0, jsx_runtime_1.jsx)("p", { children: t('modelHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: `dvt-badge ${snapshot.enabled ? 'ok' : 'error'}`, children: snapshot.enabled && draft.model !== '' ? draft.model : t('off') })] }), (0, jsx_runtime_1.jsx)(Field, { label: t('model'), children: (0, jsx_runtime_1.jsxs)("select", { className: "dvt-select", "aria-label": t('model'), disabled: !snapshot.writable || busy, value: draft.provider !== '' && draft.model !== '' ? modelKey(draft.provider, draft.model) : '', onChange: (event) => { applyModelSelection(event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: t('off') }), providers.map(entry => ((0, jsx_runtime_1.jsx)("optgroup", { label: entry.name, children: entry.models.map(model => ((0, jsx_runtime_1.jsx)("option", { value: modelKey(entry.provider, model.id), children: model.name }, model.id))) }, entry.provider)))] }) }), reasoningEfforts.length > 0 ? ((0, jsx_runtime_1.jsx)(Field, { label: t('reasoningEffort'), children: (0, jsx_runtime_1.jsxs)("select", { className: "dvt-select", "aria-label": t('reasoningEffort'), disabled: busy || draft.model === '', value: draft.reasoningEffort, onChange: (event) => { update('reasoningEffort', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "", children: t('reasoningDefault') }), reasoningEfforts.map(effort => (0, jsx_runtime_1.jsx)("option", { value: effort, children: effort }, effort))] }) })) : null, (0, jsx_runtime_1.jsxs)("label", { className: "dvt-check", children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", checked: draft.pasteToPath, disabled: busy, onChange: (event) => { update('pasteToPath', event.target.checked); } }), (0, jsx_runtime_1.jsx)("span", { children: t('pasteToPath') }), (0, jsx_runtime_1.jsx)("small", { children: t('pasteToPathHint') })] })] }), (0, jsx_runtime_1.jsxs)("div", { className: "dvt-save-row", children: [(0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "primary", disabled: !snapshot.writable || busy, onClick: save, children: state.action === 'save' ? t('saving') : t('save') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy || !snapshot.enabled, onClick: () => { void controller.testRead(); }, children: state.action === 'test' ? t('testing') : t('testRead') }), (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Button, { variant: "outline", disabled: busy, onClick: () => { void controller.load(); }, children: t('reload') })] }), (0, jsx_runtime_1.jsxs)("details", { className: "dvt-advanced", children: [(0, jsx_runtime_1.jsxs)("summary", { children: [(0, jsx_runtime_1.jsxs)("span", { children: [(0, jsx_runtime_1.jsx)("strong", { children: t('advanced') }), (0, jsx_runtime_1.jsx)("small", { children: t('advancedHint') })] }), (0, jsx_runtime_1.jsx)("span", { className: "dvt-details-chevron", "aria-hidden": "true", children: "\u2304" })] }), (0, jsx_runtime_1.jsx)("div", { className: "dvt-advanced-body", children: (0, jsx_runtime_1.jsx)("section", { className: "dvt-panel", children: (0, jsx_runtime_1.jsxs)("div", { className: "dvt-form-grid", children: [(0, jsx_runtime_1.jsx)(Field, { label: t('language'), children: (0, jsx_runtime_1.jsxs)("select", { className: "dvt-select", "aria-label": t('language'), disabled: busy, value: draft.language, onChange: (event) => { update('language', event.target.value); }, children: [(0, jsx_runtime_1.jsx)("option", { value: "zh", children: "\u4E2D\u6587" }), (0, jsx_runtime_1.jsx)("option", { value: "en", children: "English" })] }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('timeout'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('timeout'), inputMode: "numeric", disabled: busy, value: draft.timeoutMs, onChange: (event) => { update('timeoutMs', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxBytes'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('maxBytes'), inputMode: "numeric", disabled: busy, value: draft.maxImageBytes, onChange: (event) => { update('maxImageBytes', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxPixels'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('maxPixels'), inputMode: "numeric", disabled: busy, value: draft.maxImagePixels, onChange: (event) => { update('maxImagePixels', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('concurrency'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('concurrency'), inputMode: "numeric", disabled: busy, value: draft.concurrency, onChange: (event) => { update('concurrency', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('maxImages'), children: (0, jsx_runtime_1.jsx)(dsh_client_ui_primitives_1.Input, { "aria-label": t('maxImages'), inputMode: "numeric", disabled: busy, value: draft.maxImages, onChange: (event) => { update('maxImages', event.target.value); } }) }), (0, jsx_runtime_1.jsx)(Field, { label: t('allowedDirs'), hint: t('allowedDirsHint'), children: (0, jsx_runtime_1.jsx)("textarea", { "aria-label": t('allowedDirs'), rows: 3, disabled: busy, value: draft.allowedDirs, onChange: (event) => { update('allowedDirs', event.target.value); } }) })] }) }) })] })] }));
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
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}.dvt-paste-chip{max-width:100%;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);font-size:12px}.dvt-paste-chip[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-detail{color:var(--dsw-alias-label-caption);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-chip[data-status=error] .dvt-paste-detail{color:var(--dsw-alias-state-error-primary)}.dvt-paste-chip button{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:16px;cursor:pointer}.dvt-paste-chip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-chip button:disabled{opacity:.4;cursor:default}
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
/** Register the Vision Settings section and the paste/drop-to-path bridge. */
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
function pasteLabel(file, index) {
    return file.name.trim() || `clipboard-image-${index + 1}`;
}
/** Owns browser File objects until DSH serializes the corresponding text references. */
class PasteImageController {
    ctx;
    records = new Map();
    listeners = new Set();
    revision = 0;
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
    verdicts = new Map();
    routeAvailable = true;
    /** Best-effort current model selector label (the host owns the real verdict). */
    currentModelLabel() {
        const buttons = document.querySelectorAll('button[aria-label]');
        for (const button of buttons) {
            const label = button.getAttribute('aria-label') ?? '';
            if (/选择模型|select model|current model|当前模型/i.test(label))
                return label;
        }
        return '';
    }
    refreshVerdict(label) {
        if (!this.routeAvailable || label === '')
            return;
        const cached = this.verdicts.get(label);
        if (cached?.pending)
            return;
        const entry = { pending: true, takeover: cached?.takeover ?? false, at: cached?.at ?? 0 };
        this.verdicts.set(label, entry);
        fetch(`${exports.PASTE_IMAGES_ROUTE}?model=${encodeURIComponent(label)}`)
            .then((res) => {
            if (res.status === 404) {
                this.routeAvailable = false;
                entry.pending = false;
                return null;
            }
            if (!res.ok)
                throw new Error(`policy ${res.status}`);
            return res.json();
        })
            .then((body) => {
            entry.pending = false;
            if (body) {
                entry.takeover = body.takeover === true;
                entry.at = Date.now();
            }
        })
            .catch(() => { entry.pending = false; });
    }
    /** Take over a paste only when the host confirmed a text-only model. */
    shouldTakeover() {
        const label = this.currentModelLabel();
        const cached = this.verdicts.get(label);
        if (!cached || cached.pending || cached.at === 0 || Date.now() - cached.at > this.VERDICT_MAX_AGE_MS) {
            this.refreshVerdict(label);
            return false;
        }
        return cached.takeover;
    }
    /** Prefetch the paste/drop takeover verdict (called on composer focus/drag enter). */
    prefetch() {
        this.refreshVerdict(this.currentModelLabel());
    }
    source() {
        return {
            trigger: '@',
            name: SOURCE,
            order: 1000,
            candidates: () => Promise.resolve([]),
            onPick: () => undefined,
            codec: {
                clipboardText: ref => `[pasted image: ${this.records.get(ref)?.file.name ?? ref}]`,
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
        return this.ctx.conversation.input.for(actx);
    }
    insertText(input, text, start, end = start) {
        if (text === '')
            return start;
        const snapshot = input.state.getSnapshot();
        input.setDraft(snapshot.draft.slice(0, start) + text + snapshot.draft.slice(end));
        return start + text.length;
    }
    insertRecords(sessionId, input, files, cursor) {
        const batch = { sessionId, records: [] };
        const draftBeforeReferences = input.state.getSnapshot().draft;
        try {
            const before = input.state.getSnapshot().draft.slice(0, cursor);
            if (before !== '' && !/\s$/u.test(before))
                cursor = this.insertText(input, ' ', cursor);
            for (const [index, file] of files.entries()) {
                const ref = id();
                const record = { ref, file, batch, status: 'ready' };
                batch.records.push(record);
                this.records.set(ref, record);
                const snapshot = input.state.getSnapshot();
                const accepted = input.insertReference({
                    source: SOURCE,
                    ref,
                    label: pasteLabel(file, index),
                    clipboardText: `[pasted image: ${pasteLabel(file, index)}]`,
                }, { start: cursor, end: cursor, draftRev: snapshot.draftRev });
                if (!accepted)
                    throw new Error('The composer changed before pasted images could be inserted');
                cursor += 1;
                const hasNext = index + 1 < files.length;
                const suffix = input.state.getSnapshot().draft.slice(cursor);
                if (hasNext || (suffix !== '' && !/^\s/u.test(suffix)))
                    cursor = this.insertText(input, ' ', cursor);
            }
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
            this.changed();
            return cursor;
        }
        catch (error) {
            input.setDraft(draftBeforeReferences);
            for (const record of batch.records)
                this.records.delete(record.ref);
            throw error;
        }
    }
    handlePaste(event) {
        const files = imageFiles(event.clipboardData);
        if (files.length === 0)
            return false;
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement) || target.closest('[data-composer-card]') === null)
            return false;
        // Leave the paste native for a multimodal model (or an unresolved one):
        // only a confirmed text-only model gets the paste-to-path takeover.
        if (!this.shouldTakeover())
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return true;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return true;
        const start = Math.max(0, Math.min(target.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        const end = Math.max(start, Math.min(target.selectionEnd ?? start, snapshot.draft.length));
        const text = (event.clipboardData?.getData('text/plain') ?? '').replaceAll('\uFFFC', '');
        try {
            let cursor = this.insertText(input, text, start, end);
            validateImages(files);
            cursor = this.insertRecords(String(sessionId), input, files, cursor);
            requestAnimationFrame(() => {
                target.focus({ preventScroll: true });
                target.setSelectionRange(cursor, cursor);
            });
        }
        catch (error) {
            input.notify('error', message(error));
        }
        return true;
    }
    handleDrop(event) {
        const files = imageFiles(event.dataTransfer);
        if (files.length === 0)
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
        // Leave the drop native for a multimodal model (or an unresolved one):
        // only a confirmed text-only model gets the paste-to-path takeover.
        if (!this.shouldTakeover())
            return false;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        // The native DSH drop handler normally resets its drag overlay here; since
        // this capture-phase takeover stops that handler, tell it to reset now.
        window.dispatchEvent(new Event('dragend'));
        const sessionId = this.ctx.sessions.list.getSnapshot().current;
        if (sessionId === undefined)
            return true;
        const input = this.inputFor(sessionId);
        const snapshot = input.state.getSnapshot();
        if (snapshot.phase !== 'plain')
            return true;
        const start = Math.max(0, Math.min(textarea.selectionStart ?? snapshot.draft.length, snapshot.draft.length));
        const end = Math.max(start, Math.min(textarea.selectionEnd ?? start, snapshot.draft.length));
        const text = (event.dataTransfer?.getData('text/plain') ?? '').replaceAll('\uFFFC', '');
        try {
            let cursor = this.insertText(input, text, start, end);
            validateImages(files);
            cursor = this.insertRecords(String(sessionId), input, files, cursor);
            requestAnimationFrame(() => {
                textarea.focus({ preventScroll: true });
                textarea.setSelectionRange(cursor, cursor);
            });
        }
        catch (error) {
            input.notify('error', message(error));
        }
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
        return `[Pasted image available at absolute path: ${JSON.stringify(record.absolutePath)}]`;
    }
}
exports.PasteImageController = PasteImageController;
/** Minimal per-image progress, failure, and removal feedback above the composer. */
function PasteImageDock(props) {
    (0, react_1.useSyncExternalStore)(props.controller.subscribe, props.controller.snapshot);
    const occurrences = props.input.occurrences.filter(occurrence => occurrence.source === SOURCE);
    const records = props.controller.recordsFor(occurrences);
    if (records.length === 0)
        return null;
    return (0, jsx_runtime_1.jsx)("div", { className: "dvt-paste-dock", role: "status", "aria-label": "Pasted images", children: occurrences.map((occurrence) => {
            const record = props.controller.recordsFor([occurrence])[0];
            if (record === undefined)
                return null;
            const detail = record.status === 'copying' ? 'copying…'
                : record.status === 'copied' ? 'copied'
                    : record.status === 'error' ? record.error ?? 'copy failed'
                        : humanBytes(record.file.size);
            return (0, jsx_runtime_1.jsxs)("div", { className: "dvt-paste-chip", "data-status": record.status, children: [(0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-name", title: record.file.name, children: record.file.name || 'clipboard image' }), (0, jsx_runtime_1.jsx)("span", { className: "dvt-paste-detail", title: record.error, children: detail }), (0, jsx_runtime_1.jsx)("button", { type: "button", "aria-label": `Remove ${record.file.name || 'clipboard image'}`, disabled: props.input.phase !== 'plain' || record.status === 'copying', onClick: () => { props.remove(occurrence); }, children: "\u00D7" })] }, occurrence.occurrenceId);
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
}
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
