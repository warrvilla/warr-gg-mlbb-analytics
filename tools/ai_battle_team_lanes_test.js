process.on('unhandledRejection',()=>{});process.on('uncaughtException',e=>{if(!/Supabase|no net/.test(e.message))console.error('UNCAUGHT:',e.message);});
const fs=require('fs');const path=require('path');const {JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const ROOT="/sessions/dreamy-upbeat-hopper/mnt/Warr GG";
let html=fs.readFileSync(path.join(ROOT,'ai_battle.html'),'utf8');
for(const f of ['warr-lib.js','warr-nav.js','warr-theme.js']){const code=fs.readFileSync(path.join(ROOT,f),'utf8');html=html.replace(new RegExp('<script src="'+f+'"></script>'),'<script>'+code.replace(/<\/script>/g,'<\\/script>')+'</script>');}
html=html.replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const today=new Date();const d=n=>{const x=new Date(today);x.setDate(x.getDate()-n);return x.toISOString().slice(0,10);};
const driver=`<script>
window.__out=[];const log=(...a)=>window.__out.push(a.join(' '));
window.__sim=function(){
  // ---------- A) UNIT: computeHeroLanesScoped ----------
  const recent=d=>d; // already formatted by node
  const M=(date,league,blueTeam,redTeam,bluePicks,redPicks)=>({date,league,blueTeam,redTeam,bluePicks,redPicks,winner:'blue'});
  const P=(name,lane)=>({name,lane});
  const matches=[
    // BTR runs Yi Sun-shin JUNGLE (recent, several games)
    M('${d(5)}','MPL PH','BTR','X',[P('Yi Sun-shin','Jungle'),P('Lukas','Gold')],[P('Tigreal','Roam')]),
    M('${d(9)}','MPL PH','Y','BTR',[P('Chou','Roam')],[P('Yi Sun-shin','Jungle'),P('Valir','Mid')]),
    M('${d(12)}','MPL PH','BTR','Z',[P('Yi Sun-shin','Jungle')],[P('Franco','Roam')]),
    // a STALE BTR game (very old) where YSS was Gold — should age out
    M('${d(400)}','MPL PH','BTR','W',[P('Yi Sun-shin','Gold')],[P('Akai','Roam')]),
    // OTHER PH teams run Yi Sun-shin GOLD (region identity differs)
    M('${d(6)}','MPL PH','X','Q',[P('Yi Sun-shin','Gold')],[P('Hylos','Roam')]),
    M('${d(7)}','MPL PH','Q','X',[P('Lolita','Roam')],[P('Yi Sun-shin','Gold'),P('Pharsa','Mid')]),
  ];
  const teamL=WDB.computeHeroLanesScoped(matches,{team:'BTR'});
  const regionL=WDB.computeHeroLanesScoped(matches,{league:'MPL PH'});
  log('=== A) computeHeroLanesScoped ===');
  log('BTR  Yi Sun-shin ->',JSON.stringify(teamL['Yi Sun-shin']),'(expect ["Jungle"], stale Gold dropped)');
  log('Region Yi Sun-shin ->',JSON.stringify(regionL['Yi Sun-shin']),'(region mixes both, gold-heavy)');
  log('Global Yi Sun-shin ->',JSON.stringify(getHeroLanesAB(HEROES.find(h=>h.name==='Yi Sun-shin'))),'(no ctx)');

  // ---------- B) INTEGRATION: emulated team assigns its lane ----------
  log('\\n=== B) Integration: emulated team lane assignment ===');
  const yss=HEROES.find(h=>h.name==='Yi Sun-shin');
  if(!yss){log('Yi Sun-shin not in HEROES — skip');return true;}
  // emulate BTR on RED (the AI side)
  aiMode='enemy';aiSide='red';pSide='blue';enemyProfile={name:'BTR',t:{gamesPlayed:9,winRate:55}};
  _emuLaneTable=Object.assign({},regionL,teamL); // same merge initBattle does
  laneAssignmentsAB={};laneManualAB={};
  ST={step:0,bb:[],rb:[],bp:[],rp:[],hist:[]};
  // RED (emulated BTR) picks YSS
  ST.rp.push(yss);resolveTeamLanesAB(ST.rp,_laneCtxForSide('red'));
  log('RED=BTR (emulated) Yi Sun-shin assigned lane:',effectiveLaneAB(yss),'(expect Jungle)');
  // BLUE (human, no identity) picks YSS — should use global, not BTR jungle
  laneAssignmentsAB={};ST={step:0,bb:[],rb:[],bp:[],rp:[],hist:[]};
  ST.bp.push(yss);resolveTeamLanesAB(ST.bp,_laneCtxForSide('blue'));
  log('BLUE=human Yi Sun-shin assigned lane:',effectiveLaneAB(yss),'(should follow GLOBAL, not forced Jungle)');

  // ---------- C) sanity: full emulated draft stays legal ----------
  log('\\n=== C) Full emulated draft legality (RED=BTR) ===');
  diff='gm';enemyProfile={name:'BTR',t:{gamesPlayed:9,winRate:55}};aiMode='enemy';aiSide='red';pSide='blue';
  _emuLaneTable=Object.assign({},regionL,teamL);
  ST={step:0,bb:[],rb:[],bp:[],rp:[],hist:[]};laneAssignmentsAB={};laneManualAB={};
  const used=()=>new Set([...ST.bb,...ST.rb,...ST.bp,...ST.rp].map(h=>h.id));
  const avail=()=>HEROES.filter(h=>!used().has(h.id));
  let bad=0;
  for(let i=0;i<DRAFT_ORDER.length;i++){ST.step=i;const s=DRAFT_ORDER[i];let hero;
    if(s.team===aiSide){try{hero=localAI(s);}catch(e){log('THROW @'+i+': '+e.message);bad++;break;}}
    else{const a=avail();hero=a[Math.floor(Math.random()*a.length)];}
    if(!hero){log('NULL @'+i);bad++;break;}
    if(s.type==='ban')(s.team==='blue'?ST.bb:ST.rb).push(hero);else{(s.team==='blue'?ST.bp:ST.rp).push(hero);resolveTeamLanesAB(s.team==='blue'?ST.bp:ST.rp,_laneCtxForSide(s.team));}
  }
  const redLanes=ST.rp.map(h=>h.name+':'+effectiveLaneAB(h));
  const distinct=new Set(ST.rp.map(h=>effectiveLaneAB(h)).filter(l=>l!=='Flex'));
  log('RED(BTR) comp:',redLanes.join(', '));
  log('RED distinct lanes filled:',distinct.size+'/5','| issues:',bad);
  return true;
};
</script>`;
html=html.replace('</body>',driver+'</body>');
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:new VirtualConsole(),pretendToBeVisual:true,
  beforeParse(window){const s={};window.localStorage={getItem:k=>(k in s?s[k]:null),setItem:(k,v)=>{s[k]=String(v);},removeItem:k=>{},clear:()=>{}};window.fetch=()=>Promise.reject(new Error('no net'));window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});}});
const w=dom.window;
setTimeout(()=>{if(typeof w.__sim!=='function'){console.log('SIM NOT READY');process.exit(1);}try{w.__sim();}catch(e){console.log('SIM THREW:',e.message,e.stack);process.exit(1);}(w.__out||[]).forEach(l=>console.log(l));process.exit(0);},2000);
