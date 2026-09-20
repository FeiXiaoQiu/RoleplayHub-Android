const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/usr/local/lib/node_modules/playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const baseline = process.argv.includes('--baseline');
(async () => {
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
        for (const width of [390, 1280]) {
            const context = await browser.newContext({ viewport: { width, height: 844 } });
            await context.route('**/*', route => {
                const url = new URL(route.request().url());
                if (url.origin !== 'http://127.0.0.1:8080') return route.abort();
                const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
                if (!['index.html', 'assets/js/app.js', 'assets/js/ui-components.js', 'assets/css/styles.css'].includes(file)) return route.continue();
                // Both runs use the original visual treatment, isolating script work.
                let body = file.endsWith('.css') || baseline
                    ? execFileSync('git', ['show', `${file.endsWith('.css') ? '3d66d58^' : '3d66d58'}:${file}`], { cwd: '/workspace' }).toString()
                    : fs.readFileSync(`/workspace/${file}`, 'utf8');
                if (file.endsWith('/app.js')) body = body.replace(/(const getCharacter(?:WI|Regex)Count = \(char\) => \{)/g, '$1 window.qaCounts++;');
                return route.fulfill({ body, contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : 'text/html' });
            });
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto('http://127.0.0.1:8080');
            await page.getByPlaceholder('角色对您的称呼').fill('Offline QA');
            await page.getByRole('button', { name: '保存并开始' }).click();
            const result = await page.evaluate(async () => {
                const root = document.querySelector('#app')._vnode.component;
                const app = root.proxy;
                const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
                const settle = async () => { await Vue.nextTick(); await pause(800); };
                const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
                const entries = Array.from({ length: 300 }, (_, i) => ({ comment: `Entry ${i}`, name: `Script ${i}`, content: 'Offline data' }));
                app.characters = Array.from({ length: 200 }, (_, i) => ({ uuid: `offline-${i}`, name: `Synthetic ${i}`, description: 'test', createdAt: i, worldInfo: structuredClone(entries), regexScripts: structuredClone(entries) }));
                app.currentView = 'characters'; await settle();
                let rootRenders = 0, renderMs = 0;
                const render = root.render;
                root.render = function (...args) { const t = performance.now(); rootRenders++; try { return render.apply(this, args); } finally { renderMs += performance.now() - t; } };
                const rows = [];
                for (let round = 0; round < 5; round++) {
                    rootRenders = 0; renderMs = 0; window.qaCounts = 0;
                    const start = performance.now();
                    app.toggleNavigation(); await Vue.nextTick();
                    const open = { ms: performance.now() - start, rootRenders, renderMs, counts: window.qaCounts };
                    await pause(450);
                    rootRenders = 0; renderMs = 0;
                    const enterStart = performance.now();
                    [...document.querySelectorAll('.app-navigation-item')].find(el => el.textContent.trim() === '设置').click();
                    await Vue.nextTick();
                    const enter = { ms: performance.now() - enterStart, rootRenders, renderMs, nodes: document.querySelector('.app-main').querySelectorAll('*').length };
                    await settle(); app.currentView = 'characters'; await settle();
                    rootRenders = 0; window.qaCounts = 0;
                    const stage = document.querySelector('.character-deck__stage');
                    const card = stage.querySelector('.is-focused');
                    const before = card.textContent;
                    const b = card.getBoundingClientRect();
                    const x = b.x + b.width / 2, y = b.y + b.height / 2;
                    // Real pointer moves are also covered below; synthetic events make the workload deterministic.
                    stage.setPointerCapture = () => {}; stage.hasPointerCapture = () => false;
                    const send = (type, dx) => stage.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, pointerType: 'touch', clientX: x + dx, clientY: y, bubbles: true, cancelable: true }));
                    const samples = [];
                    for (const direction of [-1, 1]) {
                        send('pointerdown', 0);
                        for (let i = 1; i <= 24; i++) { await frame(); const t = performance.now(); send('pointermove', direction * i * 4); await Vue.nextTick(); samples.push(performance.now() - t); }
                        send('pointerup', direction * 96); await settle();
                    }
                    if (stage.querySelector('.is-focused').textContent !== before) throw Error('round-trip focus mismatch');
                    rows.push({ open, enter, drag: { counts: window.qaCounts, rootRenders, ms: samples.reduce((a,b)=>a+b,0), max: Math.max(...samples) } });
                }
                return rows;
            });
            // Exercise native mouse capture, final focus, click target, and back handling.
            await page.evaluate(() => {
                const stage = document.querySelector('.character-deck__stage');
                delete stage.setPointerCapture; delete stage.hasPointerCapture;
            });
            const focusedName = () => page.locator('.character-deck__item.is-focused').innerText();
            const original = await focusedName();
            for (const direction of [-1, 1]) {
                const box = await page.locator('.character-deck__item.is-focused').boundingBox();
                const x = box.x + box.width / 2, y = box.y + box.height / 3;
                await page.mouse.move(x, y); await page.mouse.down();
                await page.mouse.move(x + direction * 100, y, { steps: 24 }); await page.mouse.up();
                await page.waitForTimeout(800);
                if (direction === -1) assert.notEqual(await focusedName(), original);
            }
            assert.equal(await focusedName(), original);
            await page.getByRole('button', { name: '下一个角色', exact: true }).click();
            await page.waitForTimeout(800);
            const expected = await page.locator('.character-deck__item.is-focused').innerText();
            await page.locator('.character-deck__enter').click();
            await page.waitForFunction(() => document.querySelector('#app')._vnode.component.proxy.currentView === 'chat');
            const selected = await page.evaluate(() => document.querySelector('#app')._vnode.component.proxy.currentCharacter.name);
            assert(expected.includes(selected));
            await page.getByRole('button', { name: '打开导航', exact: true }).click();
            await page.waitForTimeout(450);
            assert(await page.locator('.app-main').evaluate(el => el.inert));
            assert(await page.evaluate(() => window.RPHubBack()));
            await page.waitForTimeout(450);
            assert.equal(await page.locator('.app-main').evaluate(el => el.inert), false);
            assert(await page.evaluate(() => document.activeElement.classList.contains('app-nav-trigger')));
            for (const label of ['角色卡管理', '设置', '预设', '世界书', '正则', '工具', '记忆系统', 'UI模板', '用量统计']) {
                await page.getByRole('button', { name: '打开导航', exact: true }).click();
                await page.waitForTimeout(450);
                const item = page.locator('.app-navigation-item').filter({ hasText: label });
                await item.click();
                await page.waitForTimeout(450);
                assert.equal(await page.locator('.app-navigation-panel').count(), 0);
                assert.equal(await page.locator('.app-main').evaluate(el => el.inert), false);
            }
            assert.deepEqual(errors, []);
            if (!baseline) for (const row of result) { assert.equal(row.open.rootRenders, 0); assert.equal(row.drag.rootRenders, 0); assert(row.drag.counts <= 30); }
            console.log(JSON.stringify({ baseline, width, rows: result }));
            await context.close();
        }
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
