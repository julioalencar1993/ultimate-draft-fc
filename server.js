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
const TOTAL_TEAMS = 20; // campeonato continua com 20 times; sala aceita até 8 jogadores humanos
const PICK_ROUNDS = 11;
const BOT_PICK_DELAY_MS = 1000;
const rooms = new Map();

function normPos(pos){ pos=String(pos||'').toUpperCase(); const map={MEI:'MAT',ZAG:'ZC',ATA:'CA',ALA:'MD'}; return map[pos]||pos; }
function posSector(pos){ pos=normPos(pos); if(pos==='GK') return 'GK'; if(['ZC','LD','LE'].includes(pos)) return 'DEF'; if(['VOL','MC','MAT','MD','ME'].includes(pos)) return 'MID'; return 'ATT'; }
const POSITION_ADAPTATION_MATRIX={
 GK:{5:['GK'],4:[],3:[],2:['ZC'],1:['ALL_OTHER']},
 ZC:{5:['ZC'],4:['LD','LE','VOL'],3:['MC','GK'],2:['ALL_OTHER'],1:[]},
 LD:{5:['LD','MD'],4:['LE','ME'],3:['ZC','MC','PE','PD'],2:['VOL'],1:['ALL_OTHER']},
 LE:{5:['LE','ME'],4:['LD','MD'],3:['ZC','MC','PE','PD','VOL'],2:['ALL_OTHER'],1:['GK']},
 VOL:{5:['VOL'],4:['MC','ZC'],3:['MAT'],2:['ALL_OTHER'],1:['GK']},
 MC:{5:['MC','MAT','VOL'],4:['MD','ME'],3:['PE','PD'],2:['ALL_OTHER'],1:['GK']},
 MD:{5:['MD','PD','MAT'],4:['ME','PE','SA'],3:['LE','LD'],2:['ALL_OTHER'],1:['GK']},
 ME:{5:['ME','PE','MAT'],4:['MD','PD','SA'],3:['LE','LD'],2:['ALL_OTHER'],1:['GK']},
 MAT:{5:['MAT','MD','ME','SA'],4:['MC'],3:['CA','VOL'],2:['ALL_OTHER'],1:['GK']},
 PD:{5:['PD','MD','SA'],4:['PE','ME','MAT'],3:['MC','CA','LD'],2:['ALL_OTHER'],1:['GK']},
 PE:{5:['PE','ME','SA'],4:['PD','MD','MAT'],3:['MC','CA','LE'],2:['ALL_OTHER'],1:['GK']},
 SA:{5:['SA','MAT','PD','PE'],4:['CA'],3:['MC'],2:['ALL_OTHER'],1:['GK']},
 CA:{5:['CA'],4:['SA'],3:['PD','PE','MAT'],2:['ALL_OTHER'],1:['GK']}
};
const STAR_LOSS={5:0,4:3,3:6,2:15,1:25};
function adaptationStars(natural,assigned){ natural=normPos(natural); assigned=normPos(assigned); const row=POSITION_ADAPTATION_MATRIX[natural]||{}; for(const st of [5,4,3,2,1]){ if((row[st]||[]).includes(assigned)) return st; } for(const st of [5,4,3,2,1]){ if((row[st]||[]).includes('ALL_OTHER')) return st; } return 2; }
function positionPenalty(card,assigned){ return STAR_LOSS[adaptationStars(card.pos,assigned)]||0; }
function effectiveOvr(card,assigned){ return Math.max(40, Number(card.ovr||70)-positionPenalty(card,assigned)); }

const fs = require('fs');

function extractCardArrayFromHtml(html, varName){
  const marker = `const ${varName} =`;
  const start = html.indexOf(marker);
  if(start < 0) return [];
  const arrStart = html.indexOf('[', start);
  const arrEnd = html.indexOf('];', arrStart);
  if(arrStart < 0 || arrEnd < 0) return [];
  try {
    return JSON.parse(html.slice(arrStart, arrEnd + 1));
  } catch (err) {
    console.error(`Erro ao carregar ${varName}:`, err.message);
    return [];
  }
}


