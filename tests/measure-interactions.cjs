const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/usr/local/lib/node_modules/playwright');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({args:['--no-sandbox']});
 try {
  for (const width of [390, 1280]) for (const reducedMotion of ['no-preference', 'reduce']) {
   const context = await browser.newContext({viewport:{width,height:844},reducedMotion});
   await context.route('**/*', r => {
    const url = new URL(r.request().url());
    if(url.origin !== 'http://127.0.0.1:8080') return r.abort();
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if(process.argv.includes('--baseline') && ['index.html','assets/js/app.js','assets/js/ui-components.js','assets/css/styles.css'].includes(file)) {
     return r.fulfill({body:require('node:child_process').execFileSync('git',['show',`HEAD:${file}`],{cwd:'/workspace'}),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html'});
    }
    return r.continue();
   });
   const page = await context.newPage();
   await page.goto('http://127.0.0.1:8080');
   await page.getByPlaceholder('角色对您的称呼').fill('Offline QA');
   await page.getByRole('button',{name:'保存并开始'}).click();
   const result = await page.evaluate(async () => {
    const app = document.querySelector('#app')._vnode.component.proxy;
    const tick = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    app.characters = Array.from({length:200},(_,i)=>({uuid:'offline-'+i,name:'Synthetic '+i,description:'test',createdAt:i,worldInfo:[],regexScripts:[]}));
    app.currentView='characters'; await Vue.nextTick(); await tick();
    const card = document.querySelector('.character-deck__item');
    const deck = card ? {filter:getComputedStyle(card).filter,transition:getComputedStyle(card).transitionProperty} : null;
    app.characterGridView=true; await Vue.nextTick();
    const hiddenDecks=document.querySelectorAll('.character-deck').length;
    const times=[];
    for(let i=0;i<5;i++) {
     const start=performance.now(); app.isNavigationOpen=true; await Vue.nextTick(); await tick();
     times.push(performance.now()-start);
     app.isNavigationOpen=false; await new Promise(r=>setTimeout(r,450));
    }
    app.isNavigationOpen=true; await Vue.nextTick(); await tick();
    const nav=getComputedStyle(document.querySelector('.app-navigation-panel'));
    const blur=nav.backdropFilter;
    app.isNavigationOpen=false;
    const closeStart=performance.now();
    while(document.querySelector('.app-navigation-panel')) await tick();
    const closeMs=performance.now()-closeStart;
    app.showUserSetupModal=true; await Vue.nextTick();
    const modal=document.querySelector('.modal-shell');
    const modalStyle=modal ? {animation:getComputedStyle(modal).animationDuration,transition:getComputedStyle(modal.firstElementChild).transitionProperty}:null;
    const back=window.RPHubBack();
    const switchStart=performance.now();
    const switched=await app.selectCharacter(1);
    const switchMs=performance.now()-switchStart;
    if (!switched || app.currentCharacterIndex!==1) throw Error('character selection failed');
    await app.selectCharacter(2);
    if (app.currentCharacterIndex!==2) throw Error('second character selection failed');
    return {deck,hiddenDecks,blur,navTwoFramesMs:times.map(x=>+x.toFixed(1)),closeMs:+closeMs.toFixed(1),modalStyle,back,switchMs:+switchMs.toFixed(1)};
   });
   assert.equal(result.back,true);
   if(process.argv.includes('--verify')) {
    assert.equal(result.hiddenDecks,0);
     assert(result.blur.includes(width===390 ? '16px' : '24px'));
     assert(result.deck.filter.includes('blur'));
     assert(result.deck.transition.includes('filter'));
    if(reducedMotion==='reduce') assert(result.closeMs<150);
   }
   console.log(JSON.stringify({width,reducedMotion,...result}));
   await context.close();
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
