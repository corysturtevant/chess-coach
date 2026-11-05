import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createProfileStore} from '../scripts/profiles.mjs';
const dir=await mkdtemp(join(tmpdir(),'chess-profiles-'));
try{
 let store=createProfileStore(dir);
 assert.deepEqual((await store.list()).map(p=>p.name),['Cory','Oliver']);
 const added=await store.create('Sam');assert.ok(added.id);
 await assert.rejects(store.create(' sam '),e=>e.status===409);
 const state={mode:'play',solved:['back-rank'],play:{gameId:'game-1',ply:2,pgn:'1. e4 e5',player:'w',status:'In progress',logItems:[{san:'Game review',text:'Develop your pieces.'}]}};
 await store.put('cory',0,state);
 assert.equal((await store.get('oliver')).state,null);
 await assert.rejects(store.put('cory',0,{...state,solved:[]}),e=>e.status===409);
 assert.deepEqual((await store.get('cory')).state.solved,['back-rank']);
 store=createProfileStore(dir);assert.equal((await store.get('cory')).revision,1);
 const shared={...state,mode:'together',together:{options:{white:'Cory',black:'Oliver',whiteId:'cory',blackId:'oliver'},game:{gameId:'shared-1',ply:2,pgn:'1. d4 d5',status:'In progress'}}};
 await store.put('cory',1,shared);
 const history=(await store.get('oliver')).history;assert.equal(history.length,1);
 assert.equal((await store.game('oliver',history[0].id)).white,'Cory');
 await assert.rejects(store.game(added.id,history[0].id),e=>e.status===404);
 const solo=(await store.get('cory')).history.find(g=>g.mode==='play');assert.equal((await store.game('cory',solo.id)).snapshot.logItems[0].text,'Develop your pieces.');
 const results=await Promise.allSettled([store.put('cory',2,state),store.put('cory',2,state)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 console.log('Profile storage: persistence, seeds, duplicate names, isolation, shared history, reviews, and concurrent saves passed.');
}finally{await rm(dir,{recursive:true,force:true})}
