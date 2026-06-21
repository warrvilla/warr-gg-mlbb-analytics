process.on('unhandledRejection',()=>{});process.on('uncaughtException',e=>{if(!/Supabase|no net/.test(e.message))console.error('UNCAUGHT:',e.message);});
const fs=require('fs');const path=require('path');const {JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const ROOT="/sessions/dreamy-upbeat-hopper/mnt/Warr GG";
let html=fs.readFileSync(path.join(ROOT,'ai_battle.html'),'utf8');
for(const f of ['warr-lib.js','warr-nav.js','warr-theme.js']){const code=fs.readFileSync(path.join(ROOT,f),'utf8');html=html.replace(new RegExp('<script src="'+f+'"></script>'),'<script>'+code.replace(/<\/script>/g,'<\\/script>')+'</script>');}
html=html.replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const dd=n=>{const x=new Date();x.setDate(x.getDate()-n);return x.toISOString().slice(0,10);};
// Build a fake scouted team "ZETA" with a clear identity:
//  - Always FIRST-PICKS "Lukas" (priority), mastered (high WR+KDA)
//  - Always FIRST-BANS "Fanny"
const P=(name,lane,k,d,a)=>({name,lane,kda:{k,d,a}});
const mk=(date,bt,rt,bp,rp,bb,rb,winner)=>({date,league:'MPL PH',blueTeam:bt,redTeam:rt,bluePicks:bp,redPicks:rp,blueBans:bb,redBans:rb,winner,gameNum:1,seriesFormat:'BO3'});
const G=[];
for(let i=0;i<6;i++){
  // ZETA on blue: Lukas first pick (idx0), wins, great KDA; Fanny first ban
  G.push(mk(dd(3+i),'ZETA','OPP',
    [P('Lukas','Gold',8,1,9),P('Tigreal','Roam',1,3,12),P('Chou','EXP',4,2,6),P('Valir','Mid',6,2,8),P('Baxia','Jungle',2,2,10)],
    [P('Beatrix','Gold',3,5,4),P('Atlas','Roam',1,6,7),P('Paquito','EXP',5,4,3),P('Pharsa','Mid',4,3,6),P('Ling','Jungle',6,5,2)],
    ['Fanny','Lancelot','Kadita'],['Harith','Novaria','Yu Zhong'],'blue'));
}
const scoutDB={matches:G,teams:{ZETA:{gamesPlayed:6,winRate:100,topPicks:[{name:'Lukas',count:6}],topBans:[{name:'Fanny',count:6}]}}};
const driver=`<script>
window.__out=[];const log=(...a)=>window.__out.push(a.join(' '));
window.__sim=function(){
  // seed scout cache the engine reads
  localStorage.setItem(SCOUT_KEY_AB, ${JSON.stringify(JSON.stringify(scoutDB))});
  buildEnemyProfileCache('ZETA');
  const ep=enemyProfile;
  log('=== ENEMY PROFILE: ZETA ===');
  log('blueSideCore:',JSON.stringify(ep.blueSideCore));
  log('Lukas pickPos (blue):',ep.bluePickPos['Lukas'],'(expect ~0 = first pick priority)');
  log('Tigreal pickPos (blue):',ep.bluePickPos['Tigreal']);
  log('Lukas mastery:',JSON.stringify(ep.heroMastery['Lukas']),'(expect high score, 100% WR)');
  log('Beatrix mastery (they never play):',JSON.stringify(ep.heroMastery['Beatrix']||'none'));
  log('blueBanPhase1 (priority order):',JSON.stringify(ep.blueBanPhase1),'(expect Fanny first)');
  log('blueBanFreq Fanny:',ep.blueBanFreq&&ep.blueBanFreq['Fanny']);

  // Now emulate ZETA on BLUE and run its first few picks/bans to see if identity shows
  diff='gm';aiMode='enemy';pSide='red';aiSide='blue';pName='You';
  ST={step:0,bb:[],rb:[],bp:[],rp:[],hist:[]};laneAssignmentsAB={};laneManualAB={};
  // give the engine a meta so tiers exist
  HEROES.forEach((h,i)=>{TIER_LIST[h.name]={tier:['S','A','B','B','C'][i%5],lane:(getHeroLanesAB(h)[0]||'Mid')};META_SCORES[h.name]={pr:50,br:30,ms:6};});
  if(typeof invalidateScoutIntel==='function')try{invalidateScoutIntel();}catch(e){}
  log('\\n=== Emulated ZETA (blue) first decisions ===');
  const used=()=>new Set([...ST.bb,...ST.rb,...ST.bp,...ST.rp].map(h=>h.id));
  const avail=()=>HEROES.filter(h=>!used().has(h.id));
  for(let i=0;i<DRAFT_ORDER.length;i++){ST.step=i;const s=DRAFT_ORDER[i];let hero;
    if(s.team===aiSide){try{const ctx=draftBrainAB(s);hero=ctx.hero;if(s.type==='ban'&&ST.bb.length===0&&s.team==='blue')log('ZETA first BAN ->',hero.name,'| reason:',ctx.reason);if(s.type==='pick'&&ST.bp.length===0&&s.team==='blue')log('ZETA first PICK ->',hero.name,'| reason:',ctx.reason);}catch(e){log('THROW @'+i+': '+e.message);break;}}
    else{const a=avail();hero=a[Math.floor(Math.random()*a.length)];}
    if(!hero)break;
    if(s.type==='ban')(s.team==='blue'?ST.bb:ST.rb).push(hero);else(s.team==='blue'?ST.bp:ST.rp).push(hero);
  }
  log('ZETA(blue) final picks:',ST.bp.map(h=>h.name).join(', '));
  return true;
};
</script>`;
html=html.replace('</body>',driver+'</body>');
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://warr.gg/',virtualConsole:new VirtualConsole(),pretendToBeVisual:true,
  beforeParse(window){window.fetch=()=>Promise.reject(new Error('no net'));window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});}});
const w=dom.window;
setTimeout(()=>{if(typeof w.__sim!=='function'){console.log('SIM NOT READY');process.exit(1);}try{w.__sim();}catch(e){console.log('SIM THREW:',e.message,e.stack);process.exit(1);}(w.__out||[]).forEach(l=>console.log(l));process.exit(0);},2200);
