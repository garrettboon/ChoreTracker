import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, where, orderBy, limit, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, arrayUnion, arrayRemove, increment, deleteField, Timestamp, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { VAPID_KEY } from "./config.js";
import * as G from "./game.js";

const CREATURES=G.CREATURES;
const S={phase:"loading",user:null,role:null,device:null,config:null,bank:{},prefs:{},weeks:{},xp:{},battles:{},claims:{},bounties:{},game:{},devices:[],codes:[],ptab:"activity",viewKid:null,busy:{},
  ui:{goalInput:"",newGoal:{name:"",target:""},ded:{kid:"",amount:0.25,reason:"",how:"",type:"ded"},buy:null,pgoal:{},editGoal:null,editChore:null,kidView:null,adjust:null,openBuckets:{},confirmChore:null,prNote:null,split:{key:null,base:"",dirty:false,shares:{}},draft:null,pickCreature:false,wtab:"creature",prevPct:{},prevLvl:{},bb:null,levelUp:null,xpHist:{},guide:{},pair:{code:"",name:""},newCode:{role:"display"},log:{kid:"",chore:"",note:""}}};

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r2=n=>Math.round((Number(n)||0)*100)/100;
const q=n=>Math.round((Number(n)||0)*4)/4;
const qd=n=>Math.floor((Number(n)||0)*4+1e-9)/4;   // round down to the nearest quarter
const BONUS_RATE=.25;   // bonus for reaching the weekly goal, as a share of the goal
const money=n=>(n<0?"−":"")+"$"+Math.abs(r2(n)).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});
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
  return {creature:p.creature||null,interestTo:p.interestTo||"invest",prLog:p.prLog||{},prDone:p.prDone||{},prNotes:p.prNotes||{},seenWarnings:p.seenWarnings||[],goals,archived:b.archived||[],invest:r2(b.invest||0),give:r2(b.give||0),
    stats:Object.assign({chores:0,goalHits:0,redemptions:0,earned:0},b.stats||{}),lastInterestMonth:b.lastInterestMonth||null};
}
function creatureFor(kidId){const ks=kidState(kidId);const idx=cfg().kids.findIndex(k=>k.id===kidId);const starters=CREATURES.filter(c=>c[3]===1);
  const id=ks.creature&&xpState(kidId).unlocked.has("c:"+ks.creature)?ks.creature:starters[Math.max(0,idx)%starters.length][0];return CREATURES.find(c=>c[0]===id)||CREATURES[0];}

/* ---------- game state ---------- */
function xpState(id){const x=S.xp[id]||{};const level=x.maxLevel||1,total=x.total||0,need=level>=G.MAX_LEVEL?0:G.xpToNext(level);
  return {total,level,need,into:Math.max(0,Math.min(need,total-G.levelStart(level))),unlocked:new Set([...G.STARTERS.map(c=>"c:"+c),...(x.unlocked||[]),...G.unlockedIds(level,x),...(G.skipsLevels(cfg(),kidCfg(id))?G.allUnlockIds():[])]),
    freezes:x.freezes||0,frozen:x.frozenDates||[],counts:x.counts||{},pb:x.pb||{},levelUp:x.levelUp||null,notice:x.notice||null};}
function equipped(id){const e=(S.prefs[id]||{}).equipped||{},u=xpState(id).unlocked;const ok=(k,p)=>e[k]&&u.has(p+e[k])?e[k]:"";
  return {hat:ok("hat","h:"),theme:ok("theme","t:"),trail:ok("trail","r:"),confetti:ok("confetti","f:"),title:ok("title","ti:")};}
function titleOf(id){const lv=xpState(id).level,t=equipped(id).title;const f=G.TITLES.find(x=>x[0]===t)||G.TITLES.filter(x=>!x[3]&&x[2]<=lv).pop();return f?f[1]:"";}
// A person's creature with its growth stage and accessory.
function crHtml(id){const cr=creatureFor(id),hat=G.HATS.find(h=>h[0]===equipped(id).hat);return `<span class="cr stage-${G.stageFor(xpState(id).level)}">${cr[1]}${hat?`<i class="hat hat-${hat[0]}" aria-hidden="true">${hat[1]}</i>`:""}</span>`;}
const game=()=>G.gameCfg(cfg());
const icon=ch=>`<span class="c-ic" aria-hidden="true">${esc(G.choreIcon(ch))}</span>`;
const cotdId=()=>G.choreOfDay(cfg().chores,ymd(),cfg());
const choreXpFor=(kidId,ch)=>G.choreXp(ch,{cotd:cotdId()===ch.id,boost:G.streakBoost(cfg(),streak(kidId))});
const battleList=()=>Object.entries(S.battles).map(([id,b])=>({id,...b})).sort((a,b)=>b.createdAt-a.createdAt);
const weekDocId=(kid,wk)=>wk+"_"+kid;
function getWeek(kid,wk){return Object.assign({kidId:kid,week:wk,goal:null,entries:[],deductions:[],warnings:[],closed:false},S.weeks[weekDocId(kid,wk)]||{});}
function activeWeek(kid){const wk=mondayOf(new Date());const w=S.weeks[weekDocId(kid,wk)];return (w&&w.closed)?addDays(wk,7):wk;}
function weekNet(w){let n=0;for(const e of w.entries||[])if(e.status!=="reversed")n+=e.amount;for(const d of w.deductions||[])if(d.status==="active"||d.status==="final")n-=d.amount;return r2(n);}
const choreCount=w=>(w.entries||[]).filter(e=>e.status!=="reversed").length;
function countBetween(kidId,choreId,from,to){let n=0;for(const w of Object.values(S.weeks)){if(w.kidId!==kidId)continue;for(const e of w.entries||[])if(e.choreId===choreId&&e.date>=from&&e.date<=to&&e.status!=="reversed")n++;}return n;}
const countOnDate=(kidId,choreId,date)=>countBetween(kidId,choreId,date,date);
// A chore's limits: each person a day (`limit`), the whole family a day (`familyLimit`), and the whole family a week (`weekLimit`, Monday to Sunday). Grown-ups count in the family totals.
function limitState(kidId,ch,date){const mon=mondayOf(parseYmd(date)),ids=cfg().kids.map(k=>k.id);
  const me=countOnDate(kidId,ch.id,date),fam=ids.reduce((s,id)=>s+countOnDate(id,ch.id,date),0),wk=ids.reduce((s,id)=>s+countBetween(id,ch.id,mon,addDays(mon,6)),0);
  const lim=ch.limit||1,flim=ch.familyLimit>0?ch.familyLimit:0,wlim=ch.weekLimit>0?ch.weekLimit:0;
  return {me,fam,wk,lim,flim,wlim,reason:wlim&&wk>=wlim?"week":flim&&fam>=flim?"family":me>=lim?"person":null};}
const LIMIT_MSG={week:"That one's done for this week.",family:"That one's done for today.",person:"That one's at its max per person for today."};
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
  unsubs.push(onSnapshot(doc(db,"app/config"),s=>{S.config=s.exists()?s.data():null;backfillPrDone();refreshCleanDraft();softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"bank"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.bank=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"prefs"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.prefs=m;backfillPrDone();softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"xp"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.xp=m;S.xpLoaded=true;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"claims"),s=>{const m={};s.forEach(d=>m[d.id]={id:d.id,...d.data()});S.claims=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"bounties"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.bounties=m;softRender();},onErr));
  unsubs.push(onSnapshot(doc(db,"app/game"),s=>{S.game=s.exists()?s.data():{};softRender();},onErr));
  if(S.role==="parent"&&S.user){unsubs.push(onSnapshot(doc(db,"parentTokens",S.user.uid),s=>{S.myToken=s.exists()?s.data():null;softRender();},onErr));}
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
  // A full-screen run closes if its battle was called off.
  for(const [k,close] of [["tm",closeMap],["rush",closeRush],["wheel",closeWheel]]){const u=S.ui[k],b=u&&S.battles[u.id];if(u&&b&&b.status==="cancelled")close();}
  if(S.ui.focus&&S.ui.focus.battleId){const b=S.battles[S.ui.focus.battleId];if(b&&b.status==="cancelled"){closeFocus();toast("That battle was called off.");}}
  if(S.ui.focus&&S.phase==="ready"&&S.config)h+=focusOverlay();
  else if(S.ui.tm&&S.phase==="ready"&&S.config&&onKidScreen())h+=mapOverlay();
  else if(S.ui.rush&&S.phase==="ready"&&S.config&&onKidScreen())h+=rushOverlay();
  else if(S.ui.wheel&&S.phase==="ready"&&S.config&&onKidScreen())h+=wheelOverlay();
  else if(S.ui.co&&S.role==="parent"&&S.phase==="ready"&&S.config)h+=cashoutWizard();
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
  restoreFocus();checkLevelUp();tickClocks();if(!wdRaf&&document.querySelector(".wd-spin"))wdRaf=requestAnimationFrame(wdWatch);
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
function tickClocks(){const els=document.querySelectorAll(".tt-clock[data-start],.cd-clock[data-end]");if(!els.length){clearInterval(clockTimer);clockTimer=null;return;}
  const upd=()=>{document.querySelectorAll(".tt-clock[data-start]").forEach(el=>{el.textContent=fmtMs(Date.now()-Number(el.dataset.start));});tickGoal();
    // Countdowns: when one runs out, ring and redraw (Room Rush then asks for the count).
    let done=false;document.querySelectorAll(".cd-clock[data-end]").forEach(el=>{const left=Number(el.dataset.end)-Date.now();el.textContent=fmtMs(Math.max(0,left));if(left<=3000)done=true;});
    if(done){chime(true);try{navigator.vibrate&&navigator.vibrate([300,100,300]);}catch(e){}render();}};upd();if(!clockTimer)clockTimer=setInterval(upd,1000);}
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
  h+=battleSection(k)+bountySection(k)+warningCards(k,ks)+challengeCards(k.id)+prSection(k,ks,today)+choreSection(k,today)+(k.adult?adultSavings(k,ks):moneySection(k,ks,w,net))+questSection(k)+rewardSection(k)+badgeSection(k.id)+activitySection(w);
  return h+(embedded?"":`</div>`);
}
function pushControl(){
  if(S.role!=="kid"||!("Notification" in window))return "";
  const perm=Notification.permission;
  if(perm==="granted"&&S.device&&S.device.fcmToken)return "";
  if(perm==="denied")return `<p class="hint">Reminders are blocked. Allow notifications for this app in the tablet's settings to get them.</p>`;
  return `<button class="btn ghost block" style="margin-top:12px" data-act="enable-push">🔔 Turn on notifications (reminders and battles)</button>`;
}
function reminderBanner(k,ks,today){
  const times=(k.remind||[]).filter(Boolean).sort();if(!times.some(t=>t<=nowHM()))return "";
  const done=ks.prLog[today]||[];
  const todo=[...prChores().filter(c=>!done.includes(c.id)).map(c=>c.name),...famChoresFor(k.id).filter(c=>c.assign===k.id&&countOnDate(k.id,c.id,today)===0&&!limitState(k.id,c,today).reason).map(c=>c.name)];
  return todo.length?`<div class="banner" role="status">Still to do today: ${todo.map(esc).join(", ")}</div>`:"";
}
function goalSetter(k,wk){
  const last=weekNet(getWeek(k.id,addDays(wk,-7)));const dl=daysLeft(wk);const max=r2(famChoresFor(k.id).reduce((s,c)=>{const L=limitState(k.id,c,wk),perDay=Math.min(L.lim,L.flim||Infinity),room=L.wlim?Math.max(0,L.wlim-L.wk):Infinity;return s+choreValue(k,c)*Math.min(perDay*dl,room);},0));
  const v=Number(S.ui.goalInput)||0;const chips=last>0?[q(last),q(last*1.25),q(last*1.5)]:[1,2.5,5];
  if(k.adult)return `<section class="card goal goal-set"><h2>Your goal for the race this week</h2>
    <p class="sub">It moves your lane on the family board, like the kids'. Nothing is paid out.${last>0?` Last week you reached ${money(last)}.`:""}</p>
    <div class="chips">${[...new Set(chips)].filter(c=>c>0).map(c=>`<button data-act="goal-chip" data-v="${c}">${money(c)}</button>`).join("")}</div>
    <div class="money-in">$<input type="number" inputmode="decimal" step="0.25" min="0.25" aria-label="Weekly race goal" data-bind="goalInput" value="${esc(S.ui.goalInput)}"></div>
    <button class="btn block" data-act="set-goal">Lock in my goal</button></section>`;
  return `<section class="card goal goal-set"><h2>What do you want to earn this week?</h2>
    <p class="sub">${last>0?`Last week you earned ${money(last)}. `:""}Doing every chore every day would earn about ${money(max)}.</p>
    <div class="chips">${[...new Set(chips)].filter(c=>c>0).map(c=>`<button data-act="goal-chip" data-v="${c}">${money(c)}</button>`).join("")}</div>
    <div class="money-in">$<input type="number" inputmode="decimal" step="0.25" min="0.25" aria-label="Weekly goal in dollars" data-bind="goalInput" value="${esc(S.ui.goalInput)}"></div>
    <p class="goal-msg">${v>0?`Reach it and you get a +${money(r2(v*BONUS_RATE))} bonus.`:"Bigger goal, bigger bonus."}</p>
    <button class="btn block" data-act="set-goal">Lock in my goal</button></section>`;
}
function goalCard(k,ks,w,net,cr){
  const won=net>=w.goal,bonus=r2(w.goal*BONUS_RATE),bt=w.bonusTo||"split";
  if(k.adult)return `<section class="card goal ${won?"won":""}"><div class="goal-top"><div><div class="big">${money(net)}</div><p class="sub">of your ${money(w.goal)} race goal</p></div>
    <div class="bonus">${won?"Goal reached":"Reach it for"}<b>+${G.XP.goal} XP</b><small>Not paid, just for the race</small></div></div>${trail(net/w.goal,crHtml(k.id),won,undefined,equipped(k.id).trail)}
    <p class="goal-msg">${won?"Goal reached! 🎉":`${money(w.goal-net)} to go`}</p></section>`;
  return `<section class="card goal ${won?"won":""}"><div class="goal-top"><div><div class="big">${money(net)}</div><p class="sub">of your ${money(w.goal)} goal</p></div>
    <div class="bonus">${won?"Bonus earned":"Bonus if you make it"}<b>+${money(bonus)}</b><small>and +${G.XP.goal} XP</small></div></div>${trail(net/w.goal,crHtml(k.id),won,undefined,equipped(k.id).trail)}
    <p class="goal-msg">${won?"Goal reached! Your bonus is locked in.":`${money(w.goal-net)} to go`}</p>
    <label class="inline">Bonus goes to <select data-change="bonusTo" aria-label="Where your bonus goes">${["split","spend","save","invest","give"].map(o=>`<option value="${o}" ${o===bt?"selected":""}>${destName(ks,o)}</option>`).join("")}</select></label></section>`;
}
// Warnings cost nothing. An unseen one is loud until the kid taps Got it; seen ones stay as a quiet list for the week.
function warningCards(k,ks){const all=[];for(const w of openWeeks(k.id))for(const x of w.warnings||[])all.push(x);if(!all.length)return "";
  const seen=new Set(ks.seenWarnings),fresh=all.filter(x=>!seen.has(x.id)),old=all.filter(x=>seen.has(x.id));let h="";
  for(const x of fresh)h+=`<section class="card warning"><h3>⚠️ A warning from ${esc(x.by||"a parent")}</h3><p><b>${esc(x.reason)}</b></p><p class="hint">This one doesn't cost anything. Turn it around so it doesn't become a deduction.</p><button class="btn small" style="margin-top:10px" data-act="warn-seen" data-id="${x.id}">Got it</button></section>`;
  if(old.length)h+=`<section class="card warning seen"><p class="sub">⚠️ Warnings this week: ${old.map(x=>`<b>${esc(x.reason)}</b>`).join(", ")}</p></section>`;
  return h;}
function challengeCards(kidId){let h="";for(const w of openWeeks(kidId))for(const d of w.deductions)if(d.status==="active")
  h+=`<section class="card challenge"><h3>Earn back ${money(d.amount)}</h3><p><b>${esc(d.reason)}</b></p>${d.how?`<p>How: ${esc(d.how)}</p>`:""}<p class="hint">When you've done it, ask a parent to mark it earned back. You have until Sunday's cash-out.</p></section>`;return h;}
function prSection(k,ks,today){const prs=prChores();if(!prs.length)return "";const done=ks.prLog[today]||[],notes=ks.prNotes[today]||{},pn=S.ui.prNote;const s=streak(k.id),boost=G.streakBoost(cfg(),s),fr=xpState(k.id).freezes;
  return `<section class="card"><div class="sec-head"><h2>Every day</h2><span><span class="streak">🔥 ${s} day${s===1?"":"s"} in a row</span>${boost>1?` <span class="pill boost" title="Streak bonus on all XP">×${boost} XP</span>`:""}${fr?` <span class="pill" title="Streak freezes save your streak on a missed day">🧊 ${fr}</span>`:""}</span></div><div class="checks">${prs.map(c=>{const on=done.includes(c.id),asking=pn&&pn.id===c.id,sub=on&&notes[c.id]?notes[c.id]:c.note;
    return `<button class="check ${on?"on":""}" data-act="toggle-pr" data-id="${c.id}" aria-pressed="${on}" ${asking?"disabled":""}><span class="box">${on?"✓":""}</span><span><b>${icon(c)}${esc(c.name)}</b>${sub?`<small>${esc(sub)}</small>`:""}</span></button>${!on&&stepsOf(c).length?`<button class="fx-open pr" data-act="focus" data-id="${c.id}">▶ Start · ${stepsOf(c).length} steps</button>`:""}${asking?`<div class="confirm"><label>What was it?<input data-bind="prNote.text" maxlength="120" placeholder="Say what you did" value="${esc(pn.text)}"></label><div class="row"><button class="btn small" data-act="save-pr-note" ${String(pn.text||"").trim()?"":"disabled"}>Check it off</button><button class="btn ghost small" data-act="cancel-pr-note">Cancel</button></div></div>`:""}`;}).join("")}</div>
    <p class="hint">These don't pay money. They're part of taking care of yourself. Finish all of them for +${G.XP.checklist} XP and to keep your streak going.${game().streakMultiplier.enabled?` A ${game().streakMultiplier.minStreak}-day streak makes all your XP count ×${game().streakMultiplier.mult}.`:""}</p></section>`;}