// v36: correção/validação da base histórica usada no multiplayer.
// Regra: cada carta representa uma temporada realista da carreira; se vier ano fora da janela,
// a carta é descartada para evitar casos como Suárez em 1959/1966 ou jogador de linha como GK.
const CAREER_WINDOWS = {
  'lionel messi':[2004,2025], 'messi':[2004,2025],
  'cristiano ronaldo':[2002,2025], 'cristiano':[2002,2025],
  'luis suarez':[2005,2025], 'luís suárez':[2005,2025], 'suarez':[2005,2025],
  'neymar':[2009,2025], 'kylian mbappe':[2015,2025], 'mbappe':[2015,2025],
  'erling haaland':[2016,2025], 'haaland':[2016,2025],
  'robert lewandowski':[2008,2025], 'lewandowski':[2008,2025],
  'luka modric':[2005,2025], 'modric':[2005,2025],
  'xavi':[1998,2019], 'andres iniesta':[2002,2018], 'iniesta':[2002,2018],
  'ronaldinho':[1998,2015], 'kaka':[2001,2017], 'kaká':[2001,2017],
  'luis figo':[1989,2009], 'luís figo':[1989,2009], 'figo':[1989,2009],
  'zico':[1971,1994], 'ronaldo nazario':[1993,2011], 'ronaldo fenômeno':[1993,2011],
  'pele':[1956,1977], 'pelé':[1956,1977], 'maradona':[1976,1997],
  'zidane':[1988,2006], 'maldini':[1985,2009], 'buffon':[1995,2023]
};
const POSITION_FIXES = {
  'figo':'PD', 'luís figo':'PD', 'luis figo':'PD',
  'zico':'MAT', 'luis suarez':'CA', 'luís suárez':'CA', 'suarez':'CA',
  'lionel messi':'SA', 'messi':'SA', 'cristiano ronaldo':'CA', 'cristiano':'CA',
  'ronaldinho':'PE', 'xavi':'MC', 'iniesta':'MC', 'modric':'MC',
  'maldini':'ZC', 'buffon':'GK', 'dida':'GK'
};
function normText(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function cardKey(c){ return normText((c.fam || c.name || '')); }
function findWindow(c){ const k=cardKey(c), n=normText(c.name); return CAREER_WINDOWS[k] || CAREER_WINDOWS[n] || null; }
function fixClub(c){
  const k=cardKey(c), y=Number(c.year);
  if(k.includes('suarez')){
    if(y===2014) c.club='Liverpool';
    if(y>=2015 && y<=2020) c.club='Barcelona';
    if(y===2021) c.club='Atlético Madrid';
  }
  if(k.includes('figo')){
    if(y<=2000) c.club='Barcelona';
    if(y>=2001 && y<=2005) c.club='Real Madrid';
  }
  if(k.includes('messi')){
    if(y<=2021) c.club='Barcelona';
    if(y===2022) c.club='Argentina';
    if(y>=2023) c.club='Inter Miami';
  }
  if(k.includes('cristiano')){
    if(y<=2009) c.club='Manchester United';
    if(y>=2010 && y<=2018) c.club='Real Madrid';
    if(y>=2019 && y<=2021) c.club='Juventus';
  }
  if(k.includes('zico') && y>=1971 && y<=1989) c.club='Flamengo';
  return c;
}
function normalizeHistoricalCard(c){
  const card={...c};
  const y=Number(card.year);
  if(!Number.isFinite(y) || y<1880 || y>2026) return null;
  const win=findWindow(card);
  if(win && (y<win[0] || y>win[1])) return null;
  const k=cardKey(card), n=normText(card.name);
  const fixedPos=POSITION_FIXES[k] || POSITION_FIXES[n];
  if(fixedPos) card.pos=fixedPos;
  if(card.pos==='GK' && fixedPos && fixedPos!=='GK') card.pos=fixedPos;
  return fixClub(card);
}

function loadRealCards(){
  try {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const base = extractCardArrayFromHtml(html, 'originalCards');
    const expansion = extractCardArrayFromHtml(html, 'expansionCardsV25');
    const cards = [...base, ...expansion]
      .filter(c => c && c.name && c.pos && Number.isFinite(Number(c.year)) && Number.isFinite(Number(c.ovr)))
      .map((c, idx) => normalizeHistoricalCard({
        id: String(c.id || `REAL${idx}`),
        fam: c.fam || '',
        name: c.name,
        pos: normPos(c.pos),
        year: Number(c.year),
        club: c.club || 'Histórico',
        ovr: Number(c.ovr),
        category: c.category || '',
        era: c.era || ''
      }))
      .filter(Boolean);
    if(cards.length) return cards;
  } catch (err) {
    console.error('Erro ao ler base real do index.html:', err.message);
  }
  return [
    {id:'FALLBACK1',name:'Pelé',pos:'CA',year:1970,club:'Santos',ovr:99},
    {id:'FALLBACK2',name:'Lionel Messi',pos:'SA',year:2012,club:'Barcelona',ovr:99},
    {id:'FALLBACK3',name:'Cristiano Ronaldo',pos:'PE',year:2017,club:'Real Madrid',ovr:98},
    {id:'FALLBACK4',name:'Luis Suárez',pos:'CA',year:2016,club:'Barcelona',ovr:95},
    {id:'FALLBACK5',name:'Luís Figo',pos:'PD',year:2001,club:'Real Madrid',ovr:93},
    {id:'FALLBACK6',name:'Zico',pos:'MAT',year:1981,club:'Flamengo',ovr:96},
    {id:'FALLBACK7',name:'Gianluigi Buffon',pos:'GK',year:2006,club:'Juventus',ovr:96},
    {id:'FALLBACK8',name:'Paolo Maldini',pos:'ZC',year:1994,club:'Milan',ovr:97}
  ];
}

const realCards = loadRealCards();

const formations = ['4-3-3','4-4-2','4-1-3-2','4-5-1','3-5-2','4-1-2-3','5-3-2','4-2-3-1','4-3-1-2','3-4-3','5-2-1-2','3-4-1-2'];
function rnd(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
function code8(){ let c; do { c=String(rnd(10000000,99999999)); } while(rooms.has(c)); return c; }
function cloneCard(p,i){
  return {
    id: 'MP' + Date.now() + i + Math.random().toString(16).slice(2),
    sourceId: String(p.id || ''),
    fam: p.fam || '',
    name: p.name,
    pos: normPos(p.pos),
    year: p.year,
    club: p.club || 'Histórico',
    ovr: p.ovr,
    category: p.category || '',
    era: p.era || ''
  };
}
function playerIdentity(c){ return normText(c.fam || c.name); }
function exactCardKey(c){ return String(c.sourceId || c.id || '') + '|' + normText(c.name) + '|' + String(c.year || ''); }
function teamHasIdentity(team,c){ const id=playerIdentity(c); return (team.players||[]).some(p=>playerIdentity(p)===id); }
function isCardAvailable(room,team,c){
  const picked=room?.draft?.pickedExact || new Set();
  if(picked.has(exactCardKey(c))) return false;
  if(team && teamHasIdentity(team,c)) return false;
  return true;
}
function randomAvailableCard(room,team,desiredPositions){
  let pool = realCards.filter(c=>isCardAvailable(room,team,c));
  if(desiredPositions && desiredPositions.length){
    const wanted = new Set(desiredPositions.map(normPos));
    const posPool = pool.filter(c=>wanted.has(normPos(c.pos)));
    if(posPool.length) pool = posPool;
  }
  if(!pool.length) pool = realCards.slice();
  return pool[rnd(0, pool.length-1)];
}
function makeOptions(room,team,n=10){
  const opts=[]; const seen=new Set();
  const slots=openSlots(team||{players:[]});
  const add=(desired)=>{
    for(let tries=0; tries<250; tries++){
      const p=randomAvailableCard(room,team,desired);
      const key=exactCardKey({sourceId:p.id,name:p.name,year:p.year});
      const idkey=playerIdentity(p);
      if(seen.has(key) || seen.has('ID:'+idkey)) continue;
      seen.add(key); seen.add('ID:'+idkey); opts.push(cloneCard(p,opts.length)); return true;
    }
    return false;
  };
  while(opts.length<n-1) add(null);
  // Último slot: tenta obrigatoriamente trazer uma posição aberta do time da vez.
  add(slots);
  while(opts.length<n) add(null);
  return opts.slice(0,n);
}
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; }
function countPositions(players){ return players.reduce((acc,p)=>{ const k=normPos(p.assignedPos||p.pos); acc[k]=(acc[k]||0)+1; return acc; },{}); }
const FORMATION_SLOTS={
  '4-3-3':['GK','LD','ZC','ZC','LE','VOL','MC','MAT','PE','CA','PD'],
  '4-4-2':['GK','LD','ZC','ZC','LE','MD','MC','MC','ME','SA','CA'],
  '4-1-3-2':['GK','LD','ZC','ZC','LE','VOL','MD','MAT','ME','SA','CA'],
  '4-5-1':['GK','LD','ZC','ZC','LE','VOL','MC','MAT','MD','ME','CA'],
  '3-5-2':['GK','ZC','ZC','ZC','VOL','MC','MAT','MD','ME','SA','CA'],
  '4-1-2-3':['GK','LD','ZC','ZC','LE','VOL','MC','MC','PE','CA','PD'],
  '5-3-2':['GK','LD','ZC','ZC','ZC','LE','VOL','MC','MAT','SA','CA'],
  '4-2-3-1':['GK','LD','ZC','ZC','LE','VOL','MC','ME','MAT','MD','CA'],
  '4-3-1-2':['GK','LD','ZC','ZC','LE','VOL','MC','MC','MAT','SA','CA'],
  '3-4-3':['GK','ZC','ZC','ZC','ME','MC','VOL','MD','PE','CA','PD'],
  '5-2-1-2':['GK','LD','ZC','ZC','ZC','LE','MC','VOL','MAT','SA','CA'],
  '3-4-1-2':['GK','ZC','ZC','ZC','ME','MC','VOL','MD','MAT','SA','CA']
};
function formationSlots(team){ return (FORMATION_SLOTS[team?.formation] || FORMATION_SLOTS['4-3-3']).slice(); }
function openSlots(team){ const need=formationSlots(team); const used=countPositions(team.players||[]); return need.filter(pos=>{ used[pos]=used[pos]||0; const total=need.filter(x=>x===pos).length; return used[pos]++ < total; }); }
function pickPosition(team, card){ card.pos=normPos(card.pos); const slots=openSlots(team); if(!slots.length) return card.pos; return [...slots].sort((a,b)=>positionPenalty(card,a)-positionPenalty(card,b))[0]; }
function validAssignedPos(team, card, assignedPos){ const slots=openSlots(team); assignedPos=normPos(assignedPos); if(!assignedPos) return null; if(!slots.includes(assignedPos)) return null; return assignedPos; }
function publicRoom(room){ return { code:room.code, hostId:room.hostId, phase:room.phase, maxPlayers:MAX_PLAYERS, players:room.players.map(p=>({id:p.id,club:p.club,ready:p.ready})), teams: room.teams?.map(t=>({id:t.id,club:t.club,human:t.human,players:t.players?.length||0})) || [] }; }
function emitRoom(room){ io.to(room.code).emit('mp:roomState', publicRoom(room)); }
function fillBots(room){ let n=1; room.teams = room.players.map(p=>({ id:p.id, club:p.club, human:true, socketId:p.id, formation:'4-3-3', players:[], stats:{P:0,V:0,E:0,D:0,GP:0,GC:0,PTS:0} })); while(room.teams.length<TOTAL_TEAMS){ room.teams.push({ id:'BOT'+n, club:'Bot '+n, human:false, formation:formations[rnd(0,formations.length-1)], players:[], stats:{P:0,V:0,E:0,D:0,GP:0,GC:0,PTS:0} }); n++; }
}
function buildDraftOrder(room){
 const base=shuffle([...room.teams.keys()]);
 const order=[];
 for(let r=0;r<PICK_ROUNDS;r++){ order.push(...(r%2===0 ? base : [...base].reverse())); }
 room.draft={ order, baseOrder:base, index:0, options:[], pickLog:[], pickedExact:new Set(), turnTimer:null, turnEndsAt:null };
}
function serializeDraftTeams(room){
  return room.teams.map(t=>({
    id:t.id,
    club:t.club,
    count:(t.players||[]).length,
    human:t.human,
    formation:t.formation,
    players:t.players||[]
  }));
}
function finishDraftPhase(room){
  if(!room || !room.draft) return;
  if(room.phase==='match' || room.phase==='standings') return;
  if(room.draft.finalized) return;
  room.draft.finalized=true;
  if(room.draft.turnTimer){ clearTimeout(room.draft.turnTimer); room.draft.turnTimer=null; }
  if(room.draft.guardTimer){ clearTimeout(room.draft.guardTimer); room.draft.guardTimer=null; }
  room.phase='readyRound';
  emitRoom(room);
  io.to(room.code).emit('mp:draftDone', {
    index: room.draft.index,
    total: room.draft.order.length,
    pickLog: room.draft.pickLog.slice(-80),
    teams: serializeDraftTeams(room)
  });
  // Garante que o último pick apareça e, em seguida, entra nos jogos sem depender do cliente.
  setTimeout(()=>{ if(room.phase==='readyRound') startRound(room); }, 900);
}
function isDraftComplete(room){
  if(!room || !room.draft) return true;
  if(room.draft.index >= room.draft.order.length) return true;
  // trava de segurança: se todos já possuem 11 jogadores, encerra mesmo que o índice fique errado.
  return room.teams && room.teams.length && room.teams.every(t => (t.players||[]).length >= PICK_ROUNDS);
}
function emitDraftState(room, team){
  const d=room.draft;
  io.to(room.code).emit('mp:draftState', {
    index:d.index,
    total:d.order.length,
    teamId:team.id,
    club:team.club,
    human:team.human,
    botDelayMs: team.human ? 0 : BOT_PICK_DELAY_MS,
    turnEndsAt:d.turnEndsAt,
    options: d.options,
    order:d.baseOrder.map(i=>({id:room.teams[i].id,club:room.teams[i].club,human:room.teams[i].human})),
    pickLog:d.pickLog.slice(-80),
    teams:serializeDraftTeams(room)
  });
}
function advanceDraft(room){
  if(!room.draft || room.phase!=='draft') return;
  if(isDraftComplete(room)){ finishDraftPhase(room); return; }

  const d=room.draft;
  const teamIdx = d.order[d.index];
  const team = room.teams[teamIdx];
  if(!team){ finishDraftPhase(room); return; }

  if(d.turnTimer){ clearTimeout(d.turnTimer); d.turnTimer=null; }
  if(d.guardTimer){ clearTimeout(d.guardTimer); d.guardTimer=null; }

  d.options = makeOptions(room, team, 10);
  const delay = team.human ? 20000 : BOT_PICK_DELAY_MS;
  const turnIndex = d.index;
  d.turnEndsAt = Date.now() + delay;
  emitDraftState(room, team);

  const safeAutoPick = () => {
    if(room.phase!=='draft' || !room.draft || room.draft.finalized) return;
    if(room.draft.index !== turnIndex) return;
    autoPick(room, team.id, turnIndex);
  };

  d.turnTimer=setTimeout(safeAutoPick, delay);
  // Guard extra: se o primeiro timeout falhar por qualquer motivo, tenta de novo.
  d.guardTimer=setTimeout(safeAutoPick, delay + 1200);
}
function autoPick(room, teamId, expectedIndex){
  const d=room.draft;
  if(!d || room.phase!=='draft' || d.finalized) return false;
  if(typeof expectedIndex==='number' && d.index!==expectedIndex) return false;
  if(isDraftComplete(room)){ finishDraftPhase(room); return true; }
  const team=room.teams[d.order[d.index]];
  if(!team || team.id!==teamId) return false;

  const slots=openSlots(team);
  if(!d.options || !d.options.length) d.options = makeOptions(room, team, 10);

  let pool=(d.options||[]).filter(c=>slots.includes(normPos(c.pos)) && !teamHasIdentity(team,c));
  if(!pool.length) pool=(d.options||[]).filter(c=>!teamHasIdentity(team,c));
  if(!pool.length) pool=(d.options||[]).slice();

  let pick=pool.length ? pool[rnd(0,pool.length-1)] : null;
  if(!pick){
    const fallback=randomAvailableCard(room, team, slots);
    if(!fallback){ finishDraftPhase(room); return false; }
    pick=cloneCard(fallback,0);
    d.options=[pick];
  }
  const assigned=pickPosition(team,pick);
  return applyPick(room, teamId, pick.id, assigned, true);
}
function applyPick(room, teamId, cardId, assignedPos, isAuto=false){
  const d=room.draft;
  if(!d || d.finalized || room.phase!=='draft') return false;
  if(isDraftComplete(room)){ finishDraftPhase(room); return false; }

  const teamIdx=d.order[d.index];
  const team=room.teams[teamIdx];
  if(!team || team.id!==teamId) return false;
  if(team.human && !isAuto && !room.players.some(p=>p.id===teamId && !p.disconnected)) return false;

  if(d.turnTimer){ clearTimeout(d.turnTimer); d.turnTimer=null; }
  if(d.guardTimer){ clearTimeout(d.guardTimer); d.guardTimer=null; }

  let card=(d.options||[]).find(c=>c.id===cardId) || (d.options||[])[0];
  if(!card){
    const fallback=randomAvailableCard(room, team, openSlots(team));
    if(!fallback){ finishDraftPhase(room); return false; }
    card=cloneCard(fallback,0);
  }
  if(teamHasIdentity(team,card)){
    const alt=(d.options||[]).find(c=>!teamHasIdentity(team,c));
    if(alt) card=alt;
  }

  card={...card};
  card.pos=normPos(card.pos);
  card.assignedPos=validAssignedPos(team, card, assignedPos) || pickPosition(team, card);
  card.fitStars=adaptationStars(card.pos,card.assignedPos);
  card.fitLoss=positionPenalty(card,card.assignedPos);
  card.effectiveOvr=effectiveOvr(card,card.assignedPos);
  team.players.push(card);
  d.pickedExact.add(exactCardKey(card));

  const log={
    club:team.club,
    teamId:team.id,
    card:{name:card.name,pos:card.pos,year:card.year,ovr:card.ovr,effectiveOvr:card.effectiveOvr,fitStars:card.fitStars,assignedPos:card.assignedPos},
    pick:d.index+1,
    round:Math.floor(d.index/TOTAL_TEAMS)+1
  };
  d.pickLog.push(log);
  d.index++;

  io.to(room.code).emit('mp:pickMade',{
    teamId:team.id,
    club:team.club,
    card,
    log,
    pickLog:d.pickLog.slice(-80),
    teams:serializeDraftTeams(room),
    nextIndex:d.index,
    total:d.order.length
  });

  if(isDraftComplete(room)) finishDraftPhase(room);
  else advanceDraft(room);
  return true;
}
function startRound(room){ room.phase='match'; room.round=(room.round||0)+1; const shuffled=[...room.teams].sort(()=>Math.random()-.5); room.matches=[]; for(let i=0;i<shuffled.length;i+=2){ room.matches.push({ id:`R${room.round}M${i/2+1}`, home:shuffled[i], away:shuffled[i+1], minute:0, h:0, a:0, events:[], finished:false }); }
 room.players.forEach(p=>{ const match=room.matches.find(m=>m.home.id===p.id || m.away.id===p.id); if(match){ const s=io.sockets.sockets.get(p.id); if(s) s.join(room.code+':'+match.id); io.to(p.id).emit('mp:yourMatch',{ round:room.round, match:lightMatch(match) }); }});
 emitRoom(room);
 const start=Date.now(); const duration=40000;
 room.timer=setInterval(()=>{ const minute=Math.min(90, Math.floor((Date.now()-start)/duration*90)); room.matches.forEach(m=>{ if(m.finished) return; m.minute=minute; if(Math.random()<0.055){ const side=Math.random()<0.5?'home':'away'; const team=side==='home'?m.home:m.away; const roster=team.players||[]; const scorerObj=(roster[rnd(0,Math.max(0,roster.length-1))]||{name:'Jogador'}); const scorer=scorerObj.name; let assist=''; if(roster.length>1 && Math.random()<0.72){ const candidates=roster.filter(p=>p.name!==scorer); const a=candidates[rnd(0,Math.max(0,candidates.length-1))]; assist=a?a.name:''; } if(side==='home') m.h++; else m.a++; const ev={minute, type:'goal', side, scorer, assist, club:team.club, score:`${m.h} x ${m.a}`}; m.events.push(ev); io.to(room.code+':'+m.id).emit('mp:matchEvent',{ matchId:m.id, event:ev, match:lightMatch(m) }); }
 });
 io.to(room.code).emit('mp:roundClock',{ round:room.round, minute });
 room.matches.forEach(m=>io.to(room.code+':'+m.id).emit('mp:matchTick',{ match:lightMatch(m) }));
 if(minute>=90){ clearInterval(room.timer); finishRound(room); }
 }, 1000);
}
function lightMatch(m){ const pack=t=>({id:t.id,club:t.club,human:t.human,formation:t.formation,players:(t.players||[]).map(p=>({name:p.name,pos:p.pos,assignedPos:p.assignedPos,effectiveOvr:p.effectiveOvr,fitStars:p.fitStars}))}); return {id:m.id, home:pack(m.home), away:pack(m.away), minute:m.minute,h:m.h,a:m.a,events:m.events.slice(-8),finished:m.finished}; }
function finishRound(room){ room.matches.forEach(m=>{ m.finished=true; applyResult(m.home.stats,m.h,m.a); applyResult(m.away.stats,m.a,m.h); m.home.form=m.home.form||[]; m.away.form=m.away.form||[]; m.home.form.push(m.home.stats.last); m.away.form.push(m.away.stats.last); m.home.form=m.home.form.slice(-5); m.away.form=m.away.form.slice(-5); }); room.phase='standings'; const standings=room.teams.map(t=>({club:t.club,human:t.human,form:t.form||[],...t.stats})).sort((a,b)=>b.PTS-a.PTS || (b.GP-b.GC)-(a.GP-a.GC) || b.GP-a.GP); io.to(room.code).emit('mp:roundFinished',{ round:room.round, matches:room.matches.map(lightMatch), standings }); setTimeout(()=>startRound(room), 10000); }
function applyResult(s,gf,ga){ s.P++; s.GP+=gf; s.GC+=ga; if(gf>ga){s.V++;s.PTS+=3;s.last='V'}else if(gf===ga){s.E++;s.PTS+=1;s.last='E'}else{s.D++;s.last='D'} }


io.on('connection', socket=>{
 socket.on('mp:createRoom', ({password,club})=>{ const code=code8(); const room={code,password:String(password||''),hostId:socket.id,phase:'lobby',players:[{id:socket.id,club:club||'Meu Clube',ready:false}]}; rooms.set(code,room); socket.join(code); socket.emit('mp:roomCreated',{code}); emitRoom(room); });
 socket.on('mp:joinRoom', ({code,password,club})=>{ const room=rooms.get(String(code||'')); if(!room) return socket.emit('mp:error','Sala não encontrada'); if(room.password!==String(password||'')) return socket.emit('mp:error','Senha incorreta'); if(room.players.length>=MAX_PLAYERS) return socket.emit('mp:error','Sala cheia'); if(room.phase!=='lobby') return socket.emit('mp:error','Draft já começou'); room.players.push({id:socket.id,club:club||'Clube',ready:false}); socket.join(room.code); emitRoom(room); });
 socket.on('mp:startDraft', ({code})=>{ const room=rooms.get(String(code||'')); if(!room || room.hostId!==socket.id) return; fillBots(room); buildDraftOrder(room); room.phase='draft'; emitRoom(room); advanceDraft(room); });
 socket.on('mp:pick', ({code,cardId,assignedPos})=>{ const room=rooms.get(String(code||'')); if(!room || room.phase!=='draft') return; const d=room.draft; if(!d) return; const team=room.teams[d.order[d.index]]; if(!team || !team.human || team.id!==socket.id) return socket.emit('mp:error','Ainda não é sua vez de escolher.'); applyPick(room, socket.id, cardId, assignedPos); });

 socket.on('mp:changeFormation', ({code,formation})=>{
   const room=rooms.get(String(code||''));
   if(!room || !room.teams) return;
   const team=room.teams.find(t=>t.id===socket.id);
   if(!team || !team.human) return;
   if(!formations.includes(String(formation||''))) return;
   team.formation=String(formation);
   // Reorganiza os jogadores já escolhidos na nova formação sem contar posição antiga.
   const players=team.players||[];
   const reassigned=[];
   players.forEach(p=>{
     p.assignedPos=null;
     const tempTeam={...team, players:reassigned};
     const pos=pickPosition(tempTeam,p);
     p.assignedPos=pos;
     p.fitStars=adaptationStars(p.pos,p.assignedPos);
     p.fitLoss=positionPenalty(p,p.assignedPos);
     p.effectiveOvr=effectiveOvr(p,p.assignedPos);
     reassigned.push(p);
   });
   if(room.phase==='draft' && room.draft){
     const d=room.draft;
     const cur=room.teams[d.order[d.index]];
     io.to(room.code).emit('mp:draftState', { index:d.index, total:d.order.length, teamId:cur.id, club:cur.club, human:cur.human, botDelayMs:cur.human?0:BOT_PICK_DELAY_MS, turnEndsAt:d.turnEndsAt, options:d.options, order:d.baseOrder.map(i=>({id:room.teams[i].id,club:room.teams[i].club,human:room.teams[i].human})), pickLog:d.pickLog.slice(-80), teams:room.teams.map(t=>({id:t.id,club:t.club,count:t.players.length,human:t.human,formation:t.formation,players:t.players})) });
   }
 });
 socket.on('disconnect',()=>{ rooms.forEach(room=>{ const p=room.players.find(x=>x.id===socket.id); if(p){ p.disconnected=true; emitRoom(room); } }); });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
server.listen(PORT, HOST, () => console.log('Servidor iniciado em ' + HOST + ':' + PORT));
server.on('error', (err) => {
  console.error('Erro no servidor:', err);
  process.exit(1);
});
