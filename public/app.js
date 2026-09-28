import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, where, orderBy, limit, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, arrayUnion, arrayRemove, increment, Timestamp, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { VAPID_KEY } from "./config.js";
import * as G from "./game.js";

const CREATURES=G.CREATURES;
const S={phase:"loading",user:null,role:null,device:null,config:null,bank:{},prefs:{},weeks:{},xp:{},battles:{},claims:{},bounties:{},game:{},devices:[],codes:[],ptab:"activity",viewKid:null,busy:{},
  ui:{goalInput:"",newGoal:{name:"",target:""},ded:{kid:"",amount:0.25,reason:"",how:""},buy:null,pgoal:{},editGoal:null,kidView:null,adjust:null,openBuckets:{},confirmChore:null,prNote:null,split:{key:null,base:"",dirty:false,shares:{}},draft:null,pickCreature:false,wtab:"creature",prevPct:{},prevLvl:{},bb:null,levelUp:null,xpHist:{},pair:{code:"",name:""},newCode:{role:"display"},log:{kid:"",chore:"",note:""}}};

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r2=n=>Math.round((Number(n)||0)*100)/100;
const q=n=>Math.round((Number(n)||0)*4)/4;
const qd=n=>Math.floor((Number(n)||0)*4+1e-9)/4;   // round down to the nearest quarter
const BONUS_RATE=.25;   // bonus for reaching the weekly goal, as a share of the goal
const money=n=>(n<0?"−":"")+"$"+Math.abs(r2(n)).toFixed(2);
const uid=()=>Math.random().toString(36).slice(2,10);
const clone=o=>JSON.parse(JSON.stringify(o));
function ymd(d=new Date()){const z=n=>String(n).padStart(2,"0");return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());}
function parseYmd(s){const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d);}
function mondayOf(d){const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return ymd(x);}
function addDays(s,n){const x=parseYmd(s);x.setDate(x.getDate()+n);return ymd(x);}
function shortDate(s){return parseYmd(s).toLocaleDateString(undefined,{month:"short",day:"numeric"});}
function nowHM(){const d=new Date();return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0");}
function timeOf(t){return new Date(t).toLocaleString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit"});}
function setPath(obj,path,val){const p=path.split(".");let o=obj;for(let i=0;i<p.length-1;i++){if(o[p[i]]==null)o[p[i]]={};o=o[p[i]];}o[p[p.length-1]]=val;}
let toastTimer;function toast(msg){let t=$(".toast");if(!t){t=document.createElement("div");t.className="toast";t.setAttribute("role","status");document.body.appendChild(t);}t.textContent=msg;clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.remove(),3000);}
const errMsg=e=>(e&&e.message||"Something went wrong").replace(/^Firebase: /,"");

/* ---------- Firebase ---------- */
let app,auth,db,fns,msg=null;
try{
  const cfg=await (await fetch("/__/firebase/init.json")).json();
  app=initializeApp(cfg);auth=getAuth(app);
  db=initializeFirestore(app,{localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
  fns=getFunctions(app);
  // Local development: `firebase emulators:start` serves the app on localhost and talks to the emulators.
  if(["localhost","127.0.0.1"].includes(location.hostname)){connectAuthEmulator(auth,"http://127.0.0.1:9099",{disableWarnings:true});connectFirestoreEmulator(db,"127.0.0.1",8080);connectFunctionsEmulator(fns,"127.0.0.1",5001);}
}catch(e){document.getElementById("app").innerHTML=`<div class="center"><div class="logo">Boon <span>Chore Tracker</span></div><p class="sub" style="max-width:420px">Open this app from its Firebase Hosting address (your-project.web.app). It can't start from a saved file.</p></div>`;throw e;}
const call=name=>httpsCallable(fns,name);
async function messaging(){if(msg)return msg;if(!(await isSupported().catch(()=>false)))return null;msg=getMessaging(app);onMessage(msg,p=>toast((p.notification&&p.notification.body)||"Reminder"));return msg;}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(()=>{});

/* ---------- data access ---------- */
const cfg=()=>S.config;
const kidCfg=id=>cfg().kids.find(k=>k.id===id);
const kidsSorted=()=>[...cfg().kids].sort((a,b)=>(!!b.adult-!!a.adult)||((b.age||0)-(a.age||0)));
const choreById=id=>cfg().chores.find(c=>c.id===id);
const needsNote=c=>!!c&&(c.ask===true||(c.ask==null&&/parent'?s?\s*choice/i.test(c.name||"")));
const prChores=()=>cfg().chores.filter(c=>c.kind==="pr");
const famChoresFor=kidId=>cfg().chores.filter(c=>c.kind==="family"&&(c.assign==="pool"||c.assign===kidId));
const choreValue=(kid,ch)=>r2((kid.rate||0)*(ch.mult||1));
function kidState(id){
  const b=S.bank[id]||{},p=S.prefs[id]||{},bal=b.goalBal||{};
  const archivedIds=new Set((b.archived||[]).map(a=>a.goalId).filter(Boolean));
  const goals=[{id:"general",name:"General savings",target:0,balance:r2(bal.general||0)}];
  Object.entries(p.goals||{}).filter(([gid])=>!archivedIds.has(gid)).sort((a,c)=>(a[1].created||0)-(c[1].created||0))
    .forEach(([gid,g])=>goals.push({id:gid,name:g.name,target:g.target||0,balance:r2(bal[gid]||0)}));
  return {creature:p.creature||null,interestTo:p.interestTo||"invest",prLog:p.prLog||{},prDone:p.prDone||{},prNotes:p.prNotes||{},goals,archived:b.archived||[],invest:r2(b.invest||0),give:r2(b.give||0),
    stats:Object.assign({chores:0,goalHits:0,redemptions:0,earned:0},b.stats||{}),lastInterestMonth:b.lastInterestMonth||null};
}
function creatureFor(kidId){const ks=kidState(kidId);const idx=cfg().kids.findIndex(k=>k.id===kidId);const starters=CREATURES.filter(c=>c[3]===1);
  const id=ks.creature&&xpState(kidId).unlocked.has("c:"+ks.creature)?ks.creature:starters[Math.max(0,idx)%starters.length][0];return CREATURES.find(c=>c[0]===id)||CREATURES[0];}

/* ---------- game state ---------- */
function xpState(id){const x=S.xp[id]||{};const level=x.maxLevel||1,total=x.total||0,need=level>=G.MAX_LEVEL?0:G.xpToNext(level);
  return {total,level,need,into:Math.max(0,Math.min(need,total-G.levelStart(level))),unlocked:new Set([...G.STARTERS.map(c=>"c:"+c),...(x.unlocked||G.unlockedIds(level,x))]),
    freezes:x.freezes||0,frozen:x.frozenDates||[],counts:x.counts||{},pb:x.pb||{},levelUp:x.levelUp||null,notice:x.notice||null};}
function equipped(id){const e=(S.prefs[id]||{}).equipped||{},u=xpState(id).unlocked;const ok=(k,p)=>e[k]&&u.has(p+e[k])?e[k]:"";
  return {hat:ok("hat","h:"),theme:ok("theme","t:"),trail:ok("trail","r:"),confetti:ok("confetti","f:"),title:ok("title","ti:")};}
function titleOf(id){const lv=xpState(id).level,t=equipped(id).title;const f=G.TITLES.find(x=>x[0]===t)||G.TITLES.filter(x=>!x[3]&&x[2]<=lv).pop();return f?f[1]:"";}
// A person's creature with its growth stage and accessory.
function crHtml(id){const cr=creatureFor(id),hat=G.HATS.find(h=>h[0]===equipped(id).hat);return `<span class="cr stage-${G.stageFor(xpState(id).level)}">${cr[1]}${hat?`<i class="hat hat-${hat[0]}" aria-hidden="true">${hat[1]}</i>`:""}</span>`;}
const game=()=>G.gameCfg(cfg());
const cotdId=()=>G.choreOfDay(cfg().chores,ymd(),cfg());
const choreXpFor=(kidId,ch)=>G.choreXp(ch,{cotd:cotdId()===ch.id,boost:G.streakBoost(cfg(),streak(kidId))});
const battleList=()=>Object.entries(S.battles).map(([id,b])=>({id,...b})).sort((a,b)=>b.createdAt-a.createdAt);
const weekDocId=(kid,wk)=>wk+"_"+kid;
function getWeek(kid,wk){return Object.assign({kidId:kid,week:wk,goal:null,entries:[],deductions:[],closed:false},S.weeks[weekDocId(kid,wk)]||{});}
function activeWeek(kid){const wk=mondayOf(new Date());const w=S.weeks[weekDocId(kid,wk)];return (w&&w.closed)?addDays(wk,7):wk;}
function weekNet(w){let n=0;for(const e of w.entries||[])if(e.status!=="reversed")n+=e.amount;for(const d of w.deductions||[])if(d.status==="active"||d.status==="final")n-=d.amount;return r2(n);}
const choreCount=w=>(w.entries||[]).filter(e=>e.status!=="reversed").length;
function countOnDate(kidId,choreId,date){let n=0;for(const w of Object.values(S.weeks)){if(w.kidId!==kidId)continue;for(const e of w.entries||[])if(e.choreId===choreId&&e.date===date&&e.status!=="reversed")n++;}return n;}
function choreCountToday(kidId,ch,date){const me=kidCfg(kidId);if(ch.assign==="pool"&&!(me&&me.adult))return cfg().kids.filter(k=>!k.adult).reduce((s,k)=>s+countOnDate(k.id,ch.id,date),0);return countOnDate(kidId,ch.id,date);}
const openWeeks=kidId=>Object.values(S.weeks).filter(w=>w.kidId===kidId&&!w.closed).map(w=>getWeek(w.kidId,w.week));
function prComplete(ks,date,frozen){if(ks.prDone&&ks.prDone[date])return true;if(frozen&&frozen.includes(date))return true;const ids=prChores().map(c=>c.id);if(!ids.length)return false;const d=ks.prLog[date]||[];return ids.every(i=>d.includes(i));}
function streak(kidId){const ks=kidState(kidId),fz=xpState(kidId).frozen;let d=ymd();if(!prComplete(ks,d,fz))d=addDays(d,-1);let n=0;while(prComplete(ks,d,fz)&&n<400){n++;d=addDays(d,-1);}return n;}
function bestStreak(kidId){const ks=kidState(kidId),fz=xpState(kidId).frozen;const dates=[...new Set([...Object.keys(ks.prLog),...Object.keys(ks.prDone),...fz])].filter(d=>prComplete(ks,d,fz)).sort();let best=0,run=0,prev=null;for(const d of dates){run=(prev&&addDays(prev,1)===d)?run+1:1;best=Math.max(best,run);prev=d;}return best;}
// A day counts as complete once it has been completed; later changes to the checklist don't undo it.
// Days completed before this flag existed get one on first load, judged by the list at that time.
const prBackfilled=new Set();
function backfillPrDone(){
  if(!S.config)return;
  for(const k of cfg().kids){
    if(prBackfilled.has(k.id)||!S.prefs[k.id])continue;
    if(!(S.role==="parent"||(S.role==="kid"&&S.viewKid===k.id)))continue;
    prBackfilled.add(k.id);const ks=kidState(k.id),add={};
    for(const d of Object.keys(ks.prLog))if(!ks.prDone[d]&&prComplete(ks,d))add[d]=true;
    if(Object.keys(add).length)setDoc(doc(db,"prefs",k.id),{prDone:add},{merge:true}).catch(e=>console.warn(e));
  }
}
// Where a week's savings go: {goalId: fraction} over goals that still exist. Older weeks used a single saveTo.
function saveSplitFor(w,ks){
  const ids=ks.goals.map(g=>g.id);let s={};
  if(w.saveSplit&&typeof w.saveSplit==="object")for(const [id,v] of Object.entries(w.saveSplit)){const n=Number(v);if(ids.includes(id)&&n>0)s[id]=n;}
  if(!Object.keys(s).length){const g=ks.goals.find(g=>g.id===w.saveTo)||ks.goals[0];if(!g)return {};s={[g.id]:1};}
  const tot=Object.values(s).reduce((a,b)=>a+b,0);for(const id in s)s[id]=s[id]/tot;return s;
}
// Split a dollar amount by fractions into whole cents that add up exactly; spare cents go to the biggest shares.
function splitCents(amount,fr){
  const ids=Object.keys(fr);if(!ids.length)return {};const cents=Math.round(amount*100),out={};let used=0;
  for(const id of ids){out[id]=Math.floor(cents*fr[id]+1e-9);used+=out[id];}
  const order=[...ids].sort((a,b)=>fr[b]-fr[a]);for(let rem=cents-used,i=0;rem>0;rem--,i=(i+1)%order.length)out[order[i]]++;
  for(const id of ids)out[id]=out[id]/100;return out;
}
function savePartsText(ks,parts){const ids=Object.keys(parts||{});if(!ids.length)return "General savings";if(ids.length===1)return esc(goalName(ks,ids[0]));return ids.map(id=>`${esc(goalName(ks,id))} ${money(parts[id])}`).join(", ");}
function calcInterest(p){const i=cfg().interest;return Math.min(p,i.threshold)*i.low/100+Math.max(0,p-i.threshold)*i.high/100;}
function splitAmt(amt){const sp=cfg().split;const r=q(amt);const save=q(r*sp.save/100),invest=q(r*sp.invest/100),give=q(r*sp.give/100);return {spend:r2(r-save-invest-give),save,invest,give};}
function goalName(ks,id){const g=ks.goals.find(g=>g.id===id);return g?g.name:"General savings";}
function destName(ks,dest){return {spend:"Spend",invest:"Invest",give:"Give",split:"Split like earnings",save:"Save"}[dest]||goalName(ks,dest);}
const parentName=()=>S.user&&(S.user.displayName||S.user.email)||"Parent";

/* ---------- auth & subscriptions ---------- */
let unsubs=[],deviceUnsub=null,weekKey="",weekUnsub=null,battleKey="",battleUnsub=null;
function stopData(){unsubs.forEach(u=>u());unsubs=[];prBackfilled.clear();if(weekUnsub)weekUnsub();weekUnsub=null;if(battleUnsub)battleUnsub();battleUnsub=null;weekKey="";battleKey="";S.config=null;S.bank={};S.prefs={};S.weeks={};S.xp={};S.xpLoaded=false;S.battles={};S.claims={};S.bounties={};S.game={};S.devices=[];S.codes=[];}
function onErr(e){console.warn(e);if(e&&e.code==="permission-denied"&&S.role!=="parent"){/* device was unpaired */}}
function startData(){
  if(unsubs.length)return;
  unsubs.push(onSnapshot(doc(db,"app/config"),s=>{S.config=s.exists()?s.data():null;backfillPrDone();softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"bank"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.bank=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"prefs"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.prefs=m;backfillPrDone();softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"xp"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.xp=m;S.xpLoaded=true;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"claims"),s=>{const m={};s.forEach(d=>m[d.id]={id:d.id,...d.data()});S.claims=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"bounties"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.bounties=m;softRender();},onErr));
  unsubs.push(onSnapshot(doc(db,"app/game"),s=>{S.game=s.exists()?s.data():{};softRender();},onErr));
  if(S.role==="parent"){
    unsubs.push(onSnapshot(collection(db,"devices"),s=>{S.devices=s.docs.map(d=>({id:d.id,...d.data()}));softRender(true);},onErr));
    unsubs.push(onSnapshot(collection(db,"pairCodes"),s=>{S.codes=s.docs.map(d=>({id:d.id,...d.data()}));softRender(true);},onErr));
  }
  subscribeWeeks();
}
function subscribeWeeks(){subscribeBattles();const mon=mondayOf(new Date());if(mon===weekKey)return;weekKey=mon;if(weekUnsub)weekUnsub();
  weekUnsub=onSnapshot(query(collection(db,"weeks"),where("week","in",[addDays(mon,-7),mon,addDays(mon,7)])),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.weeks=m;softRender();},onErr);}
// Battles from the last week (live ones always start today or yesterday).
function subscribeBattles(){const since=addDays(ymd(),-7);if(since===battleKey)return;battleKey=since;if(battleUnsub)battleUnsub();
  battleUnsub=onSnapshot(query(collection(db,"battles"),where("day",">=",since)),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.battles=m;softRender();},onErr);}

onAuthStateChanged(auth,async user=>{
  S.user=user;stopData();if(deviceUnsub){deviceUnsub();deviceUnsub=null;}S.role=null;S.device=null;
  if(!user){S.phase="welcome";render();return;}
  if(user.isAnonymous){
    S.phase="loading";render();
    deviceUnsub=onSnapshot(doc(db,"devices",user.uid),s=>{
      if(!s.exists()){stopData();S.device=null;S.role=null;S.phase="pair";render();return;}
      S.device=s.data();S.role=S.device.role;S.viewKid=S.device.kidId;S.phase="ready";startData();render();
      if(S.role==="display")wake();
      if(S.role==="kid"&&"Notification" in window&&Notification.permission==="granted")enablePush(true);
    },()=>{S.phase="pair";render();});
    return;
  }
  S.phase="loading";render();
  try{await call("setupFamily")();S.role="parent";S.phase="ready";S.ptab="activity";startData();render();
    if("Notification" in window&&Notification.permission==="granted")enablePush(true);}
  catch(e){S.phase="notparent";S.ui.err=errMsg(e);render();}
});

/* ---------- celebrations ---------- */
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
const cv=$("#confetti"),cx=cv.getContext("2d");let parts=[],anim=null;
const CONFETTI_EMOJI={stars:["⭐","🌟","✨"],hearts:["💖","💜","💛"],coins:["🪙","💰","🪙"]};
// style: "" for classic paper, or an unlocked confetti style. Defaults to the person on this screen.
function confetti(n=140,style){if(reduced)return;if(style==null)style=S.viewKid&&S.config?equipped(S.viewKid).confetti:"";const em=CONFETTI_EMOJI[style];
  cv.width=innerWidth*devicePixelRatio;cv.height=innerHeight*devicePixelRatio;const W=cv.width,H=cv.height,cols=["#E3A20F","#2B7FC2","#2D6A4D","#D5553C","#9B6BD6"];
  for(let i=0;i<(em?Math.ceil(n/3):n);i++)parts.push({x:W/2+(Math.random()-.5)*W*.4,y:H*.35,vx:(Math.random()-.5)*16*devicePixelRatio,vy:(-Math.random()*14-5)*devicePixelRatio,s:(5+Math.random()*7)*devicePixelRatio,r:Math.random()*6,vr:(Math.random()-.5)*.3,c:cols[i%cols.length],e:em?em[i%em.length]:null,life:140+Math.random()*60});if(!anim)loop();}
function loop(){cx.clearRect(0,0,cv.width,cv.height);for(const p of parts){p.vy+=.38*devicePixelRatio;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;p.life--;cx.save();cx.translate(p.x,p.y);cx.rotate(p.r);
    if(p.e){cx.font=`${Math.round(p.s*2.6)}px serif`;cx.textAlign="center";cx.fillText(p.e,0,0);}else{cx.fillStyle=p.c;cx.fillRect(-p.s/2,-p.s/3,p.s,p.s*.66);}cx.restore();}
  parts=parts.filter(p=>p.life>0&&p.y<cv.height+40);if(parts.length)anim=requestAnimationFrame(loop);else{anim=null;cx.clearRect(0,0,cv.width,cv.height);}}
let actx;function chime(big){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const notes=big?[523,659,784,1047,1319]:[784,1175];const t0=actx.currentTime;notes.forEach((f,i)=>{const o=actx.createOscillator(),g=actx.createGain();o.type="triangle";o.frequency.value=f;const t=t0+i*.09;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.18,t+.02);g.gain.exponentialRampToValueAtTime(.0001,t+.4);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+.45);});}catch(e){}}

