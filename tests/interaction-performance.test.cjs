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
