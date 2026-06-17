const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));

const MAX_PLAYERS = 8;
const TOTAL_TEAMS = 20; // campeonato continua com 20 times; sala aceita até 8 jogadores humanos
const PICK_ROUNDS = 11;
const BOT_PICK_DELAY_MS = 2000;
const rooms = new Map();


function loadRealCardPool(){
  try{
    const html = fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
    const m = html.match(/const\s+originalCards\s*=\s*(\[[\s\S]*?\]);/);
    if(!m) throw new Error('originalCards não encontrado');
    const cards = JSON.parse(m[1]);
    return cards
      .filter(c => c && c.name && c.pos && Number.isFinite(Number(c.year)))
      .map(c => ({
        id: String(c.id || ''),
        fam: c.fam || '',
        name: c.name,
        pos: c.pos,
        year: Number(c.year),
        club: c.club || 'Histórico',
        ovr: Number(c.ovr || 80),
        category: c.category || 'Histórico',
        era: c.era || ''
      }));
  }catch(err){
    console.warn('Aviso: usando base multiplayer reduzida. Falha ao carregar originalCards:', err.message);
    return [];
  }
}
const realCardPool = loadRealCardPool();

const playerPool = [
 {name:'Pelé',pos:'ATA',base:98},{name:'Messi',pos:'PD',base:98},{name:'Diego Maradona',pos:'MAT',base:98},{name:'Cristiano Ronaldo',pos:'PE',base:97},{name:'Ronaldo',pos:'ATA',base:98},{name:'Ronaldinho',pos:'MAT',base:96},{name:'Zinedine Zidane',pos:'MAT',base:96},{name:'Johan Cruyff',pos:'SA',base:96},{name:'Neymar',pos:'PE',base:94},{name:'Kylian Mbappé',pos:'ATA',base:93},{name:'Thierry Henry',pos:'ATA',base:94},{name:'Romário',pos:'ATA',base:95},{name:'Marco van Basten',pos:'ATA',base:95},{name:'Roberto Baggio',pos:'SA',base:94},{name:'Francesco Totti',pos:'SA',base:93},{name:'Alessandro Del Piero',pos:'SA',base:93},{name:'Andrés Iniesta',pos:'MC',base:95},{name:'Xavi',pos:'MC',base:95},{name:'Luka Modric',pos:'MC',base:94},{name:'Kaká',pos:'MAT',base:94},{name:'Ruud Gullit',pos:'MC',base:94},{name:'Lothar Matthäus',pos:'VOL',base:94},{name:'Frank Rijkaard',pos:'VOL',base:93},{name:'Sergio Busquets',pos:'VOL',base:92},{name:'Andrea Pirlo',pos:'MC',base:93},{name:'Paolo Maldini',pos:'ZAG',base:96},{name:'Roberto Carlos',pos:'LE',base:94},{name:'Cafu',pos:'LD',base:94},{name:'Franz Beckenbauer',pos:'ZAG',base:96},{name:'Franco Baresi',pos:'ZAG',base:95},{name:'Alessandro Nesta',pos:'ZAG',base:94},{name:'Fabio Cannavaro',pos:'ZAG',base:94},{name:'Sergio Ramos',pos:'ZAG',base:93},{name:'Virgil van Dijk',pos:'ZAG',base:93},{name:'Manuel Neuer',pos:'GK',base:94},{name:'Gianluigi Buffon',pos:'GK',base:95},{name:'Iker Casillas',pos:'GK',base:94},{name:'Lev Yashin',pos:'GK',base:96},{name:'Erling Haaland',pos:'ATA',base:93},{name:'Karim Benzema',pos:'ATA',base:92},{name:'Robert Lewandowski',pos:'ATA',base:94},{name:'Luis Suárez',pos:'ATA',base:94},{name:'Mohamed Salah',pos:'PD',base:93},{name:'Garrincha',pos:'PD',base:95},{name:'George Best',pos:'PE',base:94},{name:'Rivaldo',pos:'MAT',base:94},{name:'Luís Figo',pos:'PD',base:94},{name:'Michel Platini',pos:'MAT',base:95},{name:'Zico',pos:'MAT',base:95},{name:'Sócrates',pos:'MC',base:92},{name:'Juan Román Riquelme',pos:'MAT',base:92},{name:'Clarence Seedorf',pos:'MC',base:91},{name:'Patrick Vieira',pos:'VOL',base:92},{name:'Claude Makelele',pos:'VOL',base:91},{name:'N’Golo Kanté',pos:'VOL',base:91},{name:'Edgar Davids',pos:'VOL',base:91},{name:'Javier Zanetti',pos:'LD',base:92},{name:'Philipp Lahm',pos:'LD',base:92},{name:'Marcelo',pos:'LE',base:91},{name:'Dani Alves',pos:'LD',base:92}
];
const formations = ['4-3-3','4-2-3-1','4-4-2','3-5-2','4-3-1-2'];
function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function code8(){ let c; do { c=String(rnd(10000000,99999999)); } while(rooms.has(c)); return c; }
function cloneRealCard(base, i){
 return { ...base, id:'MP'+Date.now()+'_'+i+'_'+Math.random().toString(16).slice(2), sourceId:base.id };
}
function makeCard(i){
 if(realCardPool.length){
   const base = realCardPool[rnd(0, realCardPool.length-1)];
   return cloneRealCard(base, i);
 }
 const p = playerPool[rnd(0,playerPool.length-1)];
 const realisticYears = {
  'Pelé':[1958,1962,1965,1970,1973], 'Messi':[2009,2011,2012,2015,2022], 'Diego Maradona':[1981,1983,1986,1987,1990],
  'Cristiano Ronaldo':[2008,2012,2014,2017,2021], 'Ronaldo':[1996,1997,1998,2002,2004], 'Ronaldinho':[2001,2003,2005,2006,2007],
  'Luis Suárez':[2014,2015,2016,2017,2018,2019,2020], 'Robert Lewandowski':[2014,2015,2016,2017,2019,2020,2021,2022],
  'Erling Haaland':[2022,2023,2024], 'Luís Figo':[1997,2000,2001,2002,2004], 'Zico':[1976,1979,1981,1982,1983]
 };
 const ys = realisticYears[p.name] || [1998,2002,2006,2010,2014,2018,2022];
 const year = ys[rnd(0,ys.length-1)];
 const ovr = Math.max(76, Math.min(99, p.base + rnd(-4,2)));
 return { id:'MP'+Date.now()+i+Math.random().toString(16).slice(2), name:p.name, pos:p.pos, year, club:'Histórico', ovr };
}
function makeOptions(n=10){
 if(realCardPool.length){
   const used = new Set();
   const out = [];
   while(out.length<n && used.size<realCardPool.length){
     const idx = rnd(0, realCardPool.length-1);
     if(used.has(idx)) continue;
     used.add(idx);
     out.push(cloneRealCard(realCardPool[idx], out.length));
   }
   return out;
 }
 return Array.from({length:n},(_,i)=>makeCard(i));
}
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
function posSector(pos){ if(pos==='GK') return 'GK'; if(['ZAG','LD','LE','ALA'].includes(pos)) return 'DEF'; if(['VOL','MC','MAT'].includes(pos)) return 'MID'; return 'ATT'; }
function countPositions(players){ return players.reduce((acc,p)=>{ const k=p.assignedPos||p.pos; acc[k]=(acc[k]||0)+1; return acc; },{}); }
function openSlots(team){ const need=['GK','LD','ZAG','ZAG','LE','VOL','MC','MC','PE','ATA','PD']; const used=countPositions(team.players); return need.filter(pos=>{ used[pos]=used[pos]||0; const total=need.filter(x=>x===pos).length; return used[pos]++ < total; }); }
function pickPosition(team, card){ const slots=openSlots(team); if(slots.includes(card.pos)) return card.pos; const sameSector=slots.find(p=>posSector(p)===posSector(card.pos)); return sameSector || slots[0] || card.pos; }
function validAssignedPos(team, card, assignedPos){ const slots=openSlots(team); if(!assignedPos) return null; if(!slots.includes(assignedPos)) return null; if(assignedPos===card.pos || posSector(assignedPos)===posSector(card.pos)) return assignedPos; return null; }
function publicRoom(room){ return { code:room.code, hostId:room.hostId, phase:room.phase, maxPlayers:MAX_PLAYERS, players:room.players.map(p=>({id:p.id,club:p.club,ready:p.ready})), teams: room.teams?.map(t=>({id:t.id,club:t.club,human:t.human,players:t.players?.length||0})) || [] }; }
function emitRoom(room){ io.to(room.code).emit('mp:roomState', publicRoom(room)); }
function fillBots(room){ let n=1; room.teams = room.players.map(p=>({ id:p.id, club:p.club, human:true, socketId:p.id, formation:'4-3-3', players:[], stats:{P:0,V:0,E:0,D:0,GP:0,GC:0,PTS:0} })); while(room.teams.length<TOTAL_TEAMS){ room.teams.push({ id:'BOT'+n, club:'Bot '+n, human:false, formation:formations[rnd(0,formations.length-1)], players:[], stats:{P:0,V:0,E:0,D:0,GP:0,GC:0,PTS:0} }); n++; }
}
function buildDraftOrder(room){
 const base=shuffle([...room.teams.keys()]);
 const order=[];
 for(let r=0;r<PICK_ROUNDS;r++){ order.push(...(r%2===0 ? base : [...base].reverse())); }
 room.draft={ order, baseOrder:base, index:0, options:[], pickLog:[] };
}
function advanceDraft(room){ if(!room.draft) return;
 if(room.draft.index >= room.draft.order.length){ room.phase='readyRound'; emitRoom(room); io.to(room.code).emit('mp:draftDone', { teams:room.teams.map(t=>({id:t.id,club:t.club,human:t.human,players:t.players})) }); startRound(room); return; }
 const teamIdx = room.draft.order[room.draft.index];
 const team = room.teams[teamIdx];
 room.draft.options = makeOptions(10);
 io.to(room.code).emit('mp:draftState', { index:room.draft.index, total:room.draft.order.length, teamId:team.id, club:team.club, human:team.human, botDelayMs: team.human ? 0 : BOT_PICK_DELAY_MS, options: team.human ? room.draft.options : [], order:room.draft.baseOrder.map(i=>({id:room.teams[i].id,club:room.teams[i].club,human:room.teams[i].human})), pickLog:room.draft.pickLog.slice(-80), teams:room.teams.map(t=>({id:t.id,club:t.club,count:t.players.length,human:t.human,players:t.players})) });
 if(!team.human){ setTimeout(()=>{ const pick=room.draft.options[rnd(0,room.draft.options.length-1)]; applyPick(room, team.id, pick.id); }, BOT_PICK_DELAY_MS); }
}
function applyPick(room, teamId, cardId, assignedPos){ const d=room.draft; if(!d) return false; const teamIdx=d.order[d.index]; const team=room.teams[teamIdx]; if(!team || team.id!==teamId) return false; if(team.human && !room.players.some(p=>p.id===teamId && !p.disconnected)) return false; const card=d.options.find(c=>c.id===cardId) || d.options[0]; if(!card) return false; card.assignedPos=validAssignedPos(team, card, assignedPos) || pickPosition(team, card); team.players.push(card); const log={club:team.club, teamId:team.id, card:{name:card.name,pos:card.pos,year:card.year,ovr:card.ovr,assignedPos:card.assignedPos}, pick:d.index+1, round:Math.floor(d.index/TOTAL_TEAMS)+1}; d.pickLog.push(log); io.to(room.code).emit('mp:pickMade',{ teamId:team.id, club:team.club, card, log, pickLog:d.pickLog.slice(-80), teams:room.teams.map(t=>({id:t.id,club:t.club,count:t.players.length,human:t.human,players:t.players})), nextIndex:d.index+1, total:d.order.length }); d.index++; advanceDraft(room); return true; }
function startRound(room){ room.phase='match'; room.round=(room.round||0)+1; const shuffled=[...room.teams].sort(()=>Math.random()-.5); room.matches=[]; for(let i=0;i<shuffled.length;i+=2){ room.matches.push({ id:`R${room.round}M${i/2+1}`, home:shuffled[i], away:shuffled[i+1], minute:0, h:0, a:0, events:[], finished:false }); }
 room.players.forEach(p=>{ const match=room.matches.find(m=>m.home.id===p.id || m.away.id===p.id); if(match){ const s=io.sockets.sockets.get(p.id); if(s) s.join(room.code+':'+match.id); io.to(p.id).emit('mp:yourMatch',{ round:room.round, match:lightMatch(match) }); }});
 emitRoom(room);
 const start=Date.now(); const duration=40000;
 room.timer=setInterval(()=>{ const minute=Math.min(90, Math.floor((Date.now()-start)/duration*90)); room.matches.forEach(m=>{ if(m.finished) return; m.minute=minute; if(Math.random()<0.055){ const side=Math.random()<0.5?'home':'away'; const team=side==='home'?m.home:m.away; const scorer=(team.players[rnd(0,Math.max(0,team.players.length-1))]||{name:'Jogador'}).name; if(side==='home') m.h++; else m.a++; const ev={minute, type:'goal', side, scorer, club:team.club, score:`${m.h} x ${m.a}`}; m.events.push(ev); io.to(room.code+':'+m.id).emit('mp:matchEvent',{ matchId:m.id, event:ev, match:lightMatch(m) }); }
 });
 io.to(room.code).emit('mp:roundClock',{ round:room.round, minute });
 if(minute>=90){ clearInterval(room.timer); finishRound(room); }
 }, 1000);
}
function lightMatch(m){ return {id:m.id, home:{id:m.home.id,club:m.home.club,human:m.home.human}, away:{id:m.away.id,club:m.away.club,human:m.away.human}, minute:m.minute,h:m.h,a:m.a,events:m.events.slice(-8),finished:m.finished}; }
function finishRound(room){ room.matches.forEach(m=>{ m.finished=true; applyResult(m.home.stats,m.h,m.a); applyResult(m.away.stats,m.a,m.h); m.home.form=m.home.form||[]; m.away.form=m.away.form||[]; m.home.form.push(m.home.stats.last); m.away.form.push(m.away.stats.last); m.home.form=m.home.form.slice(-5); m.away.form=m.away.form.slice(-5); }); room.phase='standings'; const standings=room.teams.map(t=>({club:t.club,human:t.human,form:t.form||[],...t.stats})).sort((a,b)=>b.PTS-a.PTS || (b.GP-b.GC)-(a.GP-a.GC) || b.GP-a.GP); io.to(room.code).emit('mp:roundFinished',{ round:room.round, matches:room.matches.map(lightMatch), standings }); setTimeout(()=>startRound(room), 10000); }
function applyResult(s,gf,ga){ s.P++; s.GP+=gf; s.GC+=ga; if(gf>ga){s.V++;s.PTS+=3;s.last='V'}else if(gf===ga){s.E++;s.PTS+=1;s.last='E'}else{s.D++;s.last='D'} }