/* ---------- render ---------- */
function mode(){return S.role==="kid"?"kid":S.role==="display"?"display":S.role==="parent"?"parent":"";}
function render(){
  let h;
  if(S.phase==="welcome")h=viewWelcome();
  else if(S.phase==="pair")h=viewPair();
  else if(S.phase==="notparent")h=`<div class="center"><div class="logo">Boon <span>Chore Tracker</span></div><p class="sub" style="max-width:420px;margin-top:12px">${esc(S.ui.err)}</p><div class="choices"><button class="btn" data-act="sign-out">Sign out</button></div></div>`;
  else if(S.phase!=="ready"||!S.config)h=`<div class="center"><div class="logo">Boon <span>Chore Tracker</span></div><p class="sub">Loading…</p></div>`;
  else if(S.role==="kid")h=kidCfg(S.viewKid)?viewKid(S.viewKid):`<div class="center"><p class="sub">This tablet's person was removed. Ask a parent to pair it again.</p></div>`;
  else if(S.role==="display")h=viewDisplay();
  else h=viewParent();
  if(S.ui.levelUp)h+=levelUpOverlay();
  $("#app").innerHTML=h;document.body.dataset.mode=mode();
  const th=S.phase==="ready"&&S.config&&S.viewKid&&kidCfg(S.viewKid)&&onKidScreen()?equipped(S.viewKid).theme:"";
  if(th)document.body.dataset.kidtheme=th;else delete document.body.dataset.kidtheme;
  afterRender();
}
function softRender(force){if(!force&&S.role==="parent"&&S.ptab==="settings"&&S.ui.draft)return;const a=document.activeElement;
  if(a&&a.tagName==="INPUT"&&S.role!=="display"){const b=a.dataset.bind;render();if(b){const el=document.querySelector(`[data-bind="${b}"]`);if(el){el.focus();try{const l=el.value.length;el.setSelectionRange(l,l)}catch(e){}}}return;}render();}
function afterRender(){
  if(S.role==="display"&&S.config){for(const k of cfg().kids){const w=getWeek(k.id,activeWeek(k.id));const p=w.goal?weekNet(w)/w.goal:0;const prev=S.ui.prevPct[k.id];
    if(prev!=null&&prev<1&&p>=1){confetti(220,equipped(k.id).confetti);chime(true);const el=document.querySelector(`.lane[data-kid="${k.id}"] .walker`);if(el)el.classList.add("cheer");}S.ui.prevPct[k.id]=p;
    if(!S.xpLoaded)continue;const lv=xpState(k.id).level,pl=S.ui.prevLvl[k.id];if(pl!=null&&lv>pl){confetti(260,equipped(k.id).confetti);chime(true);const el=document.querySelector(`.lane[data-kid="${k.id}"] .lane-cr`);if(el)el.classList.add("cheer");}S.ui.prevLvl[k.id]=lv;}}
  if(S.role==="display"&&S.config&&S.xpLoaded){const fp=G.familyProgress(famTotal(),S.game.familyGoal);const done=!!(fp&&fp.done);
    if(S.ui.prevFam===false&&done){confetti(400);chime(true);}S.ui.prevFam=fp?done:null;}
  checkLevelUp();tickClocks();
}
// True when the screen shows one person's own view: their tablet, a parent's own tab, or a parent's "see a kid's screen".
function onKidScreen(){return S.role==="kid"||(S.role==="parent"&&(S.ptab.startsWith("me:")||(S.ptab==="views"&&!!S.ui.kidView)));}
// Shows the level-up celebration once per device, on the screen of the person who leveled up.
const seenKey=id=>"boon.levelSeen."+id;
function readSeen(id){try{return Number(localStorage.getItem(seenKey(id)))||0;}catch(e){return 0;}}
function checkLevelUp(){
  if(S.ui.levelUp||S.phase!=="ready"||!S.config||!S.viewKid||!kidCfg(S.viewKid))return;
  if(!onKidScreen())return;
  const lu=xpState(S.viewKid).levelUp;if(!lu||Date.now()-lu.at>36*3600e3||lu.at<=readSeen(S.viewKid))return;
  S.ui.levelUp={...lu,kid:S.viewKid};render();confetti(320);chime(true);
}
function levelUpOverlay(){const lu=S.ui.levelUp;const items=G.describeUnlocks(lu.unlocks||[]);if(lu.freezes)items.push(["🧊",`${lu.freezes} streak freeze${lu.freezes>1?"s":""}`,"Saves your streak on a missed day"]);
  return `<div class="overlay" role="dialog" aria-modal="true" aria-labelledby="lu-title"><div class="lu-card"><div class="lu-cr">${crHtml(lu.kid)}</div><p class="lu-kicker">Level up!</p><h2 id="lu-title">Level ${lu.level}</h2>
    ${items.length?`<p class="sub">You unlocked:</p><ul class="lu-list">${items.map(i=>`<li><span>${i[0]}</span><b>${esc(i[1])}</b><small>${esc(i[2])}</small></li>`).join("")}</ul>`:`<p class="sub">Keep going. More unlocks are on the way.</p>`}
    <button class="btn block" data-act="lu-ok" autofocus>Awesome!</button></div></div>`;}
// Keeps Time Trial stopwatches ticking between renders.
let clockTimer=null;
function tickClocks(){const els=document.querySelectorAll(".tt-clock[data-start]");if(!els.length){clearInterval(clockTimer);clockTimer=null;return;}
  const upd=()=>document.querySelectorAll(".tt-clock[data-start]").forEach(el=>{el.textContent=fmtMs(Date.now()-Number(el.dataset.start));});upd();if(!clockTimer)clockTimer=setInterval(upd,1000);}
function fmtMs(ms){const t=Math.max(0,Math.round(ms/1000));const h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;return (h?h+":"+String(m).padStart(2,"0"):m)+":"+String(sec).padStart(2,"0");}

function viewWelcome(){
  return `<div class="center"><div class="logo">Boon <span>Chore Tracker</span></div><p class="sub">Set up this device</p><div class="choices">
    <button class="choice" data-act="start-pair"><span class="e">📱</span><span><b>Pair this device</b><small>For a kid's tablet or the family leaderboard. A parent gives you a code.</small></span></button>
    <button class="choice" data-act="parent-signin"><span class="e">🔑</span><span><b>Parent sign-in</b><small>Sign in with Google</small></span></button></div></div>`;
}
function viewPair(){
  const p=S.ui.pair;
  return `<div class="center"><h1>Pair this device</h1><p class="sub" style="max-width:380px;margin-top:6px">On a parent's phone, open Devices and create a code for this tablet.</p>
  <div class="pinbox"><input id="pin" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="6-digit pairing code" data-bind="pair.code" value="${esc(p.code)}" placeholder="000000">
  <label style="text-align:left">Name this device (optional)<input data-bind="pair.name" value="${esc(p.name)}" placeholder="Maggie's tablet"></label>
  <button class="btn block" data-act="pair" ${S.busy.pair?"disabled":""}>${S.busy.pair?"Pairing…":"Pair"}</button>
  <button class="btn ghost block" data-act="parent-signin">Parent sign-in instead</button></div></div>`;
}

// crH: the creature's HTML (crHtml). style: an unlocked trail style, or "".
function trail(frac,crH,won,label,style){const f=Math.max(0,Math.min(1,frac||0));
  return `<div class="trail ${style?"tr-"+style:""}" role="img" aria-label="${esc(label||Math.round(f*100)+"% of goal")}"><div class="trail-fill" style="--f:${f}"></div><span class="walker ${won?"victory":""}" style="--f:${f}">${crH}</span><span class="flag">🏁</span></div>`;}
function weekLabel(wk){return wk===mondayOf(new Date())?`Week of ${shortDate(wk)}`:`Next week starts ${shortDate(wk)}`;}
function daysLeft(wk){if(wk!==mondayOf(new Date()))return 7;return 7-((new Date().getDay()+6)%7);}

function viewKid(kidId,embedded){
  const k=kidCfg(kidId),ks=kidState(k.id),today=ymd(),wk=activeWeek(k.id),w=getWeek(k.id,wk),net=weekNet(w),cr=creatureFor(k.id);
  let h=embedded?"":`<div class="wrap">`;
  h+=`<header class="kid-head"><button class="avatar stage-${G.stageFor(xpState(k.id).level)}" data-act="pick-creature" aria-label="Open wardrobe" aria-expanded="${!!S.ui.pickCreature}">${crHtml(k.id)}</button><div><h1>${esc(k.name)}</h1><p class="sub"><span class="title-chip">${esc(titleOf(k.id))}</span> ${weekLabel(wk)}</p></div></header>`;
  h+=xpBar(k.id)+pushControl();
  if(S.ui.pickCreature)h+=wardrobe(k.id);
  h+=familyBar(true)+freezeNotice(k.id)+reminderBanner(k,ks,today);
  h+=w.goal==null?goalSetter(k,wk):goalCard(k,ks,w,net,cr);
  h+=battleSection(k)+bountySection(k)+challengeCards(k.id)+prSection(k,ks,today)+choreSection(k,today)+moneySection(k,ks,w,net)+questSection(k)+rewardSection(k)+badgeSection(k.id)+activitySection(w);
  return h+(embedded?"":`</div>`);
}
function pushControl(){
  if(S.role!=="kid"||!("Notification" in window))return "";
  const perm=Notification.permission;
  if(perm==="granted"&&S.device&&S.device.fcmToken)return "";
  if(perm==="denied")return `<p class="hint">Reminders are blocked. Allow notifications for this app in the tablet's settings to get them.</p>`;
  return `<button class="btn ghost block" style="margin-top:12px" data-act="enable-push">Turn on chore reminders</button>`;
}
function reminderBanner(k,ks,today){
  const times=(k.remind||[]).filter(Boolean).sort();if(!times.some(t=>t<=nowHM()))return "";
  const done=ks.prLog[today]||[];
  const todo=[...prChores().filter(c=>!done.includes(c.id)).map(c=>c.name),...famChoresFor(k.id).filter(c=>c.assign===k.id&&countOnDate(k.id,c.id,today)===0).map(c=>c.name)];
  return todo.length?`<div class="banner" role="status">Still to do today: ${todo.map(esc).join(", ")}</div>`:"";
}
function goalSetter(k,wk){
  const last=weekNet(getWeek(k.id,addDays(wk,-7)));const perDay=famChoresFor(k.id).reduce((s,c)=>s+choreValue(k,c)*(c.limit||1),0);const max=r2(perDay*daysLeft(wk));
  const v=Number(S.ui.goalInput)||0;const chips=last>0?[q(last),q(last*1.25),q(last*1.5)]:[1,2.5,5];
  return `<section class="card goal goal-set"><h2>What do you want to earn this week?</h2>
    <p class="sub">${last>0?`Last week you earned ${money(last)}. `:""}Doing every chore every day would earn about ${money(max)}.</p>
    <div class="chips">${[...new Set(chips)].filter(c=>c>0).map(c=>`<button data-act="goal-chip" data-v="${c}">${money(c)}</button>`).join("")}</div>
    <div class="money-in">$<input type="number" inputmode="decimal" step="0.25" min="0.25" aria-label="Weekly goal in dollars" data-bind="goalInput" value="${esc(S.ui.goalInput)}"></div>
    <p class="goal-msg">${v>0?`Reach it and you get a +${money(r2(v*BONUS_RATE))} bonus.`:"Bigger goal, bigger bonus."}</p>
    <button class="btn block" data-act="set-goal">Lock in my goal</button></section>`;
}
function goalCard(k,ks,w,net,cr){
  const won=net>=w.goal,bonus=r2(w.goal*BONUS_RATE),bt=w.bonusTo||"split";
  return `<section class="card goal ${won?"won":""}"><div class="goal-top"><div><div class="big">${money(net)}</div><p class="sub">of your ${money(w.goal)} goal</p></div>
    <div class="bonus">${won?"Bonus earned":"Bonus if you make it"}<b>+${money(bonus)}</b><small>and +${G.XP.goal} XP</small></div></div>${trail(net/w.goal,crHtml(k.id),won,undefined,equipped(k.id).trail)}
    <p class="goal-msg">${won?"Goal reached! Your bonus is locked in.":`${money(w.goal-net)} to go`}</p>
    <label class="inline">Bonus goes to <select data-change="bonusTo" aria-label="Where your bonus goes">${["split","spend","save","invest","give"].map(o=>`<option value="${o}" ${o===bt?"selected":""}>${destName(ks,o)}</option>`).join("")}</select></label></section>`;
}
function challengeCards(kidId){let h="";for(const w of openWeeks(kidId))for(const d of w.deductions)if(d.status==="active")
  h+=`<section class="card challenge"><h3>Earn back ${money(d.amount)}</h3><p><b>${esc(d.reason)}</b></p>${d.how?`<p>How: ${esc(d.how)}</p>`:""}<p class="hint">When you've done it, ask a parent to mark it earned back. You have until Sunday's cash-out.</p></section>`;return h;}
function prSection(k,ks,today){const prs=prChores();if(!prs.length)return "";const done=ks.prLog[today]||[],notes=ks.prNotes[today]||{},pn=S.ui.prNote;const s=streak(k.id),boost=G.streakBoost(cfg(),s),fr=xpState(k.id).freezes;
  return `<section class="card"><div class="sec-head"><h2>Every day</h2><span><span class="streak">🔥 ${s} day${s===1?"":"s"} in a row</span>${boost>1?` <span class="pill boost" title="Streak bonus on all XP">×${boost} XP</span>`:""}${fr?` <span class="pill" title="Streak freezes save your streak on a missed day">🧊 ${fr}</span>`:""}</span></div><div class="checks">${prs.map(c=>{const on=done.includes(c.id),asking=pn&&pn.id===c.id,sub=on&&notes[c.id]?notes[c.id]:c.note;
    return `<button class="check ${on?"on":""}" data-act="toggle-pr" data-id="${c.id}" aria-pressed="${on}" ${asking?"disabled":""}><span class="box">${on?"✓":""}</span><span><b>${esc(c.name)}</b>${sub?`<small>${esc(sub)}</small>`:""}</span></button>${asking?`<div class="confirm"><label>What was it?<input data-bind="prNote.text" maxlength="120" placeholder="Say what you did" value="${esc(pn.text)}"></label><div class="row"><button class="btn small" data-act="save-pr-note" ${String(pn.text||"").trim()?"":"disabled"}>Check it off</button><button class="btn ghost small" data-act="cancel-pr-note">Cancel</button></div></div>`:""}`;}).join("")}</div>
    <p class="hint">These don't pay money. They're part of taking care of yourself. Finish all of them for +${G.XP.checklist} XP and to keep your streak going.${game().streakMultiplier.enabled?` A ${game().streakMultiplier.minStreak}-day streak makes all your XP count ×${game().streakMultiplier.mult}.`:""}</p></section>`;}
function choreSection(k,today){const list=famChoresFor(k.id).sort((a,b)=>(a.assign==="pool")-(b.assign==="pool")),cc=S.ui.confirmChore,cot=cotdId();
  return `<section class="card"><div class="sec-head"><h2>Family chores</h2></div>${list.length?list.map(c=>{const n=choreCountToday(k.id,c,today),lim=c.limit||1,full=n>=lim,busy=S.busy["c:"+c.id],asking=cc&&cc.choreId===c.id,ask=needsNote(c);
    return `<div class="chore ${c.id===cot?"cotd":""}"><div><b>${esc(c.name)}</b><small><span class="tag ${c.assign===k.id?"mine":""}">${c.assign===k.id?"Yours":"Anyone"}</span>${c.id===cot?`<span class="tag star">⭐ Double XP today</span>`:""}${n} of ${lim} done today</small></div><div class="c-val">+${money(choreValue(k,c))}<small>+${choreXpFor(k.id,c)} XP</small></div><button class="btn small" data-act="do-chore" data-id="${c.id}" ${full||busy||asking?"disabled":""}>${busy?"Saving…":full?"All done":"I did it"}</button>
      ${asking?`<div class="confirm"><b>Did you do "${esc(c.name)}"?</b>${ask?`<label>What was it?<input data-bind="confirmChore.note" maxlength="120" placeholder="Say what you did" value="${esc(cc.note)}"></label>`:""}<div class="row"><button class="btn small" data-act="confirm-chore" ${ask&&!String(cc.note||"").trim()?"disabled":""}>Yes, I did it</button><button class="btn ghost small" data-act="cancel-chore">Not yet</button></div></div>`:""}</div>`;}).join(""):`<p class="empty">No chores set up yet.</p>`}</section>`;}
