import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, where, orderBy, limit, getDocs, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, arrayUnion, arrayRemove, increment, Timestamp, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { VAPID_KEY } from "./config.js";
import * as G from "./game.js";

const CREATURES=G.CREATURES;
const S={phase:"loading",user:null,role:null,device:null,config:null,bank:{},prefs:{},weeks:{},xp:{},battles:{},devices:[],codes:[],ptab:"activity",viewKid:null,busy:{},
  ui:{goalInput:"",newGoal:{name:"",target:""},ded:{kid:"",amount:0.25,reason:"",how:""},buy:null,pgoal:{},draft:null,pickCreature:false,wtab:"creature",prevPct:{},prevLvl:{},pair:{code:"",name:""},newCode:{role:"display"},log:{kid:"",chore:""},
    bb:null,levelUp:null,xpHist:{}}};

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r2=n=>Math.round((Number(n)||0)*100)/100;
const q=n=>Math.round((Number(n)||0)*4)/4;
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
}catch(e){document.getElementById("app").innerHTML=`<div class="center"><div class="logo">Boon <span>Bank</span></div><p class="sub" style="max-width:420px">Open this app from its Firebase Hosting address (your-project.web.app). It can't start from a saved file.</p></div>`;throw e;}
const call=name=>httpsCallable(fns,name);
async function messaging(){if(msg)return msg;if(!(await isSupported().catch(()=>false)))return null;msg=getMessaging(app);onMessage(msg,p=>toast((p.notification&&p.notification.body)||"Reminder"));return msg;}
if("serviceWorker" in navigator)navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(()=>{});

