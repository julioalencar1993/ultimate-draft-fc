const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));

const MAX_PLAYERS = 8;
const TOTAL_TEAMS = 20;
const PICK_ROUNDS = 11;
const BOT_PICK_DELAY_MS = 2000;
const rooms = new Map();

const names = ['Pelé','Messi','Maradona','Cristiano Ronaldo','Ronaldo','Ronaldinho','Zidane','Cruyff','Neymar','Mbappé','Henry','Romário','Van Basten','Baggio','Totti','Del Piero','Iniesta','Xavi','Modric','Kaká','Gullit','Matthäus','Rijkaard','Busquets','Pirlo','Maldini','Roberto Carlos','Cafu','Beckenbauer','Baresi','Nesta','Cannavaro','Sergio Ramos','Van Dijk','Neuer','Buffon','Casillas','Yashin','Haaland','Benzema','Lewandowski','Suárez','Salah','Garrincha','Best','Rivaldo','Figo','Platini','Zico','Sócrates','Riquelme','Seedorf','Vieira','Makelele','Kante','Davids','Zanetti','Lahm','Marcelo','Dani Alves'];
const positions = ['GK','ZAG','ZAG','LD','LE','VOL','MC','MAT','PE','PD','SA','ATA'];
const formations = ['4-3-3','4-2-3-1','4-4-2','3-5-2','4-3-1-2'];
function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function code8(){ let c; do { c=String(rnd(10000000,99999999)); } while(rooms.has(c)); return c; }
function makeCard(i){ const name = names[rnd(0,names.length-1)]; const pos = positions[rnd(0,positions.length-1)]; const year = rnd(1958,2025); const ovr = rnd(76,99); return { id:'MP'+Date.now()+i+Math.random().toString(16).slice(2), name, pos, year, club:'Histórico', ovr }; }
function makeOptions(n=5){ return Array.from({length:n},(_,i)=>makeCard(i)); }
function publicRoom(room){ return { code:room.code, hostId:room.hostId, phase:room.phase, maxPlayers:MAX_PLAYERS, players:room.players.map(p=>({id:p.id,club:p.club,ready:p.ready})), teams: room.teams?.map(t=>({id:t.id,club:t.club,human:t.human,players:t.players?.length||0})) || [] }; }
function emitRoom(room){ io.to(room.code).emit('mp:roomState', publicRoom(room)); }
function fillBots(room){ let n=1; room.teams = room.players.map(p=>({ id:p.id, club:p.club, human:true, socketId:p.id, formation:'4-3-3', players:[], stats:{P:0,V:0,E:0,D:0,GP:0,GC:0,PTS:0} })); while(room.teams.length<TOTAL_TEAMS){ room.teams.push({ id:'BOT'+n, club:'Bot '+n, human:false, formation:formations[rnd(0,formations.length-1)], players:[], stats:{P:0,V:0,E:0,D:0,GP:0,GC:0,PTS:0} }); n++; }
}
function buildDraftOrder(room){ const order=[]; for(let r=0;r<PICK_ROUNDS;r++){ const arr=[...room.teams.keys()]; if(r%2) arr.reverse(); order.push(...arr); } room.draft={ order, index:0, options:[], round:1 };
}
function advanceDraft(room){ if(!room.draft) return;
 if(room.draft.index >= room.draft.order.length){ room.phase='readyRound'; emitRoom(room); io.to(room.code).emit('mp:draftDone', { teams:room.teams.map(t=>({id:t.id,club:t.club,human:t.human,players:t.players})) }); startRound(room); return; }
 const teamIdx = room.draft.order[room.draft.index];
 const team = room.teams[teamIdx];
 room.draft.options = makeOptions(5);
 io.to(room.code).emit('mp:draftState', { index:room.draft.index, total:room.draft.order.length, teamId:team.id, club:team.club, human:team.human, botDelayMs: team.human ? 0 : BOT_PICK_DELAY_MS, options: team.human ? room.draft.options : [], teams:room.teams.map(t=>({id:t.id,club:t.club,count:t.players.length,human:t.human})) });
 if(!team.human){ setTimeout(()=>{ const pick=room.draft.options[rnd(0,room.draft.options.length-1)]; applyPick(room, team.id, pick.id); }, BOT_PICK_DELAY_MS); }
}
function applyPick(room, teamId, cardId){ const d=room.draft; if(!d) return false; const teamIdx=d.order[d.index]; const team=room.teams[teamIdx]; if(!team || team.id!==teamId) return false; if(team.human && !room.players.some(p=>p.id===teamId && !p.disconnected)) return false; const card=d.options.find(c=>c.id===cardId) || d.options[0]; if(!card) return false; team.players.push(card); io.to(room.code).emit('mp:pickMade',{ teamId:team.id, club:team.club, card, nextIndex:d.index+1, total:d.order.length }); d.index++; advanceDraft(room); return true; }
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
function finishRound(room){ room.matches.forEach(m=>{ m.finished=true; applyResult(m.home.stats,m.h,m.a); applyResult(m.away.stats,m.a,m.h); }); room.phase='standings'; const standings=room.teams.map(t=>({club:t.club,human:t.human,...t.stats})).sort((a,b)=>b.PTS-a.PTS || (b.GP-b.GC)-(a.GP-a.GC) || b.GP-a.GP); io.to(room.code).emit('mp:roundFinished',{ round:room.round, matches:room.matches.map(lightMatch), standings }); setTimeout(()=>startRound(room), 10000); }
function applyResult(s,gf,ga){ s.P++; s.GP+=gf; s.GC+=ga; if(gf>ga){s.V++;s.PTS+=3}else if(gf===ga){s.E++;s.PTS+=1}else{s.D++} }

io.on('connection', socket=>{
 socket.on('mp:createRoom', ({password,club})=>{ const code=code8(); const room={code,password:String(password||''),hostId:socket.id,phase:'lobby',players:[{id:socket.id,club:club||'Meu Clube',ready:false}]}; rooms.set(code,room); socket.join(code); socket.emit('mp:roomCreated',{code}); emitRoom(room); });
 socket.on('mp:joinRoom', ({code,password,club})=>{ const room=rooms.get(String(code||'')); if(!room) return socket.emit('mp:error','Sala não encontrada'); if(room.password!==String(password||'')) return socket.emit('mp:error','Senha incorreta'); if(room.players.length>=MAX_PLAYERS) return socket.emit('mp:error','Sala cheia'); if(room.phase!=='lobby') return socket.emit('mp:error','Draft já começou'); room.players.push({id:socket.id,club:club||'Clube',ready:false}); socket.join(room.code); emitRoom(room); });
 socket.on('mp:startDraft', ({code})=>{ const room=rooms.get(String(code||'')); if(!room || room.hostId!==socket.id) return; fillBots(room); buildDraftOrder(room); room.phase='draft'; emitRoom(room); advanceDraft(room); });
 socket.on('mp:pick', ({code,cardId})=>{ const room=rooms.get(String(code||'')); if(!room || room.phase!=='draft') return; const d=room.draft; if(!d) return; const team=room.teams[d.order[d.index]]; if(!team || !team.human || team.id!==socket.id) return socket.emit('mp:error','Ainda não é sua vez de escolher.'); applyPick(room, socket.id, cardId); });
 socket.on('disconnect',()=>{ rooms.forEach(room=>{ const p=room.players.find(x=>x.id===socket.id); if(p){ p.disconnected=true; emitRoom(room); } }); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Servidor iniciado na porta ' + PORT));