function splitEditor(k,ks,w,goals,weekSave){
  if(goals.length<2)return "";
  const key=weekDocId(k.id,w.week),eff=saveSplitFor(w,ks),stored={};goals.forEach(g=>stored[g.id]=Math.round((eff[g.id]||0)*100));const base=JSON.stringify(stored);
  if(S.ui.split.key!==key||(!S.ui.split.dirty&&S.ui.split.base!==base))S.ui.split={key,base,dirty:false,shares:{...stored}};
  const sh=S.ui.split.shares,cur={};goals.forEach(g=>cur[g.id]=Math.max(0,Math.round(Number(sh[g.id])||0)));const total=Object.values(cur).reduce((a,b)=>a+b,0),ok=total===100,changed=JSON.stringify(cur)!==base;
  const fr={};if(ok)for(const id in cur)if(cur[id]>0)fr[id]=cur[id]/100;const proj=ok?splitCents(weekSave,fr):{};
  return `<div class="split" data-week-save="${weekSave}"><p class="split-title">This week's savings split</p>${goals.map(g=>`<div class="split-row" data-goal="${g.id}"><span class="nm">${esc(g.name)}<small class="proj">${ok?"+"+money(proj[g.id]||0)+" this week":""}</small></span><input type="number" min="0" max="100" step="5" inputmode="numeric" aria-label="${esc(g.name)} share" data-bind="split.shares.${g.id}" data-type="num" value="${esc(sh[g.id]??0)}"><span class="pct">%</span></div>`).join("")}
    <div class="split-foot"><span class="split-total ${ok?"":"bad"}">Total ${total}%${ok?"":" (make it 100%)"}</span><span class="row" style="gap:6px"><button class="btn ghost small" data-act="split-even">Even split</button><button class="btn small" data-act="save-split" ${ok&&changed?"":"disabled"}>Save</button></span></div></div>`;
}
function updateSplitUI(){const el=document.querySelector(".split");if(!el)return;const rows=[...el.querySelectorAll(".split-row")],cur={};
  rows.forEach(r=>{cur[r.dataset.goal]=Math.max(0,Math.round(Number(r.querySelector("input").value)||0));});
  const total=Object.values(cur).reduce((a,b)=>a+b,0),ok=total===100,fr={};if(ok)for(const id in cur)if(cur[id]>0)fr[id]=cur[id]/100;
  const proj=ok?splitCents(Number(el.dataset.weekSave)||0,fr):{};rows.forEach(r=>{r.querySelector(".proj").textContent=ok?"+"+money(proj[r.dataset.goal]||0)+" this week":"";});
  const t=el.querySelector(".split-total");t.textContent=`Total ${total}%${ok?"":" (make it 100%)"}`;t.classList.toggle("bad",!ok);
  el.querySelector('[data-act="save-split"]').disabled=!(ok&&JSON.stringify(cur)!==S.ui.split.base);}
function moneySection(k,ks,w,net){const sp=splitAmt(Math.max(0,net)),goals=ks.goals,g=S.ui.newGoal,open=S.ui.openBuckets,pc=cfg().split;
  // One column of cards, collapsed by default. The header always shows the total; cards with details open on tap.
  const card=(id,cls,name,total,sub,body)=>{const o=!!open[id],x=!!body;
    return `<section class="bucket ${cls}${o?" open":""}">${x?`<button class="bucket-head" data-act="toggle-bucket" data-id="${id}" aria-expanded="${o}">`:`<div class="bucket-head">`}<span class="bh-name"><h3>${name} <small>${pc[id]}%</small></h3>${sub?`<p>${sub}</p>`:""}</span><span class="bh-total money">${money(total)}</span>${x?`<span class="chev" aria-hidden="true">${o?"▴":"▾"}</span></button>`:"</div>"}${x&&o?`<div class="bucket-body">${body}</div>`:""}</section>`;};
  const saved=goals.reduce((a,x)=>a+x.balance,0);
  return `<section class="card"><div class="sec-head"><h2>My money</h2></div><div class="buckets">
    ${card("spend","b-spend","Spend",sp.spend,"Cash you get Sunday night","")}
    ${card("save","b-save","Save",saved,`+${money(sp.save)} this week`,
      `${goals.map(x=>`<div class="sgoal"><div class="top"><span>${esc(x.name)}</span><span>${money(x.balance)}${x.target?" / "+money(x.target):""}</span></div>${x.target?`<div class="bar"><i style="width:${Math.min(100,x.balance/x.target*100)}%"></i></div>`:""}</div>`).join("")}
      ${splitEditor(k,ks,w,goals,sp.save)}
      <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="newGoal.name" value="${esc(g.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="newGoal.target" value="${esc(g.target)}"><button class="btn small" data-act="add-goal">Add</button></div>`)}
    ${card("invest","b-invest","Invest",ks.invest,`+${money(sp.invest)} this week`,
      `<p>Next monthly interest: ${money(qd(calcInterest(ks.invest)))}, rounded down to the nearest quarter.</p><label>Interest goes to<select data-change="interestTo">${["invest","spend","give",...goals.map(x=>x.id)].map(o=>`<option value="${o}" ${o===ks.interestTo?"selected":""}>${o==="invest"?"Back into Invest (it grows!)":destName(ks,o)}</option>`).join("")}</select></label>`)}
    ${card("give","b-give","Give",ks.give,`+${money(sp.give)} this week`,"")}
  </div></section>`;}
function badgeList(kidId){const ks=kidState(kidId),st=ks.stats,x=xpState(kidId);const live=openWeeks(kidId).reduce((s,w)=>s+choreCount(w),0);const chores=(st.chores||0)+live;
  const saved=ks.goals.reduce((s,g)=>s+g.balance,0)+ks.archived.reduce((s,g)=>s+(g.bought||0),0);
  return G.badgeList({chores,goalHits:st.goalHits||0,bestStreak:bestStreak(kidId),redemptions:st.redemptions||0,saved,invest:ks.invest,give:ks.give,bought:ks.archived.length,wins:x.counts.win||0,giant:x.counts.giant||0}).map(b=>[b[1],b[2],b[3]]);}
function badgeSection(kidId){const b=badgeList(kidId);return `<section class="card"><div class="sec-head"><h2>Badges</h2><span class="sub">${b.filter(x=>x[2]).length} of ${b.length}. +${G.XP.badge} XP each</span></div><div class="badges">${b.map(x=>`<div class="badge ${x[2]?"":"locked"}"><span>${x[0]}</span>${x[1]}</div>`).join("")}</div></section>`;}
function choreLine(e){const rev=e.status==="reversed";return [`<span class="${rev?"struck":""}">${esc(e.name)}${e.detail?`: ${esc(e.detail)}`:""}<br><small>${timeOf(e.t)}${rev?", reversed":""}</small></span>`,`<span class="amt ${rev?"struck":"pos"}">+${money(e.amount)}</span>`];}
function dedLine(d){const st={active:"can still earn back",redeemed:"earned back",final:"final"}[d.status]||d.status;return [`<span class="${d.status==="redeemed"?"struck":""}">${esc(d.reason)}<br><small>${timeOf(d.t)}, ${st}</small></span>`,`<span class="amt ${d.status==="redeemed"?"struck":"neg"}">−${money(d.amount)}</span>`];}
function activitySection(w){const list=[...w.entries.map(e=>({t:e.t,l:choreLine(e)})),...w.deductions.map(d=>({t:d.t,l:dedLine(d)}))].sort((a,b)=>b.t-a.t).slice(0,10);
  return `<section class="card"><div class="sec-head"><h2>This week</h2></div>${list.length?`<ul class="feed">${list.map(x=>`<li>${x.l.join("")}</li>`).join("")}</ul>`:`<p class="empty">Nothing yet. Pick a chore and get your creature moving.</p>`}</section>`;}

/* ---------- game: XP, wardrobe, battles ---------- */
function xpBar(id){const x=xpState(id);const pct=x.need?Math.round(x.into/x.need*100):100;
  return `<div class="xpbar" role="img" aria-label="Level ${x.level}. ${x.need?`${x.into} of ${x.need} XP to level ${x.level+1}`:"Top level"}"><span class="lvl-badge">Lv ${x.level}</span><div class="xp-track"><i style="width:${pct}%"></i></div><span class="xp-num">${x.need?`${x.into} / ${x.need} XP`:"Max level!"}</span></div>`;}
const WTABS=[["creature","Creatures"],["hat","Accessories"],["theme","Themes"],["trail","Trails"],["confetti","Confetti"],["title","Titles"]];
const THEME_ICON={ocean:"🌊",forest:"🌲",space:"🚀",candy:"🍭",gold:"🥇"},TRAIL_ICON={rainbow:"🌈",stars:"🌌",lava:"🌋",ice:"🧊"},CONF_ICON={stars:"⭐",hearts:"💖",coins:"🪙"};
function wardrobe(id){const x=xpState(id),e=equipped(id),cr=creatureFor(id),tab=S.ui.wtab;
  const opt=(list,slot,pre,icon,none)=>[{id:"",icon:none[0],name:none[1],ok:true,on:!e[slot]},...list.map(t=>({id:t[0],icon:icon(t),name:t[1],lv:t[2],ok:x.unlocked.has(pre+t[0]),on:e[slot]===t[0]}))];
  let items;
  if(tab==="creature")items=CREATURES.map(c=>({id:c[0],icon:c[1],name:c[2],lv:c[3],ok:x.unlocked.has("c:"+c[0]),on:c[0]===cr[0]}));
  else if(tab==="hat")items=[{id:"",icon:"🚫",name:"None",ok:true,on:!e.hat},...G.HATS.map(h=>({id:h[0],icon:h[1],name:h[2],lv:h[3],ok:x.unlocked.has("h:"+h[0]),on:e.hat===h[0]}))];
  else if(tab==="theme")items=opt(G.THEMES,"theme","t:",t=>THEME_ICON[t[0]]||"🎨",["🌿","Classic"]);
  else if(tab==="trail")items=opt(G.TRAILS,"trail","r:",t=>TRAIL_ICON[t[0]]||"🛤️",["➖","Classic"]);
  else if(tab==="confetti")items=opt(G.CONFETTI,"confetti","f:",t=>CONF_ICON[t[0]]||"🎉",["🎊","Classic"]);
  else {const cur=titleOf(id);items=G.TITLES.map(t=>({id:t[0],icon:"🏷️",name:t[1],lv:t[2],hint:t[4],ok:x.unlocked.has("ti:"+t[0]),on:t[1]===cur}));}
  const stage=G.STAGES[G.stageFor(x.level)-1][1],next=G.STAGES[G.stageFor(x.level)];
  return `<section class="card"><div class="sec-head"><h2>Wardrobe</h2><span class="sub">${esc(creatureFor(id)[2])}: ${stage}${next?`. Grows at level ${next[0]}`:""}</span></div>
    <div class="seg wtabs">${WTABS.map(t=>`<button class="${tab===t[0]?"on":""}" data-act="wtab" data-tab="${t[0]}" aria-pressed="${tab===t[0]}">${t[1]}</button>`).join("")}</div>
    <div class="picker" style="margin-top:12px">${items.map(it=>`<button class="${it.on?"on":""} ${it.ok?"":"locked"}" data-act="equip" data-slot="${tab}" data-id="${it.id}" ${it.ok?"":"disabled"} aria-pressed="${it.on}"><span>${it.icon}</span>${esc(it.name)}${it.ok?"":`<small>${it.hint?esc(it.hint):"🔒 Level "+it.lv}</small>`}</button>`).join("")}</div>
    <p class="hint">Level up to unlock more. Your creature grows at levels 5, 10, and 20.</p></section>`;}
function freezeNotice(id){const n=xpState(id).notice;if(!n||n.type!=="freeze"||Date.now()-n.at>36*3600e3)return "";let seen=0;try{seen=Number(localStorage.getItem("boon.freezeSeen."+id))||0;}catch(e){}if(n.at<=seen)return "";
  return `<div class="banner freeze" role="status"><span>🧊 A streak freeze covered ${esc(parseYmd(n.date).toLocaleDateString(undefined,{weekday:"long"}))}. Your streak is safe!</span><button class="btn ghost small" data-act="freeze-ok" data-at="${n.at}">OK</button></div>`;}

const bName=(b,id)=>esc((kidCfg(id)||{}).name||(b.names||{})[id]||"Someone");
const TEAM=["raid","grownups"];
function modeParams(b){const p=b.params||{};const tw=b.twist?`. ${esc(b.twist.text)}`:"";
  const t={race:`First to ${p.n} chores`,blitz:p.windowMin?`${p.windowMin}-minute blitz`:"Until midnight",grownups:p.windowMin?`${p.windowMin} minutes`:"Until midnight",
    territory:"Most Anyone chores by midnight",bingo:"First to a line",streakduel:"Don't miss a day",showdown:"Best share of weekly goal",
    raid:`${p.bossEmoji||"🐉"} ${esc(p.bossName||"Boss")}, ${p.days||1} day${(p.days||1)>1?"s":""}`}[b.mode];
  return (t||(p.choreName?esc(p.choreName):""))+tw;}
function fmtEnd(t){const d=new Date(t);return d.getHours()===0&&d.getMinutes()===0?(d-Date.now()>26*3600e3?"at midnight "+d.toLocaleDateString(undefined,{weekday:"short"}):"at midnight"):"at "+d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});}
function scoreHtml(b,id){
  if(G.TIMED.includes(b.mode)){const a=(b.attempts||{})[id];return !a?"–":a.void?"✗":a.ms!=null?fmtMs(a.ms):`<span class="tt-clock" data-start="${a.startAt}"></span>`;}
  if(b.mode==="judge"){const a=(b.attempts||{})[id];return a&&a.entryId?"✓ Done":"–";}
  if(b.mode==="streakduel"){const days=Object.values(b.duelDays||{});const ok=days.filter(d=>d[id]).length;return days.length?`${ok} day${ok===1?"":"s"}`:"–";}
  if(b.mode==="showdown"){const s=(b.scores||{})[id];return s?s.adj+"%":`${showdownLive(b,id)}%<small> so far</small>`;}
  const s=(b.scores||{})[id],h=(b.handicap||{})[id]||1;return `${s?s.adj:0}${h>1?`<small> (×${h})</small>`:""}`;}
// Rough live Goal Showdown score from this week's records (the server decides at cash-out).
function showdownLive(b,id){const w=getWeek(id,b.params.week);return Math.round(G.showdownScore(weekNet(w),w.goal,0)*100);}
function teamLine(b,side){const ids=b.teams[side],ts=(b.teamScores||{})[side],h=(b.teamHandicap||{})[side]||1;
  return `<div><span class="team-crs">${ids.map(p=>crHtml(p)).join("")}</span><b>${ids.map(p=>bName(b,p)).join(", ")}</b><span class="b-score">${ts?ts.adj:0}${h>1?`<small> (×${h})</small>`:""}</span></div>`;}
function resultText(b,me){const r=b.result||{};const who=id=>id===me?"You":bName(b,id);
  if(r.noContest)return `No contest. ${esc(r.reason||"")}`;
  if(b.mode==="ghost")return r.record?"First record set! ⏱️":r.winner?"New personal best! 🎉":"Not this time. Try again!";
  if(b.mode==="raid")return r.winnerSide?`${esc(b.params.bossEmoji)} Boss beaten! 🎉`:`${esc(r.reason||"The boss got away.")}`;
  if(r.tie)return `It's a tie! ${esc(r.reason||"")}`;
  if(r.winnerSide){const mine=G.sideOf(b,me)===r.winnerSide;return mine?`Your team won! 🏆 ${esc(r.reason||"")}`:`${b.teams[r.winnerSide].map(p=>bName(b,p)).join(" and ")} won. ${esc(r.reason||"")}`;}
  return r.winner===me?`You won! 🏆 ${esc(r.reason||"")}`:`${who(r.winner)} won. ${esc(r.reason||"")}`;}
function bingoGrid(b,me){const p=b.params;const list=G.battleEntries(entriesFor(me),b.startAt,b.endAt);const marks=G.bingoMarks(b,list,me);
  return `<div class="bingo" role="grid" aria-label="Your bingo card">${p.card.map((c,i)=>`<div class="sq ${marks[i]?"on":""}" role="gridcell">${marks[i]&&((p.free||{})[me]||[]).includes(i)?"FREE":esc((p.cardNames||[])[i]||c)}</div>`).join("")}</div>`;}
