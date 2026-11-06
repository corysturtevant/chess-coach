import {chromium} from '@playwright/test';
import {Chess} from 'chess.js';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'chess-replay-')),url='http://127.0.0.1:14178';
const server=spawn(process.execPath,['scripts/serve.mjs'],{env:{...process.env,PORT:'14178',DATA_DIR:dir,LLM_API_KEY:'',MAIA_API_URL:''},stdio:'ignore'});
let browser;
try{
 for(let i=0;i<50;i++){try{if((await fetch(url+'/api/health')).ok)break}catch{}await new Promise(r=>setTimeout(r,100))}
 browser=await chromium.launch({channel:process.env.PLAYWRIGHT_BROWSER||'chrome'});
 const page=await browser.newPage({viewport:{width:393,height:852}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const fixtures=[
  {moves:['e4','e5','Nf3','Nc6','Bc4','Nf6','O-O','Be7'],ply:7,squares:{g1:'white king',f1:'white rook',e1:''}},
  {moves:['e4','a6','e5','d5','exd6','cxd6'],ply:5,squares:{d6:'white pawn',d5:''}},
  {fen:'7k/P7/8/8/8/8/8/7K w - - 0 1',moves:['a8=Q+','Kh7'],ply:1,squares:{a8:'white queen',a7:''}}
 ];
 for(const fixture of fixtures){
  const g=new Chess(fixture.fen);for(const move of fixture.moves)assert.ok(g.move(move));
  await page.goto(url);await page.evaluate(state=>{localStorage.clear();localStorage.setItem('chesscoach.v1',JSON.stringify(state))},{pgn:g.pgn(),gameId:'replay-test',player:'w',level:'beginner'});await page.reload();
  await page.locator('#sheet button').last().waitFor();
  const saved=await page.evaluate(()=>localStorage.getItem('chesscoach.v1'));
  await page.locator('#sheet button[data-ply="'+fixture.ply+'"]').click();
  assert.match(await page.locator('#statusText').innerText(),/Viewing/);
  for(const [square,piece]of Object.entries(fixture.squares))assert.equal(await page.locator('.sq[data-sq='+square+']').getAttribute('aria-label'),square+(piece?' '+piece:''));
  assert.equal(await page.locator('#undoBtn').isDisabled(),true);assert.equal(await page.locator('#hintBtn').isDisabled(),true);
  await page.locator('.sq[data-sq=h1]').click();assert.equal(await page.locator('.sq.sel').count(),0);
  assert.equal(await page.evaluate(()=>localStorage.getItem('chesscoach.v1')),saved);
  if(fixture.ply===7)await page.screenshot({path:'/tmp/chess-replay-phone.png'});
  await page.locator('#returnLiveBtn').click();assert.equal(await page.locator('#returnLiveBtn').isVisible(),false);
  for(const square of Object.keys(fixture.squares)){const piece=g.get(square),label=square+(piece?' '+(piece.color==='w'?'white ':'black ')+({k:'king',q:'queen',r:'rook',b:'bishop',n:'knight',p:'pawn'})[piece.type]:'');assert.equal(await page.locator('.sq[data-sq='+square+']').getAttribute('aria-label'),label)}
  const last=fixture.moves.length;await page.locator('#sheet button[data-ply="'+last+'"]').click();await page.locator('#returnLiveBtn').click();
  assert.equal(await page.evaluate(()=>localStorage.getItem('chesscoach.v1')),saved);
 }
 assert.deepEqual(errors,[]);console.log('Move replay: castling, en passant, promotion, read-only board, live return, and unchanged saved game passed.');
}finally{await browser?.close();server.kill();if(server.exitCode===null)await once(server,'exit');await rm(dir,{recursive:true,force:true})}