function choreSection(k,today){const list=famChoresFor(k.id).sort((a,b)=>(a.assign==="pool")-(b.assign==="pool")),cc=S.ui.confirmChore,cot=cotdId();
  return `<section class="card"><div class="sec-head"><h2>Family chores</h2></div>${list.length?list.map(c=>{const L=limitState(k.id,c,today),full=!!L.reason,mine=c.assign===k.id,busy=S.busy["c:"+c.id],asking=cc&&cc.choreId===c.id,ask=needsNote(c);
    return `<div class="chore ${c.id===cot?"cotd":""}"><div><b>${icon(c)}${esc(c.name)}</b>${full?"":`<button class="fx-open" data-act="focus" data-id="${c.id}" ${busy?"disabled":""}>▶ Start${stepsOf(c).length?` · ${stepsOf(c).length} steps`:""}${c.targetMin>0?` · ${c.targetMin} min`:""}</button>`}<small><span class="tag ${c.assign===k.id?"mine":""}">${c.assign===k.id?"Yours":"Anyone"}</span>${c.id===cot?`<span class="tag star">⭐ Double XP today</span>`:""}</small></div><div class="c-val">+${money(choreValue(k,c))}<small>+${choreXpFor(k.id,c)} XP</small></div><button class="btn small" data-act="do-chore" data-id="${c.id}" ${full||busy||asking?"disabled":""}>${busy?"Saving…":L.reason==="week"?"Done this week":L.reason==="family"?"All done today":L.reason==="person"?(mine?"All done":"Your max today"):"I did it"}</button><small class="c-count">${mine?"":"you "}${L.me} of ${L.lim} today${L.flim?`, family ${L.fam} of ${L.flim} today`:""}${L.wlim?`, family ${L.wk} of ${L.wlim} this week`:""}</small>
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
// Grown-ups aren't paid: no Spend, Invest, Give, or cash-out. Their savings goals are for the kids to see,
// with the saved amount typed in by hand.
function adultSavings(k,ks){const g=S.ui.newGoal,eg=S.ui.editGoal,goals=ks.goals.filter(x=>x.id!=="general"||x.balance>0);
  return `<section class="card"><div class="sec-head"><h2>My savings goals</h2></div><p class="hint" style="margin-top:0">Just for the kids to see you saving too. Grown-ups don't get paid or cashed out, so update the amount yourself.</p>
    ${goals.length?goals.map(x=>eg&&eg.kid===k.id&&eg.goal===x.id&&eg.amountOnly?`<div class="sgoal"><div class="row"><label style="flex:2 1 140px">Saved so far for ${esc(x.name)}<input type="number" step="1" min="0" inputmode="decimal" data-type="num" data-bind="editGoal.amount" value="${esc(eg.amount)}"></label><button class="btn small" data-act="adult-save-amt">Save</button><button class="btn ghost small" data-act="cancel-edit-goal">Cancel</button></div></div>`
      :`<div class="sgoal"><div class="top"><span>${esc(x.name)}${x.id==="general"?"":`<button class="sg-del" data-act="del-goal" data-kid="${k.id}" data-goal="${x.id}" aria-label="Delete ${esc(x.name)}" title="Delete this goal">✕</button>`}</span><span>${money(x.balance)}${x.target?" / "+money(x.target):""} <button class="btn ghost small" data-act="adult-edit-amt" data-kid="${k.id}" data-goal="${x.id}">✏️ Update</button></span></div>${x.target?`<div class="bar"><i style="width:${Math.min(100,x.balance/x.target*100)}%"></i></div>`:""}</div>`).join("")
      :`<p class="empty">No savings goals yet. Add one the kids can cheer you on for.</p>`}
    <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="newGoal.name" value="${esc(g.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="newGoal.target" value="${esc(g.target)}"><button class="btn small" data-act="add-goal">Add</button></div></section>`;}
function moneySection(k,ks,w,net){const sp=splitAmt(Math.max(0,net)),goals=ks.goals,g=S.ui.newGoal,open=S.ui.openBuckets,pc=cfg().split;
  // One column of cards, collapsed by default. The header always shows the total; cards with details open on tap.
  const card=(id,cls,name,total,sub,body)=>{const o=!!open[id],x=!!body;
    return `<section class="bucket ${cls}${o?" open":""}">${x?`<button class="bucket-head" data-act="toggle-bucket" data-id="${id}" aria-expanded="${o}">`:`<div class="bucket-head">`}<span class="bh-name"><h3>${name} <small>${pc[id]}%</small></h3>${sub?`<p>${sub}</p>`:""}</span><span class="bh-total money">${money(total)}</span>${x?`<span class="chev" aria-hidden="true">${o?"▴":"▾"}</span></button>`:"</div>"}${x&&o?`<div class="bucket-body">${body}</div>`:""}</section>`;};
  const saved=goals.reduce((a,x)=>a+x.balance,0);
  return `<section class="card"><div class="sec-head"><h2>My money</h2></div><div class="buckets">
    ${card("spend","b-spend","Spend",sp.spend,"Cash you get Sunday night","")}
    ${card("save","b-save","Save",saved,`+${money(sp.save)} this week`,
      `${goals.map(x=>`<div class="sgoal"><div class="top"><span>${esc(x.name)}${x.id==="general"?"":`<button class="sg-del" data-act="del-goal" data-kid="${k.id}" data-goal="${x.id}" aria-label="Delete ${esc(x.name)}" title="Delete this goal">✕</button>`}</span><span>${money(x.balance)}${x.target?" / "+money(x.target):""}</span></div>${x.target?`<div class="bar"><i style="width:${Math.min(100,x.balance/x.target*100)}%"></i></div>`:""}</div>`).join("")}
      ${splitEditor(k,ks,w,goals,sp.save)}
      <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="newGoal.name" value="${esc(g.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="newGoal.target" value="${esc(g.target)}"><button class="btn small" data-act="add-goal">Add</button></div>`)}
    ${card("invest","b-invest","Invest",ks.invest,`+${money(sp.invest)} this week`,
      `<p>Next monthly interest: ${money(qd(calcInterest(ks.invest)))}, rounded down to the nearest quarter. You'll decide where it goes at cash-out, and you can split it.</p>`)}
    ${card("give","b-give","Give",ks.give,`+${money(sp.give)} this week`,"")}
  </div></section>`;}
function badgeList(kidId){const ks=kidState(kidId),st=ks.stats,x=xpState(kidId),c=x.counts;const live=openWeeks(kidId).reduce((s,w)=>s+choreCount(w),0);const chores=(st.chores||0)+live;
  const saved=ks.goals.reduce((s,g)=>s+g.balance,0)+ks.archived.reduce((s,g)=>s+(g.bought||0),0);
  return G.badgeList({chores,goalHits:st.goalHits||0,bestStreak:bestStreak(kidId),redemptions:st.redemptions||0,saved,invest:ks.invest,give:ks.give,bought:ks.archived.length,
    wins:c.win||0,giant:c.giant||0,modeWins:G.modeWinsOf(c),level:x.level,quests:c.quest||0,bounties:c.bounty||0,checklistDays:c.pr||0,
    early:c.early||0,earlyBest:Math.max((S.xp[kidId]||{}).earlyBest||0,G.bestMorning(entriesFor(kidId).map(e=>({...e,hour:hourIn(e.t)}))))});}
// Earned badges, then the next one of each kind to go for. "Show all" lists every badge.
const badgeKind=id=>({first:"chores",fifty:"chores",bought:"bought",comeback:"comeback"}[id]||id.replace(/\d+$/,""));
function badgeSection(kidId){const b=badgeList(kidId),got=b.filter(x=>x[3]),open=S.ui.allBadges,kinds=new Set();
  const next=b.filter(x=>!x[3]&&!kinds.has(badgeKind(x[0]))&&kinds.add(badgeKind(x[0]))).slice(0,4);
  const shown=open?b:[...got,...next];
  // Tap a badge to see how it's earned (tablets have no hover).
  const sel=S.ui.badgeInfo&&S.ui.badgeInfo.kid===kidId?S.ui.badgeInfo.id:null,pick=b.find(x=>x[0]===sel);
  const tile=x=>`<button type="button" class="badge ${x[3]?"":"locked"} ${x[0]===sel?"sel":""}" data-act="badge-info" data-kid="${kidId}" data-id="${x[0]}" aria-pressed="${x[0]===sel}" title="${esc(x[4])}"><span>${x[1]}</span>${esc(x[2])}${!x[3]&&!/\d/.test(x[2])?`<small>${esc(x[4])}</small>`:""}</button>`;
  const info=pick&&shown.includes(pick)?`<div class="badge-info" role="status"><span>${pick[1]}</span><div><b>${esc(pick[2])}</b>${pick[3]?" ✅ Earned":" 🔒 Not yet"}<br>${esc(pick[4])}.</div><button class="btn ghost small" data-act="badge-info" data-kid="${kidId}" data-id="${pick[0]}" aria-label="Close">✕</button></div>`:"";
  return `<section class="card"><div class="sec-head"><h2>Badges</h2><span class="sub">${got.length} of ${b.length}. +${G.XP.badge} XP each</span></div>
    ${info}<div class="badges">${shown.map(tile).join("")}</div>
    <button class="btn ghost small" style="margin-top:10px" data-act="all-badges" aria-expanded="${!!open}">${open?"Show fewer":`Show all ${b.length}`}</button></section>`;}
function choreLine(e){const rev=e.status==="reversed";return [`<span class="${rev?"struck":""}">${icon(choreById(e.choreId)||{name:e.name,kind:"family"})}${esc(e.name)}${e.ms?` <small class="took">⏱ ${fmtMs(e.ms)}</small>`:""}${e.detail?`: ${esc(e.detail)}`:""}<br><small>${timeOf(e.t)}${rev?", reversed":""}</small></span>`,`<span class="amt ${rev?"struck":"pos"}">+${money(e.amount)}</span>`];}
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
const TEAM=["raid","babyraid","grownups"];
function modeParams(b){const p=b.params||{};const tw=b.twist?`. ${esc(b.twist.text)}`:"";
  const t={race:`First to ${p.n} chores`,blitz:p.windowMin?`${G.timeText(p.windowMin)} blitz`:"Until midnight",grownups:p.windowMin?G.timeText(p.windowMin):"Until midnight",
    territory:p.map?"Conquer the map":"Most Anyone chores by midnight",roomrush:`${esc(p.room||"")}, ${p.minutes} minute${p.minutes>1?"s":""} each`,dishduel:"Most dishes washed",bingo:"First to a line",streakduel:"Don't miss a day",showdown:"Best share of weekly goal",
    raid:`${p.bossEmoji||"🐉"} ${esc(p.bossName||"Boss")}, ${p.days||1} day${(p.days||1)>1?"s":""}`,babyraid:`${p.bossEmoji||"🐣"} ${esc(p.bossName||"Baby boss")}, today`}[b.mode];
  const time=p.windowMin&&!["blitz","grownups"].includes(b.mode)?`, ${G.timeText(p.windowMin)}`:"";
  return (t||(p.choreName?`${esc(G.choreIcon(choreById(p.choreId)||{name:p.choreName}))} ${esc(p.choreName)}`:""))+time+tw;}
function fmtEnd(t){const d=new Date(t);return d.getHours()===0&&d.getMinutes()===0?(d-Date.now()>26*3600e3?"at midnight "+d.toLocaleDateString(undefined,{weekday:"short"}):"at midnight"):"at "+d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});}
function scoreHtml(b,id){
  if(G.TIMED.includes(b.mode)){const a=(b.attempts||{})[id],q=(b.quality||{})[id];return !a?"–":a.void?"✗":a.ms!=null?fmtMs(a.ms)+(q===true?` <small title="A parent checked it">✓</small>`:q===false?` <small title="Didn't pass the parent's check">✗</small>`:""):`<span class="tt-clock" data-start="${a.startAt}"></span>`;}
  if(b.mode==="judge"){const a=(b.attempts||{})[id];return a&&a.entryId?"✓ Done":"–";}
  if(G.COUNT_MODES.includes(b.mode)){const a=(b.attempts||{})[id],h=(b.handicap||{})[id]||1,unit=b.mode==="dishduel"?["dish","dishes"]:["item","items"];
    if(!a)return "–";if(a.count==null)return "⏱";
    // Nobody sees the other side's count until everyone's is in.
    if(b.status==="active"&&id!==S.viewKid)return `✓<small> in</small>`;
    return `${a.count}<small> ${a.count===1?unit[0]:unit[1]}${h>1?` (×${h})`:""}</small>`;}
  if(b.mode==="streakduel"){const days=Object.values(b.duelDays||{});const ok=days.filter(d=>d[id]).length;return days.length?`${ok} day${ok===1?"":"s"}`:"–";}
  if(b.mode==="showdown"){const s=(b.scores||{})[id];return s?s.adj+"%":`${showdownLive(b,id)}%<small> so far</small>`;}
  const s=(b.scores||{})[id],h=(b.handicap||{})[id]||1;return `${s?s.adj:0}${h>1?`<small> (×${h})</small>`:""}`;}
// Rough live Goal Showdown score from this week's records (the server decides at cash-out).
function showdownLive(b,id){const w=getWeek(id,b.params.week);return Math.round(G.showdownScore(weekNet(w),w.goal,0)*100);}
function teamLine(b,side){const ids=b.teams[side],ts=(b.teamScores||{})[side],h=(b.teamHandicap||{})[side]||1;
  return `<div><span class="team-crs">${ids.map(p=>crHtml(p)).join("")}</span><b>${ids.map(p=>bName(b,p)).join(", ")}</b><span class="b-score">${ts?ts.adj:0}${h>1?`<small> (×${h})</small>`:""}</span></div>`;}
function resultText(b,me){const r=b.result||{};const who=id=>id===me?"You":bName(b,id);
  if(r.noContest)return `No contest. ${esc(r.reason||"")}`;
  if(r.solo)return r.done?`Challenge complete! 🎉 ${esc(r.reason||"")}`:`${esc(r.reason||"Done")}. Good try!`;
  if(b.mode==="ghost")return r.record?"First record set! ⏱️":r.winner?"New personal best! 🎉":"Not this time. Try again!";
  if(G.isRaid(b.mode))return r.winnerSide?`${esc(b.params.bossEmoji)} Boss beaten! 🎉`:`${esc(r.reason||"The boss got away.")}`;
  if(r.tie)return `It's a tie! ${esc(r.reason||"")}`;
  if(r.winnerSide){const mine=G.sideOf(b,me)===r.winnerSide;return mine?`Your team won! 🏆 ${esc(r.reason||"")}`:`${b.teams[r.winnerSide].map(p=>bName(b,p)).join(" and ")} won. ${esc(r.reason||"")}`;}
  return r.winner===me?`You won! 🏆 ${esc(r.reason||"")}`:`${who(r.winner)} won. ${esc(r.reason||"")}`;}
function bingoGrid(b,me){const p=b.params;const list=G.battleEntries(entriesFor(me),b.startAt,b.endAt);const marks=G.bingoMarks(b,list,me);
  return `<div class="bingo" role="grid" aria-label="Your bingo card">${p.card.map((c,i)=>`<div class="sq ${marks[i]?"on":""}" role="gridcell">${marks[i]&&((p.free||{})[me]||[]).includes(i)?"FREE":`<span class="sq-ic">${esc(G.choreIcon(choreById(c)||{name:(p.cardNames||[])[i]}))}</span>${esc((p.cardNames||[])[i]||c)}`}</div>`).join("")}</div>`;}
// This person's chore entries from the weeks on screen.
function entriesFor(id){return Object.values(S.weeks).filter(w=>w.kidId===id).flatMap(w=>w.entries||[]);}
// Hour of the day in the family's time zone, as the server counts it (24 when an entry has no time).
function hourIn(t){if(!Number.isFinite(t))return 24;try{return Number(new Intl.DateTimeFormat("en-US",{timeZone:cfg().timezone||undefined,hour:"numeric",hourCycle:"h23"}).format(new Date(t)));}catch(e){return new Date(t).getHours();}}
function battleCard(b,me){const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const other=b.players.find(p=>p!==me);const dis=S.busy.b?"disabled":"";
  let vs;
  if(G.isRaid(b.mode)){const ts=(b.teamScores||{}).a,dmg=ts?ts.raw:0,hp=b.params.hp||1;
    vs=`<div class="raid"><div class="boss">${esc(b.params.bossEmoji)}<b>${esc(b.params.bossName)}</b></div><div class="hp" role="img" aria-label="${Math.max(0,hp-dmg)} of ${hp} health left"><i style="width:${Math.max(0,100-dmg/hp*100)}%"></i></div><p class="sub">${Math.min(dmg,hp)} / ${hp} damage. Team: ${b.teams.a.map(p=>bName(b,p)).join(", ")}</p></div>`;}
  else if(b.teams)vs=`<div class="vs">${teamLine(b,"a")}<span class="vs-x">VS</span>${teamLine(b,"b")}</div>`;
  else if(b.players.length>1)vs=`<div class="vs">${b.players.map(p=>`<div>${crHtml(p)}<b>${p===me?"You":bName(b,p)}</b><span class="b-score">${scoreHtml(b,p)}</span></div>`).join(`<span class="vs-x">VS</span>`)}</div>`;
  else if(b.mode!=="ghost")vs=`<div class="vs solo"><div>${crHtml(me)}<b>You <span class="vs-x">· SOLO</span></b><span class="b-score">${scoreHtml(b,me)}</span></div></div>`;
  else vs=`<div class="vs"><div>${crHtml(me)}<b>You</b><span class="b-score">${scoreHtml(b,me)}</span></div><span class="vs-x">VS</span><div><span class="cr">👻</span><b>Your best</b><span class="b-score">${b.pb!=null?fmtMs(b.pb):"None yet"}</span></div></div>`;
  let body="",dl="";
  if(b.status==="pending"){const acc=b.accepted||{},waiting=b.players.filter(p=>!acc[p]);
    body=b.challenger!==me&&!acc[me]?`<p><b>${bName(b,b.challenger)}</b> ${G.isRaid(b.mode)?"wants you on their team!":"challenged you!"}</p><div class="row"><button class="btn" data-act="b-accept" data-id="${b.id}" ${dis}>Accept</button><button class="btn ghost" data-act="b-decline" data-id="${b.id}" ${dis}>Not now</button></div>`
      :`<p class="sub">Waiting for ${waiting.map(p=>bName(b,p)).join(", ")} to accept…</p>${b.challenger===me?`<button class="btn ghost small" data-act="b-cancel" data-id="${b.id}" ${dis}>Cancel challenge</button>`:""}`;}
  else if(b.status==="active"){
    if(b.mode==="doom"&&!(b.dooms||{})[me]){const od=other&&(b.dooms||{})[other];
      body=`<p class="sub">Spin the wheel to get your doom, then do "${esc(b.params.choreName)}" with it. Fastest run done well (doom included) wins.${od?` ${bName(b,other)} got ${doomText(od)}!`:""}</p><button class="btn block" data-act="wd-open" data-id="${b.id}">🎡 Spin the Wheel of Doom</button>`;}
    else if(G.TIMED.includes(b.mode)){const a=(b.attempts||{})[me];
      if(b.mode==="doom")dl=`<p class="wd-line">Your doom: <b>${doomText(b.dooms[me])}</b>${other&&(b.dooms||{})[other]?`<br>${bName(b,other)}: ${doomText(b.dooms[other])}`:""}</p>`;
      body=!a?`<p class="sub">Tap Start, do "${esc(b.params.choreName)}", then tap Done. The chore is logged when you finish.</p><button class="btn block" data-act="b-start" data-id="${b.id}" ${dis}>▶ Start timer</button>`
        :a.ms==null&&!a.void?`<div class="tt-big"><span class="tt-clock" data-start="${a.startAt}"></span></div>${stepsOf(choreById(b.params.choreId)).length?`<button class="btn block" data-act="fx-battle" data-id="${b.id}">⤢ Open the checklist</button>`:`<button class="btn block" data-act="b-finish" data-id="${b.id}" ${dis}>✓ Done!</button><button class="btn ghost small" style="margin-top:8px" data-act="fx-battle" data-id="${b.id}">⤢ Full screen</button>`}`
        :`<p class="sub">${a.void?"Your run didn't count: "+esc(a.void):"Your time: <b>"+fmtMs(a.ms)+"</b>. A parent will check that it was done well"}.${other?` Waiting for ${bName(b,other)}.`:""}</p>`;}
    else if(b.mode==="judge"){const a=(b.attempts||{})[me];
      body=a&&a.entryId?`<p class="sub">Turned in! ${other&&!((b.attempts||{})[other]||{}).entryId?`Waiting for ${bName(b,other)}.`:""} Then a parent picks the better job.</p>`
        :`<p class="sub">Do your best job on "${esc(b.params.choreName)}", then tap Done. A parent picks the better job.</p>${stepsOf(choreById(b.params.choreId)).length?`<button class="btn block" data-act="fx-battle" data-id="${b.id}">⤢ Open the checklist</button>`:`<button class="btn block" data-act="b-finish" data-id="${b.id}" ${dis}>✓ Done!</button>`}`;}
    else if(b.mode==="roomrush"){const a=(b.attempts||{})[me],p=b.params,mins=`${p.minutes} minute${p.minutes>1?"s":""}`;
      body=!a?`<p class="sub">Go to the <b>${esc(p.room)}</b> and tap Start. You get ${mins} to put away as many things as you can. Count them in your head! Ends ${fmtEnd(b.endAt)}.</p><button class="btn block" data-act="rr-start" data-id="${b.id}" ${dis}>▶ Start (${mins})</button>`
        :a.count==null?`<button class="btn block" data-act="rr-open" data-id="${b.id}">⤢ Back to the timer</button>`
        :`<p class="sub">You cleaned up <b>${a.count}</b> thing${a.count===1?"":"s"}!${other&&((b.attempts||{})[other]||{}).count==null?` Waiting for ${bName(b,other)}.`:""}</p>`;}
    else if(b.mode==="dishduel"){const a=(b.attempts||{})[me],v=(S.ui.dishes||{})[b.id];
      const waiting=b.players.filter(p=>p!==me&&((b.attempts||{})[p]||{}).count==null);
      body=a&&a.count!=null?`<p class="sub">You washed <b>${a.count}</b> dish${a.count===1?"":"es"}!${waiting.length?` Waiting for ${waiting.map(p=>bName(b,p)).join(" and ")}. The winner shows as soon as everyone's count is in.`:""}</p>`
        :`<p class="sub">Wash dishes together and count the ones you wash. When you're done, type your count here. Nobody sees it until everyone's in. Ends ${fmtEnd(b.endAt)}.</p>
        <div class="row dd-row"><label class="rr-count">How many dishes did you wash?<input type="number" inputmode="numeric" min="0" max="${G.MAX_RUSH_ITEMS}" step="1" data-bind="dishes.${b.id}" data-type="num" value="${esc(v??"")}"></label></div>
        <button class="btn block" data-act="dd-submit" data-id="${b.id}" ${dis||!(v!==""&&v!=null&&Number.isInteger(Number(v)))?"disabled":""}>Turn in my count</button>`;}
    else if(G.isMapTerritory(b)){const o=(b.open||{})[me];
      body=`<button class="tm-mini" data-act="tm-open" data-id="${b.id}" aria-label="Open the map">${mapSvg(b,me,false)}</button><p class="sub">${o?`You're conquering <b>${esc(b.params.map.names[o.c])}</b>: ${esc(G.choreIcon(choreById(o.choreId)||{name:o.name}))} ${esc(o.name)}.`:"Reveal a country next to yours, do its chore, and it's yours. Most countries wins."} Ends ${fmtEnd(b.endAt)}.</p><button class="btn block" data-act="tm-open" data-id="${b.id}">🗺️ Open the map</button>`;}
    else if(b.mode==="bingo")body=`${bingoGrid(b,me)}<p class="sub">Do the chores on your card. First to finish a row, column, or diagonal wins. Ends ${fmtEnd(b.endAt)}.</p>`;
    else if(b.mode==="streakduel")body=`<p class="sub">${ymd()<b.params.startDate?"Starts tomorrow.":"Checked each night."} Finish your daily list every day. Whoever misses first loses. Up to 14 days.</p>`;
    else if(b.mode==="showdown")body=`<p class="sub">Earn the biggest share of your weekly goal. Decided at Sunday's cash-out.</p>`;
    else if(G.isRaid(b.mode))body=`<p class="sub">Every chore ${b.players.length>1?"your team does":"you do"} hits the boss. Beat it ${fmtEnd(b.endAt)}!</p>`;
    else body=`<p class="sub">${{race:`First to ${b.params.n} chores wins. Do chores below to score!`,territory:"Every Anyone chore you do is yours. Most claims wins.",grownups:"Every chore adds XP to your team's score."}[b.mode]||"Most chore XP wins. Bigger chores count more."} Ends ${fmtEnd(b.endAt)}.</p>`;}
  else if(b.status==="judging")body=`<p class="b-result">🧑‍⚖️ Both done! A parent is judging.</p>`;
  else if(b.status==="confirming"&&G.TIMED.includes(b.mode)){const r=b.result||{};const q=b.quality||{};
    const lead=b.mode==="ghost"?(r.record?"First record":r.winner?"New best":"Not faster this time"):r.tie?"A tie":r.winner?(r.winner===me?"You":bName(b,r.winner)):"";
    const runs=b.players.filter(p=>((b.attempts||{})[p]||{}).ms!=null).map(p=>`${p===me?"You":bName(b,p)}: ${q[p]===true?"✓ done well":q[p]===false?"✗ didn't pass":"waiting for a check"}`).join(". ");
    body=S.role==="parent"
      ?`<p class="b-result">⏳ Pending: ${lead}</p><p class="hint">Fast only counts if it's done right. You're a parent, so check each run here (or in the Game tab). The winner shows once every run is checked.</p>${qcRows(b)}`
      :`<p class="b-result">⏳ Pending: ${lead}</p><p class="hint">Fast only counts if it's done right. A parent is checking the work in the Game tab. ${runs}.</p>`;}
  else if(b.status==="confirming"){const r=b.result||{};let act;
    if(r.needsParent)act=`<p class="hint">${r.disputedBy?"Someone asked a parent to check.":"That was super fast!"} A parent needs to check this one.</p>`;
    else if(other&&!G.isWinner(b,r,me))act=`<div class="row"><button class="btn" data-act="b-confirm" data-id="${b.id}" ${dis}>Looks good</button><button class="btn ghost" data-act="b-dispute" data-id="${b.id}" ${dis}>Ask a parent</button></div>`;
    else act=`<p class="hint">Waiting for ${other?"the other side or ":""}a parent to confirm.</p>`;
    body=`<p class="b-result">${resultText(b,me)}</p>${act}`;}
  return `<div class="bcard ${b.status}"><div class="b-head"><b>${b.wildcard?"🃏 Wildcard: ":""}${m.emoji} ${esc(m.name)}</b><span class="sub">${modeParams(b)}</span></div>${vs}${dl}${body}${b.status==="active"?cancelRow(b,me):""}</div>`;}
// Calling off a running battle: a solo player just cancels; with others, everyone has to agree.
function cancelRow(b,me){const dis=S.busy.b?"disabled":"";
  if(b.players.length===1)return `<button class="btn ghost small b-off" data-act="b-cancel" data-id="${b.id}" ${dis}>Cancel this battle</button>`;
  const ask=b.cancelAsk||{},askers=b.players.filter(p=>ask[p]),waiting=b.players.filter(p=>!ask[p]&&p!==me);
  if(ask[me])return `<p class="hint b-off">You asked to call it off. Waiting for ${waiting.map(p=>bName(b,p)).join(" and ")} to agree.</p>`;
  if(askers.length)return `<div class="banner b-off"><span>🤝 ${askers.map(p=>bName(b,p)).join(" and ")} want${askers.length>1?"":"s"} to call it off.</span><button class="btn small" data-act="b-cancel" data-id="${b.id}" ${dis}>Agree</button></div>`;
  return `<button class="btn ghost small b-off" data-act="b-cancel" data-id="${b.id}" ${dis}>Call it off</button>`;}
function recentLine(b,me){const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const others=b.players.filter(p=>p!==me);const xp=(b.xp||{})[me]||0;
  return `<li><span>${m.emoji} ${esc(m.name)}${others.length?` ${G.isRaid(b.mode)?"with":"vs"} ${others.map(p=>bName(b,p)).join(", ")}`:""}<br><small>${resultText(b,me)}</small></span><span class="amt pos">${xp?"+"+xp+" XP":""}</span></li>`;}
const bbChores=(kidId,mode)=>cfg().chores.filter(c=>c.kind==="family"&&!needsNote(c)&&(c.assign==="pool"||(mode==="ghost"&&c.assign===kidId)));
function battleBuilder(k,bb){const bc=game().battles,lv=xpState(k.id).level,mode=G.modeById(bb.mode);
  const modeBtn=m=>{const lim=battleLimitFor(k.id,m.id);const why=(bc.modesOff||[]).includes(m.id)?"Turned off":lv<m.level&&!G.skipsLevels(cfg(),k)?`🔒 Level ${m.level}`:m.kidsOnly&&k.adult&&!G.canSolo(cfg(),k,m.id)?"Kids only":lim?(lim.scope==="day"?"Done for today":"Done for this week"):"";
    return `<button class="mode ${bb.mode===m.id?"on":""}" data-act="bb-mode" data-id="${m.id}" ${why?"disabled":""} aria-pressed="${bb.mode===m.id}"><span>${m.emoji}</span><b>${esc(m.name)}</b><small>${esc(why||m.desc)}</small></button>`;};
  const soloOk=!!mode&&G.canSolo(cfg(),k,mode.id),solo=soloOk&&bb.opponent==="__solo";
  const pick=(list,key,multi,label,me)=>`<h3>${label}</h3><div class="seg" style="justify-content:flex-start">${me?`<button class="${solo?"on":""}" data-act="bb-pick" data-key="opponent" data-id="__solo" aria-pressed="${solo}">🙋 Just me</button>`:""}${list.map(p=>{const on=multi?(bb[key]||[]).includes(p.id):bb[key]===p.id;
    return `<button class="${on?"on":""}" data-act="bb-pick" data-key="${key}" data-multi="${multi?1:""}" data-id="${p.id}" aria-pressed="${on}">${creatureFor(p.id)[1]} ${esc(p.name)}</button>`;}).join("")}</div>`;
  const others=kidsSorted().filter(p=>p.id!==k.id);let who="";
  if(mode&&G.isRaid(mode.id))who=pick(others,"team",true,mode.id==="babyraid"||soloOk?"Who's on your team? (optional, up to 3)":"Who's on your team? (up to 3)");
  else if(mode&&mode.id==="grownups"){const mine=others.filter(p=>!!p.adult===!!k.adult),theirs=others.filter(p=>!!p.adult!==!!k.adult);
    who=(mine.length?pick(mine,"team",true,"Your team (optional)"):"")+pick(theirs,"opponents",true,k.adult?"Kids to battle":"Grown-ups to battle");}
  else if(mode&&!mode.solo)who=pick(mode.kidsOnly&&k.adult?[]:mode.kidsOnly?others.filter(p=>!p.adult):others,"opponent",false,soloOk?"Who do you challenge? Or play solo.":"Who do you challenge?",soloOk);
  let params="";
  if(bb.mode==="race")params+=`<label>First to<select data-bind="bb.n">${[2,3,4,5,6].map(n=>`<option value="${n}" ${Number(bb.n)===n?"selected":""}>${n} chores</option>`).join("")}</select></label>`;
  if(G.TIMEBOX_MODES.includes(bb.mode)){const cur=String(bb.windowMin),custom=cur==="custom"||!G.TIME_CHOICES.map(String).includes(cur);
    params+=`<label>${bb.mode==="roomrush"?"Do it within":"Time limit"}<select data-bind="bb.windowMin">${G.TIME_CHOICES.map(v=>`<option value="${v}" ${!custom&&Number(cur)===v?"selected":""}>${v?G.timeText(v):"Until midnight"}</option>`).join("")}<option value="custom" ${custom?"selected":""}>Custom…</option></select></label>
    ${custom?`<label style="flex:0 1 130px">Minutes<input type="number" min="${G.MIN_TIME}" max="${G.MAX_TIME}" step="5" data-bind="bb.customMin" value="${esc(bb.customMin||(cur!=="custom"?cur:30))}"></label>`:""}`;}
  if(bb.mode==="roomrush"){const other=bb.room==="other";
    params+=`<label>Room<select data-bind="bb.room">${G.ROOMS.map(r=>`<option ${bb.room===r?"selected":""}>${esc(r)}</option>`).join("")}<option value="other" ${other?"selected":""}>Somewhere else…</option></select></label>
    ${other?`<label>Which room?<input data-bind="bb.roomCustom" maxlength="30" placeholder="Like: the stairs" value="${esc(bb.roomCustom||"")}"></label>`:""}
    <label>Each run<select data-bind="bb.minutes">${G.RUSH_MINUTES.map(n=>`<option value="${n}" ${Number(bb.minutes)===n?"selected":""}>${n} minute${n>1?"s":""}</option>`).join("")}</select></label>`;}
  if(bb.mode==="raid")params+=`<label>How many days<select data-bind="bb.days">${[1,2,3].map(n=>`<option value="${n}" ${Number(bb.days)===n?"selected":""}>${n} day${n>1?"s":""}</option>`).join("")}</select></label>`;
  if(mode&&(G.TIMED.includes(mode.id)||mode.id==="judge")){const pb=xpState(k.id).pb;
    params+=`<label>Chore<select data-bind="bb.choreId">${bbChores(k.id,mode.id).map(c=>`<option value="${c.id}" ${bb.choreId===c.id?"selected":""}>${esc(c.name)}${mode.id==="ghost"&&pb[c.id]!=null?` (your best ${fmtMs(pb[c.id])})`:""}</option>`).join("")}</select></label>`;}
  const opp=mode&&!mode.solo&&!mode.team?kidCfg(bb.opponent):null;let hc="";
  if(opp&&mode.id!=="wildcard"){const h=G.handicaps(k,opp,cfg());const y=h[k.id]>1?k:h[opp.id]>1?opp:null;if(y)hc=`<p class="hint">${y.id===k.id?"You're":esc(y.name)+" is"} younger, so ${y.id===k.id?"your":"their"} score counts ×${h[y.id]}${mode.id==="bingo"?" (in Bingo: free squares instead)":""}.</p>`;}
  const ready=mode&&(mode.solo||solo||(mode.id==="raid"?(bb.team||[]).length>(soloOk?-1:0)&&(bb.team||[]).length<=3:mode.id==="babyraid"?(bb.team||[]).length<=3:mode.id==="grownups"?(bb.opponents||[]).length>0:!!opp));
  return `<div class="builder"><h3>Pick a mode</h3><div class="modes">${G.ACTIVE_MODES.map(modeBtn).join("")}</div>${who}
    ${params?`<div class="row" style="margin-top:10px">${params}</div>`:""}${hc}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="bb-send" ${!ready||S.busy.b?"disabled":""}>${S.busy.b?"Sending…":mode&&(mode.solo||solo)?"Start":"Send challenge"}</button><button class="btn ghost" data-act="bb-close">Cancel</button></div></div>`;}
// This person's battle limits, counted the same way the server does (null mode: overall limits only).
const battleLimitFor=(id,modeId)=>G.battleLimit(cfg(),modeId||"-",battleList(),id,ymd(),mondayOf(new Date()));
function battleUse(id){const mon=mondayOf(new Date()),n=b=>!["declined","expired","cancelled"].includes(b.status)&&b.players.includes(id);
  const wk=battleList().filter(b=>n(b)&&b.day>=mon&&b.day<=addDays(mon,6));return {day:wk.filter(b=>b.day===ymd()).length,week:wk.length};}
function battleSection(k){const bc=game().battles;const mine=battleList().filter(b=>b.players.includes(k.id));const live=mine.filter(b=>b.live);const recent=mine.filter(b=>!b.live&&b.status==="done").slice(0,3);
  if(!bc.enabled&&!live.length&&!recent.length)return "";
  const bb=S.ui.bb&&S.ui.bb.kid===k.id?S.ui.bb:null;const asleep=bc.enabled&&G.inQuietHours(nowHM(),cfg());
  const t12=hm=>{const [h,m]=hm.split(":").map(Number);return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});};
  const x=xpState(k.id).counts;const rec=(x.win||0)+(x.loss||0)+(x.tie||0)?`<span class="sub">${x.win||0} won, ${x.loss||0} lost${x.tie?`, ${x.tie} tied`:""}</span>`:"";
  const used=battleUse(k.id),allDone=battleLimitFor(k.id,null);
  const btn=asleep?`<span class="sub">😴 Asleep until ${t12(bc.quietEnd)}</span>`:allDone?`<span class="sub">✋ ${allDone.scope==="day"?"That's all for today":"That's all for this week"}</span>`:`<button class="btn small" data-act="bb-open">Challenge</button>`;
  const usage=bc.enabled?`<p class="hint" style="margin:0 0 6px">Battles today: ${used.day} of ${bc.dailyCap}${bc.weeklyCap>0?`. This week: ${used.week} of ${bc.weeklyCap}`:""}.</p>`:"";
  return `<section class="card battles"><div class="sec-head"><h2>⚔️ Battles</h2>${rec}${bc.enabled&&!bb?btn:""}</div>${usage}
    ${bb?battleBuilder(k,bb):""}${live.map(b=>battleCard(b,k.id)).join("")}
    ${!live.length&&!bb?`<p class="empty">${bc.enabled?"No battles right now. Challenge someone, or race your own best time.":"Battles are turned off."}</p>`:""}
    ${recent.length?`<ul class="feed recent">${recent.map(b=>recentLine(b,k.id)).join("")}</ul>`:""}</section>`;}