// This person's chore entries from the weeks on screen.
function entriesFor(id){return Object.values(S.weeks).filter(w=>w.kidId===id).flatMap(w=>w.entries||[]);}
function battleCard(b,me){const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const other=b.players.find(p=>p!==me);const dis=S.busy.b?"disabled":"";
  let vs;
  if(b.mode==="raid"){const ts=(b.teamScores||{}).a,dmg=ts?ts.raw:0,hp=b.params.hp||1;
    vs=`<div class="raid"><div class="boss">${esc(b.params.bossEmoji)}<b>${esc(b.params.bossName)}</b></div><div class="hp" role="img" aria-label="${Math.max(0,hp-dmg)} of ${hp} health left"><i style="width:${Math.max(0,100-dmg/hp*100)}%"></i></div><p class="sub">${Math.min(dmg,hp)} / ${hp} damage. Team: ${b.teams.a.map(p=>bName(b,p)).join(", ")}</p></div>`;}
  else if(b.teams)vs=`<div class="vs">${teamLine(b,"a")}<span class="vs-x">VS</span>${teamLine(b,"b")}</div>`;
  else if(b.players.length>1)vs=`<div class="vs">${b.players.map(p=>`<div>${crHtml(p)}<b>${p===me?"You":bName(b,p)}</b><span class="b-score">${scoreHtml(b,p)}</span></div>`).join(`<span class="vs-x">VS</span>`)}</div>`;
  else vs=`<div class="vs"><div>${crHtml(me)}<b>You</b><span class="b-score">${scoreHtml(b,me)}</span></div><span class="vs-x">VS</span><div><span class="cr">👻</span><b>Your best</b><span class="b-score">${b.pb!=null?fmtMs(b.pb):"None yet"}</span></div></div>`;
  let body="";
  if(b.status==="pending"){const acc=b.accepted||{},waiting=b.players.filter(p=>!acc[p]);
    body=b.challenger!==me&&!acc[me]?`<p><b>${bName(b,b.challenger)}</b> ${b.mode==="raid"?"wants you on their team!":"challenged you!"}</p><div class="row"><button class="btn" data-act="b-accept" data-id="${b.id}" ${dis}>Accept</button><button class="btn ghost" data-act="b-decline" data-id="${b.id}" ${dis}>Not now</button></div>`
      :`<p class="sub">Waiting for ${waiting.map(p=>bName(b,p)).join(", ")} to accept…</p>${b.challenger===me?`<button class="btn ghost small" data-act="b-cancel" data-id="${b.id}" ${dis}>Cancel challenge</button>`:""}`;}
  else if(b.status==="active"){
    if(G.TIMED.includes(b.mode)){const a=(b.attempts||{})[me];
      body=!a?`<p class="sub">Tap Start, do "${esc(b.params.choreName)}", then tap Done. The chore is logged when you finish.</p><button class="btn block" data-act="b-start" data-id="${b.id}" ${dis}>▶ Start timer</button>${b.mode==="ghost"?`<button class="btn ghost small" style="margin-top:8px" data-act="b-cancel" data-id="${b.id}" ${dis}>Cancel</button>`:""}`
        :a.ms==null&&!a.void?`<div class="tt-big"><span class="tt-clock" data-start="${a.startAt}"></span></div><button class="btn block" data-act="b-finish" data-id="${b.id}" ${dis}>✓ Done!</button>`
        :`<p class="sub">${a.void?"Your run didn't count: "+esc(a.void):"Your time: <b>"+fmtMs(a.ms)+"</b>"}.${other?` Waiting for ${bName(b,other)}.`:""}</p>`;}
    else if(b.mode==="judge"){const a=(b.attempts||{})[me];
      body=a&&a.entryId?`<p class="sub">Turned in! ${other&&!((b.attempts||{})[other]||{}).entryId?`Waiting for ${bName(b,other)}.`:""} Then a parent picks the better job.</p>`
        :`<p class="sub">Do your best job on "${esc(b.params.choreName)}", then tap Done. A parent picks the better job.</p><button class="btn block" data-act="b-finish" data-id="${b.id}" ${dis}>✓ Done!</button>`;}
    else if(b.mode==="bingo")body=`${bingoGrid(b,me)}<p class="sub">Do the chores on your card. First to finish a row, column, or diagonal wins. Ends ${fmtEnd(b.endAt)}.</p>`;
    else if(b.mode==="streakduel")body=`<p class="sub">${ymd()<b.params.startDate?"Starts tomorrow.":"Checked each night."} Finish your daily list every day. Whoever misses first loses. Up to 14 days.</p>`;
    else if(b.mode==="showdown")body=`<p class="sub">Earn the biggest share of your weekly goal. Decided at Sunday's cash-out.</p>`;
    else if(b.mode==="raid")body=`<p class="sub">Every chore your team does hits the boss. Beat it ${fmtEnd(b.endAt)}!</p>`;
    else body=`<p class="sub">${{race:`First to ${b.params.n} chores wins. Do chores below to score!`,territory:"Every Anyone chore you do is yours. Most claims wins.",grownups:"Every chore adds XP to your team's score."}[b.mode]||"Most chore XP wins. Bigger chores count more."} Ends ${fmtEnd(b.endAt)}.</p>`;}
  else if(b.status==="judging")body=`<p class="b-result">🧑‍⚖️ Both done! A parent is judging.</p>`;
  else if(b.status==="confirming"){const r=b.result||{};let act;
    if(r.needsParent)act=`<p class="hint">${r.disputedBy?"Someone asked a parent to check.":"That was super fast!"} A parent needs to check this one.</p>`;
    else if(other&&!G.isWinner(b,r,me))act=`<div class="row"><button class="btn" data-act="b-confirm" data-id="${b.id}" ${dis}>Looks good</button><button class="btn ghost" data-act="b-dispute" data-id="${b.id}" ${dis}>Ask a parent</button></div>`;
    else act=`<p class="hint">Waiting for ${other?"the other side or ":""}a parent to confirm.</p>`;
    body=`<p class="b-result">${resultText(b,me)}</p>${act}`;}
  return `<div class="bcard ${b.status}"><div class="b-head"><b>${b.wildcard?"🃏 Wildcard: ":""}${m.emoji} ${esc(m.name)}</b><span class="sub">${modeParams(b)}</span></div>${vs}${body}</div>`;}
function recentLine(b,me){const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const others=b.players.filter(p=>p!==me);const xp=(b.xp||{})[me]||0;
  return `<li><span>${m.emoji} ${esc(m.name)}${others.length?` ${b.mode==="raid"?"with":"vs"} ${others.map(p=>bName(b,p)).join(", ")}`:""}<br><small>${resultText(b,me)}</small></span><span class="amt pos">${xp?"+"+xp+" XP":""}</span></li>`;}
const bbChores=(kidId,mode)=>cfg().chores.filter(c=>c.kind==="family"&&!needsNote(c)&&(c.assign==="pool"||(mode==="ghost"&&c.assign===kidId)));
function battleBuilder(k,bb){const bc=game().battles,lv=xpState(k.id).level,mode=G.modeById(bb.mode);
  const modeBtn=m=>{const why=(bc.modesOff||[]).includes(m.id)?"Turned off":lv<m.level?`🔒 Level ${m.level}`:m.kidsOnly&&k.adult?"Kids only":"";
    return `<button class="mode ${bb.mode===m.id?"on":""}" data-act="bb-mode" data-id="${m.id}" ${why?"disabled":""} aria-pressed="${bb.mode===m.id}"><span>${m.emoji}</span><b>${esc(m.name)}</b><small>${esc(why||m.desc)}</small></button>`;};
  const pick=(list,key,multi,label)=>`<h3>${label}</h3><div class="seg" style="justify-content:flex-start">${list.map(p=>{const on=multi?(bb[key]||[]).includes(p.id):bb[key]===p.id;
    return `<button class="${on?"on":""}" data-act="bb-pick" data-key="${key}" data-multi="${multi?1:""}" data-id="${p.id}" aria-pressed="${on}">${creatureFor(p.id)[1]} ${esc(p.name)}</button>`;}).join("")}</div>`;
  const others=kidsSorted().filter(p=>p.id!==k.id);let who="";
  if(mode&&mode.id==="raid")who=pick(others,"team",true,"Who's on your team? (up to 3)");
  else if(mode&&mode.id==="grownups"){const mine=others.filter(p=>!!p.adult===!!k.adult),theirs=others.filter(p=>!!p.adult!==!!k.adult);
    who=(mine.length?pick(mine,"team",true,"Your team (optional)"):"")+pick(theirs,"opponents",true,k.adult?"Kids to battle":"Grown-ups to battle");}
  else if(mode&&!mode.solo)who=pick(mode.kidsOnly?others.filter(p=>!p.adult):others,"opponent",false,"Who do you challenge?");
  let params="";
  if(bb.mode==="race")params=`<label>First to<select data-bind="bb.n">${[2,3,4,5,6].map(n=>`<option value="${n}" ${Number(bb.n)===n?"selected":""}>${n} chores</option>`).join("")}</select></label>`;
  if(bb.mode==="blitz"||bb.mode==="grownups")params=`<label>How long<select data-bind="bb.windowMin">${[[30,"30 minutes"],[60,"1 hour"],[0,"Until midnight"]].map(([v,l])=>`<option value="${v}" ${Number(bb.windowMin)===v?"selected":""}>${l}</option>`).join("")}</select></label>`;
  if(bb.mode==="raid")params=`<label>How many days<select data-bind="bb.days">${[1,2,3].map(n=>`<option value="${n}" ${Number(bb.days)===n?"selected":""}>${n} day${n>1?"s":""}</option>`).join("")}</select></label>`;
  if(mode&&(G.TIMED.includes(mode.id)||mode.id==="judge")){const pb=xpState(k.id).pb;
    params=`<label>Chore<select data-bind="bb.choreId">${bbChores(k.id,mode.id).map(c=>`<option value="${c.id}" ${bb.choreId===c.id?"selected":""}>${esc(c.name)}${mode.id==="ghost"&&pb[c.id]!=null?` (your best ${fmtMs(pb[c.id])})`:""}</option>`).join("")}</select></label>`;}
  const opp=mode&&!mode.solo&&!mode.team?kidCfg(bb.opponent):null;let hc="";
  if(opp&&mode.id!=="wildcard"){const h=G.handicaps(k,opp,cfg());const y=h[k.id]>1?k:h[opp.id]>1?opp:null;if(y)hc=`<p class="hint">${y.id===k.id?"You're":esc(y.name)+" is"} younger, so ${y.id===k.id?"your":"their"} score counts ×${h[y.id]}${mode.id==="bingo"?" (in Bingo: free squares instead)":""}.</p>`;}
  const ready=mode&&(mode.solo||(mode.id==="raid"?(bb.team||[]).length>0&&(bb.team||[]).length<=3:mode.id==="grownups"?(bb.opponents||[]).length>0:!!opp));
  return `<div class="builder"><h3>Pick a mode</h3><div class="modes">${G.MODES.map(modeBtn).join("")}</div>${who}
    ${params?`<div class="row" style="margin-top:10px">${params}</div>`:""}${hc}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="bb-send" ${!ready||S.busy.b?"disabled":""}>${S.busy.b?"Sending…":mode&&mode.solo?"Start":"Send challenge"}</button><button class="btn ghost" data-act="bb-close">Cancel</button></div></div>`;}
function battleSection(k){const bc=game().battles;const mine=battleList().filter(b=>b.players.includes(k.id));const live=mine.filter(b=>b.live);const recent=mine.filter(b=>!b.live&&b.status==="done").slice(0,3);
  if(!bc.enabled&&!live.length&&!recent.length)return "";
  const bb=S.ui.bb&&S.ui.bb.kid===k.id?S.ui.bb:null;const asleep=bc.enabled&&G.inQuietHours(nowHM(),cfg());
  const t12=hm=>{const [h,m]=hm.split(":").map(Number);return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});};
  const x=xpState(k.id).counts;const rec=(x.win||0)+(x.loss||0)+(x.tie||0)?`<span class="sub">${x.win||0} won, ${x.loss||0} lost${x.tie?`, ${x.tie} tied`:""}</span>`:"";
  return `<section class="card battles"><div class="sec-head"><h2>⚔️ Battles</h2>${rec}${bc.enabled&&!bb?(asleep?`<span class="sub">😴 Asleep until ${t12(bc.quietEnd)}</span>`:`<button class="btn small" data-act="bb-open">Challenge</button>`):""}</div>
    ${bb?battleBuilder(k,bb):""}${live.map(b=>battleCard(b,k.id)).join("")}
    ${!live.length&&!bb?`<p class="empty">${bc.enabled?"No battles right now. Challenge someone, or race your own best time.":"Battles are turned off."}</p>`:""}
    ${recent.length?`<ul class="feed recent">${recent.map(b=>recentLine(b,k.id)).join("")}</ul>`:""}</section>`;}

/* ---------- game: quests, rewards, bounties, family goal ---------- */
function questCtx(id){const mon=mondayOf(new Date()),sun=addDays(mon,6),fri=addDays(mon,4),ks=kidState(id),fz=xpState(id).frozen;
  const entries=entriesFor(id).filter(e=>e.status!=="reversed"&&e.date>=mon&&e.date<=sun).map(e=>({...e,hour:new Date(e.t).getHours()}));
  let checklistDays=0;for(let i=0;i<7;i++)if(prComplete(ks,addDays(mon,i)))checklistDays++;
  const w=getWeek(id,mon);const ded=(w.deductions||[]).filter(d=>d.status==="active"||d.status==="final").reduce((s,d)=>s+d.amount,0);
  const wins=battleList().filter(b=>b.status==="done"&&b.day>=mon&&b.day<=sun&&b.players.includes(id)&&G.isWinner(b,b.result,id)).length;
  return {entries,chores:cfg().chores,cotdOf:d=>G.choreOfDay(cfg().chores,d,cfg()),checklistDays,wins,goal:w.goal||0,netByFri:entries.filter(e=>e.date<=fri).reduce((s,e)=>s+e.amount,0)-ded};}
function questSection(k){if(!game().quests.enabled)return "";const qs=G.questStatus(mondayOf(new Date()),k.id,questCtx(k.id));
  return `<section class="card"><div class="sec-head"><h2>🗺️ This week's quests</h2><span class="sub">New ones every Monday</span></div><div class="quests">${qs.map(q=>`<div class="quest ${q.done?"done":""}"><span class="q-e">${q.done?"✅":q.emoji}</span><div><b>${esc(q.text)}</b><div class="bar"><i style="width:${q.progress/q.target*100}%"></i></div><small>${q.done?"Done!":`${q.progress} of ${q.target}`}</small></div><span class="q-xp">+${q.xp} XP</span></div>`).join("")}</div></section>`;}
const claimsFor=id=>Object.values(S.claims).filter(c=>c.personId===id);
function rewardSection(k){const rewards=game().rewards;if(!rewards.length)return "";const lv=xpState(k.id).level,mine=claimsFor(k.id);
  const rows=rewards.slice().sort((a,b)=>a.level-b.level).map(r=>{const cl=mine.filter(c=>c.rewardId===r.id).sort((a,b)=>b.slot-a.slot);const next=G.nextRewardSlot(r,lv,cl.map(c=>c.slot));const last=cl[0];
    let st;
    if(last&&last.status==="pending")st=`<span class="pill">Waiting for a parent</span>`;
    else if(last&&last.status==="approved")st=`<span class="pill on">Approved! 🎉</span>`;
    else if(next!=null)st=`<button class="btn small" data-act="claim-reward" data-id="${esc(r.id)}" ${S.busy.b?"disabled":""}>Claim</button>`;
    else if(lv<r.level)st=`<span class="pill">🔒 Level ${r.level}</span>`;
    else st=r.repeat?`<span class="pill">Again at level ${G.rewardSlots(r,lv+999).find(l=>l>lv)}</span>`:`<span class="pill on">Enjoyed ✓</span>`;
    return `<div class="flag-row"><span><b>${esc(r.name)}</b><br><small>Level ${r.level}${r.repeat?`, then every ${r.repeat} levels`:""}</small></span>${st}</div>`;}).join("");
  return `<section class="card"><div class="sec-head"><h2>🎁 Rewards</h2><span class="sub">Earn them by leveling up</span></div>${rows}</section>`;}
function bountySection(k){const list=Object.entries(S.bounties).map(([id,b])=>({id,...b})).filter(b=>(b.status==="open"&&(!b.for||b.for===k.id))||(b.status==="claimed"&&b.claimedBy===k.id)).sort((a,b)=>b.xp-a.xp);
  if(!list.length)return "";
  return `<section class="card"><div class="sec-head"><h2>🏅 Bounties</h2><span class="sub">Special jobs from a parent</span></div>${list.map(b=>`<div class="flag-row"><span><b>${esc(b.name)}</b><br><small>+${b.xp} XP${b.for?"":", first one to do it"}${b.due?`. By ${shortDate(b.due)}`:""}</small></span>
    ${b.status==="claimed"?`<span class="pill">Waiting for a parent</span>`:`<button class="btn small" data-act="claim-bounty" data-id="${b.id}" ${S.busy.b?"disabled":""}>I did it</button>`}</div>`).join("")}</section>`;}
const famTotal=()=>cfg().kids.reduce((s,k)=>s+((S.xp[k.id]||{}).total||0),0);
function familyBar(compact){const g=S.game.familyGoal;const fp=G.familyProgress(famTotal(),g);if(!fp)return "";
  return `<div class="fambar ${fp.done?"done":""} ${compact?"compact":""}" role="img" aria-label="Family goal ${esc(g.name)}: ${fp.into} of ${fp.target} XP"><span class="fb-name">👨‍👩‍👧‍👦 ${esc(g.name)}</span><div class="fb-track"><i style="width:${fp.frac*100}%"></i></div><span class="fb-num">${fp.done?"Reached! 🎉":`${fp.into.toLocaleString()} / ${fp.target.toLocaleString()} XP`}</span></div>`;}

function viewDisplay(){
  const d=(7-new Date().getDay())%7;const cash=d===0?"Cash-out tonight":`Cash-out in ${d} day${d===1?"":"s"}`;
  const all=[];for(const w of Object.values(S.weeks))for(const e of w.entries||[])if(e.status!=="reversed")all.push({...e,kidId:w.kidId});
  const recent=all.sort((a,b)=>b.t-a.t).slice(0,5).map(e=>{const k=kidCfg(e.kidId);return k?`<b>${esc(k.name)}</b> ${esc(e.name.toLowerCase())}${e.detail?` (${esc(e.detail)})`:""} +${money(e.amount)}`:"";}).filter(Boolean);
  const ups=cfg().kids.map(k=>({k,lu:xpState(k.id).levelUp})).filter(x=>x.lu&&Date.now()-x.lu.at<24*3600e3).map(x=>`⭐ <b>${esc(x.k.name)}</b> reached level ${x.lu.level}!`);
  const cot=choreById(cotdId()||"");
  return `<div class="board"><header class="board-head"><h1>Boon Chore Tracker</h1><div class="when">${new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}. <b>${cash}</b>${cot?`<span class="cotd-chip">⭐ Double XP: ${esc(cot.name)}</span>`:""}</div></header>
  ${familyBar(false)}${battleStrip()}
  <div class="lanes">${kidsSorted().map(k=>{const ks=kidState(k.id),w=getWeek(k.id,activeWeek(k.id)),net=weekNet(w),won=w.goal&&net>=w.goal,s=streak(k.id),x=xpState(k.id);
    return `<section class="lane ${won?"won":""}" data-kid="${k.id}"><div class="lane-who"><span class="lane-cr">${crHtml(k.id)}</span><div><h2>${esc(k.name)}</h2><span class="lvl-badge">Lv ${x.level}</span> <span class="streak">🔥 ${s}</span><small class="lane-title">${esc(titleOf(k.id))}</small></div></div>
      <div class="lane-track">${w.goal?trail(net/w.goal,crHtml(k.id),won,`${esc(k.name)} is at ${Math.round(net/w.goal*100)}% of their goal`,equipped(k.id).trail):`<p class="sub">Waiting for this week's goal</p>`}</div>
      <div class="lane-num"><b>${money(net)}</b><span>${w.goal?"of "+money(w.goal):"No goal yet"}</span>${w.goal?`<em class="${won?"won-note":""}">${won?"Goal reached!":Math.round(net/w.goal*100)+"%"}</em>`:""}</div>
</section>`;}).join("")}</div>
  <footer class="ticker">${[...ups,...(recent.length?["Latest: "+recent.join("&emsp;")]:[])].join("&emsp;")||"No chores done yet this week. Who's first?"}</footer></div>`;
}
// Live battles across the top of the family display.
function battleStrip(){const bl=battleList().filter(b=>b.live&&b.status!=="pending");if(!bl.length)return "";
  return `<div class="battle-strip" aria-label="Battles going on">${bl.map(b=>{const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const r=b.result||{};
    let who;
    if(b.mode==="raid"){const ts=(b.teamScores||{}).a;who=`<span class="bs-p">${b.teams.a.map(p=>crHtml(p)).join("")} vs ${esc(b.params.bossEmoji)} <span class="bs-score">${Math.max(0,(b.params.hp||0)-(ts?ts.raw:0))} HP left</span></span>`;}
    else if(b.teams)who=["a","b"].map(sd=>`<span class="bs-p">${b.teams[sd].map(p=>crHtml(p)).join("")} <span class="bs-score">${((b.teamScores||{})[sd]||{}).adj||0}</span></span>`).join(`<span class="vs-x">vs</span>`);
    else who=b.players.map(p=>`<span class="bs-p">${crHtml(p)} <b>${bName(b,p)}</b> <span class="bs-score">${scoreHtml(b,p)}</span></span>`).join(`<span class="vs-x">vs</span>`);
    const tail=b.status==="judging"?`<em>Judging…</em>`:b.status==="confirming"?`<em>${r.noContest?"No contest":r.tie?"Tie!":b.mode==="ghost"?(r.winner?"New best!":"So close!"):r.winnerSide?b.teams[r.winnerSide].map(p=>bName(b,p)).join(" & ")+" win!":bName(b,r.winner)+" wins!"}</em>`:b.mode==="ghost"?`<span class="vs-x">vs</span><span class="bs-p">👻 best ${b.pb!=null?fmtMs(b.pb):"—"}</span>`:"";
    return `<div class="bs"><span class="bs-mode">${b.wildcard?"🃏 ":""}${m.emoji} ${esc(m.name)}</span>${who}${tail}</div>`;}).join("")}</div>`;}

