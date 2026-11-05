import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function createProfileStore(directory) {
  const file = resolve(directory, 'profiles.json');
  let queue = Promise.resolve();
  const initial = () => ({ version: 1, profiles: ['Cory','Oliver'].map(name => ({ id: name.toLowerCase(), name, revision: 0, state: null })), games: {} });
  async function read() {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; return initial(); }
  }
  function transaction(fn) {
    const work = queue.then(async () => {
      const db = await read();
      const result = await fn(db);
      await mkdir(directory, { recursive: true });
      const temp = file + '.tmp';
      await writeFile(temp, JSON.stringify(db), { mode: 0o600 });
      await rename(temp, file);
      return result;
    });
    queue = work.catch(() => {});
    return work;
  }
  const error = (status, message) => Object.assign(new Error(message), { status });
  const profile = (db,id) => { const p=db.profiles.find(p=>p.id===id);if(!p)throw error(404,'Profile not found');return p; };
  const summary = p => ({ id:p.id,name:p.name,revision:p.revision });
  return {
    list: () => transaction(db => db.profiles.map(summary)),
    create: name => transaction(db => {
      if(typeof name!=='string'||!name.trim()||name.trim().length>24)throw error(422,'Use a name between 1 and 24 characters.');
      name=name.trim();if(db.profiles.some(p=>p.name.toLowerCase()===name.toLowerCase()))throw error(409,'That player already exists.');
      const p={id:randomUUID(),name,revision:0,state:null};db.profiles.push(p);return summary(p);
    }),
    get: id => transaction(db => { const p=profile(db,id);return {...p,history:Object.values(db.games).filter(g=>g.profileIds.includes(id)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(g=>({id:g.id,mode:g.mode,updatedAt:g.updatedAt,status:g.snapshot.status||'In progress',white:g.white,black:g.black}))}; }),
    game: (id,gameId) => transaction(db => {profile(db,id);const g=db.games[gameId];if(!g||!g.profileIds.includes(id))throw error(404,'Game not found');return g;}),
    put: (id,revision,state) => transaction(db => {
      const p=profile(db,id);
      if(revision!==p.revision)throw error(409,'This profile changed on another device. Reload its latest game before continuing.');
      if(!state||typeof state!=='object'||Array.isArray(state)||!['play','together','lesson'].includes(state.mode)||!Array.isArray(state.solved))throw error(422,'Invalid profile state');
      for(const [mode,snapshot] of [['play',state.play],['together',state.together?.game]]){
        if(!snapshot)continue;
        if(mode==='together'&&(!state.together.options||typeof state.together.options.white!=='string'||typeof state.together.options.black!=='string'))throw error(422,'Invalid player names');
        if(typeof snapshot.pgn!=='string'||snapshot.pgn.length>40000||typeof snapshot.gameId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(snapshot.gameId))throw error(422,'Invalid saved game');
        if(!snapshot.ply)continue;
        const ids=mode==='together'?[id,state.together.options?.whiteId,state.together.options?.blackId]:[id];
        const profileIds=[...new Set(ids.filter(value=>db.profiles.some(p=>p.id===value)))];
        const key=id+':'+snapshot.gameId;
        db.games[key]={id:key,mode,profileIds,snapshot,white:mode==='together'?state.together.options.white:(snapshot.player==='w'?p.name:'Coach'),black:mode==='together'?state.together.options.black:(snapshot.player==='b'?p.name:'Coach'),updatedAt:new Date().toISOString()};
      }
      p.state=state;p.revision++;return {revision:p.revision};
    })
  };
}
