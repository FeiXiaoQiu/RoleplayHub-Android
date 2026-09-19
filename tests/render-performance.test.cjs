const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');
const { test } = require('node:test');
const root = require('node:path').resolve(__dirname, '..');
const source = fs.readFileSync(`${root}/assets/js/app.js`, 'utf8');
const context = vm.createContext({ window: {}, console, Vue: {} });
for (const file of ['built-in-content.js', 'core-utils.js', 'data-services.js']) {
    vm.runInContext(fs.readFileSync(`${root}/assets/js/${file}`, 'utf8'), context);
}
const services = Object.values(context.window).find(value => value?.stripUiTemplateUpdateBlock);
let computations = 0;
context.stripUiTemplateUpdateBlock = text => { computations++; return services.stripUiTemplateUpdateBlock(text); };
context.cardUtils = context.window.RPHubCardUtils;
const start = source.indexOf('const computeMainContent =');
const end = source.indexOf('const switchProfile =', start);
vm.runInContext(source.slice(start, end) + '\nthis.cached = processMainContent; this.baseline = computeMainContent;', context);

test('cached output equals original for streaming prefixes and completion', () => {
    const texts = [
        '', 'hello', 'before image###unfinished', '<div><div>x</div></div>after',
        '```html\n<div>x</div>\n```after', '<script>let x = 1;</script>done',
        '<ui_template_updates>{"x":1}</ui_template_updates>正文', '<!-- <div> --> plain',
        '<div title="unfinished', '<!doctype html><html><body>body</body></html>'
    ];
    for (const text of texts) {
        for (let index = 0; index <= text.length; index++) {
            for (const state of [true, false]) {
                const prefix = text.slice(0, index);
                assert.deepEqual(context.cached(prefix, state), context.baseline(prefix, state));
                assert.deepEqual(context.cached(prefix, state), context.baseline(prefix, state));
            }
        }
    }
    assert.equal(context.cached('<div>', true).showSpinner, true);
    assert.equal(context.cached('<div>', false).showSpinner, false);
});

test('synthetic stream measures duplicate work and bounded cache', () => {
    const text = ('正文 **bold** <div>panel</div>\n'.repeat(2000));
    const inputs = Array.from({ length: 300 }, (_, i) => text.slice(0, Math.floor(text.length * (i + 1) / 300)));
    const run = fn => {
        computations = 0;
        const begin = performance.now();
        for (const input of inputs) for (let call = 0; call < 6; call++) fn(input, true);
        return { computations, ms: +(performance.now() - begin).toFixed(2) };
    };
    const before = run(context.baseline);
    const after = run(context.cached);
    assert.equal(before.computations, 1800);
    assert.equal(after.computations, 300);
    for (let i = 0; i < 200; i++) context.cached(`${i}${text}`, false);
    assert(vm.runInContext('mainContentCache.size <= 16 && mainContentCacheCharacters <= 262144', context));
    assert(vm.runInContext('latestStreamingContent.text.length', context) <= text.length);
    console.log(JSON.stringify({ workload: '300 growing prefixes, 6 calls each', before, after }));
});

test('default and auto-save still persist chat, with identical stored payload', async () => {
    const saveStart = source.indexOf('const saveData =');
    const saveEnd = source.indexOf('\n        };', saveStart) + '\n        };'.length;
    const writes = [];
    const history = [{ role: 'assistant', content: 'synthetic saved reply', showRaw: true }];
    const scope = {
        console, settings: {}, MAX_CONTEXT_SIZE: 1000000, _initComplete: true,
        getMainDb: () => ({}), normalizeActiveToolAggressivenessSettings() {},
        saveCharactersNow: async () => {}, normalizeActiveTools: () => [],
        setStoredValue: async (key, value) => writes.push([key, structuredClone(value)]),
        saveChatHistoryNow: async () => writes.push(['chat', structuredClone(history)]),
        saveMemorySettingsNow: async () => {}, saveClassicMemoriesNow: async () => {},
        currentCharacterIndex: { value: 0 }, userProfiles: { value: [] }, activeProfileId: { value: '' }
    };
    for (const key of ['presets', 'regexScripts', 'globalRegexScripts', 'worldInfo', 'globalWorldInfo', 'globalUiTemplates']) scope[key] = { value: [] };
    scope.worldInfoSettings = {}; scope.user = {};
    vm.runInNewContext(source.slice(saveStart, saveEnd) + '; this.save = saveData;', scope);
    await scope.save();
    const defaultWrites = structuredClone(writes);
    writes.length = 0;
    await scope.save({ saveMemories: false, saveCharacters: false });
    assert.deepEqual(writes, defaultWrites);
    assert.deepEqual(writes.find(([key]) => key === 'chat')[1], history);
    const api = fs.readFileSync(`${root}/assets/js/api-utils.js`, 'utf8');
    assert.match(api, /setInterval\(flush, 60\)/);
});
