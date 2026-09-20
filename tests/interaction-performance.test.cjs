const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');

test('character switch yields loading feedback and cancels stale work before storage', async () => {
    const start = source.indexOf('const selectCharacter = async');
    const end = source.indexOf('const handleAvatarUpload', start);
    let frame;
    const scope = {
        characters: { value: [{ uuid: 'a' }] }, currentCharacterIndex: { value: -1 },
        switchingCharacterIndex: { value: -1 }, document: { visibilityState: 'visible' },
        clearPendingChatImages() {}, clearPendingCardInteraction() {},
        requestAnimationFrame(callback) { frame = callback; }, setTimeout,
    };
    vm.createContext(scope);
    vm.runInContext('let _characterSwitchEpoch = 0;\n' + source.slice(start, end) + '\nthis.select = selectCharacter;', scope);
    const pending = scope.select(0);
    assert.equal(scope.switchingCharacterIndex.value, 0);
    assert.equal(typeof frame, 'function');
    vm.runInContext('_characterSwitchEpoch++', scope);
    frame();
    await pending;
    // No storage dependencies exist in this scope: stale work must exit first.
    assert.equal(scope.switchingCharacterIndex.value, 0);
});

test('affected Web resources match Android assets byte for byte', () => {
    for (const file of ['index.html', 'assets/css/styles.css', 'assets/js/ui-components.js', 'assets/js/app.js']) {
        assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(root, 'android-app/app/src/main/assets/www', file)), file);
    }
});

test('normal-motion CSS exactly restores the pre-rc16 visual rules', () => {
    const original = require('node:child_process').execFileSync('git', ['show', '3d66d58^:assets/css/styles.css'], { cwd: root }).toString();
    const current = fs.readFileSync(path.join(root, 'assets/css/styles.css'), 'utf8');
    const accessibility = /        @media \(prefers-reduced-motion: reduce\) \{\n            \.modal-shell,[\s\S]*?\n        \}\n\n/;
    assert.equal(current.replace(accessibility, ''), original);
});

test('deck cached counts track edits and small circular windows without pointer rescans', () => {
    const context = vm.createContext({ console });
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/vendor/vue.global.prod.js'), 'utf8'), context);
    const ui = fs.readFileSync(path.join(root, 'assets/js/ui-components.js'), 'utf8');
    const start = ui.indexOf('const leftCount = computed');
    const end = ui.indexOf('const move = direction', start);
    vm.runInContext(`
        const { ref, reactive, computed } = Vue;
        let calls = 0;
        const props = reactive({ items: [], worldInfoCount: char => { calls++; return char.worldInfo.length; }, regexCount: char => { calls++; return char.regexScripts.length; } });
        const focusedIndex = ref(0), dragOffset = ref(0);
        ${ui.slice(start, end)}
        this.api = { props, focusedIndex, dragOffset, visibleItems, calls: () => calls };
    `, context);
    const api = context.api;
    for (let count = 0; count <= 6; count++) {
        api.dragOffset.value = 0;
        api.props.items = Array.from({ length: count }, (_, i) => ({ originalIndex: i, char: { uuid: `${i}`, worldInfo: [], regexScripts: [] } }));
        for (const offset of [-0.8, -0.3, 0, 0.3, 0.8]) {
            api.dragOffset.value = offset;
            const items = api.visibleItems.value;
            assert.equal(items.length, Math.min(count, 5));
            assert.equal(new Set(items.map(item => item.char.uuid)).size, items.length);
            for (const item of items) assert.equal(item.position, item.offset + offset);
        }
    }
    const calls = api.calls();
    api.dragOffset.value = 0.9;
    assert.equal(api.visibleItems.value.length, 5);
    assert.equal(api.calls(), calls);
    api.props.items[0].char.worldInfo.push({ comment: 'new' });
    api.props.items[0].char.regexScripts.push({ name: 'new' });
    const focused = api.visibleItems.value.find(item => item.offset === 0);
    assert.equal(focused.worldInfoCount, 1);
    assert.equal(focused.regexCount, 1);
});
