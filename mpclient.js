
(function(){
 let socket=null, roomCode=null, myId=null, mpCurrentDraft=null, mpPendingCard=null;
 function by(id){return document.getElementById(id)}
 function show(sec){['mpHome','mpLobby','mpDraft','mpMatch','mpStandings'].forEach(id=>by(id).style.display=id===sec?'block':'none')}
 function ensureSocket(){ if(socket) return socket; socket=io(); socket.on('connect',()=>{myId=socket.id}); socket.on('mp:error',m=>alert(m)); socket.on('mp:roomCreated',d=>{roomCode=d.code;by('mpRoomCode').textContent=d.code;show('mpLobby')}); socket.on('mp:roomState',renderRoom); socket.on('mp:draftState',renderDraft); socket.on('mp:pickMade',d=>{by('mpDraftSub').textContent=d.club+' escolheu '+d.card.name+' ('+d.card.pos+')'; const opts=by('mpOptions'); if(opts) opts.innerHTML='<div class="mpBox" style="grid-column:1/-1;text-align:center"><h2>Escolha feita</h2><p class="mpSub">'+mpEsc(d.club)+' escolheu <b>'+mpEsc(d.card.name)+'</b> ('+mpEsc(d.card.pos)+', '+mpEsc(d.card.year)+') • <b>OVR '+mpEsc(d.card.ovr)+'</b></p></div>';}); socket.on('mp:draftDone',()=>{by('mpDraftTitle').textContent='Draft encerrado. Preparando rodada...'}); socket.on('mp:yourMatch',d=>{show('mpMatch'); renderMatch(d.match); by('mpMatchLog').innerHTML=''}); socket.on('mp:matchEvent',d=>{renderMatch(d.match); const log=by('mpMatchLog'); log.innerHTML='<div>'+d.event.minute+'\' ⚽ '+d.event.scorer+' - '+d.event.club+' ('+d.event.score+')</div>'+log.innerHTML}); socket.on('mp:roundClock',d=>{by('mpClock').textContent=d.minute+"'"}); socket.on('mp:roundFinished',renderStandings); return socket; }
 function renderRoom(r){ roomCode=r.code; by('mpRoomCode').textContent=r.code; by('mpPlayers').innerHTML=r.players.map((p,i)=>'<span class="mpPill">'+(i+1)+'. '+p.club+(p.id===r.hostId?' 👑':'')+'</span>').join(''); by('mpStartBtn').style.display=(myId===r.hostId && r.phase==='lobby')?'inline-block':'none'; if(r.phase==='lobby') show('mpLobby'); }
 function mpEsc(v){return String(v==null?'':v).replace(/[&<>"]/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]})}
 function mpDraftCardHtml(c){
   const flag=(typeof flagForPlayer==='function')?flagForPlayer(c):'⚽';
   const kit=(typeof kitForPlayer==='function')?kitForPlayer(c):'👕';
   return '<div class="playerCard mpDraftCard" onclick="MP.pick(\''+mpEsc(c.id)+'\')">'+
     '<div class="pos '+mpEsc(c.pos)+'">'+mpEsc(c.pos)+'</div><div class="cardFlag">'+flag+'</div>'+
     '<div class="fakePhoto"><div class="compactKit">'+kit+'</div></div>'+
     '<div class="playerInfo"><div class="name">'+mpEsc(c.name).toUpperCase()+'</div>'+
     '<div class="meta">'+mpEsc(c.club||'HISTÓRICO').toUpperCase()+' • '+mpEsc(c.year)+'</div>'+
     '<div class="cardFooterMini"><span class="miniPill">'+mpEsc(c.pos)+'</span></div></div></div>';
 }
 function mpPosSector(pos){ if(pos==='GK') return 'GK'; if(['ZAG','LD','LE','ALA'].includes(pos)) return 'DEF'; if(['VOL','MC','MAT'].includes(pos)) return 'MID'; return 'ATT'; }
 function mpFormationNeed(){ return ['GK','LD','ZAG','ZAG','LE','VOL','MC','MC','PE','ATA','PD']; }
 function mpOpenSlots(team){
   const need=mpFormationNeed();
   const used={};
   (team&&team.players?team.players:[]).forEach(p=>{ const k=p.assignedPos||p.pos; used[k]=(used[k]||0)+1; });
   const countNeed={}; need.forEach(x=>countNeed[x]=(countNeed[x]||0)+1);
   return need.filter(pos=>{ const u=used[pos]||0; used[pos]=u+1; return u < countNeed[pos]; });
 }
 function mpOpenPositionModal(card){
   if(!mpCurrentDraft) return;
   mpPendingCard=card;
   const myTeam=(mpCurrentDraft.teams||[]).find(t=>t.id===myId) || {players:[]};
   const slots=mpOpenSlots(myTeam);
   let final=slots.filter(pos=>pos===card.pos || mpPosSector(pos)===mpPosSector(card.pos));
   if(!final.length) final=slots;
   by('modalPlayerName').textContent=card.name+' '+card.year+' - '+(card.club||'Histórico')+' - '+card.pos;
   const box=by('positionChoices');
   box.innerHTML='';
   final.forEach(pos=>{
     const b=document.createElement('div');
     b.className='posChoice';
     b.innerHTML=mpEsc(pos)+'<div class="sub">Titular</div>';
     b.onclick=()=>{
       by('positionModal').style.display='none';
       ensureSocket().emit('mp:pick',{code:roomCode,cardId:card.id,assignedPos:pos});
       by('mpOptions').innerHTML='<p class="mpSub">Escolha enviada. Aguardando servidor...</p>';
     };
     box.appendChild(b);
   });
   by('positionModal').style.display='flex';
 }
 function renderMpPitch(){
   if(!mpCurrentDraft) return '';
   const myTeam=(mpCurrentDraft.teams||[]).find(t=>t.id===myId) || {players:[]};
   const coords={GK:[50,88],LD:[82,68],ZAG1:[62,72],ZAG2:[38,72],LE:[18,68],VOL:[50,55],MC1:[35,42],MC2:[65,42],PE:[22,24],ATA:[50,18],PD:[78,24]};
   const need=mpFormationNeed(); const occ={}; const totalNeed={}; need.forEach(x=>totalNeed[x]=(totalNeed[x]||0)+1);
   const slots=need.map(pos=>{occ[pos]=(occ[pos]||0)+1; return {pos,key:pos+(totalNeed[pos]>1?occ[pos]:'')};});
   const players=(myTeam.players||[]).slice(); const used={};
   return '<div class="sideFormation"><h3>Seu Campo</h3><div class="pitch">'+slots.map((sl,i)=>{
     const p=players.find(x=>!used[x.id||x.name+i] && (x.assignedPos||x.pos)===sl.pos);
     if(p) used[p.id||p.name+i]=true;
     const k=sl.key; const xy=coords[k]||coords[sl.pos]||[50,50];
     return '<div class="pitchPos '+(p?'filled':'')+'" style="left:'+xy[0]+'%;top:'+xy[1]+'%"><div><span class="ppos">'+mpEsc(sl.pos)+'</span>'+(p?'<span class="pname">'+mpEsc(p.name)+'<br>OVR '+mpEsc(p.ovr)+'</span>':'')+'</div></div>';
   }).join('')+'</div></div>';
 }
 function renderPickFeed(log){
   const items=(log||[]).slice().reverse();
   if(!items.length) return '<div class="mpFeedList"><p class="mpSub">Nenhum pick ainda.</p></div>';
   return '<div class="mpFeedList">'+items.map(l=>'<div class="mpFeedItem"><div class="mpFeedAvatar">🤖</div><div><span>'+mpEsc(l.club)+' escolheu</span><b>'+mpEsc(l.card.name)+'</b><em>'+mpEsc(l.card.assignedPos||l.card.pos)+'</em></div></div>').join('')+'</div>';
 }
 function renderDraftOrder(d){
   const order=d.order||[];
   const teamsById={}; (d.teams||[]).forEach(t=>teamsById[t.id]=t);
   const round=Math.floor(d.index/20)+1;
   const dir=round%2===1?'1 → 20':'20 → 1';
   return '<aside class="mpDraftPanel"><div class="mpPanelHead">👥 Ordem do Draft</div><div class="mpDraftOrderList">'+order.map((o,i)=>{
     const t=teamsById[o.id]||o;
     const active=o.id===d.teamId?' active':'';
     return '<div class="mpDraftOrderRow'+active+'"><span class="num">'+(i+1)+'</span><span class="club">'+mpEsc(t.club)+'</span><span class="count">'+(t.count||0)+'/11</span></div>';
   }).join('')+'</div><div class="mpRoundBox"><b>Rodada '+round+' / 11</b><span>Serpente: '+dir+'</span></div></aside>';
 }
 function renderMpPitchV33(){
   if(!mpCurrentDraft) return '';
   const myTeam=(mpCurrentDraft.teams||[]).find(t=>t.id===myId) || {players:[]};
   const coords={GK:[50,88],LD:[82,72],ZAG1:[62,72],ZAG2:[38,72],LE:[18,72],VOL:[50,57],MC1:[36,43],MC2:[64,43],PE:[22,27],ATA:[50,20],PD:[78,27]};
   const need=mpFormationNeed(); const occ={}; const totalNeed={}; need.forEach(x=>totalNeed[x]=(totalNeed[x]||0)+1);
   const slots=need.map(pos=>{occ[pos]=(occ[pos]||0)+1; return {pos,key:pos+(totalNeed[pos]>1?occ[pos]:'')};});
   const players=(myTeam.players||[]).slice(); const used={};
   return '<div class="mpFieldWrap"><div class="mpCenterCircle"></div>'+slots.map((sl,i)=>{
     const p=players.find((x,j)=>!used[j] && (x.assignedPos||x.pos)===sl.pos);
     if(p){ const idx=players.indexOf(p); used[idx]=true; }
     const xy=coords[sl.key]||coords[sl.pos]||[50,50];
     return '<div class="mpPitchSlot '+(p?'filled':'')+'" style="left:'+xy[0]+'%;top:'+xy[1]+'%">'+(p?'<div>'+mpEsc(p.name)+'<small>'+mpEsc(sl.pos)+' • OVR '+mpEsc(p.ovr)+'</small></div>':mpEsc(sl.pos))+'</div>';
   }).join('')+'</div>';
 }
 function mpDraftCardHtmlV33(c){
   const kit=(typeof kitForPlayer==='function')?kitForPlayer(c):'👕';
   return '<div class="mpCardV33" onclick="MP.pick(\''+mpEsc(c.id)+'\')"><span class="tag '+mpEsc(c.pos)+'">'+mpEsc(c.pos)+'</span><span class="ball">⚽</span><div class="kit">'+kit+'</div><div class="name">'+mpEsc(c.name).toUpperCase()+'</div><div class="year">'+mpEsc(c.club||'HISTÓRICO').toUpperCase()+' • '+mpEsc(c.year)+'</div></div>';
 }
 function renderDraft(d){
   mpCurrentDraft=d;
   show('mpDraft');
   const isMe=d.teamId===myId;
   const round=Math.floor(d.index/20)+1;
   by('mpDraftTitle').textContent='';
   by('mpDraftSub').textContent='';
   by('mpDraftTeams').innerHTML='';
   const optionsHtml=isMe
     ? '<div class="mpPickHeader">Escolha um jogador para o seu time</div><div id="mpOptionsInner" class="mpCardGridV33">'+(d.options||[]).slice(0,10).map(mpDraftCardHtmlV33).join('')+'</div>'
     : '<div class="mpPickHeader">Aguardando escolha</div><div class="mpWaiting"><div><h2>'+mpEsc(d.club)+'</h2><p class="mpSub">'+(d.human?'Esse player está escolhendo agora.':'Bot escolhendo automaticamente em 2 segundos.')+'</p></div></div>';
   const main='<main class="mpDraftPanel mpMainPanel"><div class="mpTeamHeader"><div class="mpTeamTitle"><div class="mpShield">♙</div><div><h2>Seu Time</h2><p>4-3-3</p></div></div><div class="mpStatsMini"><div class="mpStatBox">Entrosamento<b>0</b></div><div class="mpStatBox">Overall<b>--</b></div></div></div>'+renderMpPitchV33()+optionsHtml+'<div style="padding:12px 20px 16px"><div class="mpLog" style="height:auto"><b>Tempo para escolher</b> <span class="mpTitle" style="float:right">20s</span><div style="clear:both;height:8px;background:#162231;border-radius:99px;margin-top:10px"><div style="height:100%;width:55%;background:#f2c94c;border-radius:99px"></div></div></div></div></main>';
   const feed='<aside class="mpDraftPanel"><div class="mpPanelHead">📋 Histórico do Draft</div>'+renderPickFeed(d.pickLog)+'</aside>';
   by('mpOptions').className='';
   by('mpOptions').innerHTML='<div class="mpTopLine"><div><h1>Ultimate Draft FC Online</h1><p class="mpSub">Rodada '+round+' • Pick '+(d.index+1)+' / '+d.total+' — Vez de: '+mpEsc(d.club)+(isMe?' — SUA VEZ':'')+'</p></div></div><div class="mpDraftShell">'+renderDraftOrder(d)+main+feed+'</div>';
 }
 function renderMatch(m){ by('mpMatchTitle').textContent=m.home.club+' x '+m.away.club; by('mpScore').textContent=m.h+' x '+m.a; by('mpClock').textContent=m.minute+"'"; }
 function renderStandings(d){ show('mpStandings'); by('mpStandingsTable').innerHTML='<tr><th>#</th><th>Clube</th><th>PTS</th><th>J</th><th>V</th><th>E</th><th>D</th><th>SG</th></tr>'+d.standings.map((s,i)=>'<tr><td>'+(i+1)+'</td><td>'+s.club+(s.human?' 👤':' 🤖')+'</td><td>'+s.PTS+'</td><td>'+s.P+'</td><td>'+s.V+'</td><td>'+s.E+'</td><td>'+s.D+'</td><td>'+(s.GP-s.GC)+'</td></tr>').join(''); }
 window.MP={ open(){ensureSocket();by('mpOverlay').classList.add('show');show('mpHome')}, close(){by('mpOverlay').classList.remove('show')}, createRoom(){ensureSocket().emit('mp:createRoom',{club:by('mpClubCreate').value,password:by('mpPassCreate').value})}, joinRoom(){roomCode=by('mpCodeJoin').value;ensureSocket().emit('mp:joinRoom',{code:roomCode,password:by('mpPassJoin').value,club:by('mpClubJoin').value})}, startDraft(){ensureSocket().emit('mp:startDraft',{code:roomCode})}, pick(id){ const card=(mpCurrentDraft&&mpCurrentDraft.options||[]).find(c=>c.id===id); if(card) mpOpenPositionModal(card); } };
 window.addEventListener('load',()=>{ const btn=document.createElement('button'); btn.className='startButton mpOnlineBtn'; btn.textContent='Jogar entre amigos (Online)'; btn.onclick=()=>MP.open(); const panel=document.querySelector('.setupPanel'); if(panel) panel.appendChild(btn); });
})();