/* ---------- parent ---------- */
function viewParent(){
  const adults=kidsSorted().filter(k=>k.adult);
  const email=String(S.user&&S.user.email||"").toLowerCase();const mine=a=>a.email&&a.email.toLowerCase()===email;
  const tabs=[...adults.map(a=>["me:"+a.id,a.name+(mine(a)?" (you)":"")]),["activity","Activity"],["game","Game"+(gameAlerts()?` (${gameAlerts()})`:"")],["views","Views"],["actions","Actions"],["goals","Savings goals"],["settings","Settings"]];
  if(!tabs.some(t=>t[0]===S.ptab))S.ptab="activity";
  let body;if(S.ptab.startsWith("me:")){S.viewKid=S.ptab.slice(3);body=viewKid(S.viewKid,true);}
  else body={activity:pActivity,game:pGame,views:pViews,actions:pActions,goals:pGoals,settings:pSettings}[S.ptab]();
  return `<div class="wrap"><header class="p-head"><div><h1>Parent</h1><p class="sub">Signed in as ${esc(parentName())}</p></div><button class="btn ghost small" data-act="sign-out">Sign out</button></header>
  <nav class="tabs">${tabs.map(t=>`<button class="${S.ptab===t[0]?"on":""}" data-act="ptab" data-tab="${t[0]}">${esc(t[1])}</button>`).join("")}</nav>${body}</div>`;
}
const gameAlerts=()=>battleList().filter(b=>b.live&&(b.status==="judging"||(b.status==="confirming"&&b.result&&b.result.needsParent))).length
  +Object.values(S.claims).filter(c=>c.status==="pending").length+Object.values(S.bounties).filter(b=>b.status==="claimed").length;
function pGame(){
  const live=battleList().filter(b=>b.live),cot=cotdId(),fam=cfg().chores.filter(c=>c.kind==="family"),g=game();
  const email=String(S.user&&S.user.email||"").toLowerCase();
  const line=b=>{const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const r=b.result||{};const names=b.teams?Object.values(b.teams).map(t=>t.map(p=>bName(b,p)).join(" & ")).join(" vs "):b.players.map(p=>bName(b,p)).join(" vs ");
    const mine=b.players.some(p=>{const k=kidCfg(p);return k&&k.email&&k.email.toLowerCase()===email;});
    const times=G.TIMED.includes(b.mode)?" Times: "+b.players.map(p=>`${bName(b,p)} ${scoreHtml(b,p)}`).join(", ")+".":b.scores?" Score: "+b.players.map(p=>`${bName(b,p)} ${scoreHtml(b,p)}`).join(", ")+".":"";
    const status=b.status==="judging"?"Both are done. Go look, then pick the better job.":b.status==="confirming"?`${resultText(b,null)}${r.needsParent?(r.disputedBy?` ${bName(b,r.disputedBy)} asked you to check.`:" Flagged: a run under a minute."):" Waiting for the other player (auto-confirms after 12 hours)."}`:b.status==="pending"?"Waiting to be accepted.":"In progress.";
    const btns=b.status==="judging"?(mine?`<small>Another parent needs to judge this one.</small>`:`<span class="row" style="flex:0 1 auto;gap:6px">${b.players.map(p=>`<button class="btn small" data-act="p-judge" data-id="${b.id}" data-winner="${p}">${bName(b,p)}</button>`).join("")}<button class="btn ghost small" data-act="p-judge" data-id="${b.id}" data-winner="tie">Tie</button></span>`)
      :b.status==="confirming"&&!mine?`<button class="btn small" data-act="p-bconfirm" data-id="${b.id}">Confirm</button><button class="btn ghost small" data-act="p-bvoid" data-id="${b.id}">No contest</button>`
      :b.status!=="confirming"?`<button class="btn ghost small" data-act="p-bcancel" data-id="${b.id}">Call off</button>`:`<small>Another parent needs to check this one.</small>`;
    return `<li><span style="flex:1"><b>${m.emoji} ${esc(m.name)}</b>: ${names}<br><small>${modeParams(b)}. ${status}${times}</small></span>${btns}</li>`;};
  const hist=id=>{const h=S.ui.xpHist[id];if(!h)return "";if(h==="loading")return `<p class="sub">Loading…</p>`;
    return h.length?`<ul class="feed">${h.map(e=>`<li><span>${esc(e.reason)}<br><small>${timeOf(e.t)}</small></span><span class="amt pos">+${e.amount} XP</span></li>`).join("")}</ul>`:`<p class="empty">No XP yet.</p>`;};
  return pushCard()+claimsCard()+bountiesCard()+`<section class="card"><div class="sec-head"><h2>Battles</h2><span class="sub">${g.battles.enabled?"On":"Off"}. Change in Settings</span></div>
    ${live.length?`<ul class="feed">${live.sort((a,b)=>(["judging","confirming"].includes(b.status))-(["judging","confirming"].includes(a.status))).map(line).join("")}</ul>`:`<p class="empty">No battles going on.</p>`}
    <p class="hint">Speed results wait for the other player or a parent to confirm. Runs under a minute and disputes always need a parent. "No contest" ends a battle with no XP.</p></section>
  <section class="card"><div class="sec-head"><h2>Chore of the Day</h2></div>
    ${g.choreOfDay.enabled?`<div class="row"><label>Today's double-XP chore<select data-change="cotd">${fam.map(c=>`<option value="${c.id}" ${c.id===cot?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label></div>
    <p class="hint">It rotates automatically each day. Picking one here changes today only. Point it at the chores nobody picks.</p>`:`<p class="empty">Turned off in Settings.</p>`}</section>
  <section class="card"><div class="sec-head"><h2>Levels</h2></div>${kidsSorted().map(k=>{const x=xpState(k.id);
    return `<div class="flag-row"><span style="flex:1"><span class="lvl-cr">${crHtml(k.id)}</span> <b>${esc(k.name)}</b>: level ${x.level}, ${x.total.toLocaleString()} XP${x.freezes?`, 🧊 ${x.freezes}`:""}<br><small>${esc(titleOf(k.id))}. ${x.need?`${x.need-x.into} XP to level ${x.level+1}`:"Top level"}</small></span>
      <button class="btn ghost small" data-act="xp-hist" data-kid="${k.id}">${S.ui.xpHist[k.id]?"Hide":"XP history"}</button></div>${hist(k.id)}`;}).join("")}
    <div class="handoff" style="margin-top:14px"><b>Count past chores</b><br>Gives everyone XP for the chores, goals, streaks, and badges they earned before levels existed. Safe to run more than once: nothing is counted twice.
    <button class="btn block" style="margin-top:10px" data-act="backfill" ${S.busy.backfill?"disabled":""}>${S.busy.backfill?"Counting…":"Count past chores"}</button></div></section>`+familyGoalCard()+raisesCard();
}
// Parent notifications on this phone: reward claims, bounties, and battles that need a parent.
function pushCard(){if(!("Notification" in window))return "";const perm=Notification.permission;if(perm==="granted"&&S.ui.parentPushOn)return "";
  return perm==="denied"?`<p class="hint">Notifications are blocked for this site in your phone's settings.</p>`
    :`<button class="btn ghost block" style="margin-top:14px" data-act="parent-push">🔔 Notify this phone when something needs a parent</button>`;}
function claimsCard(){const all=Object.values(S.claims),pend=all.filter(c=>c.status==="pending"),appr=all.filter(c=>c.status==="approved");
  if(!pend.length&&!appr.length&&!game().rewards.length)return "";
  const nm=id=>esc((kidCfg(id)||{}).name||"?");
  return `<section class="card"><div class="sec-head"><h2>🎁 Reward claims</h2><span class="sub">Set rewards in Settings</span></div>
    ${pend.length||appr.length?`<ul class="feed">${pend.map(c=>`<li><span style="flex:1"><b>${nm(c.personId)}</b>: ${esc(c.name)}<br><small>Level ${c.slot} reward, claimed ${timeOf(c.createdAt)}</small></span><button class="btn small" data-act="p-claim" data-id="${c.id}" data-st="approved">Approve</button><button class="btn ghost small" data-act="p-claim" data-id="${c.id}" data-st="declined">Not now</button></li>`).join("")}
      ${appr.map(c=>`<li><span style="flex:1"><b>${nm(c.personId)}</b>: ${esc(c.name)}<br><small>Approved. Mark it given once it happens.</small></span><button class="btn ghost small" data-act="p-claim" data-id="${c.id}" data-st="done">Given ✓</button></li>`).join("")}</ul>`:`<p class="empty">No claims waiting.</p>`}</section>`;}