/* ---------- data access ---------- */
const cfg=()=>S.config;
const kidCfg=id=>cfg().kids.find(k=>k.id===id);
const kidsSorted=()=>[...cfg().kids].sort((a,b)=>(!!b.adult-!!a.adult)||((b.age||0)-(a.age||0)));
const choreById=id=>cfg().chores.find(c=>c.id===id);
const prChores=()=>cfg().chores.filter(c=>c.kind==="pr");
const famChoresFor=kidId=>cfg().chores.filter(c=>c.kind==="family"&&(c.assign==="pool"||c.assign===kidId));
const choreValue=(kid,ch)=>r2((kid.rate||0)*(ch.mult||1));
function kidState(id){
  const b=S.bank[id]||{},p=S.prefs[id]||{},bal=b.goalBal||{};
  const archivedIds=new Set((b.archived||[]).map(a=>a.goalId).filter(Boolean));
  const goals=[{id:"general",name:"General savings",target:0,balance:r2(bal.general||0)}];
  Object.entries(p.goals||{}).filter(([gid])=>!archivedIds.has(gid)).sort((a,c)=>(a[1].created||0)-(c[1].created||0))
    .forEach(([gid,g])=>goals.push({id:gid,name:g.name,target:g.target||0,balance:r2(bal[gid]||0)}));
  return {creature:p.creature||null,interestTo:p.interestTo||"invest",prLog:p.prLog||{},goals,archived:b.archived||[],invest:r2(b.invest||0),give:r2(b.give||0),
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
const prIds=()=>prChores().map(c=>c.id);
function streak(kidId){return G.streak(kidState(kidId).prLog,prIds(),ymd(),xpState(kidId).frozen);}
function bestStreak(kidId){return G.bestStreak(kidState(kidId).prLog,prIds(),xpState(kidId).frozen);}
function calcInterest(p){const i=cfg().interest;return Math.min(p,i.threshold)*i.low/100+Math.max(0,p-i.threshold)*i.high/100;}
function splitAmt(amt){const sp=cfg().split;const r=q(amt);const save=q(r*sp.save/100),invest=q(r*sp.invest/100),give=q(r*sp.give/100);return {spend:r2(r-save-invest-give),save,invest,give};}
function goalName(ks,id){const g=ks.goals.find(g=>g.id===id);return g?g.name:"General savings";}
function destName(ks,dest){return {spend:"Spend",invest:"Invest",give:"Give",split:"Split like earnings",save:"Save"}[dest]||goalName(ks,dest);}
const parentName=()=>S.user&&(S.user.displayName||S.user.email)||"Parent";

/* ---------- auth & subscriptions ---------- */
let unsubs=[],deviceUnsub=null,weekKey="",weekUnsub=null,battleKey="",battleUnsub=null;
function stopData(){unsubs.forEach(u=>u());unsubs=[];if(weekUnsub)weekUnsub();weekUnsub=null;if(battleUnsub)battleUnsub();battleUnsub=null;weekKey="";battleKey="";S.config=null;S.bank={};S.prefs={};S.weeks={};S.xp={};S.xpLoaded=false;S.battles={};S.devices=[];S.codes=[];}
function onErr(e){console.warn(e);if(e&&e.code==="permission-denied"&&S.role!=="parent"){/* device was unpaired */}}
function startData(){
  if(unsubs.length)return;
  unsubs.push(onSnapshot(doc(db,"app/config"),s=>{S.config=s.exists()?s.data():null;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"bank"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.bank=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"prefs"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.prefs=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"xp"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.xp=m;S.xpLoaded=true;softRender();},onErr));
  if(S.role==="parent"){
    unsubs.push(onSnapshot(collection(db,"devices"),s=>{S.devices=s.docs.map(d=>({id:d.id,...d.data()}));softRender();},onErr));
    unsubs.push(onSnapshot(collection(db,"pairCodes"),s=>{S.codes=s.docs.map(d=>({id:d.id,...d.data()}));softRender();},onErr));
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
  try{await call("setupFamily")();S.role="parent";S.phase="ready";S.ptab="activity";startData();render();}
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
  else if(S.phase==="notparent")h=`<div class="center"><div class="logo">Boon <span>Bank</span></div><p class="sub" style="max-width:420px;margin-top:12px">${esc(S.ui.err)}</p><div class="choices"><button class="btn" data-act="sign-out">Sign out</button></div></div>`;
  else if(S.phase!=="ready"||!S.config)h=`<div class="center"><div class="logo">Boon <span>Bank</span></div><p class="sub">Loading…</p></div>`;
  else if(S.role==="kid")h=kidCfg(S.viewKid)?viewKid(S.viewKid):`<div class="center"><p class="sub">This tablet's person was removed. Ask a parent to pair it again.</p></div>`;
  else if(S.role==="display")h=viewDisplay();
  else h=viewParent();
  if(S.ui.levelUp)h+=levelUpOverlay();
  $("#app").innerHTML=h;document.body.dataset.mode=mode();
  const th=S.phase==="ready"&&S.config&&S.viewKid&&kidCfg(S.viewKid)&&(S.role==="kid"||(S.role==="parent"&&S.ptab.startsWith("me:")))?equipped(S.viewKid).theme:"";
  if(th)document.body.dataset.kidtheme=th;else delete document.body.dataset.kidtheme;
  afterRender();
}
function softRender(){if(S.role==="parent"&&S.ptab==="settings"&&S.ui.draft)return;const a=document.activeElement;
  if(a&&a.tagName==="INPUT"&&S.role!=="display"){const b=a.dataset.bind;render();if(b){const el=document.querySelector(`[data-bind="${b}"]`);if(el){el.focus();try{const l=el.value.length;el.setSelectionRange(l,l)}catch(e){}}}return;}render();}
function afterRender(){
  if(S.role==="display"&&S.config){for(const k of cfg().kids){const w=getWeek(k.id,activeWeek(k.id));const p=w.goal?weekNet(w)/w.goal:0;const prev=S.ui.prevPct[k.id];
    if(prev!=null&&prev<1&&p>=1){confetti(220,equipped(k.id).confetti);chime(true);const el=document.querySelector(`.lane[data-kid="${k.id}"] .walker`);if(el)el.classList.add("cheer");}S.ui.prevPct[k.id]=p;
    if(!S.xpLoaded)continue;const lv=xpState(k.id).level,pl=S.ui.prevLvl[k.id];if(pl!=null&&lv>pl){confetti(260,equipped(k.id).confetti);chime(true);const el=document.querySelector(`.lane[data-kid="${k.id}"] .lane-cr`);if(el)el.classList.add("cheer");}S.ui.prevLvl[k.id]=lv;}}
  checkLevelUp();tickClocks();
}
// Shows the level-up celebration once per device, on the screen of the person who leveled up.
const seenKey=id=>"boon.levelSeen."+id;
function readSeen(id){try{return Number(localStorage.getItem(seenKey(id)))||0;}catch(e){return 0;}}
function checkLevelUp(){
  if(S.ui.levelUp||S.phase!=="ready"||!S.config||!S.viewKid||!kidCfg(S.viewKid))return;
  if(!(S.role==="kid"||(S.role==="parent"&&S.ptab.startsWith("me:"))))return;
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
  return `<div class="center"><div class="logo">Boon <span>Bank</span></div><p class="sub">Set up this device</p><div class="choices">
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
  h+=freezeNotice(k.id)+reminderBanner(k,ks,today);
  h+=w.goal==null?goalSetter(k,wk):goalCard(k,ks,w,net,cr);
  h+=battleSection(k)+challengeCards(k.id)+prSection(k,ks,today)+choreSection(k,today)+moneySection(k,ks,w,net)+badgeSection(k.id)+activitySection(w);
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
    <p class="goal-msg">${v>0?`Reach it and you get a +${money(r2(v*.1))} bonus.`:"Bigger goal, bigger bonus."}</p>
    <button class="btn block" data-act="set-goal">Lock in my goal</button></section>`;
}
function goalCard(k,ks,w,net,cr){
  const won=net>=w.goal,bonus=r2(w.goal*.1),bt=w.bonusTo||"split";
  return `<section class="card goal ${won?"won":""}"><div class="goal-top"><div><div class="big">${money(net)}</div><p class="sub">of your ${money(w.goal)} goal</p></div>
    <div class="bonus">${won?"Bonus earned":"Bonus if you make it"}<b>+${money(bonus)}</b><small>and +${G.XP.goal} XP</small></div></div>${trail(net/w.goal,crHtml(k.id),won,undefined,equipped(k.id).trail)}
    <p class="goal-msg">${won?"Goal reached! Your bonus is locked in.":`${money(w.goal-net)} to go`}</p>
    <label class="inline">Bonus goes to <select data-change="bonusTo" aria-label="Where your bonus goes">${["split","spend","save","invest","give"].map(o=>`<option value="${o}" ${o===bt?"selected":""}>${destName(ks,o)}</option>`).join("")}</select></label></section>`;
}
function challengeCards(kidId){let h="";for(const w of openWeeks(kidId))for(const d of w.deductions)if(d.status==="active")
  h+=`<section class="card challenge"><h3>Earn back ${money(d.amount)}</h3><p><b>${esc(d.reason)}</b></p>${d.how?`<p>How: ${esc(d.how)}</p>`:""}<p class="hint">When you've done it, ask a parent to mark it earned back. You have until Sunday's cash-out.</p></section>`;return h;}
function prSection(k,ks,today){const prs=prChores();if(!prs.length)return "";const done=ks.prLog[today]||[];const s=streak(k.id),boost=G.streakBoost(cfg(),s),fr=xpState(k.id).freezes;
  return `<section class="card"><div class="sec-head"><h2>Every day</h2><span><span class="streak">🔥 ${s} day${s===1?"":"s"} in a row</span>${boost>1?` <span class="pill boost" title="Streak bonus on all XP">×${boost} XP</span>`:""}${fr?` <span class="pill" title="Streak freezes save your streak on a missed day">🧊 ${fr}</span>`:""}</span></div><div class="checks">${prs.map(c=>{const on=done.includes(c.id);
    return `<button class="check ${on?"on":""}" data-act="toggle-pr" data-id="${c.id}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span><b>${esc(c.name)}</b>${c.note?`<small>${esc(c.note)}</small>`:""}</span></button>`;}).join("")}</div>
    <p class="hint">These don't pay money. They're part of taking care of yourself. Finish all of them for +${G.XP.checklist} XP and to keep your streak going.${game().streakMultiplier.enabled?` A ${game().streakMultiplier.minStreak}-day streak makes all your XP count ×${game().streakMultiplier.mult}.`:""}</p></section>`;}
function choreSection(k,today){const list=famChoresFor(k.id).sort((a,b)=>(a.assign==="pool")-(b.assign==="pool"));const cot=cotdId();
  return `<section class="card"><div class="sec-head"><h2>Family chores</h2></div>${list.length?list.map(c=>{const n=choreCountToday(k.id,c,today),lim=c.limit||1,full=n>=lim,busy=S.busy["c:"+c.id];
    return `<div class="chore ${c.id===cot?"cotd":""}"><div><b>${esc(c.name)}</b><small><span class="tag ${c.assign===k.id?"mine":""}">${c.assign===k.id?"Yours":"Anyone"}</span>${c.id===cot?`<span class="tag star">⭐ Double XP today</span>`:""}${n} of ${lim} done today</small></div><div class="c-val">+${money(choreValue(k,c))}<small>+${choreXpFor(k.id,c)} XP</small></div><button class="btn small" data-act="do-chore" data-id="${c.id}" ${full||busy?"disabled":""}>${busy?"Saving…":full?"All done":"I did it"}</button></div>`;}).join(""):`<p class="empty">No chores set up yet.</p>`}</section>`;}
function moneySection(k,ks,w,net){const sp=splitAmt(Math.max(0,net));const goals=ks.goals;const saveTo=w.saveTo||"general";const g=S.ui.newGoal;
  return `<section class="card"><div class="sec-head"><h2>My money</h2></div><div class="buckets">
    <div class="bucket b-spend"><h3>Spend <small>${cfg().split.spend}%</small></h3><div class="money">${money(sp.spend)}</div><p>Cash you get Sunday night</p></div>
    <div class="bucket b-save"><h3>Save <small>${cfg().split.save}%</small></h3><div class="money">${money(goals.reduce((s,x)=>s+x.balance,0))}</div><p>+${money(sp.save)} this week</p>
      ${goals.map(x=>`<div class="sgoal"><div class="top"><span>${esc(x.name)}</span><span>${money(x.balance)}${x.target?" / "+money(x.target):""}</span></div>${x.target?`<div class="bar"><i style="width:${Math.min(100,x.balance/x.target*100)}%"></i></div>`:""}</div>`).join("")}
      <label>This week's savings go to<select data-change="saveTo">${goals.map(x=>`<option value="${x.id}" ${x.id===saveTo?"selected":""}>${esc(x.name)}</option>`).join("")}</select></label>
      <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="newGoal.name" value="${esc(g.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="newGoal.target" value="${esc(g.target)}"><button class="btn small" data-act="add-goal">Add</button></div></div>
    <div class="bucket b-invest"><h3>Invest <small>${cfg().split.invest}%</small></h3><div class="money">${money(ks.invest)}</div><p>+${money(sp.invest)} this week. Next monthly interest about ${money(calcInterest(ks.invest))}.</p>
      <label>Interest goes to<select data-change="interestTo">${["invest","spend","give",...goals.map(x=>x.id)].map(o=>`<option value="${o}" ${o===ks.interestTo?"selected":""}>${o==="invest"?"Back into Invest (it grows!)":destName(ks,o)}</option>`).join("")}</select></label></div>
    <div class="bucket b-give"><h3>Give <small>${cfg().split.give}%</small></h3><div class="money">${money(ks.give)}</div><p>+${money(sp.give)} this week</p></div></div></section>`;}
function badgeList(kidId){const ks=kidState(kidId),st=ks.stats,x=xpState(kidId);const live=openWeeks(kidId).reduce((s,w)=>s+choreCount(w),0);const chores=(st.chores||0)+live;
  const saved=ks.goals.reduce((s,g)=>s+g.balance,0)+ks.archived.reduce((s,g)=>s+(g.bought||0),0);
  return G.badgeList({chores,goalHits:st.goalHits||0,bestStreak:bestStreak(kidId),redemptions:st.redemptions||0,saved,invest:ks.invest,give:ks.give,bought:ks.archived.length,wins:x.counts.win||0,giant:x.counts.giant||0}).map(b=>[b[1],b[2],b[3]]);}
function badgeSection(kidId){const b=badgeList(kidId);return `<section class="card"><div class="sec-head"><h2>Badges</h2><span class="sub">${b.filter(x=>x[2]).length} of ${b.length}. +${G.XP.badge} XP each</span></div><div class="badges">${b.map(x=>`<div class="badge ${x[2]?"":"locked"}"><span>${x[0]}</span>${x[1]}</div>`).join("")}</div></section>`;}
function choreLine(e){const rev=e.status==="reversed";return [`<span class="${rev?"struck":""}">${esc(e.name)}<br><small>${timeOf(e.t)}${rev?", reversed":""}</small></span>`,`<span class="amt ${rev?"struck":"pos"}">+${money(e.amount)}</span>`];}
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
function modeParams(b){const p=b.params||{};return b.mode==="race"?`First to ${p.n} chores`:b.mode==="blitz"?(p.windowMin?`${p.windowMin}-minute blitz`:"Until midnight"):p.choreName?esc(p.choreName):"";}
function fmtEnd(t){const d=new Date(t);return d.getHours()===0&&d.getMinutes()===0?"at midnight":"at "+d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});}
function scoreHtml(b,id){if(G.TIMED.includes(b.mode)){const a=(b.attempts||{})[id];return !a?"–":a.void?"✗":a.ms!=null?fmtMs(a.ms):`<span class="tt-clock" data-start="${a.startAt}"></span>`;}
  const s=(b.scores||{})[id],h=(b.handicap||{})[id]||1;return `${s?s.adj:0}${h>1?`<small> (×${h})</small>`:""}`;}
function resultText(b,me){const r=b.result||{};const who=id=>id===me?"You":bName(b,id);
  if(r.noContest)return `No contest. ${esc(r.reason||"")}`;
  if(b.mode==="ghost")return r.record?"First record set! ⏱️":r.winner?"New personal best! 🎉":"Not this time. Try again!";
  if(r.tie)return `It's a tie! ${esc(r.reason||"")}`;
  return r.winner===me?`You won! 🏆 ${esc(r.reason||"")}`:`${who(r.winner)} won. ${esc(r.reason||"")}`;}
function battleCard(b,me){const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const other=b.players.find(p=>p!==me);
  const vs=b.players.length>1?`<div class="vs">${b.players.map(p=>`<div>${crHtml(p)}<b>${p===me?"You":bName(b,p)}</b><span class="b-score">${scoreHtml(b,p)}</span></div>`).join(`<span class="vs-x">VS</span>`)}</div>`
    :`<div class="vs"><div>${crHtml(me)}<b>You</b><span class="b-score">${scoreHtml(b,me)}</span></div><span class="vs-x">VS</span><div><span class="cr">👻</span><b>Your best</b><span class="b-score">${b.pb!=null?fmtMs(b.pb):"None yet"}</span></div></div>`;
  const dis=S.busy.b?"disabled":"";let body="";
  if(b.status==="pending")body=b.players[1]===me?`<p><b>${bName(b,b.challenger)}</b> challenged you!</p><div class="row"><button class="btn" data-act="b-accept" data-id="${b.id}" ${dis}>Accept</button><button class="btn ghost" data-act="b-decline" data-id="${b.id}" ${dis}>Not now</button></div>`
    :`<p class="sub">Waiting for ${bName(b,other)} to accept…</p><button class="btn ghost small" data-act="b-cancel" data-id="${b.id}" ${dis}>Cancel challenge</button>`;
  else if(b.status==="active"){
    if(G.TIMED.includes(b.mode)){const a=(b.attempts||{})[me];
      body=!a?`<p class="sub">Tap Start, do "${esc(b.params.choreName)}", then tap Done. The chore is logged when you finish.</p><button class="btn block" data-act="b-start" data-id="${b.id}" ${dis}>▶ Start timer</button>${b.mode==="ghost"?`<button class="btn ghost small" style="margin-top:8px" data-act="b-cancel" data-id="${b.id}" ${dis}>Cancel</button>`:""}`
        :a.ms==null&&!a.void?`<div class="tt-big"><span class="tt-clock" data-start="${a.startAt}"></span></div><button class="btn block" data-act="b-finish" data-id="${b.id}" ${dis}>✓ Done!</button>`
        :`<p class="sub">${a.void?"Your run didn't count: "+esc(a.void):"Your time: <b>"+fmtMs(a.ms)+"</b>"}.${other?` Waiting for ${bName(b,other)}.`:""}</p>`;
    } else body=`<p class="sub">${b.mode==="race"?`First to ${b.params.n} chores wins. Do chores below to score!`:"Most chore XP wins. Bigger chores count more."} Ends ${fmtEnd(b.endAt)}.</p>`;
  } else if(b.status==="confirming"){const r=b.result||{};let act;
    if(r.needsParent)act=`<p class="hint">${r.disputedBy?"Someone asked a parent to check.":"That was super fast!"} A parent needs to check this one.</p>`;
    else if(other&&r.winner!==me)act=`<div class="row"><button class="btn" data-act="b-confirm" data-id="${b.id}" ${dis}>Looks good</button><button class="btn ghost" data-act="b-dispute" data-id="${b.id}" ${dis}>Ask a parent</button></div>`;
    else act=`<p class="hint">Waiting for ${other?bName(b,other)+" or ":""}a parent to confirm.</p>`;
    body=`<p class="b-result">${resultText(b,me)}</p>${act}`;}
  return `<div class="bcard ${b.status}"><div class="b-head"><b>${m.emoji} ${esc(m.name)}</b><span class="sub">${modeParams(b)}</span></div>${vs}${body}</div>`;}
function recentLine(b,me){const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const other=b.players.find(p=>p!==me);const xp=(b.xp||{})[me]||0;
  return `<li><span>${m.emoji} ${esc(m.name)}${other?` vs ${bName(b,other)}`:""}<br><small>${resultText(b,me)}</small></span><span class="amt pos">${xp?"+"+xp+" XP":""}</span></li>`;}
function battleBuilder(k,bb){const bc=game().battles,lv=xpState(k.id).level,mode=G.modeById(bb.mode);
  const modeBtn=m=>{const why=m.soon?"Coming soon":(bc.modesOff||[]).includes(m.id)?"Turned off":lv<m.level?`🔒 Level ${m.level}`:"";
    return `<button class="mode ${bb.mode===m.id?"on":""}" data-act="bb-mode" data-id="${m.id}" ${why?"disabled":""} aria-pressed="${bb.mode===m.id}"><span>${m.emoji}</span><b>${esc(m.name)}</b><small>${esc(why||m.desc)}</small></button>`;};
  let params="";
  if(bb.mode==="race")params=`<label>First to<select data-bind="bb.n">${[2,3,4,5,6].map(n=>`<option value="${n}" ${Number(bb.n)===n?"selected":""}>${n} chores</option>`).join("")}</select></label>`;
  if(bb.mode==="blitz")params=`<label>How long<select data-bind="bb.windowMin">${[[30,"30 minutes"],[60,"1 hour"],[0,"Until midnight"]].map(([v,l])=>`<option value="${v}" ${Number(bb.windowMin)===v?"selected":""}>${l}</option>`).join("")}</select></label>`;
  if(mode&&G.TIMED.includes(mode.id)){const pb=xpState(k.id).pb;
    params=`<label>Chore<select data-bind="bb.choreId">${bbChores(k.id,mode.id).map(c=>`<option value="${c.id}" ${bb.choreId===c.id?"selected":""}>${esc(c.name)}${mode.id==="ghost"&&pb[c.id]!=null?` (your best ${fmtMs(pb[c.id])})`:""}</option>`).join("")}</select></label>`;}
  const opp=mode&&!mode.solo?kidCfg(bb.opponent):null;let hc="";
  if(opp){const h=G.handicaps(k,opp,cfg());const y=h[k.id]>1?k:h[opp.id]>1?opp:null;if(y)hc=`<p class="hint">${y.id===k.id?"You're":esc(y.name)+" is"} younger, so ${y.id===k.id?"your":"their"} score counts ×${h[y.id]}.</p>`;}
  const soon=G.MODES.filter(m=>m.soon);
  return `<div class="builder"><h3>Pick a mode</h3><div class="modes">${G.MODES.filter(m=>!m.soon).map(modeBtn).join("")}</div>
    ${soon.length?`<p class="hint" style="margin:-4px 0 10px">Coming later: ${soon.map(m=>`${m.emoji} ${esc(m.name)} (level ${m.level})`).join(", ")}.</p>`:""}
    ${mode&&!mode.solo?`<h3>Who do you challenge?</h3><div class="seg" style="justify-content:flex-start">${kidsSorted().filter(p=>p.id!==k.id).map(p=>`<button class="${bb.opponent===p.id?"on":""}" data-act="bb-opp" data-id="${p.id}" aria-pressed="${bb.opponent===p.id}">${creatureFor(p.id)[1]} ${esc(p.name)}</button>`).join("")}</div>`:""}
    ${params?`<div class="row" style="margin-top:10px">${params}</div>`:""}${hc}
    <div class="row" style="margin-top:12px"><button class="btn" data-act="bb-send" ${!mode||(!mode.solo&&!opp)||S.busy.b?"disabled":""}>${S.busy.b?"Sending…":mode&&mode.solo?"Start":"Send challenge"}</button><button class="btn ghost" data-act="bb-close">Cancel</button></div></div>`;}
const bbChores=(kidId,mode)=>cfg().chores.filter(c=>c.kind==="family"&&(c.assign==="pool"||(mode==="ghost"&&c.assign===kidId)));
function battleSection(k){const bc=game().battles;const mine=battleList().filter(b=>b.players.includes(k.id));const live=mine.filter(b=>b.live);const recent=mine.filter(b=>!b.live&&b.status==="done").slice(0,3);
  if(!bc.enabled&&!live.length&&!recent.length)return "";
  const bb=S.ui.bb&&S.ui.bb.kid===k.id?S.ui.bb:null;const asleep=bc.enabled&&G.inQuietHours(nowHM(),cfg());
  const t12=hm=>{const [h,m]=hm.split(":").map(Number);return new Date(2000,0,1,h,m).toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});};
  return `<section class="card battles"><div class="sec-head"><h2>⚔️ Battles</h2>${bc.enabled&&!bb?(asleep?`<span class="sub">😴 Asleep until ${t12(bc.quietEnd)}</span>`:`<button class="btn small" data-act="bb-open">Challenge</button>`):""}</div>
    ${bb?battleBuilder(k,bb):""}${live.map(b=>battleCard(b,k.id)).join("")}
    ${!live.length&&!bb?`<p class="empty">${bc.enabled?"No battles right now. Challenge someone, or race your own best time.":"Battles are turned off."}</p>`:""}
    ${recent.length?`<ul class="feed recent">${recent.map(b=>recentLine(b,k.id)).join("")}</ul>`:""}</section>`;}

function viewDisplay(){
  const d=(7-new Date().getDay())%7;const cash=d===0?"Cash-out tonight":`Cash-out in ${d} day${d===1?"":"s"}`;
  const all=[];for(const w of Object.values(S.weeks))for(const e of w.entries||[])if(e.status!=="reversed")all.push({...e,kidId:w.kidId});
  const recent=all.sort((a,b)=>b.t-a.t).slice(0,5).map(e=>{const k=kidCfg(e.kidId);return k?`<b>${esc(k.name)}</b> ${esc(e.name.toLowerCase())} +${money(e.amount)}`:"";}).filter(Boolean);
  const ups=cfg().kids.map(k=>({k,lu:xpState(k.id).levelUp})).filter(x=>x.lu&&Date.now()-x.lu.at<24*3600e3).map(x=>`⭐ <b>${esc(x.k.name)}</b> reached level ${x.lu.level}!`);
  const cot=choreById(cotdId()||"");
  return `<div class="board"><header class="board-head"><h1>Boon Bank</h1><div class="when">${new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}. <b>${cash}</b>${cot?`<span class="cotd-chip">⭐ Double XP: ${esc(cot.name)}</span>`:""}</div></header>
  ${battleStrip()}
  <div class="lanes">${kidsSorted().map(k=>{const ks=kidState(k.id),w=getWeek(k.id,activeWeek(k.id)),net=weekNet(w),won=w.goal&&net>=w.goal,s=streak(k.id),saved=ks.goals.reduce((a,g)=>a+g.balance,0),x=xpState(k.id);
    return `<section class="lane ${won?"won":""}" data-kid="${k.id}"><div class="lane-who"><span class="lane-cr">${crHtml(k.id)}</span><div><h2>${esc(k.name)}</h2><span class="lvl-badge">Lv ${x.level}</span> <span class="streak">🔥 ${s}</span><small class="lane-title">${esc(titleOf(k.id))}</small></div></div>
      <div class="lane-track">${w.goal?trail(net/w.goal,crHtml(k.id),won,`${esc(k.name)} is at ${Math.round(net/w.goal*100)}% of their goal`,equipped(k.id).trail):`<p class="sub">Waiting for this week's goal</p>`}</div>
      <div class="lane-num"><b>${money(net)}</b><span>${w.goal?"of "+money(w.goal):"No goal yet"}</span>${w.goal?`<em class="${won?"won-note":""}">${won?"Goal reached!":Math.round(net/w.goal*100)+"%"}</em>`:""}</div>
      <div class="lane-buckets"><span class="chip" style="--c:var(--sky)">Save ${money(saved)}</span><span class="chip" style="--c:var(--pine)">Invest ${money(ks.invest)}</span><span class="chip" style="--c:var(--coral)">Give ${money(ks.give)}</span></div></section>`;}).join("")}</div>
  <footer class="ticker">${[...ups,...(recent.length?["Latest: "+recent.join("&emsp;")]:[])].join("&emsp;")||"No chores done yet this week. Who's first?"}</footer></div>`;
}
// Live battles across the top of the family display.
function battleStrip(){const bl=battleList().filter(b=>b.live&&b.status!=="pending");if(!bl.length)return "";
  return `<div class="battle-strip" aria-label="Battles going on">${bl.map(b=>{const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const r=b.result||{};
    const who=b.players.map(p=>`<span class="bs-p">${crHtml(p)} <b>${bName(b,p)}</b> <span class="bs-score">${scoreHtml(b,p)}</span></span>`).join(`<span class="vs-x">vs</span>`);
    const tail=b.status==="confirming"?`<em>${r.noContest?"No contest":r.tie?"Tie!":b.mode==="ghost"?(r.winner?"New best!":"So close!"):bName(b,r.winner)+" wins!"}</em>`:b.mode==="ghost"?`<span class="vs-x">vs</span><span class="bs-p">👻 best ${b.pb!=null?fmtMs(b.pb):"—"}</span>`:"";
    return `<div class="bs"><span class="bs-mode">${m.emoji} ${esc(m.name)}</span>${who}${tail}</div>`;}).join("")}</div>`;}

/* ---------- parent ---------- */
function viewParent(){
  const adults=kidsSorted().filter(k=>k.adult);
  const email=String(S.user&&S.user.email||"").toLowerCase();const mine=a=>a.email&&a.email.toLowerCase()===email;
  const tabs=[...adults.map(a=>["me:"+a.id,a.name+(mine(a)?" (you)":"")]),["activity","Activity"],["game","Game"+(gameAlerts()?` (${gameAlerts()})`:"")],["deductions","Deductions"],["cashout","Cash-out"],["goals","Savings goals"],["devices","Devices"],["settings","Settings"]];
  if(!tabs.some(t=>t[0]===S.ptab))S.ptab="activity";
  let body;if(S.ptab.startsWith("me:")){S.viewKid=S.ptab.slice(3);body=viewKid(S.viewKid,true);}
  else body={activity:pActivity,game:pGame,deductions:pDeductions,cashout:pCashout,goals:pGoals,devices:pDevices,settings:pSettings}[S.ptab]();
  return `<div class="wrap"><header class="p-head"><div><h1>Parent</h1><p class="sub">Signed in as ${esc(parentName())}</p></div><button class="btn ghost small" data-act="sign-out">Sign out</button></header>
  <nav class="tabs">${tabs.map(t=>`<button class="${S.ptab===t[0]?"on":""}" data-act="ptab" data-tab="${t[0]}">${esc(t[1])}</button>`).join("")}</nav>${body}</div>`;
}
function pActivity(){
  const y=addDays(ymd(),-1);let flags="";
  for(const k of kidsSorted().filter(k=>!k.adult)){const done=kidState(k.id).prLog[y]||[];
    const miss=[...prChores().filter(c=>!done.includes(c.id)).map(c=>c.name),...famChoresFor(k.id).filter(c=>c.assign===k.id&&countOnDate(k.id,c.id,y)===0).map(c=>c.name)];
    for(const m of miss)flags+=`<div class="flag-row"><span><b>${esc(k.name)}</b> didn't check off ${esc(m)}</span><button class="btn ghost small" data-act="prefill-ded" data-kid="${k.id}" data-reason="${esc("Missed: "+m)}">Deduct</button></div>`;}
  const L=S.ui.log;if(!L.kid)L.kid=kidsSorted()[0].id;const lk=kidCfg(L.kid)||kidsSorted()[0];const lchores=famChoresFor(lk.id);if(!lchores.some(c=>c.id===L.chore))L.chore=lchores[0]?lchores[0].id:"";
  const all=[];for(const w0 of Object.values(S.weeks)){if(w0.closed)continue;const w=getWeek(w0.kidId,w0.week);for(const e of w.entries)all.push({e,w});}
  all.sort((a,b)=>b.e.t-a.e.t);
  return `<section class="card"><div class="sec-head"><h2>Log a chore</h2></div><p class="hint" style="margin-top:0">For anyone without their tablet handy.</p>
    <div class="row"><label>Who<select data-bind="log.kid">${kidsSorted().map(k=>`<option value="${k.id}" ${k.id===lk.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>
    <label>Chore<select data-bind="log.chore">${lchores.map(c=>`<option value="${c.id}" ${c.id===L.chore?"selected":""}>${esc(c.name)} (+${money(choreValue(lk,c))})</option>`).join("")}</select></label>
    <button class="btn" style="flex:0 0 auto" data-act="log-chore" ${S.busy.log?"disabled":""}>${S.busy.log?"Saving…":"Log it"}</button></div></section>
  <section class="card"><div class="sec-head"><h2>Missed yesterday</h2></div>${flags||`<p class="empty">Nothing missed yesterday.</p>`}<p class="hint">Nothing is deducted automatically. You decide.</p></section>
  <section class="card"><div class="sec-head"><h2>This week's chores</h2></div>${all.length?`<ul class="feed">${all.slice(0,50).map(({e,w})=>{const k=kidCfg(w.kidId);const l=choreLine(e);
    const btn=`<button class="btn ghost small" data-act="${e.status==="reversed"?"restore":"reverse"}" data-kid="${w.kidId}" data-wk="${w.week}" data-id="${e.id}">${e.status==="reversed"?"Restore":"Reverse"}</button>`;
    return `<li><span style="flex:1"><b>${esc(k?k.name:"?")}</b>: ${l[0]}</span>${l[1]}${btn}</li>`;}).join("")}</ul>`:`<p class="empty">No chores logged yet this week.</p>`}</section>`;
}
const gameAlerts=()=>battleList().filter(b=>b.live&&b.status==="confirming"&&b.result&&b.result.needsParent).length;
function pGame(){
  const live=battleList().filter(b=>b.live),cot=cotdId(),fam=cfg().chores.filter(c=>c.kind==="family"),g=game();
  const email=String(S.user&&S.user.email||"").toLowerCase();
  const line=b=>{const m=G.modeById(b.mode)||{emoji:"⚔️",name:"Battle"};const r=b.result||{};const names=b.players.map(p=>bName(b,p)).join(" vs ");
    const mine=b.players.some(p=>{const k=kidCfg(p);return k&&k.email&&k.email.toLowerCase()===email;});
    const times=G.TIMED.includes(b.mode)?" Times: "+b.players.map(p=>`${bName(b,p)} ${scoreHtml(b,p)}`).join(", ")+".":b.scores?" Score: "+b.players.map(p=>`${bName(b,p)} ${scoreHtml(b,p)}`).join(", ")+".":"";
    const status=b.status==="confirming"?`${resultText(b,null)}${r.needsParent?(r.disputedBy?` ${bName(b,r.disputedBy)} asked you to check.`:" Flagged: a run under a minute."):" Waiting for the other player (auto-confirms after 12 hours)."}`:b.status==="pending"?"Waiting to be accepted.":"In progress.";
    const btns=b.status==="confirming"&&!mine?`<button class="btn small" data-act="p-bconfirm" data-id="${b.id}">Confirm</button><button class="btn ghost small" data-act="p-bvoid" data-id="${b.id}">No contest</button>`
      :b.status!=="confirming"?`<button class="btn ghost small" data-act="p-bcancel" data-id="${b.id}">Call off</button>`:`<small>Another parent needs to check this one.</small>`;
    return `<li><span style="flex:1"><b>${m.emoji} ${esc(m.name)}</b>: ${names}<br><small>${modeParams(b)}. ${status}${times}</small></span>${btns}</li>`;};
  const hist=id=>{const h=S.ui.xpHist[id];if(!h)return "";if(h==="loading")return `<p class="sub">Loading…</p>`;
    return h.length?`<ul class="feed">${h.map(e=>`<li><span>${esc(e.reason)}<br><small>${timeOf(e.t)}</small></span><span class="amt pos">+${e.amount} XP</span></li>`).join("")}</ul>`:`<p class="empty">No XP yet.</p>`;};
  return `<section class="card"><div class="sec-head"><h2>Battles</h2><span class="sub">${g.battles.enabled?"On":"Off"}. Change in Settings</span></div>
    ${live.length?`<ul class="feed">${live.sort((a,b)=>(b.status==="confirming")-(a.status==="confirming")).map(line).join("")}</ul>`:`<p class="empty">No battles going on.</p>`}
    <p class="hint">Speed results wait for the other player or a parent to confirm. Runs under a minute and disputes always need a parent. "No contest" ends a battle with no XP.</p></section>
  <section class="card"><div class="sec-head"><h2>Chore of the Day</h2></div>
    ${g.choreOfDay.enabled?`<div class="row"><label>Today's double-XP chore<select data-change="cotd">${fam.map(c=>`<option value="${c.id}" ${c.id===cot?"selected":""}>${esc(c.name)}</option>`).join("")}</select></label></div>
    <p class="hint">It rotates automatically each day. Picking one here changes today only. Point it at the chores nobody picks.</p>`:`<p class="empty">Turned off in Settings.</p>`}</section>
  <section class="card"><div class="sec-head"><h2>Levels</h2></div>${kidsSorted().map(k=>{const x=xpState(k.id);
    return `<div class="flag-row"><span style="flex:1"><span class="lvl-cr">${crHtml(k.id)}</span> <b>${esc(k.name)}</b>: level ${x.level}, ${x.total.toLocaleString()} XP${x.freezes?`, 🧊 ${x.freezes}`:""}<br><small>${esc(titleOf(k.id))}. ${x.need?`${x.need-x.into} XP to level ${x.level+1}`:"Top level"}</small></span>
      <button class="btn ghost small" data-act="xp-hist" data-kid="${k.id}">${S.ui.xpHist[k.id]?"Hide":"XP history"}</button></div>${hist(k.id)}`;}).join("")}
    <div class="handoff" style="margin-top:14px"><b>Count past chores</b><br>Gives everyone XP for the chores, goals, streaks, and badges they earned before levels existed. Safe to run more than once: nothing is counted twice.
    <button class="btn block" style="margin-top:10px" data-act="backfill" ${S.busy.backfill?"disabled":""}>${S.busy.backfill?"Counting…":"Count past chores"}</button></div></section>`;
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
function cashWeek(kidId){const thisMon=mondayOf(new Date()),prev=addDays(thisMon,-7);const pw=S.weeks[weekDocId(kidId,prev)];
  if(pw&&!pw.closed&&((pw.entries||[]).length||(pw.deductions||[]).length||pw.goal))return prev;const tw=S.weeks[weekDocId(kidId,thisMon)];if(tw&&tw.closed)return null;return thisMon;}
function cashoutPlan(kidId,wk){
  const w=getWeek(kidId,wk),ks=kidState(kidId),sp=cfg().split,net=weekNet(w),goal=w.goal||0,met=goal>0&&net>=goal,bonus=met?r2(goal*.1):0;
  const ex={spend:0,save:0,invest:0,give:0};const addSplit=a=>{for(const b in ex)ex[b]+=a*sp[b]/100;};
  if(net>0)addSplit(net);const owed=net<0?q(-net):0;
  const bonusTo=w.bonusTo||"split";if(bonus){if(bonusTo==="split")addSplit(bonus);else ex[bonusTo]+=bonus;}
  const saveTo=(ks.goals.find(g=>g.id===w.saveTo)||ks.goals[0]).id;
  const month=ymd().slice(0,7);const interestDue=ks.lastInterestMonth!==month&&ks.invest>0;const interest=interestDue?r2(calcInterest(ks.invest)):0;const interestTo=ks.interestTo||"invest";
  let goalInterest=0;if(interest){if(interestTo in ex)ex[interestTo]+=interest;else goalInterest=interest;}
  const total=q(ex.spend+ex.save+ex.invest+ex.give);const storage={save:q(ex.save),invest:q(ex.invest),give:q(ex.give)};
  let cash=r2(total-storage.save-storage.invest-storage.give);if(cash<0){storage.save=r2(storage.save+cash);cash=0;}
  return {wk,net,goal,met,bonus,bonusTo,owed,saveTo,interestDue,interest,interestTo,goalInterest,cash,storage,chores:choreCount(w),activeDed:w.deductions.filter(e=>e.status==="active").length};
}
function pCashout(){
  return (new Date().getDay()===0?"":`<p class="hint">It isn't Sunday yet. Cashing out now closes the week early.</p>`)+kidsSorted().map(k=>{
    const ks=kidState(k.id),wk=cashWeek(k.id);
    if(!wk){const c=getWeek(k.id,mondayOf(new Date())).cashout;return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">Cashed out</span></div>${c?`<div class="handoff">Handed <b>${money(c.cash)}</b> in cash. Into storage: Save <b>${money(c.storage.save)}</b>, Invest <b>${money(c.storage.invest)}</b>, Give <b>${money(c.storage.give)}</b>.${c.owed?` Collected <b>${money(c.owed)}</b> from Spend.`:""}</div>`:""}</section>`;}
    const p=cashoutPlan(k.id,wk);
    return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">Week of ${shortDate(wk)}</span></div>
    <dl class="kv"><dt>Earned (after deductions)</dt><dd>${money(p.net)}</dd><dt>Goal</dt><dd>${p.goal?money(p.goal)+(p.met?" reached":" missed"):"None set"}</dd>
    ${p.bonus?`<dt>Bonus (${esc(destName(ks,p.bonusTo))})</dt><dd>+${money(p.bonus)}</dd>`:""}
    ${p.interestDue?`<dt>Monthly interest (to ${esc(destName(ks,p.interestTo))})</dt><dd>+${money(p.interest)}</dd>`:""}
    ${p.activeDed?`<dt>Open deductions becoming final</dt><dd>${p.activeDed}</dd>`:""}</dl>
    <div class="handoff">${p.owed?`Earnings came up short. Collect <b>${money(p.owed)}</b> from ${esc(k.name)}'s Spend cash.<br>`:""}Hand ${esc(k.name)} <b>${money(p.cash)}</b> in cash.<br>
      Into storage: Save <b>${money(p.storage.save)}</b> (${esc(goalName(ks,p.saveTo))}), Invest <b>${money(p.storage.invest)}</b>, Give <b>${money(p.storage.give)}</b>.${p.goalInterest?` Interest of <b>${money(p.goalInterest)}</b> goes to ${esc(goalName(ks,p.interestTo))}.`:""}</div>
    <button class="btn block" style="margin-top:12px" data-act="cashout" data-kid="${k.id}" ${S.busy["co:"+k.id]?"disabled":""}>Confirm cash-out for ${esc(k.name)}</button></section>`;}).join("");
}
function pGoals(){
  return kidsSorted().map(k=>{const ks=kidState(k.id),b=S.ui.buy,pg=S.ui.pgoal[k.id]||(S.ui.pgoal[k.id]={name:"",target:""});
    return `<section class="card"><div class="sec-head"><h2>${esc(k.name)}</h2><span class="sub">Invest ${money(ks.invest)}, Give ${money(ks.give)}</span></div>
    ${ks.goals.map(g=>`<div class="flag-row"><span><b>${esc(g.name)}</b><br><small>${money(g.balance)}${g.target?" of "+money(g.target):""}</small></span>
      ${b&&b.kid===k.id&&b.goal===g.id?`<span class="row" style="flex:0 1 260px"><input type="number" step="0.25" inputmode="decimal" aria-label="Purchase amount" data-bind="buy.amount" data-type="num" value="${esc(b.amount)}"><button class="btn small" data-act="confirm-buy">Log</button><button class="btn ghost small" data-act="cancel-buy">Cancel</button></span>`
      :`<button class="btn ghost small" data-act="buy-goal" data-kid="${k.id}" data-goal="${g.id}" ${g.balance>0?"":"disabled"}>Log purchase</button>`}</div>`).join("")}
    <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="pgoal.${k.id}.name" value="${esc(pg.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="pgoal.${k.id}.target" value="${esc(pg.target)}"><button class="btn small" data-act="p-add-goal" data-kid="${k.id}">Add</button></div>
    ${ks.archived.length?`<p class="hint">Bought so far: ${ks.archived.map(a=>`${esc(a.name)} (${money(a.bought)}, ${shortDate(a.date)})`).join(", ")}</p>`:""}</section>`;}).join("");
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
function startDraft(){const c=clone(cfg());c.kids.forEach(k=>k.remindStr=(k.remind||[]).join(", "));c.game=clone(G.gameCfg(c));S.ui.draft=c;}
function gameSettings(d){const g=d.game,b=g.battles;const chk=(path,on,label)=>`<label class="check-label"><input type="checkbox" data-bind="draft.game.${path}" ${on?"checked":""}> ${label}</label>`;
  return `<section class="card"><div class="sec-head"><h2>Game</h2></div>
    <div class="grid-2">${chk("choreOfDay.enabled",g.choreOfDay.enabled,"Chore of the Day (double XP)")}${chk("streakMultiplier.enabled",g.streakMultiplier.enabled,`Streak bonus (×${g.streakMultiplier.mult} XP at ${g.streakMultiplier.minStreak}+ days)`)}${chk("battles.enabled",b.enabled,"Battles")}</div>
    <h3 style="margin-top:14px">Battle modes</h3><div class="grid-2">${G.MODES.filter(m=>!m.soon).map(m=>`<label class="check-label"><input type="checkbox" data-act="toggle-mode" data-id="${m.id}" ${(b.modesOff||[]).includes(m.id)?"":"checked"}> ${m.emoji} ${esc(m.name)}</label>`).join("")}</div>
    <div class="grid-2" style="margin-top:12px">
    <label>No battles from<input type="time" data-bind="draft.game.battles.quietStart" value="${esc(b.quietStart)}"></label>
    <label>Until<input type="time" data-bind="draft.game.battles.quietEnd" value="${esc(b.quietEnd)}"></label>
    <label>Battles per person per day<input type="number" min="1" step="1" data-type="num" data-bind="draft.game.battles.dailyCap" value="${esc(b.dailyCap)}"></label>
    <label>Handicap per year younger (%)<input type="number" min="0" step="1" data-type="num" data-bind="draft.game.battles.handicapPct" value="${esc(b.handicapPct??Math.round(b.handicapPerYear*100))}"></label>
    <label>Biggest handicap (×)<input type="number" min="1" step="0.05" data-type="num" data-bind="draft.game.battles.handicapMax" value="${esc(b.handicapMax)}"></label></div>
    <p class="hint">Handicap example: with 8% per year, a kid 4 years younger scores ×1.32. Adults count as age ${b.adultAge}. XP never goes down, and battles never cost money.</p></section>`;}
function pSettings(){
  if(!S.ui.draft)startDraft();const d=S.ui.draft;
  const choreRow=(c,i)=>`<div class="set-block"><div class="row"><label>Chore<input data-bind="draft.chores.${i}.name" value="${esc(c.name)}"></label>
    ${c.kind==="pr"?`<label>Details<input data-bind="draft.chores.${i}.note" value="${esc(c.note||"")}"></label>`:`<label>Pays (× base rate)<input type="number" step="0.5" min="0" data-type="num" data-bind="draft.chores.${i}.mult" value="${esc(c.mult)}"></label>
    <label>Daily limit<input type="number" step="1" min="1" data-type="num" data-bind="draft.chores.${i}.limit" value="${esc(c.limit)}"></label>
    <label>Who<select data-bind="draft.chores.${i}.assign"><option value="pool" ${c.assign==="pool"?"selected":""}>Anyone</option>${d.kids.map(k=>`<option value="${k.id}" ${c.assign===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>`}
    <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-chore" data-i="${i}">Remove</button></div></div>`;
  return `<section class="card"><div class="sec-head"><h2>People</h2><button class="btn ghost small" data-act="add-kid">Add person</button></div>
    ${d.kids.map((k,i)=>`<div class="set-block"><div class="row"><label>Name<input data-bind="draft.kids.${i}.name" value="${esc(k.name)}"></label>${k.adult?`<label>Google email<input type="email" data-bind="draft.kids.${i}.email" value="${esc(k.email||"")}" placeholder="Their parent sign-in"></label>`:`<label>Age<input type="number" data-type="num" data-bind="draft.kids.${i}.age" value="${esc(k.age)}"></label>`}
    <label class="check-label"><input type="checkbox" data-bind="draft.kids.${i}.adult" ${k.adult?"checked":""}> Adult</label>
    <label>Base rate per chore<input type="number" step="0.05" data-type="num" data-bind="draft.kids.${i}.rate" value="${esc(k.rate)}"></label>
    <label>Reminder times<input data-bind="draft.kids.${i}.remindStr" value="${esc(k.remindStr)}" placeholder="15:30, 19:30"></label>
    <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-kid" data-i="${i}">Remove</button></div></div>`).join("")}</section>
  <section class="card"><div class="sec-head"><h2>Family chores (paid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="family">Add chore</button></div>${d.chores.map((c,i)=>c.kind==="family"?choreRow(c,i):"").join("")}</section>
  <section class="card"><div class="sec-head"><h2>Personal responsibility (unpaid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="pr">Add item</button></div>${d.chores.map((c,i)=>c.kind==="pr"?choreRow(c,i):"").join("")}</section>
  ${gameSettings(d)}
  <section class="card"><div class="sec-head"><h2>Invest interest (monthly)</h2></div><div class="grid-2">
    <label>Rate up to threshold (%)<input type="number" step="0.5" data-type="num" data-bind="draft.interest.low" value="${esc(d.interest.low)}"></label>
    <label>Threshold ($)<input type="number" step="1" data-type="num" data-bind="draft.interest.threshold" value="${esc(d.interest.threshold)}"></label>
    <label>Rate above threshold (%)<input type="number" step="0.5" data-type="num" data-bind="draft.interest.high" value="${esc(d.interest.high)}"></label></div>
    <p class="hint">At today's balances, this month's interest would cost ${money(cfg().kids.reduce((s,k)=>s+calcInterest(kidState(k.id).invest),0))} in total.</p></section>
  <div class="row" style="margin-top:14px"><button class="btn" data-act="save-settings">Save settings</button><button class="btn ghost" data-act="discard-settings">Discard changes</button></div>`;
}

/* ---------- writes ---------- */
const weekRef=(kid,wk)=>doc(db,"weeks",weekDocId(kid,wk));
async function txWeek(kid,wk,mut){await runTransaction(db,async t=>{const s=await t.get(weekRef(kid,wk));const w=Object.assign({kidId:kid,week:wk,entries:[],deductions:[]},s.exists()?s.data():{});mut(w);t.set(weekRef(kid,wk),w);});}
// Calls a battle function as the person on screen (parents pass as:null to act as a parent).
async function bcall(name,data,okMsg){S.busy.b=true;render();
  try{const r=await call(name)({as:S.viewKid,...data});if(okMsg)toast(okMsg);return r.data||{};}catch(e){toast(errMsg(e));return null;}finally{delete S.busy.b;}}
function guard(p,okMsg){return p.then(()=>{if(okMsg)toast(okMsg);}).catch(e=>toast("Couldn't save: "+errMsg(e)));}

async function doChore(kidId,choreId){
  const k=kidCfg(kidId),ch=choreById(choreId),today=ymd();if(!k||!ch)return;
  if(choreCountToday(k.id,ch,today)>=(ch.limit||1)){toast("That one's done for today.");return;}
  const wk=activeWeek(k.id),w=getWeek(k.id,wk),before=weekNet(w),amt=choreValue(k,ch);
  S.busy["c:"+choreId]=true;render();
  try{await call("completeChore")({kidId,choreId});
    const xpAmt=choreXpFor(k.id,ch);
    if(w.goal&&before<w.goal&&before+amt>=w.goal){confetti(260);chime(true);toast("Goal reached! Bonus locked in.");}else{confetti(50);chime(false);toast(`+${money(amt)} and +${xpAmt} XP for ${ch.name.toLowerCase()}`);}}
  catch(e){toast(errMsg(e));}
  finally{delete S.busy["c:"+choreId];render();}
}
async function doCashout(kidId){
  const wk=cashWeek(kidId);if(!wk)return;const p=cashoutPlan(kidId,wk);const k=kidCfg(kidId);
  if(!confirm(`Cash out ${k.name}? Hand over ${money(p.cash)} in cash${p.owed?` and collect ${money(p.owed)}`:""}.`))return;
  const month=ymd().slice(0,7);S.busy["co:"+kidId]=true;render();
  try{await runTransaction(db,async t=>{
    const wref=weekRef(kidId,wk),bref=doc(db,"bank",kidId);const ws=await t.get(wref),bs=await t.get(bref);
    const w=Object.assign({kidId,week:wk,entries:[],deductions:[]},ws.exists()?ws.data():{});if(w.closed)throw new Error("That week is already cashed out.");
    const b=Object.assign({goalBal:{},invest:0,give:0,archived:[],stats:{}},bs.exists()?bs.data():{});
    const addGoal=(id,amt)=>{if(amt)b.goalBal[id]=r2((b.goalBal[id]||0)+amt);};
    addGoal(p.saveTo,p.storage.save);b.invest=r2((b.invest||0)+p.storage.invest);b.give=r2((b.give||0)+p.storage.give);
    if(p.interestDue){b.lastInterestMonth=month;addGoal(p.interestTo,p.goalInterest);}
    b.stats.chores=(b.stats.chores||0)+p.chores;b.stats.goalHits=(b.stats.goalHits||0)+(p.met?1:0);b.stats.earned=r2((b.stats.earned||0)+Math.max(0,p.net)+p.bonus);
    w.closed=true;w.cashout={at:Date.now(),by:parentName(),net:p.net,goal:p.goal,met:p.met,bonus:p.bonus,interest:p.interest,cash:p.cash,owed:p.owed,storage:p.storage,saveTo:p.saveTo,goalInterest:p.goalInterest};
    w.deductions=w.deductions.map(d=>d.status==="active"?{...d,status:"final"}:d);
    t.set(wref,w);t.set(bref,b);});toast(`${k.name} is cashed out.`);}
  catch(e){toast("Couldn't cash out: "+errMsg(e));}
  finally{delete S.busy["co:"+kidId];render();}
}
async function enablePush(silent){
  try{const m=await messaging();if(!m){if(!silent)toast("This device can't get reminders.");return;}
    if(!silent){const p=await Notification.requestPermission();if(p!=="granted"){render();return;}}
    const reg=await navigator.serviceWorker.register("/firebase-messaging-sw.js");
    const token=await getToken(m,{vapidKey:VAPID_KEY,serviceWorkerRegistration:reg});
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
  case "bb-open":{const pool=bbChores(kid,"timetrial")[0];S.ui.bb={kid,mode:"race",opponent:"",n:"3",windowMin:"60",choreId:pool?pool.id:""};break;}
  case "bb-close": S.ui.bb=null;break;
  case "bb-mode":{const bb=S.ui.bb;bb.mode=ds.id;if(G.TIMED.includes(ds.id)&&!bbChores(kid,ds.id).some(c=>c.id===bb.choreId)){const c=bbChores(kid,ds.id)[0];bb.choreId=c?c.id:"";}break;}
  case "bb-opp": S.ui.bb.opponent=ds.id;break;
  case "bb-send":{const bb=S.ui.bb,m=G.modeById(bb.mode);const r=await bcall("createBattle",{mode:bb.mode,opponent:bb.opponent,n:Number(bb.n),windowMin:Number(bb.windowMin),choreId:bb.choreId});
    if(r){S.ui.bb=null;toast(m.solo?"Ghost race is on. Start when you're ready!":`Challenge sent to ${kidCfg(bb.opponent).name}!`);}break;}
  case "b-accept": if(await bcall("respondBattle",{id:ds.id,accept:true})){confetti(60);chime(false);toast("Battle on! Go go go!");}break;
  case "b-decline": await bcall("respondBattle",{id:ds.id,accept:false});break;
  case "b-cancel": await bcall("cancelBattle",{id:ds.id},"Called off.");break;
  case "b-start": await bcall("startAttempt",{id:ds.id},"Timer started. Go!");break;
  case "b-finish":{const r=await bcall("finishAttempt",{id:ds.id});if(r){confetti(80);chime(true);toast(`Done in ${fmtMs(r.ms)}! Chore logged.`);}break;}
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
  case "do-chore": doChore(kid,ds.id);return;
  case "toggle-pr":{const id=ds.id;const done=kidState(kid).prLog[today]||[];const on=done.includes(id);
    guard(setDoc(doc(db,"prefs",kid),{prLog:{[today]:on?arrayRemove(id):arrayUnion(id)}},{merge:true}));
    if(!on&&prChores().every(c=>c.id===id||done.includes(c.id))){confetti(90);chime(true);toast(`All done for today! Streak +1 and +${G.XP.checklist} XP.`);}return;}
  case "add-goal":{const g=S.ui.newGoal;const name=String(g.name||"").trim();const t=r2(g.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.newGoal={name:"",target:""};guard(setDoc(doc(db,"prefs",kid),{goals:{[uid()]:{name,target:t,created:Date.now()}}},{merge:true}));break;}
  case "ptab": if(S.ptab==="settings"&&ds.tab!=="settings")S.ui.draft=null;S.ptab=ds.tab;S.ui.pickCreature=false;break;
  case "log-chore":{const L=S.ui.log;if(!L.chore)return;S.busy.log=true;render();try{const r=await call("completeChore")({kidId:L.kid,choreId:L.chore});toast(`Logged +${money(r.data.amount)} for ${kidCfg(L.kid).name}.`);}catch(e){toast(errMsg(e));}finally{delete S.busy.log;render();}return;}
  case "reverse": case "restore": guard(txWeek(ds.kid,ds.wk,w=>{const e=w.entries.find(x=>x.id===ds.id);if(e)e.status=act==="reverse"?"reversed":"ok";}),act==="reverse"?"Reversed. Its XP comes off too.":"Restored, XP included.");return;
  case "prefill-ded": S.ui.ded={kid:ds.kid,amount:0.25,reason:ds.reason,how:"Do it today plus one extra chore"};S.ptab="deductions";break;
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
  case "p-add-goal":{const pg=S.ui.pgoal[ds.kid]||{};const name=String(pg.name||"").trim();const t=r2(pg.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.pgoal[ds.kid]={name:"",target:""};guard(setDoc(doc(db,"prefs",ds.kid),{goals:{[uid()]:{name,target:t,created:Date.now()}}},{merge:true}));break;}
  case "make-code":{const role=S.ui.newCode.role;const code=String(Math.floor(100000+Math.random()*900000));
    guard(setDoc(doc(db,"pairCodes",code),{role:role==="display"?"display":"kid",kidId:role==="display"?null:role,createdBy:parentName(),expiresAt:Timestamp.fromMillis(Date.now()+15*60000)}));return;}
  case "unpair": if(!confirm("Unpair this device? It will need a new code to reconnect."))return;guard(deleteDoc(doc(db,"devices",ds.id)),"Device unpaired.");return;
  case "add-kid": S.ui.draft.kids.push({id:uid(),name:"New person",age:8,rate:0.25,remind:[],remindStr:"15:30, 19:30"});break;
  case "rm-kid": if(!confirm("Remove this person from the app? Their saved money records stay in the database."))return;S.ui.draft.kids.splice(Number(ds.i),1);break;
  case "add-chore": S.ui.draft.chores.push(ds.kind==="pr"?{id:uid(),kind:"pr",name:"New item",note:""}:{id:uid(),kind:"family",name:"New chore",mult:1,limit:1,assign:"pool"});break;
  case "rm-chore": S.ui.draft.chores.splice(Number(ds.i),1);break;
  case "discard-settings": S.ui.draft=null;break;
  case "save-settings":{const d=clone(S.ui.draft);
    d.kids.forEach(k=>{k.remind=String(k.remindStr||"").split(",").map(s=>s.trim()).filter(s=>/^\d{1,2}:\d{2}$/.test(s)).map(s=>s.padStart(5,"0"));delete k.remindStr;k.rate=r2(k.rate);k.age=Number(k.age)||0;
      k.adult=!!k.adult;const em=String(k.email||"").trim().toLowerCase();if(k.adult&&em)k.email=em;else delete k.email;});
    const b=d.game.battles;if(b.handicapPct!=null){b.handicapPerYear=Math.max(0,Number(b.handicapPct)||0)/100;delete b.handicapPct;}
    b.handicapMax=Math.max(1,Number(b.handicapMax)||1);b.dailyCap=Math.max(1,Math.round(Number(b.dailyCap)||1));
    for(const t of ["quietStart","quietEnd"])if(!/^\d{2}:\d{2}$/.test(b[t]||""))b[t]=G.GAME_DEFAULTS.battles[t];
    d.chores.forEach(c=>{if(c.kind==="family"){c.mult=Number(c.mult)||1;c.limit=Math.max(1,Math.round(Number(c.limit)||1));if(c.assign!=="pool"&&!d.kids.some(k=>k.id===c.assign))c.assign="pool";}});
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
document.addEventListener("input",e=>{const el=e.target;if(!el.dataset.bind)return;let v=el.type==="checkbox"?el.checked:el.value;if(el.dataset.type==="num")v=v===""?"":Number(v);setPath(S.ui,el.dataset.bind,v);if(el.type==="checkbox"){render();return;}
  if(el.dataset.bind==="goalInput"){const m=document.querySelector(".goal-set .goal-msg");const n=Number(v)||0;if(m)m.textContent=n>0?`Reach it and you get a +${money(r2(n*.1))} bonus.`:"Bigger goal, bigger bonus.";}});
document.addEventListener("change",e=>{const el=e.target;if(el.dataset.bind&&el.tagName==="SELECT"){setPath(S.ui,el.dataset.bind,el.value);render();}if(el.dataset.change)handleChange(el.dataset.change,el);});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.id==="pin")handleAct("pair",{});});

let wakeLock=null;async function wake(){try{if("wakeLock" in navigator&&S.role==="display")wakeLock=await navigator.wakeLock.request("screen");}catch(e){}}
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")wake();});
setInterval(()=>{if(S.phase!=="ready")return;subscribeWeeks();const a=document.activeElement;if(!(a&&(a.tagName==="INPUT"||a.tagName==="SELECT"))&&!(S.role==="parent"&&S.ptab==="settings"))render();},60000);