io.on('connection', socket=>{
 socket.on('mp:createRoom', ({password,club})=>{ const code=code8(); const room={code,password:String(password||''),hostId:socket.id,phase:'lobby',players:[{id:socket.id,club:club||'Meu Clube',ready:false}]}; rooms.set(code,room); socket.join(code); socket.emit('mp:roomCreated',{code}); emitRoom(room); });
 socket.on('mp:joinRoom', ({code,password,club})=>{ const room=rooms.get(String(code||'')); if(!room) return socket.emit('mp:error','Sala não encontrada'); if(room.password!==String(password||'')) return socket.emit('mp:error','Senha incorreta'); if(room.players.length>=MAX_PLAYERS) return socket.emit('mp:error','Sala cheia'); if(room.phase!=='lobby') return socket.emit('mp:error','Draft já começou'); room.players.push({id:socket.id,club:club||'Clube',ready:false}); socket.join(room.code); emitRoom(room); });
 socket.on('mp:startDraft', ({code})=>{ const room=rooms.get(String(code||'')); if(!room || room.hostId!==socket.id) return; fillBots(room); buildDraftOrder(room); room.phase='draft'; emitRoom(room); advanceDraft(room); });
 socket.on('mp:pick', ({code,cardId,assignedPos})=>{ const room=rooms.get(String(code||'')); if(!room || room.phase!=='draft') return; const d=room.draft; if(!d) return; const team=room.teams[d.order[d.index]]; if(!team || !team.human || team.id!==socket.id) return socket.emit('mp:error','Ainda não é sua vez de escolher.'); applyPick(room, socket.id, cardId, assignedPos); });
 socket.on('disconnect',()=>{ rooms.forEach(room=>{ const p=room.players.find(x=>x.id===socket.id); if(p){ p.disconnected=true; emitRoom(room); } }); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Servidor iniciado na porta ' + PORT));