function bountiesCard(){const list=Object.entries(S.bounties).map(([id,b])=>({id,...b})).filter(b=>b.status==="open"||b.status==="claimed").sort((a,b)=>(b.status==="claimed")-(a.status==="claimed"));
  const nb=S.ui.nb||(S.ui.nb={name:"",xp:100,for:"",due:""});const nm=id=>esc((kidCfg(id)||{}).name||"?");
  return `<section class="card"><div class="sec-head"><h2>🏅 Bounties</h2><span class="sub">One-off jobs worth extra XP</span></div>
    ${list.length?`<ul class="feed">${list.map(b=>`<li><span style="flex:1"><b>${esc(b.name)}</b> (+${b.xp} XP)<br><small>${b.for?`For ${nm(b.for)}`:"Anyone"}${b.due?`, by ${shortDate(b.due)}`:""}. ${b.status==="claimed"?`<b>${nm(b.claimedBy)} says it's done.</b>`:"Open."}</small></span>
      ${b.status==="claimed"?`<button class="btn small" data-act="p-bounty-award" data-id="${b.id}" data-kid="${b.claimedBy}">Award</button><button class="btn ghost small" data-act="p-bounty-reopen" data-id="${b.id}">Not yet</button>`
        :`<select aria-label="Who did it" data-bind="bountyWho.${b.id}" style="width:auto">${kidsSorted().filter(k=>!b.for||k.id===b.for).map(k=>`<option value="${k.id}" ${((S.ui.bountyWho||{})[b.id]||"")===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select><button class="btn ghost small" data-act="p-bounty-award" data-id="${b.id}">Mark done</button><button class="btn ghost small" data-act="p-bounty-cancel" data-id="${b.id}">Remove</button>`}</li>`).join("")}</ul>`:`<p class="empty">No bounties right now.</p>`}
    <div class="row" style="margin-top:10px"><label>New bounty<input data-bind="nb.name" value="${esc(nb.name)}" placeholder="Clean out the garage together"></label><label style="flex:0 1 100px">XP<input type="number" min="1" max="1000" data-type="num" data-bind="nb.xp" value="${esc(nb.xp)}"></label></div>
    <div class="row" style="margin-top:8px"><label>For<select data-bind="nb.for"><option value="">Anyone</option>${kidsSorted().map(k=>`<option value="${k.id}" ${nb.for===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label><label>By (optional)<input type="date" data-bind="nb.due" value="${esc(nb.due)}"></label><button class="btn" style="flex:0 0 auto" data-act="p-bounty-add">Add bounty</button></div></section>`;}
function familyGoalCard(){const g=S.game.familyGoal,fp=G.familyProgress(famTotal(),g),fg=S.ui.fg||(S.ui.fg={name:"",target:1000});const hist=(S.game.history||[]).slice(-3).reverse();
  return `<section class="card"><div class="sec-head"><h2>👨‍👩‍👧‍👦 Family goal</h2><span class="sub">Everyone's XP fills one bar</span></div>
    ${fp?familyBar(false)+(fp.done?`<button class="btn block" style="margin-top:10px" data-act="fg-done">🎉 We did it! Mark it done</button>`:`<button class="btn ghost small" style="margin-top:8px" data-act="fg-stop">Stop this goal</button>`)
      :`<div class="row"><label>Reward<input data-bind="fg.name" value="${esc(fg.name)}" placeholder="Pizza night"></label><label style="flex:0 1 140px">XP to earn together<input type="number" min="50" step="50" data-type="num" data-bind="fg.target" value="${esc(fg.target)}"></label><button class="btn" style="flex:0 0 auto" data-act="fg-start">Start</button></div>
      <p class="hint">XP everyone earns from now on counts. The family earns roughly ${Math.round(cfg().kids.length*60).toLocaleString()} XP a day together, so 1,000 XP is a few days' work.</p>`}
    ${hist.length?`<p class="hint">Done before: ${hist.map(h=>`${esc(h.name)} (${shortDate(h.date)})`).join(", ")}</p>`:""}</section>`;}
function raisesCard(){const mp=game().moneyPerks;if(!mp.enabled)return "";
  const due=cfg().kids.filter(k=>!k.adult).map(k=>({k,n:G.raisesDue(xpState(k.id).level,k.perkLevel||0,mp.everyLevels)})).filter(x=>x.n>0);
  return `<section class="card"><div class="sec-head"><h2>💵 Raises</h2><span class="sub">Every ${mp.everyLevels} levels: +${money(mp.amount)} per chore</span></div>
    ${due.length?due.map(({k,n})=>`<div class="flag-row"><span><b>${esc(k.name)}</b> reached level ${xpState(k.id).level}<br><small>Suggested: ${money(k.rate)} → ${money(r2(k.rate+mp.amount*n))} per chore</small></span><span class="row" style="flex:0 1 auto;gap:6px"><button class="btn small" data-act="raise" data-kid="${k.id}" data-n="${n}">Give raise</button><button class="btn ghost small" data-act="raise-skip" data-kid="${k.id}">Skip</button></span></div>`).join("")
      :`<p class="empty">No raises due right now.</p>`}</section>`;}
function pViews(){
  const kids=kidsSorted().filter(k=>!k.adult),cur=kids.find(k=>k.id===S.ui.kidView);
  if(cur){S.viewKid=cur.id;return `<div class="asbar"><button class="btn ghost small" data-act="kid-view" data-kid="">← Back</button><span>This is <b>${esc(cur.name)}</b>'s screen. Taps here count as ${esc(cur.name)}.</span></div>${viewKid(cur.id,true)}`;}
  return `<div class="pboard">${viewDisplay()}</div><section class="card"><div class="sec-head"><h2>See a kid's screen</h2></div><p class="hint" style="margin:0 0 12px">Opens their tablet's screen exactly as they see it. Anything you tap there counts as them.</p>
    ${kids.length?`<div class="kid-list">${kids.map(k=>`<button class="choice" data-act="kid-view" data-kid="${k.id}"><span class="e">${creatureFor(k.id)[1]}</span><span><b>${esc(k.name)}</b><small>🔥 ${streak(k.id)} day streak</small></span></button>`).join("")}</div>`:`<p class="empty">No kids set up yet.</p>`}</section>`;
}
function pActions(){return `<h2 class="tab-h">Deductions</h2>${pDeductions()}<h2 class="tab-h">Cash-out</h2>${pCashout()}`;}
function pActivity(){
  const y=addDays(ymd(),-1);let flags="";
  for(const k of kidsSorted().filter(k=>!k.adult)){const ksy=kidState(k.id),done=ksy.prLog[y]||[];
    const miss=[...(ksy.prDone[y]?[]:prChores().filter(c=>!done.includes(c.id)).map(c=>c.name)),...famChoresFor(k.id).filter(c=>c.assign===k.id&&countOnDate(k.id,c.id,y)===0).map(c=>c.name)];
    for(const m of miss)flags+=`<div class="flag-row"><span><b>${esc(k.name)}</b> didn't check off ${esc(m)}</span><button class="btn ghost small" data-act="prefill-ded" data-kid="${k.id}" data-reason="${esc("Missed: "+m)}">Deduct</button></div>`;}
  const L=S.ui.log;if(!L.kid)L.kid=kidsSorted()[0].id;const lk=kidCfg(L.kid)||kidsSorted()[0];const lchores=famChoresFor(lk.id);if(!lchores.some(c=>c.id===L.chore))L.chore=lchores[0]?lchores[0].id:"";
  const all=[];for(const w0 of Object.values(S.weeks)){if(w0.closed)continue;const w=getWeek(w0.kidId,w0.week);for(const e of w.entries)all.push({e,w});}
  all.sort((a,b)=>b.e.t-a.e.t);
  return `<section class="card"><div class="sec-head"><h2>Log a chore</h2></div><p class="hint" style="margin-top:0">For anyone without their tablet handy.</p>
    <div class="row"><label>Who<select data-bind="log.kid">${kidsSorted().map(k=>`<option value="${k.id}" ${k.id===lk.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    <label>Chore<select data-bind="log.chore">${lchores.map(c=>`<option value="${c.id}" ${c.id===L.chore?"selected":""}>${esc(c.name)} (+${money(choreValue(lk,c))})</option>`).join("")}</select></label>${needsNote(choreById(L.chore))?`<label>What was it<input data-bind="log.note" maxlength="120" placeholder="What the chore was" value="${esc(L.note||"")}"></label>`:""}
    <button class="btn" style="flex:0 0 auto" data-act="log-chore" ${S.busy.log?"disabled":""}>${S.busy.log?"Saving…":"Log it"}</button></div></section>
  <section class="card"><div class="sec-head"><h2>Missed yesterday</h2></div>${flags||`<p class="empty">Nothing missed yesterday.</p>`}<p class="hint">Nothing is deducted automatically. You decide.</p></section>
  <section class="card"><div class="sec-head"><h2>This week's chores</h2></div>${all.length?`<ul class="feed">${all.slice(0,50).map(({e,w})=>{const k=kidCfg(w.kidId);const l=choreLine(e);
    const btn=`<button class="btn ghost small" data-act="${e.status==="reversed"?"restore":"reverse"}" data-kid="${w.kidId}" data-wk="${w.week}" data-id="${e.id}">${e.status==="reversed"?"Restore":"Reverse"}</button>`;
    return `<li><span style="flex:1"><b>${esc(k?k.name:"?")}</b>: ${l[0]}</span>${l[1]}${btn}</li>`;}).join("")}</ul>`:`<p class="empty">No chores logged yet this week.</p>`}</section>`;
}
function pDeductions(){
  const d=S.ui.ded;if(!d.kid)d.kid=kidsSorted().find(k=>!k.adult)?.id||kidsSorted()[0].id;
  let list="";for(const k of kidsSorted())for(const w of openWeeks(k.id))for(const e of w.deductions)
    list+=`<li><span style="flex:1"><b>${esc(k.name)}</b>: ${esc(e.reason)}<br><small>${e.how?"Earn back by: "+esc(e.how)+". ":""}${e.status==="active"?"Open":"Earned back"}${e.by?", by "+esc(e.by):""}</small></span><span class="amt ${e.status==="active"?"neg":"struck"}">−${money(e.amount)}</span>
    ${e.status==="active"?`<button class="btn small" data-act="redeem" data-kid="${k.id}" data-wk="${w.week}" data-id="${e.id}">Earned back</button>`:""}<button class="btn ghost small" data-act="remove-ded" data-kid="${k.id}" data-wk="${w.week}" data-id="${e.id}">Remove</button></li>`;
  return `<section class="card"><div class="sec-head"><h2>Add a deduction</h2></div>
    <div class="row"><label>Who<select data-bind="ded.kid">${kidsSorted().map(k=>`<option value="${k.id}" ${k.id===d.kid?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    <label>Amount<input type="number" step="0.25" min="0.25" inputmode="decimal" data-bind="ded.amount" data-type="num" value="${esc(d.amount)}"></label></div>
    <div class="row" style="margin-top:10px"><label>Reason<input data-bind="ded.reason" value="${esc(d.reason)}" placeholder="Bad attitude at dinner"></label></div>
    <div class="row" style="margin-top:10px"><label>How to earn it back<input data-bind="ded.how" value="${esc(d.how)}" placeholder="Apologize and keep a good attitude the rest of the day"></label></div>
    <button class="btn block" style="margin-top:12px" data-act="add-ded">Add deduction</button>
    <p class="hint">They can earn it back any time before Sunday's cash-out. After that it's final. Deductions never show on the leaderboard.</p></section>
    <section class="card"><div class="sec-head"><h2>This week</h2></div>${list?`<ul class="feed">${list}</ul>`:`<p class="empty">No deductions this week.</p>`}</section>`;
}
// Every week that still needs cashing out: last week if it was missed, plus this week. They settle as one lump.
function cashWeeks(kidId){const thisMon=mondayOf(new Date()),prev=addDays(thisMon,-7),out=[];
  const pw=S.weeks[weekDocId(kidId,prev)];if(pw&&!pw.closed&&((pw.entries||[]).length||(pw.deductions||[]).length||pw.goal))out.push(prev);
  const tw=S.weeks[weekDocId(kidId,thisMon)];if(!(tw&&tw.closed))out.push(thisMon);return out.length?out:null;}
function cashoutPlan(kidId,weeks){
  const ks=kidState(kidId),sp=cfg().split,ex={spend:0,save:0,invest:0,give:0};const addSplit=a=>{for(const b in ex)ex[b]+=a*sp[b]/100;};
  const parts=weeks.map(wk=>{const w=getWeek(kidId,wk),net=weekNet(w),goal=w.goal||0,met=goal>0&&net>=goal;
    return {wk,w,net,goal,met,bonus:met?r2(goal*BONUS_RATE):0,bonusTo:w.bonusTo||"split",chores:choreCount(w),activeDed:w.deductions.filter(e=>e.status==="active").length};});
  const net=r2(parts.reduce((t,p)=>t+p.net,0));if(net>0)addSplit(net);const owed=net<0?q(-net):0;
  let bonus=0;for(const p of parts)if(p.bonus){bonus=r2(bonus+p.bonus);if(p.bonusTo==="split")addSplit(p.bonus);else ex[p.bonusTo]+=p.bonus;}
  const month=ymd().slice(0,7);const interestDue=ks.lastInterestMonth!==month&&ks.invest>0;const interest=interestDue?qd(calcInterest(ks.invest)):0;const interestTo=ks.interestTo||"invest";
  let goalInterest=0;if(interest){if(interestTo in ex)ex[interestTo]+=interest;else goalInterest=interest;}
  const total=q(ex.spend+ex.save+ex.invest+ex.give);const storage={save:q(ex.save),invest:q(ex.invest),give:q(ex.give)};
  let cash=r2(total-storage.save-storage.invest-storage.give);if(cash<0){storage.save=r2(storage.save+cash);cash=0;}
  // The savings split comes from the newest week that set one.
  const splitW=[...parts].reverse().map(p=>p.w).find(w=>(w.saveSplit&&Object.keys(w.saveSplit).length)||w.saveTo)||parts[parts.length-1].w;
  const saveParts=splitCents(storage.save,saveSplitFor(splitW,ks));
  return {weeks,parts,net,bonus,owed,interestDue,interest,interestTo,goalInterest,cash,storage,saveParts,
    chores:parts.reduce((t,p)=>t+p.chores,0),activeDed:parts.reduce((t,p)=>t+p.activeDed,0),goalHits:parts.filter(p=>p.met).length,earned:r2(parts.reduce((t,p)=>t+Math.max(0,p.net),0))};
}
function pCashout(){
  return (new Date().getDay()===0?"":`<p class="hint">It isn't Sunday yet. Cashing out now closes this week early.</p>`)+kidsSorted().map(k=>{
    const ks=kidState(k.id),weeks=cashWeeks(k.id);
    if(!weeks){const c=getWeek(k.id,mondayOf(new Date())).cashout;return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">Cashed out</span></div>${c?`<div class="handoff">Handed <b>${money(c.cash)}</b> in cash. Into storage: Save <b>${money(c.storage.save)}</b>, Invest <b>${money(c.storage.invest)}</b>, Give <b>${money(c.storage.give)}</b>.${c.owed?` Collected <b>${money(c.owed)}</b> from Spend.`:""}</div>`:""}</section>`;}
    const p=cashoutPlan(k.id,weeks),multi=weeks.length>1,one=p.parts[0];
    return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">${multi?`${weeks.length} weeks in one lump`:`Week of ${shortDate(weeks[0])}`}</span></div>
    ${multi?`<p class="hint" style="margin:0 0 6px">Last week wasn't cashed out, so it's combined with this week. Each week's goal still counts on its own.</p>`:""}
    <dl class="kv">${multi?p.parts.map(x=>`<dt>Week of ${shortDate(x.wk)}</dt><dd>${money(x.net)}${x.goal?`, goal ${money(x.goal)} ${x.met?"reached":"missed"}`:", no goal"}</dd>`).join(""):""}
    <dt>Earned (after deductions)</dt><dd>${money(p.net)}</dd>${multi?"":`<dt>Goal</dt><dd>${one.goal?money(one.goal)+(one.met?" reached":" missed"):"None set"}</dd>`}
    ${p.bonus?`<dt>Bonus${multi?"":" ("+esc(destName(ks,one.bonusTo))+")"}</dt><dd>+${money(p.bonus)}</dd>`:""}
    ${p.interestDue?`<dt>Monthly interest (to ${esc(destName(ks,p.interestTo))})</dt><dd>+${money(p.interest)}</dd>`:""}
    ${p.activeDed?`<dt>Open deductions becoming final</dt><dd>${p.activeDed}</dd>`:""}</dl>
    <div class="handoff">${p.owed?`Earnings came up short. Collect <b>${money(p.owed)}</b> from ${esc(k.name)}'s Spend cash.<br>`:""}Hand ${esc(k.name)} <b>${money(p.cash)}</b> in cash.<br>
      Into storage: Save <b>${money(p.storage.save)}</b> (${savePartsText(ks,p.saveParts)}), Invest <b>${money(p.storage.invest)}</b>, Give <b>${money(p.storage.give)}</b>.${p.goalInterest?` Interest of <b>${money(p.goalInterest)}</b> goes to ${esc(goalName(ks,p.interestTo))}.`:""}</div>
    <button class="btn block" style="margin-top:12px" data-act="cashout" data-kid="${k.id}" ${S.busy["co:"+k.id]?"disabled":""}>Confirm cash-out for ${esc(k.name)}${multi?` (${weeks.length} weeks)`:""}</button></section>`;}).join("");
}
function pGoals(){
  return kidsSorted().map(k=>{const ks=kidState(k.id),b=S.ui.buy,pg=S.ui.pgoal[k.id]||(S.ui.pgoal[k.id]={name:"",target:""});
    return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">Invest ${money(ks.invest)}, Give ${money(ks.give)}</span></div>
    ${ks.goals.map(g=>{const eg=S.ui.editGoal;if(eg&&eg.kid===k.id&&eg.goal===g.id)return `<div class="flag-row"><span class="row" style="flex:1"><label style="flex:2 1 140px">Name<input aria-label="Goal name" data-bind="editGoal.name" value="${esc(eg.name)}"></label><label style="flex:1 1 90px">Amount<input type="number" step="0.25" min="0.25" inputmode="decimal" aria-label="Goal amount" data-bind="editGoal.target" data-type="num" value="${esc(eg.target)}"></label><button class="btn small" data-act="save-goal">Save</button><button class="btn ghost small" data-act="cancel-edit-goal">Cancel</button></span></div>`;
      return `<div class="flag-row"><span><b>${esc(g.name)}</b><br><small>${money(g.balance)}${g.target?" of "+money(g.target):""}</small></span>
      ${b&&b.kid===k.id&&b.goal===g.id?`<span class="row" style="flex:0 1 260px"><input type="number" step="0.25" inputmode="decimal" aria-label="Purchase amount" data-bind="buy.amount" data-type="num" value="${esc(b.amount)}"><button class="btn small" data-act="confirm-buy">Log</button><button class="btn ghost small" data-act="cancel-buy">Cancel</button></span>`
      :`<span class="row" style="flex:0 0 auto;gap:6px">${g.id==="general"?"":`<button class="btn ghost small" data-act="edit-goal" data-kid="${k.id}" data-goal="${g.id}">Edit</button>`}<button class="btn ghost small" data-act="buy-goal" data-kid="${k.id}" data-goal="${g.id}" ${g.balance>0?"":"disabled"}>Log purchase</button></span>`}</div>`;}).join("")}
    <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="pgoal.${k.id}.name" value="${esc(pg.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="pgoal.${k.id}.target" value="${esc(pg.target)}"><button class="btn small" data-act="p-add-goal" data-kid="${k.id}">Add</button></div>
    ${ks.archived.length?`<p class="hint">Bought so far: ${ks.archived.map(a=>`${esc(a.name)} (${money(a.bought)}, ${shortDate(a.date)})`).join(", ")}</p>`:""}
    ${balanceForm(k,ks)}</section>`;}).join("");
}
function balanceForm(k,ks){
  const a=S.ui.adjust;if(!a||a.kid!==k.id)return `<div class="row" style="margin-top:12px"><button class="btn ghost small" data-act="adjust-bal" data-kid="${k.id}">Set balances</button></div>`;
  const field=(label,bind,val)=>`<label>${esc(label)}<input type="number" step="0.01" min="0" inputmode="decimal" data-type="num" data-bind="${bind}" value="${esc(val)}"></label>`;
  const saveTotal=Object.values(a.goalBal).reduce((t,v)=>t+(Number(v)||0),0);
  return `<div class="adjust"><h3>What ${esc(k.name)} has right now</h3><p class="hint" style="margin:0 0 10px">Use this for money from before the app, or to fix a mistake. Spend is handed over as cash each week, so it has no balance here.</p>
    <h4>Save <small>Total <b class="save-total">${money(saveTotal)}</b>. Split it between general savings and any goals.</small></h4>
    <div class="grid-2">${ks.goals.map(g=>field(g.name,`adjust.goalBal.${g.id}`,a.goalBal[g.id])).join("")}</div>
    <h4>Invest</h4><div class="grid-2">${field("Invest balance","adjust.invest",a.invest)}</div>
    <h4>Give</h4><div class="grid-2">${field("Give balance","adjust.give",a.give)}</div>
    <div class="row" style="margin-top:12px"><button class="btn small" data-act="save-bal">Save balances</button><button class="btn ghost small" data-act="cancel-bal">Cancel</button></div></div>`;
}
function pDevices(){
  const nc=S.ui.newCode;const roleLabel=d=>d.role==="display"?"Leaderboard":((kidCfg(d.kidId)||{}).name||"Removed person")+"'s tablet";
  const live=S.codes.filter(c=>c.expiresAt&&c.expiresAt.toMillis()>Date.now()).sort((a,b)=>b.expiresAt.toMillis()-a.expiresAt.toMillis());
  return `<section class="card"><div class="sec-head"><h2>Pair a device</h2></div>
    <div class="row"><label>This device is for<select data-bind="newCode.role"><option value="display" ${nc.role==="display"?"selected":""}>The leaderboard</option>${kidsSorted().map(k=>`<option value="${k.id}" ${nc.role===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    <button class="btn" style="flex:0 0 auto" data-act="make-code">Create pairing code</button></div>
    ${live.map(c=>`<div class="handoff" style="margin-top:12px"><div class="code">${esc(c.id)}</div>For ${esc(c.role==="display"?"the leaderboard":(kidCfg(c.kidId)||{}).name)}. On that device, open the app, tap Pair this device, and enter the code. It expires at ${c.expiresAt.toDate().toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})}.</div>`).join("")}</section>
  <section class="card"><div class="sec-head"><h2>Paired devices</h2></div>${S.devices.length?S.devices.map(d=>`<div class="flag-row"><span><b>${esc(d.name)}</b><br><small>${esc(roleLabel(d))}</small> ${d.role==="kid"?`<span class="pill ${d.fcmToken?"on":""}">${d.fcmToken?"Reminders on":"Reminders off"}</span>`:""}</span><button class="btn ghost small" data-act="unpair" data-id="${d.id}">Unpair</button></div>`).join(""):`<p class="empty">No devices paired yet.</p>`}
  <p class="hint">Unpairing locks a device out right away. Use it for a lost tablet or to switch a tablet to someone else.</p></section>`;
}
function startDraft(){const c=clone(cfg());c.kids.forEach(k=>k.remindStr=(k.remind||[]).join(", "));c.chores.forEach(ch=>ch.ask=needsNote(ch));c.game=clone(G.gameCfg(c));S.ui.draft=c;}
function gameSettings(d){const g=d.game,b=g.battles;const chk=(path,on,label)=>`<label class="check-label"><input type="checkbox" data-bind="draft.game.${path}" ${on?"checked":""}> ${label}</label>`;
  return `<section class="card"><div class="sec-head"><h2>Game</h2></div>
    <div class="grid-2">${chk("quests.enabled",g.quests.enabled,"Weekly quests")}${chk("choreOfDay.enabled",g.choreOfDay.enabled,"Chore of the Day (double XP)")}${chk("streakMultiplier.enabled",g.streakMultiplier.enabled,`Streak bonus (×${g.streakMultiplier.mult} XP at ${g.streakMultiplier.minStreak}+ days)`)}${chk("battles.enabled",b.enabled,"Battles")}</div>
    <h3 style="margin-top:14px">Battle modes</h3><div class="grid-2">${G.MODES.filter(m=>!m.soon).map(m=>`<label class="check-label"><input type="checkbox" data-act="toggle-mode" data-id="${m.id}" ${(b.modesOff||[]).includes(m.id)?"":"checked"}> ${m.emoji} ${esc(m.name)}</label>`).join("")}</div>
    <div class="grid-2" style="margin-top:12px">
    <label>No battles from<input type="time" data-bind="draft.game.battles.quietStart" value="${esc(b.quietStart)}"></label>
    <label>Until<input type="time" data-bind="draft.game.battles.quietEnd" value="${esc(b.quietEnd)}"></label>
    <label>Battles per person per day<input type="number" min="1" step="1" data-type="num" data-bind="draft.game.battles.dailyCap" value="${esc(b.dailyCap)}"></label>
    <label>Handicap per year younger (%)<input type="number" min="0" step="1" data-type="num" data-bind="draft.game.battles.handicapPct" value="${esc(b.handicapPct??Math.round(b.handicapPerYear*100))}"></label>
    <label>Biggest handicap (×)<input type="number" min="1" step="0.05" data-type="num" data-bind="draft.game.battles.handicapMax" value="${esc(b.handicapMax)}"></label></div>
    <p class="hint">Handicap example: with 8% per year, a kid 4 years younger scores ×1.32. Adults count as age ${b.adultAge}. XP never goes down, and battles never cost money.</p>
    <h3 style="margin-top:16px">Rewards for leveling up</h3>
    ${g.rewards.map((r,i)=>`<div class="row" style="margin-top:8px"><label style="flex:0 1 90px">Level<input type="number" min="1" max="30" data-type="num" data-bind="draft.game.rewards.${i}.level" value="${esc(r.level)}"></label><label>Reward<input data-bind="draft.game.rewards.${i}.name" value="${esc(r.name)}" placeholder="Pick Friday dinner"></label>
      <label style="flex:0 1 150px">Again every<select data-bind="draft.game.rewards.${i}.repeat">${[0,1,2,3,5,10].map(n=>`<option value="${n}" ${Number(r.repeat||0)===n?"selected":""}>${n?`${n} level${n>1?"s":""}`:"Once only"}</option>`).join("")}</select></label>
      <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-reward" data-i="${i}">Remove</button></div>`).join("")||`<p class="empty">No rewards yet.</p>`}
    <div class="row" style="margin-top:8px"><button class="btn ghost small" style="flex:0 0 auto" data-act="add-reward">Add reward</button>${g.rewards.length?"":`<button class="btn ghost small" style="flex:0 0 auto" data-act="starter-rewards">Add some ideas</button>`}</div>
    <p class="hint">Kids claim a reward when they reach its level, and you approve it in the Game tab.</p>
    <h3 style="margin-top:16px">Raises</h3>
    <div class="grid-2">${chk("moneyPerks.enabled",g.moneyPerks.enabled,"Suggest raises as kids level up")}
    <label>Every how many levels<input type="number" min="1" step="1" data-type="num" data-bind="draft.game.moneyPerks.everyLevels" value="${esc(g.moneyPerks.everyLevels)}"></label>
    <label>Raise per chore ($)<input type="number" min="0.01" step="0.01" data-type="num" data-bind="draft.game.moneyPerks.amount" value="${esc(g.moneyPerks.amount)}"></label></div>
    <p class="hint">Off by default. When on, the Game tab suggests a raise and nothing changes until you tap Give raise.</p></section>`;}
function pSettings(){
  if(!S.ui.draft)startDraft();const d=S.ui.draft;
  const choreRow=(c,i)=>`<div class="set-block" data-drag="chore" data-kind="${c.kind}" data-i="${i}"><div class="row"><span class="drag-handle" data-handle role="button" aria-label="Drag to reorder" title="Drag to reorder">⠿</span><label>Chore<input data-bind="draft.chores.${i}.name" value="${esc(c.name)}"></label><label class="chk"><input type="checkbox" data-bind="draft.chores.${i}.ask" ${c.ask?"checked":""}>Ask what it was</label>
    ${c.kind==="pr"?`<label>Details<input data-bind="draft.chores.${i}.note" value="${esc(c.note||"")}"></label>`:`<label>Pays (× base rate)<input type="number" step="0.5" min="0" data-type="num" data-bind="draft.chores.${i}.mult" value="${esc(c.mult)}"></label>
    <label>Daily limit<input type="number" step="1" min="1" data-type="num" data-bind="draft.chores.${i}.limit" value="${esc(c.limit)}"></label>
    <label>Who<select data-bind="draft.chores.${i}.assign"><option value="pool" ${c.assign==="pool"?"selected":""}>Anyone</option>${d.kids.map(k=>`<option value="${k.id}" ${c.assign===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>`}
    <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-chore" data-i="${i}">Remove</button></div></div>`;
  return pDevices()+`<section class="card"><div class="sec-head"><h2>People</h2><button class="btn ghost small" data-act="add-kid">Add person</button></div>
    ${d.kids.map((k,i)=>`<div class="set-block"><div class="row"><label>Name<input data-bind="draft.kids.${i}.name" value="${esc(k.name)}"></label><label class="chk" title="A grown-up gets their own lane and tab instead of a place in the kid list"><input type="checkbox" data-bind="draft.kids.${i}.adult" ${k.adult?"checked":""}>Adult</label>${k.adult?`<label>Google email<input type="email" data-bind="draft.kids.${i}.email" value="${esc(k.email||"")}" placeholder="Their parent sign-in"></label>`:`<label>Age<input type="number" data-type="num" data-bind="draft.kids.${i}.age" value="${esc(k.age)}"></label>`}
    <label>Base rate per chore<input type="number" step="0.05" data-type="num" data-bind="draft.kids.${i}.rate" value="${esc(k.rate)}"></label>
    <label>Reminder times<input data-bind="draft.kids.${i}.remindStr" value="${esc(k.remindStr)}" placeholder="15:30, 19:30"></label>
    <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-kid" data-i="${i}">Remove</button></div></div>`).join("")}</section>
  <section class="card"><div class="sec-head"><h2>Family chores (paid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="family">Add chore</button></div><p class="hint drag-hint">Drag the ⠿ handle to change the order kids see.</p>${d.chores.map((c,i)=>c.kind==="family"?choreRow(c,i):"").join("")}</section>
  <section class="card"><div class="sec-head"><h2>Personal responsibility (unpaid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="pr">Add item</button></div><p class="hint drag-hint">Drag the ⠿ handle to change the order kids see.</p>${d.chores.map((c,i)=>c.kind==="pr"?choreRow(c,i):"").join("")}</section>
  ${gameSettings(d)}
  <section class="card"><div class="sec-head"><h2>Invest interest (monthly)</h2></div><div class="grid-2">
    <label>Rate up to threshold (%)<input type="number" step="0.5" data-type="num" data-bind="draft.interest.low" value="${esc(d.interest.low)}"></label>
    <label>Threshold ($)<input type="number" step="1" data-type="num" data-bind="draft.interest.threshold" value="${esc(d.interest.threshold)}"></label>
    <label>Rate above threshold (%)<input type="number" step="0.5" data-type="num" data-bind="draft.interest.high" value="${esc(d.interest.high)}"></label></div>
    <p class="hint">At today's balances, this month's interest would cost ${money(cfg().kids.reduce((s,k)=>s+qd(calcInterest(kidState(k.id).invest)),0))} in total, rounded down to the nearest quarter per person.</p></section>
  <div class="row" style="margin-top:14px"><button class="btn" data-act="save-settings">Save settings</button><button class="btn ghost" data-act="discard-settings">Discard changes</button></div>`;
}

/* ---------- writes ---------- */
const weekRef=(kid,wk)=>doc(db,"weeks",weekDocId(kid,wk));
async function txWeek(kid,wk,mut){await runTransaction(db,async t=>{const s=await t.get(weekRef(kid,wk));const w=Object.assign({kidId:kid,week:wk,entries:[],deductions:[]},s.exists()?s.data():{});mut(w);t.set(weekRef(kid,wk),w);});}
// Calls a battle function as the person on screen (parents pass as:null to act as a parent).
async function bcall(name,data,okMsg){S.busy.b=true;render();
  try{const r=await call(name)({as:S.viewKid,...data});if(okMsg)toast(okMsg);return r.data||{};}catch(e){toast(errMsg(e));return null;}finally{delete S.busy.b;}}
function guard(p,okMsg){return p.then(()=>{if(okMsg)toast(okMsg);}).catch(e=>toast("Couldn't save: "+errMsg(e)));}

// Check a daily item on or off; a description is kept when one was asked for.
function setPr(kid,id,on,note){const today=ymd(),ks=kidState(kid),done=ks.prLog[today]||[];
  const complete=on&&prChores().every(c=>c.id===id||done.includes(c.id));const upd={prLog:{[today]:on?arrayUnion(id):arrayRemove(id)}};
  if(complete)upd.prDone={[today]:true};else if(!on)upd.prDone={[today]:false};if(note)upd.prNotes={[today]:{[id]:note}};
  guard(setDoc(doc(db,"prefs",kid),upd,{merge:true}));
  if(complete){confetti(90);chime(true);toast(ks.prDone[today]?"All done for today.":`All done for today! Streak +1 and +${G.XP.checklist} XP.`);}}
async function doChore(kidId,choreId,note){
  const k=kidCfg(kidId),ch=choreById(choreId),today=ymd();if(!k||!ch)return;
  if(choreCountToday(k.id,ch,today)>=(ch.limit||1)){toast("That one's done for today.");return;}
  const wk=activeWeek(k.id),w=getWeek(k.id,wk),before=weekNet(w),amt=choreValue(k,ch);
  S.busy["c:"+choreId]=true;render();
  try{await call("completeChore")({kidId,choreId,note:note||""});
    if(w.goal&&before<w.goal&&before+amt>=w.goal){confetti(260);chime(true);toast("Goal reached! Bonus locked in.");}else{confetti(50);chime(false);toast(`+${money(amt)} and +${choreXpFor(k.id,ch)} XP for ${ch.name.toLowerCase()}`);}}
  catch(e){toast(errMsg(e));}
  finally{delete S.busy["c:"+choreId];render();}
}
async function doCashout(kidId){
  const weeks=cashWeeks(kidId);if(!weeks)return;const p=cashoutPlan(kidId,weeks);const k=kidCfg(kidId);
  if(!confirm(`Cash out ${k.name}${weeks.length>1?` for ${weeks.length} weeks in one lump`:""}? Hand over ${money(p.cash)} in cash${p.owed?` and collect ${money(p.owed)}`:""}.`))return;
  const month=ymd().slice(0,7);S.busy["co:"+kidId]=true;render();
  try{await runTransaction(db,async t=>{
    const refs=weeks.map(wk=>weekRef(kidId,wk)),bref=doc(db,"bank",kidId);const snaps=[];for(const r of refs)snaps.push(await t.get(r));const bs=await t.get(bref);
    const ws=snaps.map((sn,i)=>Object.assign({kidId,week:weeks[i],entries:[],deductions:[]},sn.exists()?sn.data():{}));if(ws.some(w=>w.closed))throw new Error("One of those weeks is already cashed out.");
    const b=Object.assign({goalBal:{},invest:0,give:0,archived:[],stats:{}},bs.exists()?bs.data():{});
    const addGoal=(id,amt)=>{if(amt)b.goalBal[id]=r2((b.goalBal[id]||0)+amt);};
    for(const id in p.saveParts)addGoal(id,p.saveParts[id]);b.invest=r2((b.invest||0)+p.storage.invest);b.give=r2((b.give||0)+p.storage.give);
    if(p.interestDue){b.lastInterestMonth=month;addGoal(p.interestTo,p.goalInterest);}
    b.stats.chores=(b.stats.chores||0)+p.chores;b.stats.goalHits=(b.stats.goalHits||0)+p.goalHits;b.stats.earned=r2((b.stats.earned||0)+p.earned+p.bonus);
    const at=Date.now(),last=ws.length-1;
    ws.forEach((w,i)=>{const x=p.parts[i],final=i===last;w.closed=true;
      w.cashout={at,by:parentName(),weeks,net:x.net,goal:x.goal,met:x.met,bonus:x.bonus,interest:final?p.interest:0,cash:final?p.cash:0,owed:final?p.owed:0,storage:final?p.storage:{save:0,invest:0,give:0},saveParts:final?p.saveParts:{},goalInterest:final?p.goalInterest:0,combinedInto:final?null:weeks[last]};
      w.deductions=w.deductions.map(d=>d.status==="active"?{...d,status:"final"}:d);t.set(refs[i],w);});
    t.set(bref,b);});toast(`${k.name} is cashed out.`);}
  catch(e){toast("Couldn't cash out: "+errMsg(e));}
  finally{delete S.busy["co:"+kidId];render();}
}
async function enablePush(silent){
  try{const m=await messaging();if(!m){if(!silent)toast("This device can't get reminders.");return;}
    if(!silent){const p=await Notification.requestPermission();if(p!=="granted"){render();return;}}
    const reg=await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token=await getToken(m,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
    if(token&&S.role==="parent"){await setDoc(doc(db,"parentTokens",S.user.uid),{fcmToken:token,email:S.user.email||"",at:Date.now()});S.ui.parentPushOn=true;if(!silent)toast("Notifications are on for this phone.");render();return;}
    if(token&&S.device&&token!==S.device.fcmToken)await updateDoc(doc(db,"devices",S.user.uid),{fcmToken:token,tokenAt:Date.now()});
    if(!silent)toast("Reminders are on.");}
  catch(e){if(!silent)toast("Couldn't turn on reminders: "+errMsg(e));}
}

/* ---------- actions ---------- */
async function handleAct(act,ds){
  const today=ymd(),kid=S.viewKid;
  switch(act){
  case "start-pair": try{await signInAnonymously(auth);}catch(e){toast(errMsg(e));} return;
  case "parent-signin": try{if(auth.currentUser&&auth.currentUser.isAnonymous)await signOut(auth);await signInWithPopup(auth,new GoogleAuthProvider());}catch(e){if(e.code!=="auth/popup-closed-by-user")toast(errMsg(e));} return;
  case "sign-out": if(S.role==="parent"||S.phase==="notparent"){await signOut(auth);}return;
  case "pair":{const code=String(S.ui.pair.code).trim();if(!/^\d{6}$/.test(code)){toast("Enter the 6-digit code.");return;}
    if(!auth.currentUser){try{await signInAnonymously(auth);}catch(e){toast(errMsg(e));return;}}
    S.busy.pair=true;render();try{await call("pairDevice")({code,name:S.ui.pair.name});S.ui.pair={code:"",name:""};toast("Paired!");}catch(e){toast(errMsg(e));}finally{delete S.busy.pair;render();}return;}
  case "enable-push": enablePush(false);return;
  case "pick-creature": S.ui.pickCreature=!S.ui.pickCreature;break;
  case "wtab": S.ui.wtab=ds.tab;break;
  case "equip": if(ds.slot==="creature")guard(setDoc(doc(db,"prefs",kid),{creature:ds.id},{merge:true}));
    else guard(setDoc(doc(db,"prefs",kid),{equipped:{[ds.slot]:ds.id}},{merge:true}));break;
  case "lu-ok": try{localStorage.setItem(seenKey(S.ui.levelUp.kid),String(S.ui.levelUp.at));}catch(e){} S.ui.levelUp=null;break;
  case "freeze-ok": try{localStorage.setItem("boon.freezeSeen."+kid,String(ds.at));}catch(e){} break;
  case "bb-open":{const pool=bbChores(kid,"timetrial")[0];S.ui.bb={kid,mode:"race",opponent:"",team:[],opponents:[],n:"3",windowMin:"60",days:"1",choreId:pool?pool.id:""};break;}
  case "bb-pick":{const bb=S.ui.bb;if(ds.multi){const l=new Set(bb[ds.key]||[]);if(l.has(ds.id))l.delete(ds.id);else l.add(ds.id);bb[ds.key]=[...l];}else bb[ds.key]=ds.id;break;}
  case "bb-close": S.ui.bb=null;break;
  case "bb-mode":{const bb=S.ui.bb;bb.mode=ds.id;if((G.TIMED.includes(ds.id)||ds.id==="judge")&&!bbChores(kid,ds.id).some(c=>c.id===bb.choreId)){const c=bbChores(kid,ds.id)[0];bb.choreId=c?c.id:"";}break;}

  case "bb-send":{const bb=S.ui.bb,m=G.modeById(bb.mode);const r=await bcall("createBattle",{mode:bb.mode,opponent:bb.opponent,team:bb.team,opponents:bb.opponents,n:Number(bb.n),windowMin:Number(bb.windowMin),days:Number(bb.days),choreId:bb.choreId});
    if(r){S.ui.bb=null;const got=G.modeById(r.mode)||m;toast(m.solo?"Ghost race is on. Start when you're ready!":m.id==="wildcard"?`🃏 It's ${got.name}!${r.twist?" "+r.twist.text+".":""} Challenge sent.`:m.id==="raid"?"Team invite sent!":"Challenge sent!");}break;}
  case "b-accept":{const r=await bcall("respondBattle",{id:ds.id,accept:true});if(r){confetti(60);chime(false);toast(r.started?"Battle on! Go go go!":"You're in! Waiting for the others.");}break;}
  case "b-decline": await bcall("respondBattle",{id:ds.id,accept:false});break;
  case "b-cancel": await bcall("cancelBattle",{id:ds.id},"Called off.");break;
  case "b-start": await bcall("startAttempt",{id:ds.id},"Timer started. Go!");break;
  case "b-finish":{const r=await bcall("finishAttempt",{id:ds.id});if(r){confetti(80);chime(true);toast(r.ms!=null?`Done in ${fmtMs(r.ms)}! Chore logged.`:"Turned in! Chore logged.");}break;}
  case "p-judge": if(!confirm(ds.winner==="tie"?"Call it a tie?":`${kidCfg(ds.winner).name} did the better job?`))return;await bcall("judgeBattle",{id:ds.id,winner:ds.winner,as:null},"Judged. Thanks!");break;
  case "claim-reward":{const r=await bcall("claimReward",{rewardId:ds.id});if(r){confetti(80);chime(true);toast("Claimed! A parent will approve it.");}break;}
  case "claim-bounty": if(await bcall("claimBounty",{id:ds.id},"Nice! A parent will check it."))confetti(60);break;
  case "p-claim": guard(updateDoc(doc(db,"claims",ds.id),{status:ds.st,decidedBy:parentName(),decidedAt:Date.now()}),{approved:"Approved.",declined:"Marked not now.",done:"Marked given."}[ds.st]);return;
  case "p-bounty-add":{const nb=S.ui.nb;const name=String(nb.name||"").trim(),xp=Math.round(Number(nb.xp)||0);if(!name||!(xp>0)){toast("Give the bounty a name and some XP.");return;}
    S.ui.nb={name:"",xp:100,for:"",due:""};guard(setDoc(doc(db,"bounties",uid()),{name,xp:Math.min(1000,xp),for:nb.for||"",due:nb.due||null,status:"open",createdAt:Date.now(),by:parentName()}),"Bounty posted.");break;}
  case "p-bounty-award":{const bt=S.bounties[ds.id]||{};const who=ds.kid||(S.ui.bountyWho||{})[ds.id]||bt.for||kidsSorted()[0].id;
    if(!confirm(`Give ${kidCfg(who).name} ${S.bounties[ds.id].xp} XP for this bounty?`))return;await bcall("awardBounty",{id:ds.id,personId:who,as:null},"Bounty awarded.");break;}
  case "p-bounty-reopen": guard(updateDoc(doc(db,"bounties",ds.id),{status:"open",claimedBy:null}),"Reopened.");return;
  case "p-bounty-cancel": if(!confirm("Remove this bounty?"))return;guard(updateDoc(doc(db,"bounties",ds.id),{status:"cancelled"}),"Removed.");return;
  case "fg-start":{const fg=S.ui.fg;const name=String(fg.name||"").trim(),target=Math.round(Number(fg.target)||0);if(!name||!(target>0)){toast("Name the reward and set the XP.");return;}
    S.ui.fg={name:"",target:1000};guard(setDoc(doc(db,"app/game"),{familyGoal:{name,target,startTotal:famTotal(),startedAt:Date.now()}},{merge:true}),"Family goal started!");break;}
  case "fg-done":{const g=S.game.familyGoal;confetti(300);chime(true);guard(setDoc(doc(db,"app/game"),{familyGoal:null,history:arrayUnion({name:g.name,target:g.target,date:ymd()})},{merge:true}),"Enjoy it! Set a new goal any time.");break;}
  case "fg-stop": if(!confirm("Stop this family goal? Progress on it is dropped."))return;guard(setDoc(doc(db,"app/game"),{familyGoal:null},{merge:true}));break;
  case "raise": case "raise-skip":{const mp=game().moneyPerks,lv=xpState(ds.kid).level;
    guard(runTransaction(db,async t=>{const ref=doc(db,"app/config");const c=(await t.get(ref)).data();const k=c.kids.find(x=>x.id===ds.kid);if(!k)return;
      if(act==="raise")k.rate=r2((k.rate||0)+mp.amount*Number(ds.n));k.perkLevel=lv;t.set(ref,c);}),act==="raise"?"Raise given.":"Skipped until the next one.");return;}
  case "parent-push": enablePush(false);return;
  case "add-reward": S.ui.draft.game.rewards.push({id:uid(),level:5,name:"",repeat:0});break;
  case "rm-reward": S.ui.draft.game.rewards.splice(Number(ds.i),1);break;
  case "starter-rewards": S.ui.draft.game.rewards.push({id:uid(),level:3,name:"Pick a family movie",repeat:0},{id:uid(),level:5,name:"Pick Friday dinner",repeat:5},{id:uid(),level:10,name:"30 minutes later bedtime (once)",repeat:5},{id:uid(),level:15,name:"Ice cream trip with a parent",repeat:0});break;
  case "b-confirm": await bcall("confirmResult",{id:ds.id,action:"confirm"},"Confirmed. Good game!");break;
  case "b-dispute": await bcall("confirmResult",{id:ds.id,action:"dispute"},"A parent will check it.");break;
  case "p-bconfirm": await bcall("confirmResult",{id:ds.id,action:"confirm",as:null},"Result confirmed.");break;
  case "p-bvoid": if(!confirm("End this battle as no contest? Nobody gets XP for it."))return;await bcall("confirmResult",{id:ds.id,action:"void",as:null},"Called no contest.");break;
  case "p-bcancel": if(!confirm("Call off this battle? Nobody gets XP for it."))return;await bcall("cancelBattle",{id:ds.id,as:null},"Battle called off.");break;
  case "xp-hist":{const id=ds.kid;if(S.ui.xpHist[id]){delete S.ui.xpHist[id];break;}S.ui.xpHist[id]="loading";render();
    try{const snap=await getDocs(query(collection(db,"xp",id,"events"),orderBy("t","desc"),limit(25)));S.ui.xpHist[id]=snap.docs.map(d=>d.data());}catch(e){delete S.ui.xpHist[id];toast(errMsg(e));}break;}
  case "backfill":{S.busy.backfill=true;render();try{const r=await call("backfillXp")({});toast("Done. "+cfg().kids.map(k=>r.data[k.id]?`${k.name}: level ${r.data[k.id].level}`:"").filter(Boolean).join(", "));}
    catch(e){toast(errMsg(e));}finally{delete S.busy.backfill;}break;}
  case "toggle-mode":{const b=S.ui.draft.game.battles;const off=new Set(b.modesOff||[]);if(off.has(ds.id))off.delete(ds.id);else off.add(ds.id);b.modesOff=[...off];break;}
  case "goal-chip": S.ui.goalInput=String(ds.v);break;
  case "set-goal":{const v=q(S.ui.goalInput);if(!(v>0)){toast("Pick a goal of at least $0.25.");return;}const wk=activeWeek(kid);S.ui.goalInput="";
    guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,goal:v},{merge:true}));confetti(60);chime(false);break;}
  case "do-chore": if(!choreById(ds.id))return;S.ui.confirmChore={choreId:ds.id,note:""};break;
  case "cancel-chore": S.ui.confirmChore=null;break;
  case "confirm-chore":{const cc=S.ui.confirmChore;if(!cc)return;const note=String(cc.note||"").trim();if(needsNote(choreById(cc.choreId))&&!note){toast("Say what it was first.");return;}S.ui.confirmChore=null;doChore(kid,cc.choreId,note);return;}
  case "toggle-pr":{const id=ds.id,on=(kidState(kid).prLog[today]||[]).includes(id);
    if(!on&&needsNote(choreById(id))){S.ui.prNote={id,text:""};break;}
    setPr(kid,id,!on,"");return;}
  case "cancel-pr-note": S.ui.prNote=null;break;
  case "save-pr-note":{const pn=S.ui.prNote;if(!pn)return;const text=String(pn.text||"").trim();if(!text){toast("Say what it was first.");return;}S.ui.prNote=null;setPr(kid,pn.id,true,text);return;}
  case "add-goal":{const g=S.ui.newGoal;const name=String(g.name||"").trim();const t=r2(g.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.newGoal={name:"",target:""};guard(setDoc(doc(db,"prefs",kid),{goals:{[uid()]:{name,target:t,created:Date.now()}}},{merge:true}));break;}
  case "ptab": if(S.ptab==="settings"&&ds.tab!=="settings")S.ui.draft=null;S.ptab=ds.tab;S.ui.pickCreature=false;break;
  case "log-chore":{const L=S.ui.log;if(!L.chore)return;S.busy.log=true;render();try{const r=await call("completeChore")({kidId:L.kid,choreId:L.chore,note:String(L.note||"").trim()});L.note="";toast(`Logged +${money(r.data.amount)} for ${kidCfg(L.kid).name}.`);}catch(e){toast(errMsg(e));}finally{delete S.busy.log;render();}return;}
  case "reverse": case "restore": guard(txWeek(ds.kid,ds.wk,w=>{const e=w.entries.find(x=>x.id===ds.id);if(e)e.status=act==="reverse"?"reversed":"ok";}),act==="reverse"?"Reversed. Its XP comes off too.":"Restored, XP included.");return;
  case "prefill-ded": S.ui.ded={kid:ds.kid,amount:0.25,reason:ds.reason,how:"Do it today plus one extra chore"};S.ptab="actions";break;
  case "add-ded":{const d=S.ui.ded;const amt=q(d.amount);if(!(amt>0)||!String(d.reason).trim()){toast("Add an amount and a reason.");return;}const wk=activeWeek(d.kid);
    guard(setDoc(weekRef(d.kid,wk),{kidId:d.kid,week:wk,deductions:arrayUnion({id:uid(),t:Date.now(),amount:amt,reason:String(d.reason).trim(),how:String(d.how||"").trim(),status:"active",by:parentName()})},{merge:true}),"Deduction added.");
    S.ui.ded={kid:d.kid,amount:0.25,reason:"",how:""};break;}
  case "redeem": guard(txWeek(ds.kid,ds.wk,w=>{const e=w.deductions.find(x=>x.id===ds.id);if(e){e.status="redeemed";e.redeemedBy=parentName();}}).then(()=>setDoc(doc(db,"bank",ds.kid),{stats:{redemptions:increment(1)}},{merge:true})),"Earned back. Nice comeback.");return;
  case "remove-ded": if(!confirm("Remove this deduction entirely? Use this for mistakes. To reward a comeback, use Earned back instead."))return;guard(txWeek(ds.kid,ds.wk,w=>{w.deductions=w.deductions.filter(x=>x.id!==ds.id);}));return;
  case "cashout": doCashout(ds.kid);return;
  case "buy-goal":{const g=kidState(ds.kid).goals.find(x=>x.id===ds.goal);S.ui.buy={kid:ds.kid,goal:ds.goal,amount:g?g.balance:0};break;}
  case "cancel-buy": S.ui.buy=null;break;
  case "confirm-buy":{const b=S.ui.buy;const amt=r2(b.amount);const g0=kidState(b.kid).goals.find(x=>x.id===b.goal);
    if(!g0||!(amt>0)||amt>g0.balance){toast("Amount must be more than $0 and no more than the goal's balance.");return;}S.ui.buy=null;
    guard(runTransaction(db,async t=>{const ref=doc(db,"bank",b.kid);const s=await t.get(ref);const bank=Object.assign({goalBal:{},archived:[]},s.exists()?s.data():{});
      const bal=r2(bank.goalBal[b.goal]||0);if(amt>bal)throw new Error("Balance changed. Try again.");const left=r2(bal-amt);
      if(b.goal==="general"){bank.goalBal.general=left;bank.archived.push({name:"From general savings",bought:amt,date:ymd()});}
      else{delete bank.goalBal[b.goal];bank.archived.push({goalId:b.goal,name:g0.name,target:g0.target,bought:amt,date:ymd()});if(left>0)bank.goalBal.general=r2((bank.goalBal.general||0)+left);}
      t.set(ref,bank);}),`Logged. Take ${money(amt)} out of storage.`);break;}
  case "edit-goal":{const g=kidState(ds.kid).goals.find(x=>x.id===ds.goal);if(!g)return;S.ui.buy=null;S.ui.editGoal={kid:ds.kid,goal:ds.goal,name:g.name,target:g.target||""};break;}
  case "cancel-edit-goal": S.ui.editGoal=null;break;
  case "save-goal":{const e=S.ui.editGoal;if(!e)return;const name=String(e.name||"").trim();const t=r2(e.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.editGoal=null;guard(setDoc(doc(db,"prefs",e.kid),{goals:{[e.goal]:{name,target:t}}},{merge:true}),"Goal updated.");break;}
  case "split-even":{const s=S.ui.split,ids=kidState(kid).goals.map(g=>g.id),n=ids.length||1,base=Math.floor(100/n);let rem=100-base*n;ids.forEach(id=>{s.shares[id]=base+(rem>0?1:0);if(rem>0)rem--;});s.dirty=true;break;}
  case "save-split":{const s=S.ui.split,wk=activeWeek(kid),shares={};let tot=0;for(const g of kidState(kid).goals){const v=Math.max(0,Math.round(Number(s.shares[g.id])||0));if(v>0){shares[g.id]=v;tot+=v;}}
    if(tot!==100){toast("The split needs to add up to 100%.");return;}s.dirty=false;
    guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,saveSplit:shares},{mergeFields:["kidId","week","saveSplit"]}),"Savings split saved.");break;}
  case "kid-view": S.ui.kidView=ds.kid||null;S.ui.pickCreature=false;break;
  case "toggle-bucket": S.ui.openBuckets[ds.id]=!S.ui.openBuckets[ds.id];break;
  case "adjust-bal":{const ks=kidState(ds.kid),gb={};ks.goals.forEach(g=>gb[g.id]=g.balance);S.ui.buy=null;S.ui.editGoal=null;S.ui.adjust={kid:ds.kid,goalBal:gb,invest:ks.invest,give:ks.give};break;}
  case "cancel-bal": S.ui.adjust=null;break;
  case "save-bal":{const a=S.ui.adjust;if(!a)return;const vals=[...Object.values(a.goalBal),a.invest,a.give].map(r2);if(vals.some(n=>n<0)){toast("Balances can't be negative.");return;}
    const goalBal={};for(const id in a.goalBal)goalBal[id]=r2(a.goalBal[id]);S.ui.adjust=null;
    guard(setDoc(doc(db,"bank",a.kid),{goalBal,invest:r2(a.invest),give:r2(a.give)},{merge:true}),"Balances saved.");break;}
  case "p-add-goal":{const pg=S.ui.pgoal[ds.kid]||{};const name=String(pg.name||"").trim();const t=r2(pg.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.pgoal[ds.kid]={name:"",target:""};guard(setDoc(doc(db,"prefs",ds.kid),{goals:{[uid()]:{name,target:t,created:Date.now()}}},{merge:true}));break;}
  case "make-code":{const role=S.ui.newCode.role;const code=String(Math.floor(100000+Math.random()*900000));
    guard(setDoc(doc(db,"pairCodes",code),{role:role==="display"?"display":"kid",kidId:role==="display"?null:role,createdBy:parentName(),expiresAt:Timestamp.fromMillis(Date.now()+15*60000)}));return;}
  case "unpair": if(!confirm("Unpair this device? It will need a new code to reconnect."))return;guard(deleteDoc(doc(db,"devices",ds.id)),"Device unpaired.");return;
  case "add-kid": S.ui.draft.kids.push({id:uid(),name:"New person",age:8,rate:0.25,remind:[],remindStr:"15:30, 19:30"});break;
  case "rm-kid": if(!confirm("Remove this person from the app? Their saved money records stay in the database."))return;S.ui.draft.kids.splice(Number(ds.i),1);break;
  case "add-chore": S.ui.draft.chores.push(ds.kind==="pr"?{id:uid(),kind:"pr",name:"New item",note:"",ask:false}:{id:uid(),kind:"family",name:"New chore",mult:1,limit:1,assign:"pool",ask:false});break;
  case "rm-chore": S.ui.draft.chores.splice(Number(ds.i),1);break;
  case "discard-settings": S.ui.draft=null;break;
  case "save-settings":{const d=clone(S.ui.draft);
    d.kids.forEach(k=>{k.remind=String(k.remindStr||"").split(",").map(s=>s.trim()).filter(s=>/^\d{1,2}:\d{2}$/.test(s)).map(s=>s.padStart(5,"0"));delete k.remindStr;k.rate=r2(k.rate);k.adult=!!k.adult;k.age=k.adult?0:(Number(k.age)||0);
      const em=String(k.email||"").trim().toLowerCase();if(k.adult&&em)k.email=em;else delete k.email;});
    const b=d.game.battles;if(b.handicapPct!=null){b.handicapPerYear=Math.max(0,Number(b.handicapPct)||0)/100;delete b.handicapPct;}
    b.handicapMax=Math.max(1,Number(b.handicapMax)||1);b.dailyCap=Math.max(1,Math.round(Number(b.dailyCap)||1));
    for(const t of ["quietStart","quietEnd"])if(!/^\d{2}:\d{2}$/.test(b[t]||""))b[t]=G.GAME_DEFAULTS.battles[t];
    d.game.rewards=d.game.rewards.map(r=>({id:r.id||uid(),level:Math.min(30,Math.max(1,Math.round(Number(r.level)||1))),name:String(r.name||"").trim(),repeat:Math.max(0,Math.round(Number(r.repeat)||0))})).filter(r=>r.name);
    const mp=d.game.moneyPerks;mp.enabled=!!mp.enabled;mp.everyLevels=Math.max(1,Math.round(Number(mp.everyLevels)||5));mp.amount=Math.max(0,r2(mp.amount));
    d.chores.forEach(c=>{c.ask=!!c.ask;if(c.kind==="family"){c.mult=Number(c.mult)||1;c.limit=Math.max(1,Math.round(Number(c.limit)||1));if(c.assign!=="pool"&&!d.kids.some(k=>k.id===c.assign))c.assign="pool";}});
    S.ui.draft=null;guard(setDoc(doc(db,"app/config"),d),"Settings saved.");break;}
  }
  render();
}
function handleChange(act,el){const v=el.value,kid=S.viewKid;
  if(act==="bonusTo"||act==="saveTo"){const wk=activeWeek(kid);guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,[act]:v},{merge:true}));}
  else if(act==="interestTo")guard(setDoc(doc(db,"prefs",kid),{interestTo:v},{merge:true}));
  else if(act==="cotd")guard(setDoc(doc(db,"app/config"),{game:{choreOfDay:{pin:{date:ymd(),choreId:v}}}},{merge:true}),"Chore of the Day changed for today.");}

