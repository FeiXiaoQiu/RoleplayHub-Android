const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const calls = [];
const window = {
    RPHubUtils: { extractApiErrorMessage: () => '', formatApiErrorMessage: () => '', getApiUsagePayload: () => null },
    RPHubCardUtils: { extractNativeReasoning: () => '', isNativeReasoningPart: () => false }
};
vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/js/api-utils.js'), 'utf8'), {
    window, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, console,
    fetch: async (url, options) => {
        calls.push({ url, key: options.headers.Authorization, body: JSON.parse(options.body) });
        return { ok: true, status: 200, headers: { get: () => 'application/json' },
            text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }) };
    }
});
const { bindChatModel, migrateChatModelBindings, resolveChatModel } = window.RPHubApiUtils;
const providers = [{ id: 'deepseek', apiUrl: 'https://deepseek.example/v1' }, { id: 'glm', apiUrl: 'https://glm.example/v4' }];
const fixture = () => ({ apiProviderId: 'deepseek', apiUrl: providers[0].apiUrl, apiKey: 'fake-deepseek',
    apiProviderKeys: { deepseek: 'fake-deepseek', glm: 'fake-glm' },
    qualityModel: 'same-model', balancedModel: 'same-model', fastModel: 'fast', chatModelBindings: null });

test('legacy slots migrate once; editor switching and reload preserve actual targets', async () => {
    let settings = fixture();
    migrateChatModelBindings(settings);
    settings.apiProviderId = 'glm'; settings.apiUrl = providers[1].apiUrl; settings.apiKey = 'fake-glm';
    settings = JSON.parse(JSON.stringify(settings));
    migrateChatModelBindings(settings);
    for (const mode of ['quality', 'balanced', 'fast']) {
        const connection = resolveChatModel(settings, mode, providers);
        await window.RPHubApiClient.requestChatCompletion({ ...connection, messages: [], stream: false });
        const request = calls.at(-1);
        assert.equal(request.url, 'https://deepseek.example/v1/chat/completions');
        assert.equal(request.key, 'Bearer fake-deepseek');
        assert.equal(request.body.model, settings[`${mode}Model`]);
    }
    bindChatModel(settings, 'balanced', 'same-model');
    for (const mode of ['quality', 'balanced', 'fast']) {
        await window.RPHubApiClient.requestChatCompletion({ ...resolveChatModel(settings, mode, providers), messages: [], stream: false });
        assert.equal(calls.at(-1).key, mode === 'balanced' ? 'Bearer fake-glm' : 'Bearer fake-deepseek');
    }
});

test('custom connections, empty/deleted config and malformed bindings fail closed', () => {
    const settings = fixture();
    migrateChatModelBindings(settings);
    settings.apiProviderId = 'custom2'; settings.apiUrl = 'https://custom.example/v1'; settings.apiKey = 'fake-custom';
    bindChatModel(settings, 'fast', 'custom-model');
    const custom = [...providers, { id: 'custom2', apiUrl: settings.apiUrl }];
    assert.equal(resolveChatModel(settings, 'fast', custom).apiKey, 'fake-custom');
    settings.apiUrl = '';
    assert.throws(() => resolveChatModel(settings, 'fast', custom));
    settings.apiUrl = 'https://changed.example/v1';
    assert.throws(() => resolveChatModel(settings, 'fast', custom));
    assert.throws(() => resolveChatModel(settings, 'fast', providers));
    settings.apiProviderKeys.deepseek = '';
    assert.throws(() => resolveChatModel(settings, 'quality', custom));
    delete settings.chatModelBindings.balanced;
    migrateChatModelBindings(settings);
    assert.throws(() => resolveChatModel(settings, 'balanced', custom));
});

test('request snapshot remains stable across editor and slot edits for retries/continuation', async () => {
    const settings = fixture(); migrateChatModelBindings(settings);
    const connection = resolveChatModel(settings, 'quality', providers);
    settings.apiProviderId = 'glm'; settings.apiUrl = providers[1].apiUrl; settings.apiKey = 'fake-glm';
    bindChatModel(settings, 'quality', 'other-model');
    for (let round = 0; round < 3; round++) {
        await window.RPHubApiClient.requestChatCompletion({ ...connection, messages: [], stream: false });
        assert.equal(calls.at(-1).key, 'Bearer fake-deepseek');
        assert.equal(calls.at(-1).body.model, 'same-model');
    }
});

test('app integration forwards snapshots and updates only the selected slot', () => {
    const source = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
    assert.match(source, /requestTrackedChatCompletion\(\{\s*\.\.\.chatConnection/);
    assert.match(source, /generateResponse\(Date.now\(\), \{\s*chatConnection,/);
    assert.equal((source.match(/reuseGeneratingState: true, chatConnection/g) || []).length, 2);
    const start = source.indexOf('const selectQuickModels =');
    const end = source.indexOf('const selectModel =', start);
    const settings = fixture(); migrateChatModelBindings(settings);
    const context = { settings, window, currentModelMode: { value: 'quality' }, syncCurrentApiKeyToProvider() {} };
    vm.runInNewContext(`${source.slice(start, end)}; selectQuickModels(['other', 'new', 'other'], 1);`, context);
    assert.equal(settings.qualityModel, 'same-model');
    assert.equal(settings.balancedModel, 'new');
    assert.equal(settings.fastModel, 'fast');
});

test('real editor switch and chat slot handlers keep bindings independent', async () => {
    const source = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
    const settings = fixture(); migrateChatModelBindings(settings);
    const context = {
        settings, selectedApiProviderId: { value: 'deepseek' },
        availableModels: { value: [{ id: 'stale' }] }, showModelSelector: { value: true },
        showApiProviderSelector: { value: true }, currentModelMode: { value: 'quality' },
        syncCurrentApiKeyToProvider() { settings.apiProviderKeys[settings.apiProviderId] = settings.apiKey; },
        isCustomApiProviderId: () => false, provider: providers[1]
    };
    const selectStart = source.indexOf('const selectApiProvider =');
    const selectEnd = source.indexOf('normalizeApiProviderSettings();', selectStart);
    vm.runInNewContext(`${source.slice(selectStart, selectEnd)} selectApiProvider(provider);`, context);
    assert.equal(settings.apiProviderId, 'glm');
    assert.equal(context.availableModels.value.length, 0);
    assert.equal(context.showModelSelector.value, false);
    const slotStart = source.indexOf('const selectChatModelSlot =');
    const slotEnd = source.indexOf('const characters =', slotStart);
    vm.runInNewContext(`${source.slice(slotStart, slotEnd)} selectChatModelSlot({ mode: 'balanced', model: settings.balancedModel });`, context);
    await window.RPHubApiClient.requestChatCompletion({ ...resolveChatModel(settings, context.currentModelMode.value, providers), messages: [], stream: false });
    assert.equal(calls.at(-1).url, 'https://deepseek.example/v1/chat/completions');
    assert.equal(calls.at(-1).key, 'Bearer fake-deepseek');
});

test('Android bundled resources match root web resources', () => {
    for (const file of ['index.html', 'assets/js/app.js', 'assets/js/api-utils.js', 'assets/js/ui-components.js']) {
        assert.equal(fs.readFileSync(path.join(root, file), 'utf8'),
            fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/www', file), 'utf8'), file);
    }
});