/* ---------- game: quests, rewards, bounties, family goal ---------- */
function questCtx(id){const mon=mondayOf(new Date()),sun=addDays(mon,6),fri=addDays(mon,4),ks=kidState(id),fz=xpState(id).frozen;
  const entries=entriesFor(id).filter(e=>e.status!=="reversed"&&e.date>=mon&&e.date<=sun).map(e=>({...e,hour:hourIn(e.t)}));
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

/* ---------- full-screen chore mode: timer and steps ---------- */
const stepsOf=ch=>Array.isArray(ch&&ch.steps)?ch.steps.filter(Boolean):[];
const FOCUS_KEY="boon.focus";
function saveFocus(){try{if(S.ui.focus)localStorage.setItem(FOCUS_KEY,JSON.stringify(S.ui.focus));else localStorage.removeItem(FOCUS_KEY);}catch(e){}}
// Picks up a run left open on this device (the timer keeps going while the app is closed).
function restoreFocus(){if(S.ui.focus||!S.config||!S.viewKid||!onKidScreen())return;let f=null;try{f=JSON.parse(localStorage.getItem(FOCUS_KEY)||"null");}catch(e){}
  if(!f||f.kid!==S.viewKid||Date.now()-f.startAt>6*3600e3||!(choreById(f.id)))return;
  if(f.battleId){const b=S.battles[f.battleId];if(!b)return;const a=(b.attempts||{})[f.kid];if(b.status!=="active"||(a&&(a.ms!=null||a.void||a.entryId)))return;}
  S.ui.focus=f;render();}
function openFocus(f){S.ui.focus={checked:[],note:"",startAt:Date.now(),...f};saveFocus();try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}wake();}
function closeFocus(){S.ui.focus=null;saveFocus();try{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch(e){}}
function focusOverlay(){const f=S.ui.focus,ch=choreById(f.id)||{name:"Chore"},steps=stepsOf(ch),left=steps.filter((_,i)=>!f.checked.includes(i)).length;
  const tgt=ch.targetMin>0?ch.targetMin*60000:0,ask=!f.battleId&&needsNote(ch),busy=S.busy.b||S.busy["c:"+f.id];
  const ready=!left&&(!ask||String(f.note||"").trim());
  return `<div class="focus" role="dialog" aria-modal="true" aria-labelledby="fx-title">
    <div class="fx-top"><button class="btn ghost small" data-act="fx-close">${f.battleId?"Minimize":"✕ Stop"}</button>${f.battleId?`<span class="pill">⚔️ Battle run</span>`:""}</div>
    <div class="fx-ic" aria-hidden="true">${esc(G.choreIcon(ch))}</div><h2 id="fx-title">${esc(ch.name)}</h2>
    ${(()=>{const b=f.battleId&&S.battles[f.battleId],sp=b&&b.mode==="doom"&&(b.dooms||{})[f.kid];return sp&&G.doomsOf(sp).some(d=>d[0]!=="mercy")?`<div class="fx-doom">🎡 ${G.doomsOf(sp).map(d=>`${d[1]} <b>${esc(d[2])}</b>: ${esc(d[3])}`).join("<br>")}</div>`:"";})()}
    <div class="fx-clock"><span class="tt-clock" data-start="${f.startAt}"></span></div>
    ${tgt?`<div class="fx-goal"><div class="fx-bar"><i class="fx-fill" data-start="${f.startAt}" data-target="${tgt}"></i></div><small>Goal: ${fmtMs(tgt)}</small></div>`:""}
    ${steps.length?`<div class="checks fx-steps">${steps.map((s,i)=>{const on=f.checked.includes(i);return `<button class="check ${on?"on":""}" data-act="fx-step" data-i="${i}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span><b>${esc(s)}</b></span></button>`;}).join("")}</div>`:""}
    ${ask?`<label class="fx-note">What was it?<input data-bind="focus.note" maxlength="120" placeholder="Say what you did" value="${esc(f.note||"")}"></label>`:""}
    <button class="btn block fx-done" data-act="fx-done" ${!ready||busy?"disabled":""}>${busy?"Saving…":left?`Check off every step first (${left} left)`:"✓ Done!"}</button></div>`;}
// Fills the goal bar as the timer runs; it turns orange past the goal.
function tickGoal(){document.querySelectorAll(".fx-fill[data-start]").forEach(el=>{const p=(Date.now()-Number(el.dataset.start))/Number(el.dataset.target);el.style.width=Math.min(100,p*100)+"%";el.classList.toggle("over",p>1);});}
async function finishFocus(){const f=S.ui.focus,ch=choreById(f.id);if(!f||!ch)return;const ms=Date.now()-f.startAt;
  if(f.battleId){const r=await bcall("finishAttempt",{id:f.battleId});if(r){closeFocus();confetti(80);chime(true);toast(r.ms!=null?`Done in ${fmtMs(r.ms)}! A parent will check it.`:"Turned in! Chore logged.");}render();return;}
  if(ch.kind==="pr"){closeFocus();setPr(f.kid,f.id,true,String(f.note||"").trim());render();return;}
  const note=String(f.note||"").trim();closeFocus();await doChore(f.kid,f.id,note,ms);}

/* ---------- Territory map ---------- */
// Player colors stay the same on every screen: the challenger is blue, the other player orange.
const TM_COL=["#2f7de1","#e8702a"],TM_LAND="#efe6cf",TM_CAN="#fff3b0",TM_SEL="#ffd84d",TM_LOCK="#c9c3b5";
function mapSvg(b,me,big){const m=b.params.map,R=10,W=Math.sqrt(3)*R,f=n=>n.toFixed(1);
  const ctr=i=>{const r=Math.floor(i/m.cols),c=i%m.cols;return [W*(c+(r&1)/2)+W/2,1.5*R*r+R];};
  const corner=(x,y,j)=>{const a=Math.PI/180*(60*j-30);return [x+R*Math.cos(a),y+R*Math.sin(a)];};
  const run=b.status==="active"&&Date.now()<b.endAt,sel=big&&S.ui.tm?S.ui.tm.sel:null;
  const can=new Set(big&&run&&!(b.open||{})[me]?m.names.map((_,k)=>k).filter(k=>!G.pickProblem(b,me,k)):[]);
  const locked=(b.locked||{})[me]||[];
  let coast="",inner="",labels="";
  const groups=m.names.map((name,k)=>{const cells=[];m.cells.forEach((c,i)=>{if(c===k)cells.push(i);});if(!cells.length)return "";
    const owner=G.countryOwner(b,k),worker=Object.keys(b.open||{}).find(p=>b.open[p]&&b.open[p].c===k),home=Object.values(b.params.homes||{}).includes(k);
    let fill=TM_LAND,op=1;
    if(owner)fill=TM_COL[b.players.indexOf(owner)]||"#888";
    else if(worker){fill=TM_COL[b.players.indexOf(worker)]||"#888";op=.45;}
    else if(sel===k)fill=TM_SEL;
    else if(locked.includes(k))fill=TM_LOCK;
    else if(can.has(k))fill=TM_CAN;
    let sx=0,sy=0;
    const polys=cells.map(i=>{const [x,y]=ctr(i);sx+=x;sy+=y;
      G.hexNeighbors(i,m.cols,m.rows).forEach((n,j)=>{const o=n<0?-1:m.cells[n];if(o===k||(o>=0&&o<k))return;const [x1,y1]=corner(x,y,j),[x2,y2]=corner(x,y,j+1);const seg=`M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;if(o<0)coast+=seg;else inner+=seg;});
      return `<polygon points="${[0,1,2,3,4,5].map(j=>corner(x,y,j).map(f).join(",")).join(" ")}" fill="${fill}" stroke="${fill}" stroke-width=".8" fill-opacity="${op}" stroke-opacity="${op}"/>`;}).join("");
    const lx=sx/cells.length,ly=sy/cells.length;
    const emo=home?"🏰":owner?creatureFor(owner)[1]:worker?"⛏️":locked.includes(k)?"🔒":"";
    labels+=emo?`<text class="tm-emo" x="${f(lx)}" y="${f(ly)}">${emo}</text>${big&&!home?`<text class="tm-lbl on" x="${f(lx)}" y="${f(ly+7)}">${esc(name)}</text>`:""}`:big?`<text class="tm-lbl" x="${f(lx)}" y="${f(ly)}">${esc(name)}</text>`:"";
    return `<g class="tm-ct ${can.has(k)&&sel!==k?"tm-can":""}" ${big?`data-act="tm-pick" data-c="${k}" role="button" aria-label="${esc(name)}${owner?`, ${owner===me?"yours":bName(b,owner)+"'s"}`:""}"`:""}>${polys}</g>`;}).join("");
  const vw=W*(m.cols+.5),vh=1.5*R*(m.rows-1)+2*R;
  return `<svg class="tm-svg" viewBox="${f(-2)} ${f(-2)} ${f(vw+4)} ${f(vh+4)}" role="img" aria-label="Territory map">${groups}<path d="${inner}" class="tm-border"/><path d="${coast}" class="tm-coast"/>${labels}</svg>`;}
function mapChips(b,me){return `<div class="tm-score">${b.players.map((p,i)=>`<span class="tm-chip" style="--c:${TM_COL[i]}"><i></i>${p===me?"You":bName(b,p)} <b>${scoreHtml(b,p)}</b></span>`).join("")}</div>`;}
function mapOverlay(){const t=S.ui.tm,b=S.battles[t.id],me=S.viewKid;if(!b||!G.isMapTerritory(b)||!b.players.includes(me))return "";
  const m=b.params.map,open=(b.open||{})[me],run=b.status==="active"&&Date.now()<b.endAt,busy=S.busy.b;let panel;
  if(!run)panel=`<p class="b-result">${b.status==="active"?"Time's up! Counting the map…":b.result?resultText(b,me):"This battle is over."}</p>`;
  else if(open){const ch=choreById(open.choreId)||{name:open.name},steps=stepsOf(ch),left=steps.filter((_,i)=>!t.checked.includes(i)).length;
    panel=`<p class="tm-now">⛏️ Conquering <b>${esc(m.names[open.c])}</b></p><div class="tm-chore"><span class="fx-ic">${esc(G.choreIcon(ch))}</span><b>${esc(ch.name)}</b></div><div class="fx-clock tm-clock"><span class="tt-clock" data-start="${open.at}"></span></div>
      ${steps.length?`<div class="checks fx-steps">${steps.map((s,i)=>{const on=t.checked.includes(i);return `<button class="check ${on?"on":""}" data-act="tm-step" data-i="${i}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span><b>${esc(s)}</b></span></button>`;}).join("")}</div>`:""}
      <button class="btn block" data-act="tm-claim" ${left||busy?"disabled":""}>${busy?"Saving…":left?`Check off every step first (${left} left)`:"✓ Done! Claim it"}</button>
      <button class="btn ghost small" data-act="tm-giveup" ${busy?"disabled":""}>Give up this country</button>`;}
  else if(t.sel!=null&&m.names[t.sel]){const why=G.pickProblem(b,me,t.sel),owner=G.countryOwner(b,t.sel);
    panel=`<p class="tm-now"><b>${esc(m.names[t.sel])}</b>${owner?` · ${owner===me?"Yours":bName(b,owner)+"'s"}`:""}</p>${why?`<p class="sub">${esc(why)}</p>`:`<button class="btn block" data-act="tm-reveal" ${busy?"disabled":""}>🔍 Reveal the chore</button><p class="hint">Once it's revealed, you finish it before picking another country.</p>`}`;}
  else panel=`<p class="sub">Tap a glowing country next to yours to reveal its chore. Do the chore and the country is yours.</p>`;
  return `<div class="focus tmap" role="dialog" aria-modal="true" aria-label="Territory map"><div class="fx-top"><button class="btn ghost small" data-act="tm-close">Minimize</button><span class="pill">🚩 Ends ${fmtEnd(b.endAt)}</span></div>
    ${mapChips(b,me)}${mapSvg(b,me,true)}<div class="tm-panel">${panel}</div></div>`;}
/* ---------- Wheel of Doom ---------- */
const WD_COLORS=["#e4572e","#f3a712","#29bf12","#00a5cf","#7e52a0","#ff6f91","#4e8d7c","#f9c80e","#3d5a80","#ee6c4d","#98c1d9","#2b2d42"];
const WD_PHASE=9500,WD_SPIN=8500; // each spin: a fast whirl, a long glide, then a slow crawl into the slot
const doomText=spins=>G.doomsOf(spins).map(d=>`${d[1]} ${esc(d[2])}`).join(" + ");
function doomCards(spins){return `<div class="wd-cards">${G.doomsOf(spins).map(d=>`<div class="wd-card"><span>${d[1]}</span><b>${esc(d[2])}</b><small>${esc(d[3])}</small></div>`).join("")}</div>`;}
// Where the wheel stops for spin j: a few full turns, then the slot under the pointer (with a little wobble).
function wdLand(spins,j){const i=spins[j];return 2520*(j+1)-i*30+(((i*7+j*3)%17)-8);}
// A click each time a slot passes the pointer, so you can hear it slow down.
let wdRaf=null,wdLast=null;
function wdTick(){try{actx=actx||new (window.AudioContext||window.webkitAudioContext)();const t=actx.currentTime,o=actx.createOscillator(),g=actx.createGain();o.type="square";o.frequency.value=1400;
  g.gain.setValueAtTime(.06,t);g.gain.exponentialRampToValueAtTime(.0001,t+.03);o.connect(g).connect(actx.destination);o.start(t);o.stop(t+.04);}catch(e){}}
function wdWatch(){const el=document.querySelector(".wd-rot.wd-spin");if(!el){wdRaf=null;wdLast=null;return;}
  const m=getComputedStyle(el).transform;if(m&&m!=="none"){const v=m.match(/-?[\d.e]+/g).map(Number),deg=Math.atan2(v[1],v[0])*180/Math.PI;const slot=Math.floor(((deg%360)+375)/30);if(wdLast!=null&&slot!==wdLast)wdTick();wdLast=slot;}
  wdRaf=requestAnimationFrame(wdWatch);}
function wheelSvg(style,cls){const C=110,R=100,pt=(a,r)=>{const t=(a-90)*Math.PI/180;return [(C+r*Math.cos(t)).toFixed(1),(C+r*Math.sin(t)).toFixed(1)];};
  const wedges=G.DOOMS.map((d,i)=>{const [x1,y1]=pt(i*30-15,R),[x2,y2]=pt(i*30+15,R),[ex,ey]=pt(i*30,70);
    return `<path d="M${C} ${C}L${x1} ${y1}A${R} ${R} 0 0 1 ${x2} ${y2}Z" fill="${WD_COLORS[i]}"/><text x="${ex}" y="${ey}" class="wd-emo" transform="rotate(${i*30} ${ex} ${ey})">${d[1]}</text>`;}).join("");
  return `<svg class="wd-svg" viewBox="0 0 220 220" role="img" aria-label="The Wheel of Doom"><g class="wd-rot ${cls}" style="${style}">${wedges}<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#fff" stroke-width="4"/></g><circle cx="${C}" cy="${C}" r="14" fill="#2b2d42" stroke="#fff" stroke-width="3"/><path d="M${C-11} 2L${C+11} 2L${C} 26Z" fill="#2b2d42" stroke="#fff" stroke-width="2"/></svg>`;}
let wdTimer=null;
function wheelOverlay(){const w=S.ui.wheel,b=S.battles[w.id],me=S.viewKid;if(!b||b.mode!=="doom"||!b.players.includes(me))return "";
  const spins=(b.dooms||{})[me]||w.spins,busy=S.busy.b;let style="",cls="",shown=0,spinning=false;
  if(spins){const e=w.at?Date.now()-w.at:Infinity,n=spins.length,j=Math.min(Math.floor(e/WD_PHASE),n-1),into=e-j*WD_PHASE;
    if(into<WD_SPIN){spinning=true;cls="wd-spin";style=`--from:${j?wdLand(spins,j-1):0}deg;--to:${wdLand(spins,j)}deg;animation-delay:-${Math.round(into)}ms`;shown=j;
      clearTimeout(wdTimer);wdTimer=setTimeout(()=>{if(S.ui.wheel)render();},WD_SPIN-into+30);}
    else{style=`transform:rotate(${wdLand(spins,j)}deg)`;shown=j+1;if(j<n-1){clearTimeout(wdTimer);wdTimer=setTimeout(()=>{if(S.ui.wheel)render();},WD_PHASE-into+30);}}}
  const done=spins&&shown>=spins.length,a=(b.attempts||{})[me];
  let foot;
  if(!spins)foot=`<p class="sub">Spin to find out how you'll do "${esc(b.params.choreName)}". No re-spins!</p><button class="btn block wd-go" data-act="wd-spin" ${busy?"disabled":""}>${busy?"Spinning…":"🎡 Spin!"}</button>`;
  else if(!done)foot=`<p class="wd-now">${shown&&spins[0]===G.DOOM_DOUBLE?"💀 Double doom! Spinning again…":"Spinning…"}</p>`;
  else foot=`<p class="wd-now">Your doom:</p>${doomCards(spins)}${a?`<button class="btn block" data-act="wd-close">Back</button>`:`<p class="hint">Get ready by the chore, then start the timer. A parent checks it was done well and with your doom.</p><button class="btn block wd-go" data-act="b-start" data-id="${w.id}" ${busy?"disabled":""}>▶ Start the timer</button>`}`;
  return `<div class="focus wd" role="dialog" aria-modal="true" aria-label="Wheel of Doom"><div class="fx-top"><button class="btn ghost small" data-act="wd-close" ${spinning?"disabled":""}>${spins&&done?"Close":"Not yet"}</button><span class="pill">🎡 Wheel of Doom</span></div>
    ${wheelSvg(style,cls)}<div class="tm-panel" aria-live="polite">${foot}</div></div>`;}
function openWheel(id){S.ui.wheel={id,spins:null,at:0};try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}wake();}
function closeWheel(){S.ui.wheel=null;clearTimeout(wdTimer);try{if(document.fullscreenElement&&!S.ui.focus)document.exitFullscreen().catch(()=>{});}catch(e){}}
/* ---------- Room Rush: full-screen countdown, then the count ---------- */
function rushOverlay(){const r=S.ui.rush,b=S.battles[r.id],me=S.viewKid;if(!b||b.mode!=="roomrush")return "";
  const a=(b.attempts||{})[me];if(!a||a.count!=null)return "";
  const end=a.startAt+b.params.minutes*60000,over=Date.now()>=end-3000,busy=S.busy.b,n=r.count;
  const ok=n!==""&&n!=null&&Number.isInteger(Number(n))&&Number(n)>=0&&Number(n)<=G.MAX_RUSH_ITEMS;
  return `<div class="focus rush" role="dialog" aria-modal="true" aria-labelledby="rr-title"><div class="fx-top"><button class="btn ghost small" data-act="rr-close">Minimize</button><span class="pill">🌪️ Room Rush</span></div>
    <h2 id="rr-title">${esc(b.params.room)}</h2>
    ${over?`<p class="rr-up">⏰ Time's up!</p><label class="rr-count">How many things did you clean up?<input type="number" inputmode="numeric" min="0" max="${G.MAX_RUSH_ITEMS}" step="1" data-bind="rush.count" data-type="num" value="${esc(n??"")}" autofocus></label>
      <button class="btn block" data-act="rr-submit" ${!ok||busy?"disabled":""}>${busy?"Saving…":"Turn in my count"}</button><p class="hint">Be honest! ${b.players.length>1?"The other player confirms the result.":""}</p>`
      :`<div class="fx-clock rr-clock"><span class="cd-clock" data-end="${end}">${fmtMs(end-Date.now())}</span></div><p class="sub">Put away as many things as you can. Count them in your head!</p>`}</div>`;}
function openRush(id){S.ui.rush={id,count:""};try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}wake();}
function closeRush(){S.ui.rush=null;try{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch(e){}}
function openMap(id){S.ui.tm={id,sel:null,checked:[]};try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}wake();}
function closeMap(){S.ui.tm=null;try{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch(e){}}

function viewDisplay(){
  const d=(7-new Date().getDay())%7;const cash=d===0?"Cash-out tonight":`Cash-out in ${d} day${d===1?"":"s"}`;
  const all=[];for(const w of Object.values(S.weeks))for(const e of w.entries||[])if(e.status!=="reversed")all.push({...e,kidId:w.kidId});
  const recent=all.sort((a,b)=>b.t-a.t).slice(0,5).map(e=>{const k=kidCfg(e.kidId);return k?`<b>${esc(k.name)}</b> ${esc(G.choreIcon(choreById(e.choreId)||{name:e.name}))} ${esc(e.name.toLowerCase())}${e.detail?` (${esc(e.detail)})`:""} +${money(e.amount)}`:"";}).filter(Boolean);
  const ups=cfg().kids.map(k=>({k,lu:xpState(k.id).levelUp})).filter(x=>x.lu&&Date.now()-x.lu.at<24*3600e3).map(x=>`⭐ <b>${esc(x.k.name)}</b> reached level ${x.lu.level}!`);
  const cot=choreById(cotdId()||"");
  return `<div class="board"><header class="board-head"><h1>Boon Chore Tracker</h1><div class="when">${new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}. <b>${cash}</b>${cot?`<span class="cotd-chip">⭐ Double XP: ${esc(cot.name)}</span>`:""}</div></header>
  ${familyBar(false)}${battleStrip()}
  <div class="lanes">${kidsSorted().map(k=>{const ks=kidState(k.id),w=getWeek(k.id,activeWeek(k.id)),net=weekNet(w),won=w.goal&&net>=w.goal,s=streak(k.id),x=xpState(k.id);
    return `<section class="lane ${won?"won":""}" data-kid="${k.id}"><div class="lane-who"><span class="lane-cr">${crHtml(k.id)}</span><div><h2>${esc(k.name)}</h2><span class="lvl-badge">Lv ${x.level}</span> <span class="streak">🔥 ${s}</span><small class="lane-title">${esc(titleOf(k.id))}</small></div></div>
      <div class="lane-track">${w.goal?trail(net/w.goal,crHtml(k.id),won,`${esc(k.name)} is at ${Math.round(net/w.goal*100)}% of their goal`,equipped(k.id).trail):`<p class="sub">Waiting for this week's goal</p>`}</div>
      <div class="lane-num"><b>${money(net)}</b><span>${w.goal?"of "+money(w.goal):"No goal yet"}</span>${w.goal?`<em class="${won?"won-note":""}">${won?"Goal reached!":Math.round(net/w.goal*100)+"%"}</em>`:""}</div>
      ${k.adult?adultSaving(ks):""}
</section>`;}).join("")}</div>
  <footer class="ticker">${[...ups,...(recent.length?["Latest: "+recent.join("&emsp;")]:[])].join("&emsp;")||"No chores done yet this week. Who's first?"}</footer></div>`;
}
// On the family display, what a grown-up is saving toward, so the kids see it.
function adultSaving(ks){const gs=ks.goals.filter(g=>g.id!=="general"&&g.target>0);if(!gs.length)return "";
  return `<div class="lane-save">💰 Saving for ${gs.map(g=>`<b>${esc(g.name)}</b> ${money(g.balance)} of ${money(g.target)}`).join(" · ")}</div>`;}
// Live battles across the top of the family display.
function battleStrip(){const bl=battleList().filter(b=>b.live&&b.status!=="pending");if(!bl.length)return "";
  return `<div class="battle-strip" aria-label="Battles going on">${bl.map(b=>{const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const r=b.result||{};
    let who;
    if(G.isRaid(b.mode)){const ts=(b.teamScores||{}).a;who=`<span class="bs-p">${b.teams.a.map(p=>crHtml(p)).join("")} vs ${esc(b.params.bossEmoji)} <span class="bs-score">${Math.max(0,(b.params.hp||0)-(ts?ts.raw:0))} HP left</span></span>`;}
    else if(b.teams)who=["a","b"].map(sd=>`<span class="bs-p">${b.teams[sd].map(p=>crHtml(p)).join("")} <span class="bs-score">${((b.teamScores||{})[sd]||{}).adj||0}</span></span>`).join(`<span class="vs-x">vs</span>`);
    else who=b.players.map(p=>`<span class="bs-p">${crHtml(p)} <b>${bName(b,p)}</b> <span class="bs-score">${scoreHtml(b,p)}</span></span>`).join(`<span class="vs-x">vs</span>`);
    const tail=b.status==="judging"?`<em>Judging…</em>`:b.status==="confirming"&&G.TIMED.includes(b.mode)?`<em>⏳ Checking the work…</em>`:b.status==="confirming"?`<em>${r.noContest?"No contest":r.tie?"Tie!":b.mode==="ghost"?(r.winner?"New best!":"So close!"):r.winnerSide?b.teams[r.winnerSide].map(p=>bName(b,p)).join(" & ")+" win!":bName(b,r.winner)+" wins!"}</em>`:b.mode==="ghost"?`<span class="vs-x">vs</span><span class="bs-p">👻 best ${b.pb!=null?fmtMs(b.pb):"—"}</span>`:"";
    return `<div class="bs"><span class="bs-mode">${b.wildcard?"🃏 ":""}${m.emoji} ${esc(m.name)}</span>${who}${tail}</div>`;}).join("")}</div>`;}

/* ---------- parent ---------- */
function viewParent(){
  // Each parent sees only their own lane (matched by email). With no match, show every adult so no lane is out of reach.
  const email=String(S.user&&S.user.email||"").toLowerCase();const mine=a=>a.email&&a.email.toLowerCase()===email;
  const all=kidsSorted().filter(k=>k.adult),adults=all.some(mine)?all.filter(mine):all;
  const tabs=[...adults.map(a=>["me:"+a.id,a.name+(mine(a)?" (you)":"")]),["activity","Activity"],["game","Game"+(gameAlerts()?` (${gameAlerts()})`:"")],["views","Views"],["actions","Actions"],["goals","Savings goals"],["settings","Settings"]];
  if(!tabs.some(t=>t[0]===S.ptab))S.ptab="activity";
  let body;if(S.ptab.startsWith("me:")){S.viewKid=S.ptab.slice(3);body=viewKid(S.viewKid,true);}
  else body={activity:pActivity,game:pGame,views:pViews,actions:pActions,goals:pGoals,settings:pSettings}[S.ptab]();
  return `<div class="wrap"><header class="p-head"><div><h1>Parent</h1><p class="sub">Signed in as ${esc(parentName())}</p></div><button class="btn ghost small" data-act="sign-out">Sign out</button></header>
  <nav class="tabs">${tabs.map(t=>`<button class="${S.ptab===t[0]?"on":""}" data-act="ptab" data-tab="${t[0]}">${esc(t[1])}</button>`).join("")}</nav>${body}</div>`;
}
const needsCheck=b=>G.TIMED.includes(b.mode)&&b.players.some(p=>{const a=(b.attempts||{})[p];return a&&a.ms!=null&&!a.void&&(b.quality||{})[p]==null;});
const gameAlerts=()=>battleList().filter(b=>b.live&&(b.status==="judging"||needsCheck(b)||(b.status==="confirming"&&b.result&&b.result.needsParent))).length
  +Object.values(S.claims).filter(c=>c.status==="pending").length+Object.values(S.bounties).filter(b=>b.status==="claimed").length;
// A parent's check of each finished timed run: done well (it counts) or not good enough.
function qcRows(b){const qc=b.players.filter(p=>{const a=(b.attempts||{})[p];return a&&a.ms!=null&&!a.void;});if(!G.TIMED.includes(b.mode)||!qc.length)return "";
  return `<div class="qc">${qc.map(p=>{const v=(b.quality||{})[p];return `<div class="qc-row"><span><b>${bName(b,p)}</b> ${fmtMs(b.attempts[p].ms)}${b.mode==="doom"&&(b.dooms||{})[p]?`<br><small>Doom: ${doomText(b.dooms[p])}</small>`:""}</span><button class="btn small ${v===true?"":"ghost"}" data-act="p-check" data-id="${b.id}" data-player="${p}" data-ok="1" aria-pressed="${v===true}">✓ Done well</button><button class="btn small ${v===false?"warn":"ghost"}" data-act="p-check" data-id="${b.id}" data-player="${p}" data-ok="" aria-pressed="${v===false}">✗ Not good enough</button></div>`;}).join("")}</div>`;}
function pGame(){
  const live=battleList().filter(b=>b.live),cot=cotdId(),fam=cfg().chores.filter(c=>c.kind==="family"),g=game();
  const line=b=>{const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const r=b.result||{};const names=b.teams?Object.values(b.teams).map(t=>t.map(p=>bName(b,p)).join(" & ")).join(" vs "):b.players.map(p=>bName(b,p)).join(" vs ");
    const times=G.TIMED.includes(b.mode)?" Times: "+b.players.map(p=>`${bName(b,p)} ${scoreHtml(b,p)}`).join(", ")+".":b.scores?" Score: "+b.players.map(p=>`${bName(b,p)} ${scoreHtml(b,p)}`).join(", ")+".":"";
    const qc=G.TIMED.includes(b.mode)?b.players.filter(p=>{const a=(b.attempts||{})[p];return a&&a.ms!=null&&!a.void;}):[];
    const status=qc.length?`Check that the chore was done well${b.mode==="doom"?" and with their doom":""}. Only runs done well count, and the fastest of those wins.`:b.status==="judging"?(G.isSoloPlay(b)?"Done. Go look, then say if it was a great job.":"Both are done. Go look, then pick the better job."):b.status==="confirming"?`${resultText(b,null)}${r.needsParent?(r.disputedBy?` ${bName(b,r.disputedBy)} asked you to check.`:" Flagged: a run under a minute."):" Waiting for the other player (auto-confirms after 12 hours)."}`:b.status==="pending"?"Waiting to be accepted.":"In progress.";
    const checks=qcRows(b);
    const btns=G.TIMED.includes(b.mode)&&b.status==="confirming"?`<button class="btn ghost small" data-act="p-bvoid" data-id="${b.id}">No contest</button>`:b.status==="judging"&&G.isSoloPlay(b)?`<span class="row" style="flex:0 1 auto;gap:6px"><button class="btn small" data-act="p-judge" data-id="${b.id}" data-winner="${b.players[0]}">✓ Great job</button><button class="btn ghost small" data-act="p-judge" data-id="${b.id}" data-winner="tie">✗ Not this time</button></span>`
      :b.status==="judging"?`<span class="row" style="flex:0 1 auto;gap:6px">${b.players.map(p=>`<button class="btn small" data-act="p-judge" data-id="${b.id}" data-winner="${p}">${bName(b,p)}</button>`).join("")}<button class="btn ghost small" data-act="p-judge" data-id="${b.id}" data-winner="tie">Tie</button></span>`
      :b.status==="confirming"?`<button class="btn small" data-act="p-bconfirm" data-id="${b.id}">Confirm</button><button class="btn ghost small" data-act="p-bvoid" data-id="${b.id}">No contest</button>`
      :`<button class="btn ghost small" data-act="p-bcancel" data-id="${b.id}">Call off</button>`;
    return `<li class="${qc.length?"has-qc":""}"><span style="flex:1"><b>${m.emoji} ${esc(m.name)}</b>: ${names}<br><small>${modeParams(b)}. ${status}${qc.length?"":times}</small>${checks}</span>${btns}</li>`;};
  const hist=id=>{const h=S.ui.xpHist[id];if(!h)return "";if(h==="loading")return `<p class="sub">Loading…</p>`;
    return h.length?`<ul class="feed">${h.map(e=>`<li><span>${esc(e.reason)}<br><small>${timeOf(e.t)}</small></span><span class="amt pos">+${e.amount} XP</span></li>`).join("")}</ul>`:`<p class="empty">No XP yet.</p>`;};
  return pushCard()+claimsCard()+bountiesCard()+`<section class="card"><div class="sec-head"><h2>Battles</h2><span class="sub">${g.battles.enabled?"On":"Off"}. Change in Settings</span></div>
    ${live.length?`<ul class="feed">${live.sort((a,b)=>(["judging","confirming"].includes(b.status))-(["judging","confirming"].includes(a.status))).map(line).join("")}</ul>`:`<p class="empty">No battles going on.</p>`}
    <p class="hint">Time Trial and Ghost Race runs count only after a parent checks the chore was done well; the fastest run done well wins. Other speed results wait for the other side or a parent (they confirm on their own after 12 hours). "No contest" ends a battle with no XP.</p></section>
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
function pushCard(){if(!("Notification" in window))return "";const perm=Notification.permission;
  if(perm==="denied")return `<p class="hint">Notifications are blocked for this site in your phone's settings.</p>`;
  if(!(perm==="granted"&&S.myToken&&S.myToken.fcmToken))return `<button class="btn ghost block" style="margin-top:14px" data-act="parent-push">🔔 Notify this phone: things that need a parent, and my own battles</button>`;
  const me=kidsSorted().find(k=>k.adult&&k.email&&k.email.toLowerCase()===String(S.user.email||"").toLowerCase());
  return `<section class="card"><div class="sec-head"><h2>🔔 This phone</h2></div>
    <p class="hint" style="margin-top:0">Notifications are on for claims, bounties, and battles that need a parent${me?`, plus ${esc(me.name)}'s own battles`:". Add your email to your adult profile in Settings to hear about your own battles"}.</p>
    <label class="check-label"><input type="checkbox" data-act="battle-feed" ${S.myToken.battleFeed?"checked":""}> Also tell me when the kids start and finish battles</label></section>`;}
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
// Parents can fill in a daily checklist that was done but not checked off, up to two weeks back.
// For each person, the most recent day in the last two weeks that broke a streak of 2+ days.
function brokenStreaks(){const out=[],today=ymd();
  for(const k of kidsSorted()){const ks=kidState(k.id),fz=xpState(k.id).frozen;
    for(let i=1;i<=14;i++){const d=addDays(today,-i);if(prComplete(ks,d,fz))continue;
      let run=0,p=addDays(d,-1);while(prComplete(ks,p,fz)&&run<400){run++;p=addDays(p,-1);}
      if(run>=2){const done=ks.prLog[d]||[];out.push({k,d,run,missing:prChores().filter(c=>!done.includes(c.id))});}
      break;}}
  return out;}
function fixDayCard(){const prs=prChores();if(!prs.length)return "";
  const f=S.ui.fix||(S.ui.fix={kid:kidsSorted()[0].id,date:addDays(ymd(),-1)});if(!kidCfg(f.kid))f.kid=kidsSorted()[0].id;
  const ks=kidState(f.kid),done=ks.prLog[f.date]||[],full=prComplete(ks,f.date),s=streak(f.kid);
  const dates=Array.from({length:14},(_,i)=>addDays(ymd(),-(i+1)));
  const label=d=>parseYmd(d).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})+(d===addDays(ymd(),-1)?" (yesterday)":"");
  const day=d=>parseYmd(d).toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"});
  const broken=brokenStreaks().map(x=>`<div class="flag-row"><span><b>${esc(x.k.name)}</b>'s ${x.run}-day streak stopped on ${esc(day(x.d))}${x.missing.length?`: missed ${x.missing.map(c=>esc(c.name)).join(", ")}`:""}</span><span class="btn-pair"><button class="btn small" data-act="fix-day" data-kid="${x.k.id}" data-date="${x.d}">It was done</button><button class="btn ghost small" data-act="fix-pick" data-kid="${x.k.id}" data-date="${x.d}">Pick items</button></span></div>`).join("");
  return `<section class="card"><div class="sec-head"><h2>Fix a missed day</h2><span class="sub">🔥 ${esc(kidCfg(f.kid).name)}: ${s} day${s===1?"":"s"} in a row</span></div>
    ${broken?`<h3 style="margin-top:0">Streaks that broke recently</h3>${broken}<p class="hint">If everything on that day's list was really done, tap It was done. The streak comes back right away. Or pick the items below.</p><h3>Any day</h3>`:""}
    <div class="row"><label>Who<select data-bind="fix.kid">${kidsSorted().map(k=>`<option value="${k.id}" ${k.id===f.kid?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    <label>Day<select data-bind="fix.date">${dates.map(d=>`<option value="${d}" ${d===f.date?"selected":""}>${label(d)}</option>`).join("")}</select></label></div>
    <div class="checks" style="margin-top:10px">${prs.map(c=>{const on=done.includes(c.id);return `<button class="check ${on?"on":""}" data-act="fix-pr-toggle" data-id="${c.id}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span><b>${icon(c)}${esc(c.name)}</b></span></button>`;}).join("")}</div>
    <p class="hint">${full?"✅ That day counts toward the streak.":"Check off what was done that day. When every item is checked, the day counts toward the streak again."} Streak freezes used on a day you fix come back.</p></section>`;}
// Check a daily item on or off for a past day, the same way the kid screen does for today.
function setPrDay(kid,id,on,date){const ks=kidState(kid),done=ks.prLog[date]||[];
  const complete=on&&prChores().every(c=>c.id===id||done.includes(c.id));const upd={prLog:{[date]:on?arrayUnion(id):arrayRemove(id)}};
  if(complete)upd.prDone={[date]:true};else if(!on)upd.prDone={[date]:false};
  const day=parseYmd(date).toLocaleDateString(undefined,{weekday:"long"});
  guard(setDoc(doc(db,"prefs",kid),upd,{merge:true}),complete?`Fixed. ${kidCfg(kid).name}'s ${day} counts toward the streak.`:null);}
function pActivity(){
  const y=addDays(ymd(),-1);let flags="";
  for(const k of kidsSorted()){const ksy=kidState(k.id),done=ksy.prLog[y]||[];
    const missPr=ksy.prDone[y]?[]:prChores().filter(c=>!done.includes(c.id));
    const missChores=k.adult?[]:famChoresFor(k.id).filter(c=>c.assign===k.id&&countOnDate(k.id,c.id,y)===0&&!limitState(k.id,c,y).reason);
    const act=m=>k.adult?"":`<button class="btn ghost small" data-act="prefill-warn" data-kid="${k.id}" data-reason="${esc("Missed: "+m)}">Warn</button><button class="btn ghost small" data-act="prefill-ded" data-kid="${k.id}" data-reason="${esc("Missed: "+m)}">Deduct</button>`;
    for(const c of missPr)flags+=`<div class="flag-row"><span><b>${esc(k.name)}</b> didn't check off ${esc(c.name)}</span><span class="btn-pair"><button class="btn ghost small" data-act="fix-pr" data-kid="${k.id}" data-date="${y}" data-id="${c.id}">It was done</button>${act(c.name)}</span></div>`;
    for(const c of missChores)flags+=`<div class="flag-row"><span><b>${esc(k.name)}</b> didn't check off ${esc(c.name)}</span><span class="btn-pair">${act(c.name)}</span></div>`;}
  const L=S.ui.log;if(!L.kid)L.kid=kidsSorted()[0].id;const lk=kidCfg(L.kid)||kidsSorted()[0];const lchores=famChoresFor(lk.id);if(!lchores.some(c=>c.id===L.chore))L.chore=lchores[0]?lchores[0].id:"";
  const all=[];for(const w0 of Object.values(S.weeks)){if(w0.closed)continue;const w=getWeek(w0.kidId,w0.week);for(const e of w.entries)all.push({e,w});}
  all.sort((a,b)=>b.e.t-a.e.t);
  return `<section class="card"><div class="sec-head"><h2>Log a chore</h2></div><p class="hint" style="margin-top:0">For anyone without their tablet handy.</p>
    <div class="row"><label>Who<select data-bind="log.kid">${kidsSorted().map(k=>`<option value="${k.id}" ${k.id===lk.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    <label>Chore<select data-bind="log.chore">${lchores.map(c=>`<option value="${c.id}" ${c.id===L.chore?"selected":""}>${esc(G.choreIcon(c))} ${esc(c.name)} (+${money(choreValue(lk,c))})</option>`).join("")}</select></label>${needsNote(choreById(L.chore))?`<label>What was it<input data-bind="log.note" maxlength="120" placeholder="What the chore was" value="${esc(L.note||"")}"></label>`:""}
    <button class="btn" style="flex:0 0 auto" data-act="log-chore" ${S.busy.log?"disabled":""}>${S.busy.log?"Saving…":"Log it"}</button></div></section>
  <section class="card"><div class="sec-head"><h2>Missed yesterday</h2></div>${flags||`<p class="empty">Nothing missed yesterday.</p>`}<p class="hint">Nothing is deducted automatically. You decide. If a daily item was really done but not checked off, tap It was done to fix the streak.</p></section>
  ${fixDayCard()}
  <section class="card"><div class="sec-head"><h2>This week's chores</h2></div>${all.length?`<ul class="feed">${all.slice(0,50).map(({e,w})=>{const k=kidCfg(w.kidId);const l=choreLine(e);
    const btn=`<button class="btn ghost small" data-act="${e.status==="reversed"?"restore":"reverse"}" data-kid="${w.kidId}" data-wk="${w.week}" data-id="${e.id}">${e.status==="reversed"?"Restore":"Reverse"}</button>`;
    return `<li><span style="flex:1"><b>${esc(k?k.name:"?")}</b>: ${l[0]}</span>${l[1]}${btn}</li>`;}).join("")}</ul>`:`<p class="empty">No chores logged yet this week.</p>`}</section>`;
}
function pDeductions(){
  const d=S.ui.ded;if(!d.kid)d.kid=kidsSorted().find(k=>!k.adult)?.id||kidsSorted()[0].id;const warn=d.type==="warn";
  let list="";for(const k of kidsSorted())for(const w of openWeeks(k.id)){const seen=new Set(kidState(k.id).seenWarnings);
    for(const x of w.warnings||[])list+=`<li class="wrap"><span><b>${esc(k.name)}</b>: ${esc(x.reason)}<br><small>⚠️ Warning${x.by?" by "+esc(x.by):""}. ${seen.has(x.id)?"Seen ✓":"Not seen yet"}</small></span>
      <button class="btn ghost small" data-act="warn-to-ded" data-kid="${k.id}" data-reason="${esc(x.reason)}">Deduct instead</button><button class="btn ghost small" data-act="remove-warn" data-kid="${k.id}" data-wk="${w.week}" data-id="${x.id}">Remove</button></li>`;
    for(const e of w.deductions)
    list+=`<li><span style="flex:1"><b>${esc(k.name)}</b>: ${esc(e.reason)}<br><small>${e.how?"Earn back by: "+esc(e.how)+". ":""}${e.status==="active"?"Open":"Earned back"}${e.by?", by "+esc(e.by):""}</small></span><span class="amt ${e.status==="active"?"neg":"struck"}">−${money(e.amount)}</span>
    ${e.status==="active"?`<button class="btn small" data-act="redeem" data-kid="${k.id}" data-wk="${w.week}" data-id="${e.id}">Earned back</button>`:""}<button class="btn ghost small" data-act="remove-ded" data-kid="${k.id}" data-wk="${w.week}" data-id="${e.id}">Remove</button></li>`;}
  return `<section class="card"><div class="sec-head"><h2>Add a deduction or warning</h2></div>
    <div class="seg" style="margin-bottom:10px"><button class="${warn?"":"on"}" data-act="ded-type" data-type="ded" aria-pressed="${!warn}">💸 Deduction</button><button class="${warn?"on":""}" data-act="ded-type" data-type="warn" aria-pressed="${warn}">⚠️ Warning (no money)</button></div>
    <div class="row"><label>Who<select data-bind="ded.kid">${kidsSorted().filter(k=>!k.adult).map(k=>`<option value="${k.id}" ${k.id===d.kid?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    ${warn?"":`<label>Amount<input type="number" step="0.25" min="0.25" inputmode="decimal" data-bind="ded.amount" data-type="num" value="${esc(d.amount)}"></label>`}</div>
    <div class="row" style="margin-top:10px"><label>Reason<input data-bind="ded.reason" value="${esc(d.reason)}" placeholder="Bad attitude at dinner"></label></div>
    ${warn?"":`<div class="row" style="margin-top:10px"><label>How to earn it back<input data-bind="ded.how" value="${esc(d.how)}" placeholder="Apologize and keep a good attitude the rest of the day"></label></div>`}
    <button class="btn block" style="margin-top:12px" data-act="add-ded">${warn?"Give warning":"Add deduction"}</button>
    <p class="hint">${warn?"A warning costs nothing. It shows on their screen until they tap Got it, and stays in this week's list. If it keeps happening, turn it into a deduction.":"They can earn it back any time before Sunday's cash-out. After that it's final. Deductions never show on the leaderboard."}</p></section>
    <section class="card"><div class="sec-head"><h2>This week</h2></div>${list?`<ul class="feed">${list}</ul>`:`<p class="empty">No warnings or deductions this week.</p>`}</section>`;
}
// Every week that still needs cashing out: last week if it was missed, plus this week. They settle as one lump.
function cashWeeks(kidId){const thisMon=mondayOf(new Date()),prev=addDays(thisMon,-7),out=[];
  const pw=S.weeks[weekDocId(kidId,prev)];if(pw&&!pw.closed&&((pw.entries||[]).length||(pw.deductions||[]).length||pw.goal))out.push(prev);
  const tw=S.weeks[weekDocId(kidId,thisMon)];if(!(tw&&tw.closed))out.push(thisMon);return out.length?out:null;}
// Where this month's interest goes is decided during cash-out, and can be split. Until then it starts all
// in one place: the kid's old pick if they had one, else back into Invest.
function interestDests(ks){return [["spend","Spend (cash now)"],["invest","Invest (it grows!)"],["give","Give"],...ks.goals.map(g=>[g.id,g.name])];}
function defaultAlloc(ks,interest){const to=ks.interestTo||"invest";return interest?{[interestDests(ks).some(d=>d[0]===to)?to:"invest"]:interest}:{};}
const isQuarter=v=>Math.abs(v*4-Math.round(v*4))<1e-9;
function cashoutPlan(kidId,weeks,alloc){
  const ks=kidState(kidId),sp=cfg().split,ex={spend:0,save:0,invest:0,give:0};const addSplit=a=>{for(const b in ex)ex[b]+=a*sp[b]/100;};
  const parts=weeks.map(wk=>{const w=getWeek(kidId,wk),net=weekNet(w),goal=w.goal||0,met=goal>0&&net>=goal;
    return {wk,w,net,goal,met,bonus:met?r2(goal*BONUS_RATE):0,bonusTo:w.bonusTo||"split",chores:choreCount(w),activeDed:w.deductions.filter(e=>e.status==="active").length};});
  const net=r2(parts.reduce((t,p)=>t+p.net,0));if(net>0)addSplit(net);const owed=net<0?q(-net):0;
  let bonus=0;for(const p of parts)if(p.bonus){bonus=r2(bonus+p.bonus);if(p.bonusTo==="split")addSplit(p.bonus);else ex[p.bonusTo]+=p.bonus;}
  const month=ymd().slice(0,7);const interestDue=ks.lastInterestMonth!==month&&ks.invest>0;const interest=interestDue?qd(calcInterest(ks.invest)):0;
  const dests=interestDests(ks).map(d=>d[0]),interestAlloc={};for(const [d,v] of Object.entries(alloc||defaultAlloc(ks,interest))){const n=r2(v);if(n>0&&dests.includes(d))interestAlloc[d]=n;}
  const allocTotal=r2(Object.values(interestAlloc).reduce((t,v)=>t+v,0));
  const allocOk=!interest||(Math.abs(allocTotal-interest)<0.005&&Object.values(interestAlloc).every(isQuarter));
  const goalInterest={};if(interest)for(const [d,v] of Object.entries(interestAlloc)){if(d==="spend"||d==="invest"||d==="give")ex[d]+=v;else goalInterest[d]=v;}
  const total=q(ex.spend+ex.save+ex.invest+ex.give);const storage={save:q(ex.save),invest:q(ex.invest),give:q(ex.give)};
  let cash=r2(total-storage.save-storage.invest-storage.give);if(cash<0){storage.save=r2(storage.save+cash);cash=0;}
  // The savings split comes from the newest week that set one.
  const splitW=[...parts].reverse().map(p=>p.w).find(w=>(w.saveSplit&&Object.keys(w.saveSplit).length)||w.saveTo)||parts[parts.length-1].w;
  const saveParts=splitCents(storage.save,saveSplitFor(splitW,ks));
  return {weeks,parts,net,bonus,owed,interestDue,interest,interestAlloc,allocTotal,allocOk,goalInterest,cash,storage,saveParts,
    chores:parts.reduce((t,p)=>t+p.chores,0),activeDed:parts.reduce((t,p)=>t+p.activeDed,0),goalHits:parts.filter(p=>p.met).length,earned:r2(parts.reduce((t,p)=>t+Math.max(0,p.net),0))};
}
function pCashout(){
  return (new Date().getDay()===0?"":`<p class="hint">It isn't Sunday yet. Cashing out now closes this week early.</p>`)+kidsSorted().filter(k=>!k.adult).map(k=>{
    const ks=kidState(k.id),weeks=cashWeeks(k.id);
    if(!weeks){const c=getWeek(k.id,mondayOf(new Date())).cashout;return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">Cashed out</span></div>${c?`<div class="handoff">Handed <b>${money(c.cash)}</b> in cash. Into storage: Save <b>${money(c.storage.save)}</b>, Invest <b>${money(c.storage.invest)}</b>, Give <b>${money(c.storage.give)}</b>.${c.owed?` Collected <b>${money(c.owed)}</b> from Spend.`:""}</div>`:""}</section>`;}
    const p=cashoutPlan(k.id,weeks,{}),multi=weeks.length>1,one=p.parts[0];
    return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">${multi?`${weeks.length} weeks in one lump`:`Week of ${shortDate(weeks[0])}`}</span></div>
    ${multi?`<p class="hint" style="margin:0 0 6px">Last week wasn't cashed out, so it's combined with this week. Each week's goal still counts on its own.</p>`:""}
    <dl class="kv">${multi?p.parts.map(x=>`<dt>Week of ${shortDate(x.wk)}</dt><dd>${money(x.net)}${x.goal?`, goal ${money(x.goal)} ${x.met?"reached":"missed"}`:", no goal"}</dd>`).join(""):""}
    <dt>Earned (after deductions)</dt><dd>${money(p.net)}</dd>${multi?"":`<dt>Goal</dt><dd>${one.goal?money(one.goal)+(one.met?" reached":" missed"):"None set"}</dd>`}
    ${p.bonus?`<dt>Bonus${multi?"":" ("+esc(destName(ks,one.bonusTo))+")"}</dt><dd>+${money(p.bonus)}</dd>`:""}
    ${p.interestDue?`<dt>Monthly interest</dt><dd>+${money(p.interest)}</dd>`:""}
    ${p.activeDed?`<dt>Open deductions becoming final</dt><dd>${p.activeDed}</dd>`:""}</dl>
    <div class="handoff">${p.owed?`Earnings came up short. Collect <b>${money(p.owed)}</b> from ${esc(k.name)}'s Spend cash.<br>`:""}Hand ${esc(k.name)} <b>${money(p.cash)}</b> in cash.<br>
      Into storage: Save <b>${money(p.storage.save)}</b> (${savePartsText(ks,p.saveParts)}), Invest <b>${money(p.storage.invest)}</b>, Give <b>${money(p.storage.give)}</b>.${p.interestDue?` Plus ${money(p.interest)} of interest, placed during cash-out.`:""}</div>
    <button class="btn block" style="margin-top:12px" data-act="co-start" data-kid="${k.id}" ${S.busy["co:"+k.id]?"disabled":""}>Start cash-out for ${esc(k.name)}${multi?` (${weeks.length} weeks)`:""}</button></section>`;}).join("");
}
/* ---------- cash-out walkthrough ---------- */
// Start cash-out opens this for one person. Each step is confirmed before the next; money only moves at the end.
function coSteps(p){const s=["earn"];if(p.parts.some(x=>x.goal)||p.bonus)s.push("goal");if(p.interestDue&&p.interest>0)s.push("interest");if(p.storage.save>0||Object.keys(p.goalInterest).length)s.push("save");s.push("hand");return s;}
const coLine=(label,val,cls="")=>`<div class="co-line ${cls}"><span>${label}</span><span>${val}</span></div>`;
const CO_TITLES={earn:"Earnings",goal:"Weekly goal",interest:"Interest",save:"Savings",hand:"Hand it over"};
function coHandoff(k,ks,p){const items=[],gi=Object.entries(p.goalInterest);
  if(p.owed)items.push(`Collect <b>${money(p.owed)}</b> from ${esc(k.name)}'s Spend cash (earnings came up short)`);
  if(p.cash>0)items.push(`Hand ${esc(k.name)} <b>${money(p.cash)}</b> in cash`);
  const save=r2(p.storage.save+gi.reduce((t,[,v])=>t+v,0));
  if(save>0)items.push(`Put <b>${money(save)}</b> in the Save jar <small>(${[savePartsText(ks,p.saveParts)+(p.storage.save>0?` ${money(p.storage.save)}`:""),...gi.map(([id,v])=>`interest to ${esc(goalName(ks,id))} ${money(v)}`)].filter((x,i)=>i>0||p.storage.save>0).join(", ")})</small>`);
  if(p.storage.invest>0)items.push(`Put <b>${money(p.storage.invest)}</b> in the Invest jar`);
  if(p.storage.give>0)items.push(`Put <b>${money(p.storage.give)}</b> in the Give jar`);
  return items;}
function cashoutWizard(){const c=S.ui.co,k=kidCfg(c.kid),weeks=k&&cashWeeks(c.kid);
  if(!weeks)return `<div class="focus co" role="dialog" aria-modal="true"><div class="fx-top"><button class="btn ghost small" data-act="co-close">Close</button></div><h2>All done</h2><p class="sub">${k?esc(k.name)+" is":"They're"} cashed out.</p><button class="btn block" data-act="co-close">Close</button></div>`;
  const ks=kidState(c.kid),p=cashoutPlan(c.kid,weeks,c.alloc),steps=coSteps(p);c.step=Math.max(0,Math.min(c.step,steps.length-1));const st=steps[c.step],busy=S.busy["co:"+c.kid];
  let body="",ready=true;
  if(st==="earn"){
    body=`<div class="co-lines">${p.parts.map(x=>{const w=x.w,ded=(w.deductions||[]).filter(d=>d.status==="active"||d.status==="final"),gross=r2(x.net+ded.reduce((t,d)=>t+(d.amount||0),0));
      return `${weeks.length>1?`<h3>Week of ${shortDate(x.wk)}</h3>`:""}${coLine(`${x.chores} chore${x.chores===1?"":"s"}`,money(gross))}${ded.map(d=>coLine(`Deduction: ${esc(d.reason||"")}${d.status==="active"?" <small>(becomes final)</small>":""}`,"−"+money(d.amount),"neg")).join("")}`;}).join("")}
      ${coLine("<b>Earned</b>",`<b>${money(p.net)}</b>`,"total")}</div>
      ${p.owed?`<p class="hint">Earnings came up short, so ${esc(k.name)} owes ${money(p.owed)} from their Spend cash. That's collected in the last step.</p>`:""}
      ${weeks.length>1?`<p class="hint">Last week wasn't cashed out, so both weeks settle together. Each week's goal still counts on its own.</p>`:""}
      ${new Date().getDay()===0?"":`<p class="hint">It isn't Sunday yet. Cashing out now closes this week early.</p>`}`;}
  else if(st==="goal"){
    body=`<div class="co-lines">${p.parts.map(x=>`${weeks.length>1?`<h3>Week of ${shortDate(x.wk)}</h3>`:""}${coLine(x.goal?`Goal ${money(x.goal)}, earned ${money(x.net)}`:"No goal set",x.goal?(x.met?"✅ Reached":"Missed"):"")}${x.bonus?coLine(`Bonus (25% of the goal) to ${esc(destName(ks,x.bonusTo))}`,"+"+money(x.bonus)):""}`).join("")}</div>
      ${p.bonus?"":`<p class="hint">No bonus this time.</p>`}`;}
  else if(st==="interest"){const left=r2(p.interest-p.allocTotal),bad=Object.values(p.interestAlloc).some(v=>!isQuarter(v));ready=p.allocOk;
    body=`<p class="co-big">Invest earned <b>${money(p.interest)}</b> this month</p><p class="hint">On ${money(ks.invest)} in Invest, rounded down to the nearest quarter. Decide together where it goes. You can split it.</p>
      <div class="co-alloc">${interestDests(ks).map(([d,label])=>{const v=(c.alloc||{})[d];return `<label class="co-arow"><span>${esc(label)}</span><input type="number" min="0" step="0.25" inputmode="decimal" data-type="num" data-bind="co.alloc.${d}" value="${esc(v??"")}" placeholder="0"><button class="btn ghost small" data-act="co-rest" data-dest="${d}" type="button">${left>0?"+ the rest":"All"}</button></label>`;}).join("")}</div>
      <p class="co-left ${ready?"ok":""}">${ready?"✅ All of it is placed.":left>0?`${money(left)} left to place`:left<0?`${money(-left)} too much`:bad?"Use quarters ($0.25 steps)":""}${!ready&&bad&&left===0?"":""}</p>`;}
  else if(st==="save"){const gi=Object.entries(p.goalInterest);
    body=`<div class="co-lines">${p.storage.save>0?`${coLine("Savings from earnings",money(p.storage.save))}${Object.entries(p.saveParts).map(([id,v])=>coLine(`→ ${esc(goalName(ks,id))}`,money(v),"sub")).join("")}`:""}
      ${gi.map(([id,v])=>coLine(`Interest → ${esc(goalName(ks,id))}`,money(v))).join("")}</div>
      <p class="hint">${esc(k.name)} sets how savings split between goals on their own screen (Save card).</p>`;}
  else{const items=coHandoff(k,ks,p);c.checks=c.checks||{};
    body=items.length?`<div class="checks">${items.map((t,i)=>{const on=!!c.checks[i];return `<button class="check ${on?"on":""}" data-act="co-check" data-i="${i}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span class="co-hand">${t}</span></button>`;}).join("")}</div>`:`<p class="sub">Nothing to hand over this time.</p>`;
    ready=items.every((_,i)=>c.checks[i]);}
  const last=c.step===steps.length-1;
  return `<div class="focus co" role="dialog" aria-modal="true" aria-labelledby="co-title"><div class="fx-top"><button class="btn ghost small" data-act="co-close">Cancel</button><span class="pill">💵 Cash-out: ${esc(k.name)}</span></div>
    <div class="co-dots" aria-label="Step ${c.step+1} of ${steps.length}">${steps.map((x,i)=>`<span class="${i<c.step?"done":i===c.step?"on":""}">${i<c.step?"✓":i+1}</span>`).join("")}</div>
    <h2 id="co-title">${CO_TITLES[st]}</h2><div class="co-body">${body}</div>
    <div class="row co-nav">${c.step?`<button class="btn ghost" data-act="co-back">Back</button>`:""}<button class="btn" data-act="${last?"co-finish":"co-next"}" ${!ready||busy?"disabled":""}>${busy?"Saving…":last?"✓ Finish cash-out":"✓ Looks right"}</button></div></div>`;}
function pGoals(){
  return kidsSorted().map(k=>{const ks=kidState(k.id),b=S.ui.buy,pg=S.ui.pgoal[k.id]||(S.ui.pgoal[k.id]={name:"",target:""});
    return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">${k.adult?"Savings goals only (grown-ups aren't paid)":`Invest ${money(ks.invest)}, Give ${money(ks.give)}`}</span></div>
    ${ks.goals.map(g=>{const eg=S.ui.editGoal;if(eg&&eg.kid===k.id&&eg.goal===g.id)return `<div class="flag-row"><span class="row" style="flex:1"><label style="flex:2 1 140px">Name<input aria-label="Goal name" data-bind="editGoal.name" value="${esc(eg.name)}"></label><label style="flex:1 1 90px">Amount<input type="number" step="0.25" min="0.25" inputmode="decimal" aria-label="Goal amount" data-bind="editGoal.target" data-type="num" value="${esc(eg.target)}"></label><button class="btn small" data-act="save-goal">Save</button><button class="btn ghost small" data-act="cancel-edit-goal">Cancel</button></span></div>`;
      return `<div class="flag-row"><span><b>${esc(g.name)}</b><br><small>${money(g.balance)}${g.target?" of "+money(g.target):""}</small></span>
      ${b&&b.kid===k.id&&b.goal===g.id?`<span class="row" style="flex:0 1 260px"><input type="number" step="0.25" inputmode="decimal" aria-label="Purchase amount" data-bind="buy.amount" data-type="num" value="${esc(b.amount)}"><button class="btn small" data-act="confirm-buy">Log</button><button class="btn ghost small" data-act="cancel-buy">Cancel</button></span>`
      :`<span class="row" style="flex:0 0 auto;gap:6px">${g.id==="general"?"":`<button class="btn ghost small" data-act="edit-goal" data-kid="${k.id}" data-goal="${g.id}">Edit</button><button class="btn ghost small" data-act="del-goal" data-kid="${k.id}" data-goal="${g.id}">Delete</button>`}<button class="btn ghost small" data-act="buy-goal" data-kid="${k.id}" data-goal="${g.id}" ${g.balance>0?"":"disabled"}>Log purchase</button></span>`}</div>`;}).join("")}
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
    ${k.adult?"":`<h4>Invest</h4><div class="grid-2">${field("Invest balance","adjust.invest",a.invest)}</div>
    <h4>Give</h4><div class="grid-2">${field("Give balance","adjust.give",a.give)}</div>`}
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
function startDraft(from){const c=clone(from||cfg());c.kids.forEach(k=>k.remindStr=(k.remind||[]).join(", "));c.chores.forEach(ch=>{ch.ask=needsNote(ch);ch.stepsText=(ch.steps||[]).join("\n");if(ch.kind==="family"){ch.familyLimit=ch.familyLimit>0?ch.familyLimit:0;ch.weekLimit=ch.weekLimit>0?ch.weekLimit:0;}});c.game=clone(G.gameCfg(c));S.ui.draft=c;S.ui.draftClean=JSON.stringify(c);}
const draftDirty=()=>!!S.ui.draft&&JSON.stringify(S.ui.draft)!==S.ui.draftClean;
// When the config changes underneath an untouched settings form, show the new values instead of stale ones.
function refreshCleanDraft(){if(S.role==="parent"&&S.ptab==="settings"&&S.ui.draft&&S.config&&!draftDirty()){startDraft();render();}}
/* ---------- Settings guide: battle modes and levels ---------- */
// One collapsible row. `extra` goes before the row's button (the mode on/off tick).
function gRow(id,head,sub,body,extra=""){const o=!!S.ui.guide[id];return `<div class="g-row ${o?"open":""}"><div class="g-head">${extra}<button type="button" class="g-open" data-act="guide" data-id="${id}" aria-expanded="${o}"><span class="g-text"><b>${head}</b>${sub?`<small>${sub}</small>`:""}</span><span class="chev" aria-hidden="true">›</span></button></div>${o?`<div class="g-body">${body}</div>`:""}</div>`;}
function modeGuide(){const X=G.XP,std=`Win ${X.win} XP, tie ${X.tie}, and ${X.loss} for taking part and losing. Nobody does a chore, nobody gets XP.`;return {
  race:{how:"You pick a finish line of 2 to 6 chores. Any family chore counts as one. The first to cross wins. If nobody crosses by midnight, whoever did the most wins, and an equal count is a tie.",xp:std,notes:"The handicap multiplies each chore, so a younger kid may need fewer chores to cross the line. The race ends at midnight."},
  timetrial:{how:"Both do the same chore against the clock. Tap Start, do the chore, tap Done: that logs the chore for real. A parent then marks each run Done well or Not good enough in the Game tab. The fastest run done well wins; within a second is a tie.",xp:`${std} A run that fails the check earns nothing.`,notes:"Times are divided by the handicap. Runs over 2 hours don't count, and unchecked runs become no contest after 48 hours. Because Done logs the chore, it pays money and normal chore XP too, and it counts toward the chore's maxes."},
  ghost:{how:"A solo race against your own best time on a chore. Start, do it, tap Done, and a parent checks the work.",xp:`Beat your best: ${X.win} XP. Your first run sets the record: ${X.ghostRecord} XP. Slower than your best: ${X.loss} XP.`,notes:"Only runs done well count. Your best time is remembered per chore, so the ghost keeps getting faster."},
  blitz:{how:"Most chore XP in a window: 30 minutes, 1 hour, or until midnight. Every chore counts its normal XP (${G.XP.chore} × its pay multiplier), so bigger chores score more.",xp:std,notes:"The handicap multiplies the score. The window never runs past midnight."},
  bingo:{how:"Both get the same 3×3 card of family chores (chores repeat when there are fewer than 9). Each chore done marks a square. The first to complete a row, column, or diagonal wins. If nobody does by midnight, the most squares wins.",xp:std,notes:"Instead of a handicap, the younger player starts with the center square free, plus one corner when they are 4 or more years younger."},
  territory:{how:"Kids only. A full-screen map of 13 countries. Each player starts with a castle, with neutral countries in between. Tap a country next to yours to reveal its chore (an Anyone chore), do it, and the country turns your color. You have to finish it before revealing another, or give it up (then it's locked for you). The most countries when time runs out wins, or sooner if the other side can't catch up.",xp:std,notes:"The handicap multiplies the score. Only chores done from the map claim countries. If a parent reverses a chore, its country goes back to neutral."},
  judge:{how:"Both do the same chore. In the Game tab a parent picks the better job. If only one person did it, they win.",xp:std,notes:"No handicap here: the judge decides. The chore itself pays money and normal XP as usual."},
  streakduel:{how:"Starts at midnight and lasts up to 14 days. Whoever misses their daily checklist first loses. If both keep it up the whole time, it's a tie.",xp:`Double, because it runs for days: win ${X.win*2} XP, tie ${X.tie*2}, lose ${X.loss*2}.`,notes:`It's decided from the daily list records, so there is nothing to confirm. Keeping the list also grows your streak and pays the streak milestones (${G.STREAK_MILESTONES[3]} XP at 3 days up to ${G.STREAK_MILESTONES[100]} at 100).`},
  showdown:{how:"Runs through the week and is decided at Sunday's cash-out. The winner is whoever earned the biggest share of their weekly goal. A tiny goal can't win: the share is measured against at least your recent average.",xp:`Double, because it runs for days: win ${X.win*2} XP, tie ${X.tie*2}, lose ${X.loss*2}.`,notes:`Decided from the week's records, nothing to confirm. Reaching the goal also pays the goal bonus and ${X.goal} XP.`},
  raid:{how:"2 to 4 people team up for 1 to 3 days. The boss has 60 HP per member per day, and every chore deals its XP as damage. Beat the boss before time runs out.",xp:`Win ${X.raidWin} XP each; teammates who did no chore get nothing. If the boss gets away, ${X.loss} XP each.`,notes:`Bosses come in order: ${G.BOSSES.map(b=>b[1]+" "+b[2]).join(", ")}. Each boss beaten makes the next one 25% tougher, and bosses beaten count for the whole family.`},
  babyraid:{how:"A tiny one-day boss. Go solo or bring up to 3 teammates. It has 15 HP per member, about a chore and a half each, and it never gets harder.",xp:`Win ${X.babyRaidWin} XP each, ${X.loss} if it gets away.`,notes:`Bosses: ${G.BABY_BOSSES.map(b=>b[1]+" "+b[2]).join(", ")}. Made for younger kids and quick team-ups.`},
  grownups:{how:"The kids team up against the adults for 30 minutes, an hour, or until midnight. The team with the most chore XP wins.",xp:`Win ${X.win} XP each (teammates who did no chore get nothing), tie ${X.tie}, lose ${X.loss}.`,notes:"The kids' team gets one handicap from the age gap between the teams' averages."},
  dishduel:{how:"Two (or more) of you wash dishes from the same pile at the same time, each counting the dishes you wash. When you're done, each of you types your count on your own tablet. Nobody sees the other counts until everyone's is in, and then the app names the winner right away.",xp:`${std}, plus ${G.XP.rushItem} XP for each dish (up to ${G.RUSH_XP_CAP})`,notes:"The handicap multiplies the count. It doesn't log a chore or pay money, so log the dishes chore as usual too."},
  doom:{how:"You pick an Anyone chore. Before starting the timer, each player spins the Wheel of Doom once (no re-spins) and has to do the chore with what it lands on, like one hand only, T-rex arms, or nonstop singing. 😇 Mercy means no doom; 💀 Double doom means two. The fastest run done well wins, and a parent checks each run, doom included.",xp:std,notes:"The handicap divides the time, like Time Trial. A run that didn't follow its doom should be marked Not good enough."},
  roomrush:{how:"Pick a room and 1, 2, or 3 minutes. Each player taps Start whenever they're ready, cleans up as many things as they can before the countdown ends, counting in their head, then types in their total. Most things cleaned up wins. The other player confirms the result (or asks a parent).",xp:`${std}, plus ${G.XP.rushItem} XP for each thing cleaned up (up to ${G.RUSH_XP_CAP})`,notes:"The handicap multiplies the count. It doesn't log a chore or earn money. It's just for XP and bragging rights."},
  wildcard:{how:"Picks Blitz, Territory, or Chore Bingo at random and adds a twist: one chore counts double.",xp:"The same as the mode it picks.",notes:"The twist chore is shown when the battle starts."},
};}
function battlesGeneral(b){const X=G.XP,hm=t=>{const [h,m]=String(t||"").split(":").map(Number);return isNaN(h)?"":new Date(2000,0,1,h,m||0).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});};const pct=b.handicapPct??Math.round(b.handicapPerYear*100);
  return `<p><b>Starting one.</b> Someone challenges from their screen and the other side taps Accept. No battle starts in quiet hours (${hm(b.quietStart)} to ${hm(b.quietEnd)}), and each person can join at most ${b.dailyCap} a day${b.weeklyCap>0?` and ${b.weeklyCap} a week`:""}. Open a mode to give it its own daily or weekly limit. Declined, expired, and called-off battles don't count.</p>
  <p><b>Fair fights.</b> Younger players get a handicap: their score is multiplied by ${pct}% per year of age difference, up to ×${b.handicapMax}. Adults count as ${b.adultAge}. Chore Bingo gives free squares instead.</p>
  <p><b>XP, never money.</b> A win pays ${X.win} XP, a tie ${X.tie}, and taking part ${X.loss}. Streak Duel and Goal Showdown pay double because they run for days. Boss Raid pays ${X.raidWin} each for a win (Baby Boss Raid ${X.babyRaidWin}).</p>
  <p><b>Confirming.</b> Speed results become final when the other side or a parent confirms them, or on their own after 12 hours. Disputed results wait for a parent in the Game tab. Time Trial and Ghost Race need a parent's quality check within 48 hours.</p>
  <p><b>What carries over.</b> Chores done during a battle still pay money and their normal XP (battle XP is on top), and they still count toward daily and weekly maxes. Wins count toward the First victory, 10 wins, and Battle master badges, the Giant slayer badge for beating someone older, the Battle Champ title at 10 wins, and the Win a battle quest.</p>`;}
function levelsCard(d){const g=d.game,mp=g.moneyPerks,X=G.XP,rows=[];const qx=G.QUESTS.map(q=>q.xp);
  for(let L=1;L<=G.MAX_LEVEL;L++){const prev=L>1?G.unlockedIds(L-1):[],un=G.describeUnlocks(G.unlockedIds(L).filter(i=>!prev.includes(i)));const items=[],icons=[];const add=(i,n,k)=>{items.push(`<li>${i} <b>${esc(n)}</b> <small>${esc(k)}</small></li>`);icons.push(i);};
    for(const u of un)add(u[0],u[1],u[2]);
    if(L>1&&G.freezeLevels(L-1,L))add("🧊","Streak freeze",`Saves the streak on a missed day (up to ${G.FREEZE_CAP} in hand)`);
    for(const r of g.rewards)if(r.name&&(Number(r.level)===L||(Number(r.repeat)>0&&L>Number(r.level)&&(L-Number(r.level))%Number(r.repeat)===0)))add("🎁",r.name,"Your reward: they claim it from their screen, you approve it in the Game tab");
    if(mp.enabled&&L>1&&L%Math.max(1,Math.round(Number(mp.everyLevels)||1))===0)add("💵","Raise suggested",`+${money(mp.amount)} per chore, once you tap Give raise in the Game tab`);
    const start=G.levelStart(L),sub=L===1?`Where everyone starts: ${G.STARTERS.length} creatures to pick from, the Rookie title, and the first battle modes`:`+${G.xpToNext(L-1)} XP from level ${L-1} · ${items.length?`${items.length} new: ${[...new Set(icons)].join(" ")}`:"nothing new, just bragging rights"}`;
    rows.push(gRow("l:"+L,`Level ${L} <span class="pill">${L===1?"0 XP":start+" XP"}</span>`,sub,`<ul>${items.join("")||"<li>Nothing new at this level.</li>"}</ul>`));}
  const all=!!S.ui.guide["l:all"];
  return `<section class="card"><div class="sec-head"><h2>Levels</h2><button class="btn ghost small" data-act="guide-all" data-kind="l" data-open="${all?"0":"1"}">${all?"Collapse all":"Expand all"}</button></div>
    <p class="hint" style="margin:0 0 8px">XP comes from chores (${X.chore} × the pay multiplier; Chore of the Day doubles it), the daily checklist (${X.checklist} a day plus streak milestones), a weekly goal (${X.goal}), earning back a deduction (${X.redeem}), buying a savings goal (${X.savingsGoal}), badges (${X.badge} each), quests (${Math.min(...qx)} to ${Math.max(...qx)}), and battles. Each level needs more XP than the last (${G.xpToNext(1)} for level 2, ${G.xpToNext(G.MAX_LEVEL-1)} for level ${G.MAX_LEVEL}). XP only goes down when a chore is reversed. Tap a level for what it unlocks.</p>
    <div class="guide">${rows.join("")}</div></section>`;}
function gameSettings(d){const g=d.game,b=g.battles;const chk=(path,on,label)=>`<label class="check-label"><input type="checkbox" data-bind="draft.game.${path}" ${on?"checked":""}> ${label}</label>`;
  return `<section class="card"><div class="sec-head"><h2>Game</h2></div>
    <div class="grid-2">${chk("quests.enabled",g.quests.enabled,"Weekly quests")}${chk("choreOfDay.enabled",g.choreOfDay.enabled,"Chore of the Day (double XP)")}${chk("streakMultiplier.enabled",g.streakMultiplier.enabled,`Streak bonus (×${g.streakMultiplier.mult} XP at ${g.streakMultiplier.minStreak}+ days)`)}${chk("battles.enabled",b.enabled,"Battles")}${chk("adultsUnlockAll",g.adultsUnlockAll,"Grown-ups skip level locks (every creature, item, and battle mode)")}${chk("adultsSoloAll",g.adultsSoloAll,"Grown-ups can play any battle mode solo")}</div>
    <h3 style="margin-top:14px">Battle modes</h3><p class="hint" style="margin:2px 0 4px">Tick a mode to allow it. Tap one to see how it works.</p>
    <div class="guide">${gRow("m:all","How battles work","Challenges, handicaps, XP, confirming, and what carries over",battlesGeneral(b))}${G.ACTIVE_MODES.map(m=>{const t=modeGuide()[m.id]||{};const ml=(b.modeLimits||{})[m.id]||{};const limTxt=[ml.day>0?`${ml.day} a day`:"",ml.week>0?`${ml.week} a week`:""].filter(Boolean).join(", ");
      return gRow("m:"+m.id,`${m.emoji} ${esc(m.name)} <span class="pill">Level ${m.level}</span>${limTxt?` <span class="pill">Max ${limTxt}</span>`:""}`,esc(m.desc),`<p><b>How it works.</b> ${t.how||""}</p><p><b>XP.</b> ${t.xp||""}</p>${t.notes?`<p><b>Good to know.</b> ${t.notes}</p>`:""}
      <div class="row" style="margin-top:8px"><label>Max per person per day<input type="number" min="0" step="1" data-type="num" data-bind="draft.game.battles.modeLimits.${m.id}.day" value="${esc(ml.day||"")}" placeholder="No limit"></label><label>Max per person per week<input type="number" min="0" step="1" data-type="num" data-bind="draft.game.battles.modeLimits.${m.id}.week" value="${esc(ml.week||"")}" placeholder="No limit"></label>
      ${G.TIMEBOX_MODES.includes(m.id)?(()=>{const dv=G.timeLimit({game:{battles:b}},m.id),opts=[...new Set([...G.TIME_CHOICES,dv])].sort((x,y)=>(x||1e9)-(y||1e9));return `<label>Default time limit<select data-bind="draft.game.battles.modeTimes.${m.id}">${opts.map(v=>`<option value="${v}" ${v===dv?"selected":""}>${v?G.timeText(v):"Until midnight"}</option>`).join("")}</select></label>`;})():""}</div>`,`<label class="g-on"><input type="checkbox" data-act="toggle-mode" data-id="${m.id}" ${(b.modesOff||[]).includes(m.id)?"":"checked"} aria-label="Allow ${esc(m.name)}" title="Allow ${esc(m.name)}"></label>`);}).join("")}</div>
    <div class="grid-2" style="margin-top:12px">
    <label>No battles from<input type="time" data-bind="draft.game.battles.quietStart" value="${esc(b.quietStart)}"></label>
    <label>Until<input type="time" data-bind="draft.game.battles.quietEnd" value="${esc(b.quietEnd)}"></label>
    <label>Battles per person per day<input type="number" min="1" step="1" data-type="num" data-bind="draft.game.battles.dailyCap" value="${esc(b.dailyCap)}"></label>
    <label>Battles per person per week (0 = no limit)<input type="number" min="0" step="1" data-type="num" data-bind="draft.game.battles.weeklyCap" value="${esc(b.weeklyCap||0)}"></label>
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
  // One compact row per chore; tap it to open the full editor underneath (one at a time).
  const who=id=>id==="pool"?"Anyone":((d.kids.find(k=>k.id===id)||{}).name||"Someone");
  const facts=c=>(c.kind==="pr"?[c.note||"",c.ask?"asks what it was":""]:[`pays ×${c.mult||1}`,`each ${c.limit||1} a day`,c.familyLimit>0?`family ${c.familyLimit} a day`:"",c.weekLimit>0?`family ${c.weekLimit} a week`:"",who(c.assign),c.ask?"asks what it was":""]).filter(Boolean).map(esc).join(" · ");
  const choreRow=(c,i)=>{const ed=S.ui.editChore===c.id;return `<div class="set-row ${ed?"editing":""}" data-drag="chore" data-kind="${c.kind}" data-i="${i}"><div class="set-head"><span class="drag-handle" data-handle role="button" aria-label="Drag to reorder" title="Drag to reorder">⠿</span><button type="button" class="set-open" data-act="edit-chore" data-id="${c.id}" aria-expanded="${ed}"><span><b>${icon(c)}${esc(String(c.name||"").trim())||"(no name)"}</b><small>${facts(c)}</small></span><span class="chev" aria-hidden="true">›</span></button></div>
    ${ed?`<div class="set-edit"><div class="row"><label>${c.kind==="pr"?"Item":"Chore"}<input data-bind="draft.chores.${i}.name" value="${esc(c.name)}"></label><label class="chk"><input type="checkbox" data-bind="draft.chores.${i}.ask" ${c.ask?"checked":""}>Ask what it was</label>
    ${c.kind==="pr"?`<label>Details<input data-bind="draft.chores.${i}.note" value="${esc(c.note||"")}"></label>`:`<label>Pays (× base rate)<input type="number" step="0.5" min="0" data-type="num" data-bind="draft.chores.${i}.mult" value="${esc(c.mult)}"></label>
    <label>Max per person per day<input type="number" step="1" min="1" data-type="num" data-bind="draft.chores.${i}.limit" value="${esc(c.limit)}"></label>
    <label>Max per family per day<input type="number" step="1" min="0" data-type="num" data-bind="draft.chores.${i}.familyLimit" value="${c.familyLimit>0?esc(c.familyLimit):""}" placeholder="No limit"></label>
    <label>Max per family per week<input type="number" step="1" min="0" data-type="num" data-bind="draft.chores.${i}.weekLimit" value="${c.weekLimit>0?esc(c.weekLimit):""}" placeholder="No limit"></label>
    <label>Who<select data-bind="draft.chores.${i}.assign"><option value="pool" ${c.assign==="pool"?"selected":""}>Anyone</option>${d.kids.map(k=>`<option value="${k.id}" ${c.assign===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>`}</div>
    <div class="row" style="margin-top:10px"><label>Steps for full-screen mode (one per line)<textarea rows="4" data-bind="draft.chores.${i}.stepsText" placeholder="Mirror&#10;Sink&#10;Toilet&#10;Floor">${esc(c.stepsText||"")}</textarea></label>
      <label style="flex:0 1 150px">Goal time (minutes)<input type="number" min="0" max="240" step="1" data-type="num" data-bind="draft.chores.${i}.targetMin" value="${c.targetMin>0?esc(c.targetMin):""}" placeholder="None"></label></div>
    <div class="icon-pick"><span class="sub">Icon</span>${["",...G.CHORE_ICON_CHOICES].map(e=>{const on=(c.icon||"")===e;return `<button type="button" class="${on?"on":""}" data-act="chore-icon" data-i="${i}" data-icon="${e}" aria-pressed="${on}" title="${e?"":"Pick from the name"}">${e||`Auto ${esc(G.choreIcon({...c,icon:""}))}`}</button>`;}).join("")}
      <label style="flex:0 1 120px">Or type one<input maxlength="8" data-bind="draft.chores.${i}.icon" value="${esc(c.icon||"")}" placeholder="🙂"></label></div>
    <div class="row set-foot"><button class="btn small" data-act="edit-chore" data-id="${c.id}">Done</button><button class="btn ghost small" data-act="rm-chore" data-i="${i}">Remove</button></div></div>`:""}</div>`;};
  return pDevices()+`<section class="card"><div class="sec-head"><h2>People</h2><button class="btn ghost small" data-act="add-kid">Add person</button></div>
    <div class="people"><div class="p-head"><span>Name</span><span title="A grown-up gets their own lane and tab instead of a place in the kid list">Adult</span><span>Age</span><span title="What one chore pays before its multiplier">Rate $</span><span>Reminders</span><span></span></div>
    ${d.kids.map((k,i)=>`<div class="p-row"><input data-bind="draft.kids.${i}.name" value="${esc(k.name)}" aria-label="Name"><input type="checkbox" data-bind="draft.kids.${i}.adult" ${k.adult?"checked":""} aria-label="Adult" title="A grown-up gets their own lane and tab instead of a place in the kid list">${k.adult?`<span class="p-na" aria-hidden="true">–</span>`:`<input type="number" data-type="num" data-bind="draft.kids.${i}.age" value="${esc(k.age)}" aria-label="Age">`}<input type="number" step="0.05" data-type="num" data-bind="draft.kids.${i}.rate" value="${esc(k.rate)}" aria-label="Base rate per chore"><input data-bind="draft.kids.${i}.remindStr" value="${esc(k.remindStr)}" placeholder="15:30, 19:30" aria-label="Reminder times"><button class="btn ghost small p-rm" data-act="rm-kid" data-i="${i}" aria-label="Remove ${esc(k.name)}" title="Remove">×</button>${k.adult?`<label class="p-email">Google email<input type="email" data-bind="draft.kids.${i}.email" value="${esc(k.email||"")}" placeholder="Their parent sign-in"></label>`:""}</div>`).join("")}</div>
    <p class="hint">Rate is what one chore pays before its multiplier. Reminders are times like 15:30, 19:30.</p></section>
  <section class="card"><div class="sec-head"><h2>Family chores (paid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="family">Add chore</button></div><p class="hint drag-hint">Tap a chore to edit it. Drag the ⠿ handle to change the order kids see.</p>${d.chores.map((c,i)=>c.kind==="family"?choreRow(c,i):"").join("")}</section>
  <section class="card"><div class="sec-head"><h2>Personal responsibility (unpaid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="pr">Add item</button></div><p class="hint drag-hint">Tap an item to edit it. Drag the ⠿ handle to change the order kids see.</p>${d.chores.map((c,i)=>c.kind==="pr"?choreRow(c,i):"").join("")}</section>
  ${gameSettings(d)}
  ${levelsCard(d)}
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
async function doChore(kidId,choreId,note,ms){
  const k=kidCfg(kidId),ch=choreById(choreId),today=ymd();if(!k||!ch)return;
  {const r=limitState(k.id,ch,today).reason;if(r){toast(LIMIT_MSG[r]);return;}}
  const wk=activeWeek(k.id),w=getWeek(k.id,wk),before=weekNet(w),amt=choreValue(k,ch);
  S.busy["c:"+choreId]=true;render();
  try{await call("completeChore")({kidId,choreId,note:note||"",ms:ms||0});
    if(w.goal&&before<w.goal&&before+amt>=w.goal){confetti(260);chime(true);toast("Goal reached! Bonus locked in.");}else{confetti(50);chime(false);toast(`+${money(amt)} and +${choreXpFor(k.id,ch)} XP for ${ch.name.toLowerCase()}`);}}
  catch(e){toast(errMsg(e));}
  finally{delete S.busy["c:"+choreId];render();}
}
async function doCashout(kidId,alloc){
  const weeks=cashWeeks(kidId);if(!weeks)return false;const p=cashoutPlan(kidId,weeks,alloc);const k=kidCfg(kidId);
  if(!p.allocOk){toast(`Split all ${money(p.interest)} of interest first.`);return false;}
  let ok=false;
  const month=ymd().slice(0,7);S.busy["co:"+kidId]=true;render();
  try{await runTransaction(db,async t=>{
    const refs=weeks.map(wk=>weekRef(kidId,wk)),bref=doc(db,"bank",kidId);const snaps=[];for(const r of refs)snaps.push(await t.get(r));const bs=await t.get(bref);
    const ws=snaps.map((sn,i)=>Object.assign({kidId,week:weeks[i],entries:[],deductions:[]},sn.exists()?sn.data():{}));if(ws.some(w=>w.closed))throw new Error("One of those weeks is already cashed out.");
    const b=Object.assign({goalBal:{},invest:0,give:0,archived:[],stats:{}},bs.exists()?bs.data():{});
    const addGoal=(id,amt)=>{if(amt)b.goalBal[id]=r2((b.goalBal[id]||0)+amt);};
    for(const id in p.saveParts)addGoal(id,p.saveParts[id]);b.invest=r2((b.invest||0)+p.storage.invest);b.give=r2((b.give||0)+p.storage.give);
    if(p.interestDue){b.lastInterestMonth=month;for(const id in p.goalInterest)addGoal(id,p.goalInterest[id]);}
    b.stats.chores=(b.stats.chores||0)+p.chores;b.stats.goalHits=(b.stats.goalHits||0)+p.goalHits;b.stats.earned=r2((b.stats.earned||0)+p.earned+p.bonus);
    const at=Date.now(),last=ws.length-1;
    ws.forEach((w,i)=>{const x=p.parts[i],final=i===last;w.closed=true;
      w.cashout={at,by:parentName(),weeks,net:x.net,goal:x.goal,met:x.met,bonus:x.bonus,interest:final?p.interest:0,cash:final?p.cash:0,owed:final?p.owed:0,storage:final?p.storage:{save:0,invest:0,give:0},saveParts:final?p.saveParts:{},goalInterest:final?p.goalInterest:{},interestAlloc:final?p.interestAlloc:{},combinedInto:final?null:weeks[last]};
      w.deductions=w.deductions.map(d=>d.status==="active"?{...d,status:"final"}:d);t.set(refs[i],w);});
    t.set(bref,b);});ok=true;toast(`${k.name} is cashed out.`);}
  catch(e){toast("Couldn't cash out: "+errMsg(e));}
  finally{delete S.busy["co:"+kidId];render();}
  return ok;
}
async function enablePush(silent){
  try{const m=await messaging();if(!m){if(!silent)toast("This device can't get reminders.");return;}
    if(!silent){const p=await Notification.requestPermission();if(p!=="granted"){render();return;}}
    const reg=await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token=await getToken(m,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
    if(token&&S.role==="parent"){await setDoc(doc(db,"parentTokens",S.user.uid),{fcmToken:token,email:S.user.email||"",at:Date.now()},{merge:true});S.ui.parentPushOn=true;if(!silent)toast("Notifications are on for this phone.");render();return;}
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
  case "all-badges": S.ui.allBadges=!S.ui.allBadges;break;
  case "equip": if(ds.slot==="creature")guard(setDoc(doc(db,"prefs",kid),{creature:ds.id},{merge:true}));
    else guard(setDoc(doc(db,"prefs",kid),{equipped:{[ds.slot]:ds.id}},{merge:true}));break;
  case "lu-ok": try{localStorage.setItem(seenKey(S.ui.levelUp.kid),String(S.ui.levelUp.at));}catch(e){} S.ui.levelUp=null;break;
  case "freeze-ok": try{localStorage.setItem("boon.freezeSeen."+kid,String(ds.at));}catch(e){} break;
  case "bb-open":{const pool=bbChores(kid,"timetrial")[0];S.ui.bb={kid,mode:"roomrush",opponent:"",team:[],opponents:[],n:"3",windowMin:String(G.timeLimit(cfg(),"roomrush")),customMin:"",days:"1",choreId:pool?pool.id:"",room:G.ROOMS[0],roomCustom:"",minutes:"2"};break;}
  case "bb-pick":{const bb=S.ui.bb;if(ds.multi){const l=new Set(bb[ds.key]||[]);if(l.has(ds.id))l.delete(ds.id);else l.add(ds.id);bb[ds.key]=[...l];}else bb[ds.key]=ds.id;break;}
  case "bb-close": S.ui.bb=null;break;
  case "bb-mode":{const bb=S.ui.bb;bb.mode=ds.id;bb.windowMin=String(G.timeLimit(cfg(),ds.id));bb.customMin="";if((G.TIMED.includes(ds.id)||ds.id==="judge")&&!bbChores(kid,ds.id).some(c=>c.id===bb.choreId)){const c=bbChores(kid,ds.id)[0];bb.choreId=c?c.id:"";}break;}

  case "bb-send":{const bb=S.ui.bb,m=G.modeById(bb.mode);const me=kidCfg(kid),soloOk=G.canSolo(cfg(),me,bb.mode);
    const solo=soloOk&&(bb.opponent==="__solo"||(bb.mode==="raid"&&!(bb.team||[]).length));
    const r=await bcall("createBattle",{mode:bb.mode,solo,opponent:bb.opponent==="__solo"?"":bb.opponent,team:bb.team,opponents:bb.opponents,n:Number(bb.n),windowMin:bb.windowMin==="custom"||!G.TIME_CHOICES.map(String).includes(String(bb.windowMin))?Number(bb.customMin||bb.windowMin):Number(bb.windowMin),days:Number(bb.days),choreId:bb.choreId,room:bb.room==="other"?bb.roomCustom:bb.room,minutes:Number(bb.minutes)});
    if(r){S.ui.bb=null;const got=G.modeById(r.mode)||m;toast(m.solo?"Ghost race is on. Start when you're ready!":solo&&!G.isRaid(m.id)?`Solo ${got.name} is on!`:m.id==="wildcard"?`🃏 It's ${got.name}!${r.twist?" "+r.twist.text+".":""} Challenge sent.`:G.isRaid(m.id)?((bb.team||[]).length?"Team invite sent!":"Baby boss raid is on. Go do chores!"):"Challenge sent!");}break;}
  case "b-accept":{const r=await bcall("respondBattle",{id:ds.id,accept:true});if(r){confetti(60);chime(false);toast(r.started?"Battle on! Go go go!":"You're in! Waiting for the others.");}break;}
  case "b-decline": await bcall("respondBattle",{id:ds.id,accept:false});break;
  case "b-cancel":{const b=S.battles[ds.id],solo=b&&b.players.length===1,running=b&&b.status==="active";
    if(running&&!confirm(solo?"Cancel this battle? Nobody gets XP for it.":"Call off this battle? Everyone has to agree, and nobody gets XP for it."))return;
    const r=await bcall("cancelBattle",{id:ds.id});if(r)toast(r.waiting?"Asked to call it off. Waiting for the others to agree.":"Called off.");break;}
  case "b-start":{const b=S.battles[ds.id];if(S.ui.wheel)closeWheel();if(await bcall("startAttempt",{id:ds.id},"Timer started. Go!")&&b)openFocus({kid,id:b.params.choreId,battleId:ds.id});break;}
  case "fx-battle":{const b=S.battles[ds.id];if(!b)return;const a=(b.attempts||{})[kid];openFocus({kid,id:b.params.choreId,battleId:ds.id,startAt:a&&a.startAt?a.startAt:Date.now()});break;}
  case "focus":{const ch=choreById(ds.id);if(!ch)return;S.ui.confirmChore=null;openFocus({kid,id:ch.id});break;}
  case "fx-step":{const f=S.ui.focus,n=Number(ds.i);f.checked=f.checked.includes(n)?f.checked.filter(x=>x!==n):[...f.checked,n];saveFocus();if(stepsOf(choreById(f.id)).every((_,i)=>f.checked.includes(i)))chime(false);break;}
  case "fx-close": if(!S.ui.focus.battleId&&!confirm("Stop without finishing? Nothing is logged."))return;closeFocus();break;
  case "fx-done": await finishFocus();return;
  case "wd-open":openWheel(ds.id);break;
  case "wd-close":closeWheel();break;
  case "wd-spin":{const w=S.ui.wheel;if(!w)return;const r=await bcall("spinDoom",{id:w.id});if(r&&S.ui.wheel){S.ui.wheel.spins=r.spins;S.ui.wheel.at=Date.now();}break;}
  case "dd-submit":{const n=Number((S.ui.dishes||{})[ds.id]);if(!Number.isInteger(n)||n<0||n>G.MAX_RUSH_ITEMS){toast(`Enter a number from 0 to ${G.MAX_RUSH_ITEMS}.`);return;}
    const ok=await bcall("rushCount",{id:ds.id,count:n});if(ok){chime(false);toast(`${n} dish${n===1?"":"es"} turned in! 🍽️`);}break;}
  case "rr-start":{const r=await bcall("startAttempt",{id:ds.id});if(r){openRush(ds.id);chime(false);}break;}
  case "rr-open":openRush(ds.id);break;
  case "rr-close":closeRush();break;
  case "rr-submit":{const r=S.ui.rush;if(!r)return;const n=Number(r.count);const ok=await bcall("rushCount",{id:r.id,count:n});if(ok){closeRush();confetti(80);chime(true);toast(`${n} thing${n===1?"":"s"} cleaned up! 🌪️`);}break;}
  case "tm-open":openMap(ds.id);break;
  case "tm-close":closeMap();break;
  case "tm-pick":if(S.ui.tm)S.ui.tm.sel=Number(ds.c);break;
  case "tm-reveal":{const t=S.ui.tm;if(!t)return;const r=await bcall("territoryPick",{id:t.id,country:t.sel});if(r&&S.ui.tm){S.ui.tm.checked=[];S.ui.tm.sel=null;toast(`${r.country}: ${r.name}!`);}break;}
  case "tm-step":{const t=S.ui.tm,n=Number(ds.i);t.checked=t.checked.includes(n)?t.checked.filter(x=>x!==n):[...t.checked,n];break;}
  case "tm-claim":{const t=S.ui.tm,b=t&&S.battles[t.id],o=b&&(b.open||{})[S.viewKid];if(!o)return;const r=await bcall("territoryClaim",{id:t.id,ms:Date.now()-o.at});
    if(r){if(S.ui.tm)S.ui.tm.checked=[];if(r.claimed){confetti(80);chime(true);toast(`${r.country} is yours! +${money(r.amount)}`);}else toast(`Time ran out, but the chore still counts. +${money(r.amount)}`);}break;}
  case "tm-giveup":{const t=S.ui.tm;if(!t||!confirm("Give up this country? It stays neutral, and you can't pick it again this battle."))return;const r=await bcall("territoryGiveUp",{id:t.id});if(r&&S.ui.tm)S.ui.tm.checked=[];break;}
  case "b-finish":{const r=await bcall("finishAttempt",{id:ds.id});if(r){confetti(80);chime(true);toast(r.ms!=null?`Done in ${fmtMs(r.ms)}! Chore logged.`:"Turned in! Chore logged.");}break;}
  case "chore-icon": S.ui.draft.chores[Number(ds.i)].icon=ds.icon;break;
  case "fix-pr": setPrDay(ds.kid,ds.id,true,ds.date);return;
  case "badge-info":{const cur=S.ui.badgeInfo;S.ui.badgeInfo=cur&&cur.kid===ds.kid&&cur.id===ds.id?null:{kid:ds.kid,id:ds.id};break;}
  case "adult-edit-amt":{const g=kidState(ds.kid).goals.find(x=>x.id===ds.goal);S.ui.editGoal={kid:ds.kid,goal:ds.goal,amountOnly:true,amount:g?g.balance:0};break;}
  case "adult-save-amt":{const e=S.ui.editGoal;if(!e)return;const v=r2(Math.max(0,Number(e.amount)||0));S.ui.editGoal=null;
    guard(setDoc(doc(db,"bank",e.kid),{goalBal:{[e.goal]:v}},{merge:true}),`Saved: ${money(v)}.`);break;}
  case "fix-day":{const ids=prChores().map(c=>c.id),day=parseYmd(ds.date).toLocaleDateString(undefined,{weekday:"long"});
    guard(setDoc(doc(db,"prefs",ds.kid),{prLog:{[ds.date]:arrayUnion(...ids)},prDone:{[ds.date]:true}},{merge:true}),`Fixed. ${kidCfg(ds.kid).name}'s ${day} counts toward the streak.`);return;}
  case "fix-pick":S.ui.fix={kid:ds.kid,date:ds.date};break;
  case "fix-pr-toggle":{const f=S.ui.fix;const on=(kidState(f.kid).prLog[f.date]||[]).includes(ds.id);setPrDay(f.kid,ds.id,!on,f.date);return;}
  case "p-check": await bcall("checkRun",{id:ds.id,player:ds.player,ok:!!ds.ok,as:null},ds.ok?"Marked done well.":"Marked not good enough.");break;
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
  case "battle-feed": guard(setDoc(doc(db,"parentTokens",S.user.uid),{battleFeed:!(S.myToken&&S.myToken.battleFeed)},{merge:true}),S.myToken&&S.myToken.battleFeed?"Battle news off.":"You'll hear about every battle.");return;
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
  case "guide":{const g=S.ui.guide;if(g[ds.id])delete g[ds.id];else g[ds.id]=true;break;}
  case "guide-all":{const ids=ds.kind==="m"?G.ACTIVE_MODES.map(m=>"m:"+m.id):Array.from({length:G.MAX_LEVEL},(_,i)=>"l:"+(i+1));ids.push(ds.kind+":all");for(const id of ids){if(ds.open==="1")S.ui.guide[id]=true;else delete S.ui.guide[id];}break;}
  case "goal-chip": S.ui.goalInput=String(ds.v);break;
  case "set-goal":{const v=q(S.ui.goalInput);if(!(v>0)){toast("Pick a goal of at least $0.25.");return;}const wk=activeWeek(kid);S.ui.goalInput="";
    guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,goal:v},{merge:true}));confetti(60);chime(false);break;}
  case "do-chore": if(!choreById(ds.id))return;if((kidCfg(kid)||{}).adult){doChore(kid,ds.id,"");return;}
    if(stepsOf(choreById(ds.id)).length){S.ui.confirmChore=null;openFocus({kid,id:ds.id});break;} // chores with steps are done from the checklist
    S.ui.confirmChore={choreId:ds.id,note:""};break;
  case "cancel-chore": S.ui.confirmChore=null;break;
  case "confirm-chore":{const cc=S.ui.confirmChore;if(!cc)return;const note=String(cc.note||"").trim();if(needsNote(choreById(cc.choreId))&&!note){toast("Say what it was first.");return;}S.ui.confirmChore=null;doChore(kid,cc.choreId,note);return;}
  case "toggle-pr":{const id=ds.id,on=(kidState(kid).prLog[today]||[]).includes(id);
    if(!on&&needsNote(choreById(id))&&!(kidCfg(kid)||{}).adult){S.ui.prNote={id,text:""};break;}
    setPr(kid,id,!on,"");return;}
  case "cancel-pr-note": S.ui.prNote=null;break;
  case "save-pr-note":{const pn=S.ui.prNote;if(!pn)return;const text=String(pn.text||"").trim();if(!text){toast("Say what it was first.");return;}S.ui.prNote=null;setPr(kid,pn.id,true,text);return;}
  case "add-goal":{const g=S.ui.newGoal;const name=String(g.name||"").trim();const t=r2(g.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.newGoal={name:"",target:""};guard(setDoc(doc(db,"prefs",kid),{goals:{[uid()]:{name,target:t,created:Date.now()}}},{merge:true}));break;}
  case "ptab": if(S.ptab==="settings"&&ds.tab!=="settings"){if(draftDirty()&&!confirm("Leave Settings without saving your changes?"))return;S.ui.draft=null;S.ui.editChore=null;}S.ptab=ds.tab;S.ui.pickCreature=false;break;
  case "log-chore":{const L=S.ui.log;if(!L.chore)return;S.busy.log=true;render();try{const r=await call("completeChore")({kidId:L.kid,choreId:L.chore,note:String(L.note||"").trim()});L.note="";toast(`Logged +${money(r.data.amount)} for ${kidCfg(L.kid).name}.`);}catch(e){toast(errMsg(e));}finally{delete S.busy.log;render();}return;}
  case "reverse": case "restore": guard(txWeek(ds.kid,ds.wk,w=>{const e=w.entries.find(x=>x.id===ds.id);if(e)e.status=act==="reverse"?"reversed":"ok";}),act==="reverse"?"Reversed. Its XP comes off too.":"Restored, XP included.");return;
  case "prefill-ded": S.ui.ded={kid:ds.kid,amount:0.25,reason:ds.reason,how:"Do it today plus one extra chore",type:"ded"};S.ptab="actions";break;
  case "ded-type": S.ui.ded.type=ds.type;break;
  case "prefill-warn": S.ui.ded={kid:ds.kid,amount:0.25,reason:ds.reason,how:"",type:"warn"};S.ptab="actions";break;
  case "warn-to-ded": S.ui.ded={kid:ds.kid,amount:0.25,reason:ds.reason,how:"Do it today plus one extra chore",type:"ded"};window.scrollTo(0,0);break;
  case "remove-warn": guard(txWeek(ds.kid,ds.wk,w=>{w.warnings=(w.warnings||[]).filter(x=>x.id!==ds.id);}),"Warning removed.");return;
  case "warn-seen": guard(setDoc(doc(db,"prefs",kid),{seenWarnings:arrayUnion(ds.id)},{merge:true}));return;
  case "add-ded":{const d=S.ui.ded;if(d.type==="warn"){const reason=String(d.reason||"").trim();if(!reason){toast("Add a reason.");return;}const wk=activeWeek(d.kid);
      guard(setDoc(weekRef(d.kid,wk),{kidId:d.kid,week:wk,warnings:arrayUnion({id:uid(),t:Date.now(),reason,by:parentName()})},{merge:true}),"Warning given.");
      S.ui.ded={kid:d.kid,amount:0.25,reason:"",how:"",type:"warn"};break;}
    const amt=q(d.amount);if(!(amt>0)||!String(d.reason).trim()){toast("Add an amount and a reason.");return;}const wk=activeWeek(d.kid);
    guard(setDoc(weekRef(d.kid,wk),{kidId:d.kid,week:wk,deductions:arrayUnion({id:uid(),t:Date.now(),amount:amt,reason:String(d.reason).trim(),how:String(d.how||"").trim(),status:"active",by:parentName()})},{merge:true}),"Deduction added.");
    S.ui.ded={kid:d.kid,amount:0.25,reason:"",how:"",type:"ded"};break;}
  case "redeem": guard(txWeek(ds.kid,ds.wk,w=>{const e=w.deductions.find(x=>x.id===ds.id);if(e){e.status="redeemed";e.redeemedBy=parentName();}}).then(()=>setDoc(doc(db,"bank",ds.kid),{stats:{redemptions:increment(1)}},{merge:true})),"Earned back. Nice comeback.");return;
  case "remove-ded": if(!confirm("Remove this deduction entirely? Use this for mistakes. To reward a comeback, use Earned back instead."))return;guard(txWeek(ds.kid,ds.wk,w=>{w.deductions=w.deductions.filter(x=>x.id!==ds.id);}));return;
  case "co-start":{const ks=kidState(ds.kid),weeks=cashWeeks(ds.kid);if(!weeks)return;const p=cashoutPlan(ds.kid,weeks);
    S.ui.co={kid:ds.kid,step:0,alloc:{...p.interestAlloc},checks:{}};try{if(document.documentElement.requestFullscreen&&!document.fullscreenElement)document.documentElement.requestFullscreen().catch(()=>{});}catch(e){}break;}
  case "co-close":if(S.ui.co&&cashWeeks(S.ui.co.kid)&&S.ui.co.step>0&&!confirm("Stop this cash-out? Nothing has been saved yet."))return;S.ui.co=null;try{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});}catch(e){}break;
  case "co-next":S.ui.co.step++;S.ui.co.checks={};break;
  case "co-back":S.ui.co.step--;S.ui.co.checks={};break;
  case "co-check":{const c=S.ui.co;c.checks[ds.i]=!c.checks[ds.i];break;}
  case "co-rest":{const c=S.ui.co,weeks=cashWeeks(c.kid);if(!weeks)return;const p=cashoutPlan(c.kid,weeks,c.alloc);const others=Object.entries(c.alloc||{}).filter(([d])=>d!==ds.dest).reduce((t,[,v])=>t+(Number(v)||0),0);
    c.alloc={...c.alloc,[ds.dest]:Math.max(0,r2(p.interest-others))};if(r2(p.interest-others)<=0)c.alloc={[ds.dest]:p.interest};break;}
  case "co-finish":{const c=S.ui.co;const ok=await doCashout(c.kid,c.alloc);if(ok&&S.ui.co){confetti(120);chime(true);}break;}
  case "buy-goal":{const g=kidState(ds.kid).goals.find(x=>x.id===ds.goal);S.ui.buy={kid:ds.kid,goal:ds.goal,amount:g?g.balance:0};break;}
  case "cancel-buy": S.ui.buy=null;break;
  case "confirm-buy":{const b=S.ui.buy;const amt=r2(b.amount);const g0=kidState(b.kid).goals.find(x=>x.id===b.goal);
    if(!g0||!(amt>0)||amt>g0.balance){toast("Amount must be more than $0 and no more than the goal's balance.");return;}S.ui.buy=null;
    guard(runTransaction(db,async t=>{const ref=doc(db,"bank",b.kid);const s=await t.get(ref);const bank=Object.assign({goalBal:{},archived:[]},s.exists()?s.data():{});
      const bal=r2(bank.goalBal[b.goal]||0);if(amt>bal)throw new Error("Balance changed. Try again.");const left=r2(bal-amt);
      if(b.goal==="general"){bank.goalBal.general=left;bank.archived.push({name:"From general savings",bought:amt,date:ymd()});}
      else{delete bank.goalBal[b.goal];bank.archived.push({goalId:b.goal,name:g0.name,target:g0.target,bought:amt,date:ymd()});if(left>0)bank.goalBal.general=r2((bank.goalBal.general||0)+left);}
      t.set(ref,bank);}),`Logged. Take ${money(amt)} out of storage.`);break;}
  case "del-goal":{const ks=kidState(ds.kid),g=ks.goals.find(x=>x.id===ds.goal);if(!g||g.id==="general")return;
    const parent=S.role==="parent";
    if(g.balance>0&&!parent){toast(`"${g.name}" has ${money(g.balance)} in it. Ask a parent to delete it. The money will move to General savings.`);return;}
    if(!confirm(`Delete the savings goal "${g.name}"?${g.balance>0?` Its ${money(g.balance)} moves to General savings.`:""} This can't be undone.`))return;
    const fix=ks.interestTo===g.id?{interestTo:"invest"}:{};
    if(S.ui.editGoal&&S.ui.editGoal.goal===g.id)S.ui.editGoal=null;
    if(parent&&g.balance>0)guard(runTransaction(db,async t=>{const bref=doc(db,"bank",ds.kid);const bs=await t.get(bref);const bank=bs.exists()?bs.data():{};const gb={...(bank.goalBal||{})};
      const amt=r2(gb[g.id]||0);delete gb[g.id];gb.general=r2((gb.general||0)+amt);t.set(bref,{goalBal:gb},{mergeFields:["goalBal"]});
      t.set(doc(db,"prefs",ds.kid),{goals:{[g.id]:deleteField()},...fix},{merge:true});}),`Deleted. ${money(g.balance)} moved to General savings.`);
    else guard(setDoc(doc(db,"prefs",ds.kid),{goals:{[g.id]:deleteField()},...fix},{merge:true}),"Goal deleted.");
    break;}
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
  case "add-chore":{const id=uid();S.ui.draft.chores.push(ds.kind==="pr"?{id,kind:"pr",name:"New item",note:"",ask:false}:{id,kind:"family",name:"New chore",mult:1,limit:1,familyLimit:0,weekLimit:0,assign:"pool",ask:false});S.ui.editChore=id;break;}
  case "rm-chore":{const i=Number(ds.i),c=S.ui.draft.chores[i];if(c&&c.id===S.ui.editChore)S.ui.editChore=null;S.ui.draft.chores.splice(i,1);break;}
  case "edit-chore": S.ui.editChore=S.ui.editChore===ds.id?null:ds.id;break;
  case "discard-settings": S.ui.draft=null;S.ui.editChore=null;break;
  case "save-settings":{const d=clone(S.ui.draft);
    d.kids.forEach(k=>{k.remind=String(k.remindStr||"").split(",").map(s=>s.trim()).filter(s=>/^\d{1,2}:\d{2}$/.test(s)).map(s=>s.padStart(5,"0"));delete k.remindStr;k.rate=r2(k.rate);k.adult=!!k.adult;k.age=k.adult?0:(Number(k.age)||0);
      const em=String(k.email||"").trim().toLowerCase();if(k.adult&&em)k.email=em;else delete k.email;});
    const b=d.game.battles;if(b.handicapPct!=null){b.handicapPerYear=Math.max(0,Number(b.handicapPct)||0)/100;delete b.handicapPct;}
    b.handicapMax=Math.max(1,Number(b.handicapMax)||1);b.dailyCap=Math.max(1,Math.round(Number(b.dailyCap)||1));b.weeklyCap=Math.max(0,Math.round(Number(b.weeklyCap)||0));
    const ml={};for(const [id,v] of Object.entries(b.modeLimits||{})){const day=Math.max(0,Math.round(Number(v&&v.day)||0)),week=Math.max(0,Math.round(Number(v&&v.week)||0));if(day||week)ml[id]={day,week};}b.modeLimits=ml;
    const mt={};for(const [id,v] of Object.entries(b.modeTimes||{})){const n=Math.round(Number(v));if(n===0||(n>=G.MIN_TIME&&n<=G.MAX_TIME))mt[id]=n;}b.modeTimes=mt;
    for(const t of ["quietStart","quietEnd"])if(!/^\d{2}:\d{2}$/.test(b[t]||""))b[t]=G.GAME_DEFAULTS.battles[t];
    d.game.rewards=d.game.rewards.map(r=>({id:r.id||uid(),level:Math.min(30,Math.max(1,Math.round(Number(r.level)||1))),name:String(r.name||"").trim(),repeat:Math.max(0,Math.round(Number(r.repeat)||0))})).filter(r=>r.name);
    const mp=d.game.moneyPerks;mp.enabled=!!mp.enabled;mp.everyLevels=Math.max(1,Math.round(Number(mp.everyLevels)||5));mp.amount=Math.max(0,r2(mp.amount));
    d.chores.forEach(c=>{c.ask=!!c.ask;c.icon=String(c.icon||"").trim().slice(0,8);if(!c.icon)delete c.icon;
      const steps=String(c.stepsText||"").split("\n").map(x=>x.trim()).filter(Boolean).slice(0,12).map(x=>x.slice(0,80));delete c.stepsText;if(steps.length)c.steps=steps;else delete c.steps;
      const tm=Math.round(Number(c.targetMin)||0);if(tm>0&&tm<=240)c.targetMin=tm;else delete c.targetMin;if(c.kind==="family"){c.mult=Number(c.mult)||1;c.limit=Math.max(1,Math.round(Number(c.limit)||1));c.familyLimit=Math.max(0,Math.round(Number(c.familyLimit)||0));c.weekLimit=Math.max(0,Math.round(Number(c.weekLimit)||0));if(c.assign!=="pool"&&!d.kids.some(k=>k.id===c.assign))c.assign="pool";}});
    startDraft(d);guard(setDoc(doc(db,"app/config"),d),"Settings saved.");break;}
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
  if(el.dataset.bind==="focus.note"&&S.ui.focus){saveFocus();const f=S.ui.focus,left=stepsOf(choreById(f.id)).filter((_,i)=>!f.checked.includes(i)).length,b=document.querySelector('[data-act="fx-done"]');if(b)b.disabled=!!left||!String(v).trim();}
  if(el.dataset.bind.startsWith("co.alloc.")){softRender(true);return;}
  if(el.dataset.bind.startsWith("dishes.")){const b=document.querySelector(`[data-act="dd-submit"][data-id="${el.dataset.bind.slice(7)}"]`);if(b)b.disabled=!(v!==""&&Number.isInteger(v)&&v>=0&&v<=G.MAX_RUSH_ITEMS)||!!S.busy.b;}
  if(el.dataset.bind==="rush.count"){const b=document.querySelector('[data-act="rr-submit"]');if(b)b.disabled=!(v!==""&&Number.isInteger(v)&&v>=0&&v<=G.MAX_RUSH_ITEMS)||!!S.busy.b;}
  if(el.dataset.bind==="confirmChore.note"||el.dataset.bind==="prNote.text"){const b=document.querySelector(el.dataset.bind==="confirmChore.note"?'[data-act="confirm-chore"]':'[data-act="save-pr-note"]');if(b)b.disabled=!String(v).trim();}
  {const m=/^draft\.chores\.(\d+)\.name$/.exec(el.dataset.bind);if(m){const b=document.querySelector(`[data-drag][data-i="${m[1]}"] .set-open b`);if(b)b.textContent=String(v).trim()||"(no name)";}}
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

let wakeLock=null;async function wake(){try{if("wakeLock" in navigator&&(S.role==="display"||S.ui.focus||S.ui.tm||S.ui.rush||S.ui.wheel))wakeLock=await navigator.wakeLock.request("screen");}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")wake();});
setInterval(()=>{if(S.phase!=="ready")return;subscribeWeeks();const a=document.activeElement;if(!(a&&(a.tagName==="INPUT"||a.tagName==="SELECT"))&&!(S.role==="parent"&&S.ptab==="settings"))render();},60000);

/* ---------- updates: pick up a new version without a manual refresh ---------- */
// The deploy writes version.json with the live commit. A screen left open for days checks it now and then;
// when it changes, the page reloads itself, or shows a button if someone is in the middle of something.
let liveVersion=null;
function busyNow(){const a=document.activeElement;
  return !!(S.ui.focus||S.ui.tm||S.ui.rush||S.ui.wheel||S.ui.bb||(S.ui.draft&&S.ui.draftClean!==JSON.stringify(S.ui.draft))||(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)));}
function showUpdate(){if(document.getElementById("update-bar"))return;const d=document.createElement("div");d.id="update-bar";d.className="update-bar";d.setAttribute("role","status");
  d.innerHTML=`<span>✨ A new version of the app is ready.</span><button class="btn small" type="button">Update now</button>`;d.querySelector("button").onclick=()=>location.reload();document.body.appendChild(d);}
async function checkVersion(){try{const r=await fetch("/version.json?t="+Date.now(),{cache:"no-store"});if(!r.ok)return;const v=(await r.json()).commit;if(!v)return;
  if(liveVersion==null){liveVersion=v;return;}
  if(v!==liveVersion){if(busyNow())showUpdate();else location.reload();}}catch(e){}}
checkVersion();setInterval(checkVersion,10*60e3);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkVersion();});