/* ---------- events ---------- */
document.addEventListener("click",e=>{const el=e.target.closest("[data-act]");if(!el||el.disabled)return;handleAct(el.dataset.act,el.dataset);});
document.addEventListener("input",e=>{const el=e.target;if(!el.dataset.bind)return;let v=el.value;if(el.type==="checkbox")v=el.checked;else if(el.dataset.type==="num")v=v===""?"":Number(v);setPath(S.ui,el.dataset.bind,v);
  if(el.type==="checkbox"&&/^draft\.(kids\.\d+\.adult|game\.)/.test(el.dataset.bind)){render();return;}
  if(el.dataset.bind==="confirmChore.note"||el.dataset.bind==="prNote.text"){const b=document.querySelector(el.dataset.bind==="confirmChore.note"?'[data-act="confirm-chore"]':'[data-act="save-pr-note"]');if(b)b.disabled=!String(v).trim();}
  if(el.dataset.bind.startsWith("split.shares.")){S.ui.split.dirty=true;updateSplitUI();}
  if(el.dataset.bind.startsWith("adjust.goalBal.")){const t=document.querySelector(".adjust .save-total");if(t)t.textContent=money([...document.querySelectorAll('.adjust input[data-bind^="adjust.goalBal."]')].reduce((n,i)=>n+(Number(i.value)||0),0));}
  if(el.dataset.bind==="goalInput"){const m=document.querySelector(".goal-set .goal-msg");const n=Number(v)||0;if(m)m.textContent=n>0?`Reach it and you get a +${money(r2(n*BONUS_RATE))} bonus.`:"Bigger goal, bigger bonus.";}});
