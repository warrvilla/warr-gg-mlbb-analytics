process.on('unhandledRejection',()=>{});process.on('uncaughtException',e=>{if(!/Supabase|no net/.test(e.message))console.error('UNCAUGHT:',e.message);});
const fs=require('fs');const path=require('path');const {JSDOM,VirtualConsole}=require('/tmp/node_modules/jsdom');
const ROOT="/sessions/dreamy-upbeat-hopper/mnt/Warr GG";
let html=fs.readFileSync(path.join(ROOT,'ai_battle.html'),'utf8');
for(const f of ['warr-lib.js','warr-nav.js','warr-theme.js']){const code=fs.readFileSync(path.join(ROOT,f),'utf8');html=html.replace(new RegExp('<script src="'+f+'"></script>'),'<script>'+code.replace(/<\/script>/g,'<\\/script>')+'</script>');}
html=html.replace(/<script src="https:\/\/[^"]+"><\/script>/g,'');
const driver=`<script>
window.__out=[];const log=(...a)=>window.__out.push(a.join(' '));
window.__sim=function(){
  const LANES=['Gold','Jungle','Mid','EXP','Roam'];
  const laneSet=h=>{let l=getHeroLanesAB(h).filter(x=>x!=='Flex');if(!l.length)l=LANES.slice();return l;};
  // ---- inject a synthetic but realistic meta so tiers differ ----
  // spread heroes across tiers deterministically; give each a primary lane
  const tiers=['S','A','A','B','B','B','C','C'];
  HEROES.forEach((h,i)=>{
    const t=tiers[i%tiers.length];
    const pl=laneSet(h)[0];
    TIER_LIST[h.name]={tier:t,lane:pl};
    const base={S:62,A:54,B:42,C:30}[t]||30;
    META_SCORES[h.name]={pr:base, br:Math.max(5,base-20), ms:({S:9,A:7,B:5,C:3})[t]};
  });
  if(typeof invalidateScoutIntel==='function')try{invalidateScoutIntel();}catch(e){}
  const tierOf=n=>(typeof _dbTier==='function'?_dbTier(n):'?');
  // perfect bipartite matching: can 5 picks each take a distinct lane?
  function canFill(picks){
    const cand=picks.map(laneSet);const used={};const m={};
    function aug(i,seen){for(const L of cand[i]){if(seen[L])continue;seen[L]=1;if(m[L]===undefined||aug(m[L],seen)){m[L]=i;return true;}}return false;}
    for(let i=0;i<cand.length;i++){if(!aug(i,{}))return false;}return true;
  }
  function runDraft(bs,rs,df){
    diff=df;aiMode='pvp';enemyProfile=null;pSide='blue';aiSide='red';pName='You';
    ST={step:0,bb:[],rb:[],bp:[],rp:[],hist:[]};
    const issues=[];const banTags={blue:[],red:[]};
    const usedId=()=>new Set([...ST.bb,...ST.rb,...ST.bp,...ST.rp].map(h=>h.id));
    const avail=()=>HEROES.filter(h=>!usedId().has(h.id));
    const order={S:4,A:3,B:2,C:1,D:0};
    const gPick=step=>{const myP=step.team==='blue'?ST.bp:ST.rp;const lg=avail().filter(h=>laneFeasibleAB(myP,h));lg.sort((a,b)=>(order[tierOf(b.name)]||0)-(order[tierOf(a.name)]||0));return lg[0]||avail()[0];};
    const gBan=()=>avail().slice().sort((x,y)=>(order[tierOf(y.name)]||0)-(order[tierOf(x.name)]||0))[0];
    const rnd=()=>{const a=avail();return a[Math.floor(Math.random()*a.length)];};
    for(let i=0;i<DRAFT_ORDER.length;i++){
      ST.step=i;const step=DRAFT_ORDER[i];const strat=step.team==='blue'?bs:rs;let hero;
      try{if(strat==='ai')hero=localAI(step);else if(strat==='greedy')hero=step.type==='ban'?gBan():gPick(step);else hero=rnd();}
      catch(e){issues.push('THROW @'+i+' '+step.type+'/'+step.team+': '+e.message);break;}
      if(!hero){issues.push('NULL @'+i);break;}
      if(strat==='ai'){if(usedId().has(hero.id))issues.push('DUP @'+i+': '+hero.name);
        if(step.type==='pick'){const myP=step.team==='blue'?ST.bp:ST.rp;if(!laneFeasibleAB(myP,hero))issues.push('ILLEGAL lane @'+i+': '+hero.name);}
        if(step.type==='ban'){const m=(hero._r||'').match(/\\[([^\\]]+)\\]/);banTags[step.team].push(m?m[1]:'?');}}
      if(step.type==='ban')(step.team==='blue'?ST.bb:ST.rb).push(hero);else(step.team==='blue'?ST.bp:ST.rp).push(hero);
    }
    const bFill=canFill(ST.bp),rFill=canFill(ST.rp);
    if(bs==='ai'&&!bFill)issues.push('BLUE comp has NO valid 5-lane assignment: '+ST.bp.map(h=>h.name+'('+laneSet(h).join('/')+')').join(', '));
    if(rs==='ai'&&!rFill)issues.push('RED comp has NO valid 5-lane assignment: '+ST.rp.map(h=>h.name+'('+laneSet(h).join('/')+')').join(', '));
    return{bb:ST.bb.slice(),rb:ST.rb.slice(),bp:ST.bp.slice(),rp:ST.rp.slice(),issues,bFill,rFill,banTags};
  }
  const fmt=arr=>arr.map(h=>h.name+'['+tierOf(h.name)+']').join(', ');
  const scen=[['AI vs AI','ai','ai','gm'],['AI vs Greedy','ai','greedy','gm'],['Greedy vs AI','greedy','ai','gm'],['AI vs Random','ai','random','hard']];
  for(const[name,b,r,df]of scen){
    log('\\n========================================');log('SCENARIO:',name,'| diff='+df);
    const x=runDraft(b,r,df);
    log('BLUE bans:',fmt(x.bb),'  tags:['+x.banTags.blue.join(',')+']');
    log('BLUE pick:',fmt(x.bp),'| 5-lane assignable:',x.bFill);
    log('RED  bans:',fmt(x.rb),'  tags:['+x.banTags.red.join(',')+']');
    log('RED  pick:',fmt(x.rp),'| 5-lane assignable:',x.rFill);
    if(x.issues.length){log('  !! ISSUES:');x.issues.forEach(s=>log('   -',s));}else log('  OK: legal, no dups, both comps form a valid 5-role lineup');
  }
  log('\\n========================================');log('REGRESSION: 100x AI-vs-AI (GM)');
  let faults=0,badComp=0;const tagCount={};let sBanHi=0,banTot=0;
  for(let k=0;k<100;k++){const x=runDraft('ai','ai','gm');if(x.issues.length)faults+=x.issues.length;if(!x.bFill||!x.rFill)badComp++;
    for(const sd of['blue','red']){x.banTags[sd].forEach(t=>tagCount[t]=(tagCount[t]||0)+1);
      const bans=sd==='blue'?x.bb:x.rb;const picks=sd==='blue'?x.bp:x.rp;
      const pickIds=new Set(picks.map(h=>h.id));
      for(const bh of bans){banTot++;if(['S','A'].includes(tierOf(bh.name))){/* would it have fit our comp? */
        const test=picks.slice(0,4).concat([bh]);if(picks.length>=4&&canFill(test)&&!pickIds.has(bh.id)){const ls=laneSet(bh);const ourLanes=new Set();picks.forEach(p=>laneSet(p).forEach(l=>ourLanes.add(l)));}}}}}
  log('Structural faults over 100 drafts:',faults);
  log('Drafts with an invalid comp (no 5-lane assignment):',badComp+' / 100');
  log('Ban-reason tag distribution:',JSON.stringify(tagCount));
  return true;
};
</script>`;
html=html.replace('</body>',driver+'</body>');
const dom=new JSDOM(html,{runScripts:'dangerously',virtualConsole:new VirtualConsole(),pretendToBeVisual:true,
  beforeParse(window){const s={};window.localStorage={getItem:k=>(k in s?s[k]:null),setItem:(k,v)=>{s[k]=String(v);},removeItem:k=>{},clear:()=>{}};window.fetch=()=>Promise.reject(new Error('no net'));window.matchMedia=()=>({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});}});
const w=dom.window;
setTimeout(()=>{if(typeof w.__sim!=='function'){console.log('SIM NOT READY');process.exit(1);}try{w.__sim();}catch(e){console.log('SIM THREW:',e.message,e.stack);process.exit(1);}(w.__out||[]).forEach(l=>console.log(l));process.exit(0);},2000);
