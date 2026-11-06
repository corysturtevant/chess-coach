import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'chess-profile-ui-')),url='http://127.0.0.1:14176';
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:'14176',LLM_API_KEY:'',MAIA_API_URL:''},stdio:'ignore'});
let browser;
try{
 for(let i=0;i<50;i++){try{if((await fetch(url+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER||'chrome'});
 const a=await browser.newPage({viewport:{width:393,height:852}}),b=await browser.newPage();
 const errors=[];a.on('pageerror',e=>errors.push(e.message));b.on('pageerror',e=>errors.push(e.message));
 for(const page of [a,b])await page.route('**/api/analyze',route=>route.fulfill({json:{assessment:'good',lossCp:0,bestStudentMove:'e2e4'}}));
 async function choose(page,name){await page.locator('#profileBtn').click();await page.locator('#profileList button').filter({hasText:new RegExp('^'+name+'(?: ✓)?$')}).click();await page.waitForFunction(()=>!document.querySelector('#profileDialog').open)}
 await a.goto(url);await choose(a,'Cory');await a.locator('#tabTogether').click();
 assert.equal(await a.locator('#whiteName').isVisible(),false);assert.equal(await a.locator('#blackName').isVisible(),false);
 await a.locator('#whiteProfile').selectOption('');await a.locator('#whiteName').fill('Guest friend');
 await a.locator('#swapNames').click();assert.equal(await a.locator('#blackName').inputValue(),'Guest friend');assert.equal(await a.locator('#blackName').isVisible(),true);assert.equal(await a.locator('#whiteName').isVisible(),false);
 await a.locator('#swapNames').click();await a.locator('#whiteProfile').selectOption('cory');assert.equal(await a.locator('#whiteName').isVisible(),false);
 await a.screenshot({path:'/tmp/chess-player-setup.png',animations:'disabled'});
 await a.locator('#togetherForm button[type=submit]').click();
 await a.locator('.sq[data-sq=e2]').click();await a.locator('.sq[data-sq=e4]').click();await a.waitForFunction(()=>!document.querySelector('#undoBtn').disabled);
 await a.waitForFunction(()=>document.querySelector('#profileSync').textContent==='Saved across devices');
 await b.goto(url);await choose(b,'Cory');assert.match(await b.locator('#sheet').innerText(),/e4/);
 await choose(b,'Oliver');assert.match(await b.locator('#sheet').innerText(),/No moves/);
 await b.locator('#profileBtn').click();await b.locator('#profileHistory button').first().waitFor();assert.match(await b.locator('#profileHistory').innerText(),/Cory vs Oliver/);
 await b.locator('#profileHistory button').click();await b.locator('#historyDialog').waitFor({state:'visible'});assert.match(await b.locator('#historyPgn').innerText(),/e4/);await b.locator('#closeHistory').click();
 await b.locator('#newProfileName').fill('Sam');await b.locator('#addProfileForm button').click();await b.locator('#profileList button').filter({hasText:'Sam'}).waitFor();await b.locator('#closeProfiles').click();
 const remote=await(await fetch(url+'/api/profiles/cory')).json();await fetch(url+'/api/profiles/cory',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({revision:remote.revision,state:remote.state})});
 await a.locator('.sq[data-sq=e7]').click();await a.locator('.sq[data-sq=e5]').click();
 await a.waitForFunction(()=>document.querySelector('#profileBanner').textContent.includes('Changed on another device'));
 await a.locator('#profileBtn').click();await a.locator('#reloadProfile').click();await a.waitForFunction(()=>document.querySelector('#profileSync').textContent.startsWith('Latest saved game loaded'));assert.doesNotMatch(await a.locator('#sheet').innerText(),/e5/);await a.locator('#closeProfiles').click();
 await a.reload();await a.waitForFunction(()=>document.querySelector('#profileBtn').textContent.includes('Cory'));assert.match(await a.locator('#sheet').innerText(),/e4/);
 assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await a.locator('#profileBtn').click();await a.locator('#profileHistory button').first().waitFor();await a.screenshot({path:'/tmp/chess-profiles-phone.png',animations:'disabled'});await a.locator('#closeProfiles').click();
 await a.route('**/api/profiles**',route=>route.abort());
 await a.locator('.sq[data-sq=e7]').click();await a.locator('.sq[data-sq=e5]').click();
 await a.waitForFunction(()=>document.querySelector('#profileBanner').textContent.includes('Offline'));
 await a.reload();await a.waitForFunction(()=>document.querySelector('#profileBtn').textContent.includes('Cory'));assert.match(await a.locator('#sheet').innerText(),/e5/);
 await a.unroute('**/api/profiles**');await a.evaluate(()=>window.dispatchEvent(new Event('online')));
 await a.waitForFunction(()=>document.querySelector('#profileSync').textContent==='Saved across devices');
 assert.deepEqual(errors,[]);
 console.log('Profile UI: separate devices, player switching, shared history, add player, conflict recovery, reload and phone layout passed.');
}finally{await browser?.close();server.kill();if(server.exitCode===null)await once(server,'exit');await rm(dir,{recursive:true,force:true})}