document.addEventListener("change",e=>{const el=e.target;if(el.dataset.bind&&el.tagName==="SELECT"){setPath(S.ui,el.dataset.bind,el.value);render();}if(el.dataset.change)handleChange(el.dataset.change,el);});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="pin")handleAct("pair",{});});

let drag=null;
document.addEventListener("pointerdown",e=>{const h=e.target.closest("[data-handle]"),blk=h&&h.closest("[data-drag]");if(!blk)return;e.preventDefault();
  drag={id:e.pointerId,blk,kind:blk.dataset.kind,from:Number(blk.dataset.i),over:null,after:false};blk.classList.add("dragging");try{h.setPointerCapture(e.pointerId);}catch(x){}});
document.addEventListener("pointermove",e=>{if(!drag||e.pointerId!==drag.id)return;e.preventDefault();
  const list=[...document.querySelectorAll(`[data-drag][data-kind="${drag.kind}"]`)];list.forEach(b=>b.classList.remove("drop-before","drop-after"));drag.over=null;
  for(const b of list){const r=b.getBoundingClientRect();if(e.clientY>=r.top&&e.clientY<=r.bottom){if(b!==drag.blk){drag.over=b;drag.after=e.clientY>r.top+r.height/2;b.classList.add(drag.after?"drop-after":"drop-before");}break;}}});
function endDrag(e){if(!drag||e.pointerId!==drag.id)return;const d=drag;drag=null;d.blk.classList.remove("dragging");document.querySelectorAll(".drop-before,.drop-after").forEach(b=>b.classList.remove("drop-before","drop-after"));
  if(!d.over||!S.ui.draft)return;const arr=S.ui.draft.chores,item=arr[d.from];if(!item)return;let to=Number(d.over.dataset.i)+(d.after?1:0);arr.splice(d.from,1);if(to>d.from)to--;arr.splice(to,0,item);render();}
document.addEventListener("pointerup",endDrag);document.addEventListener("pointercancel",endDrag);

let wakeLock=null;async function wake(){try{if("wakeLock" in navigator&&S.role==="display")wakeLock=await navigator.wakeLock.request("screen");}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")wake();});
setInterval(()=>{if(S.phase!=="ready")return;subscribeWeeks();const a=document.activeElement;if(!(a&&(a.tagName==="INPUT"||a.tagName==="SELECT"))&&!(S.role==="parent"&&S.ptab==="settings"))render();},60000);
