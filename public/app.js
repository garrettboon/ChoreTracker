import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, onAuthStateChanged, signInAnonymously, signInWithPopup, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, collection, query, where, onSnapshot, setDoc, updateDoc, deleteDoc, runTransaction, arrayUnion, arrayRemove, increment, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { VAPID_KEY } from "./config.js";

const CREATURES=[["dragon","🐉","Dragon"],["fox","🦊","Fox"],["frog","🐸","Frog"],["dino","🦖","T. rex"],["unicorn","🦄","Unicorn"],["octopus","🐙","Octopus"],["shark","🦈","Shark"],["turtle","🐢","Turtle"],["owl","🦉","Owl"],["bee","🐝","Bee"],["tiger","🐯","Tiger"],["penguin","🐧","Penguin"]];
const S={phase:"loading",user:null,role:null,device:null,config:null,bank:{},prefs:{},weeks:{},devices:[],codes:[],ptab:"activity",viewKid:null,busy:{},
  ui:{goalInput:"",newGoal:{name:"",target:""},ded:{kid:"",amount:0.25,reason:"",how:""},buy:null,pgoal:{},editGoal:null,kidView:null,adjust:null,split:{key:null,base:"",dirty:false,shares:{}},draft:null,pickCreature:false,prevPct:{},pair:{code:"",name:""},newCode:{role:"display"},log:{kid:"",chore:""}}};

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
}catch(e){document.getElementById("app").innerHTML=`<div class="center"><div class="logo">Boon <span>Chore Tracker</span></div><p class="sub" style="max-width:420px">Open this app from its Firebase Hosting address (your-project.web.app). It can't start from a saved file.</p></div>`;throw e;}
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
  return {creature:p.creature||null,interestTo:p.interestTo||"invest",prLog:p.prLog||{},prDone:p.prDone||{},goals,archived:b.archived||[],invest:r2(b.invest||0),give:r2(b.give||0),
    stats:Object.assign({chores:0,goalHits:0,redemptions:0,earned:0},b.stats||{}),lastInterestMonth:b.lastInterestMonth||null};
}
function creatureFor(kidId){const ks=kidState(kidId);const idx=cfg().kids.findIndex(k=>k.id===kidId);const id=ks.creature||CREATURES[Math.max(0,idx)%CREATURES.length][0];return CREATURES.find(c=>c[0]===id)||CREATURES[0];}
const weekDocId=(kid,wk)=>wk+"_"+kid;
function getWeek(kid,wk){return Object.assign({kidId:kid,week:wk,goal:null,entries:[],deductions:[],closed:false},S.weeks[weekDocId(kid,wk)]||{});}
function activeWeek(kid){const wk=mondayOf(new Date());const w=S.weeks[weekDocId(kid,wk)];return (w&&w.closed)?addDays(wk,7):wk;}
function weekNet(w){let n=0;for(const e of w.entries||[])if(e.status!=="reversed")n+=e.amount;for(const d of w.deductions||[])if(d.status==="active"||d.status==="final")n-=d.amount;return r2(n);}
const choreCount=w=>(w.entries||[]).filter(e=>e.status!=="reversed").length;
function countOnDate(kidId,choreId,date){let n=0;for(const w of Object.values(S.weeks)){if(w.kidId!==kidId)continue;for(const e of w.entries||[])if(e.choreId===choreId&&e.date===date&&e.status!=="reversed")n++;}return n;}
function choreCountToday(kidId,ch,date){const me=kidCfg(kidId);if(ch.assign==="pool"&&!(me&&me.adult))return cfg().kids.filter(k=>!k.adult).reduce((s,k)=>s+countOnDate(k.id,ch.id,date),0);return countOnDate(kidId,ch.id,date);}
const openWeeks=kidId=>Object.values(S.weeks).filter(w=>w.kidId===kidId&&!w.closed).map(w=>getWeek(w.kidId,w.week));
function prComplete(ks,date){if(ks.prDone&&ks.prDone[date])return true;const ids=prChores().map(c=>c.id);if(!ids.length)return false;const d=ks.prLog[date]||[];return ids.every(i=>d.includes(i));}
function streak(kidId){const ks=kidState(kidId);let d=ymd();if(!prComplete(ks,d))d=addDays(d,-1);let n=0;while(prComplete(ks,d)&&n<400){n++;d=addDays(d,-1);}return n;}
function bestStreak(kidId){const ks=kidState(kidId);const dates=[...new Set([...Object.keys(ks.prLog),...Object.keys(ks.prDone)])].filter(d=>prComplete(ks,d)).sort();let best=0,run=0,prev=null;for(const d of dates){run=(prev&&addDays(prev,1)===d)?run+1:1;best=Math.max(best,run);prev=d;}return best;}
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
let unsubs=[],deviceUnsub=null,weekKey="",weekUnsub=null;
function stopData(){unsubs.forEach(u=>u());unsubs=[];prBackfilled.clear();if(weekUnsub)weekUnsub();weekUnsub=null;weekKey="";S.config=null;S.bank={};S.prefs={};S.weeks={};S.devices=[];S.codes=[];}
function onErr(e){console.warn(e);if(e&&e.code==="permission-denied"&&S.role!=="parent"){/* device was unpaired */}}
function startData(){
  if(unsubs.length)return;
  unsubs.push(onSnapshot(doc(db,"app/config"),s=>{S.config=s.exists()?s.data():null;backfillPrDone();softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"bank"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.bank=m;softRender();},onErr));
  unsubs.push(onSnapshot(collection(db,"prefs"),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.prefs=m;backfillPrDone();softRender();},onErr));
  if(S.role==="parent"){
    unsubs.push(onSnapshot(collection(db,"devices"),s=>{S.devices=s.docs.map(d=>({id:d.id,...d.data()}));softRender();},onErr));
    unsubs.push(onSnapshot(collection(db,"pairCodes"),s=>{S.codes=s.docs.map(d=>({id:d.id,...d.data()}));softRender();},onErr));
  }
  subscribeWeeks();
}
function subscribeWeeks(){const mon=mondayOf(new Date());if(mon===weekKey)return;weekKey=mon;if(weekUnsub)weekUnsub();
  weekUnsub=onSnapshot(query(collection(db,"weeks"),where("week","in",[addDays(mon,-7),mon,addDays(mon,7)])),s=>{const m={};s.forEach(d=>m[d.id]=d.data());S.weeks=m;softRender();},onErr);}

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
function confetti(n=140){if(reduced)return;cv.width=innerWidth*devicePixelRatio;cv.height=innerHeight*devicePixelRatio;const W=cv.width,H=cv.height,cols=["#E3A20F","#2B7FC2","#2D6A4D","#D5553C","#9B6BD6"];
  for(let i=0;i<n;i++)parts.push({x:W/2+(Math.random()-.5)*W*.4,y:H*.35,vx:(Math.random()-.5)*16*devicePixelRatio,vy:(-Math.random()*14-5)*devicePixelRatio,s:(5+Math.random()*7)*devicePixelRatio,r:Math.random()*6,vr:(Math.random()-.5)*.3,c:cols[i%cols.length],life:140+Math.random()*60});if(!anim)loop();}
function loop(){cx.clearRect(0,0,cv.width,cv.height);for(const p of parts){p.vy+=.38*devicePixelRatio;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.r+=p.vr;p.life--;cx.save();cx.translate(p.x,p.y);cx.rotate(p.r);cx.fillStyle=p.c;cx.fillRect(-p.s/2,-p.s/3,p.s,p.s*.66);cx.restore();}
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
  $("#app").innerHTML=h;document.body.dataset.mode=mode();afterRender();
}
function softRender(){if(S.role==="parent"&&S.ptab==="settings"&&S.ui.draft)return;const a=document.activeElement;
  if(a&&a.tagName==="INPUT"&&S.role!=="display"){const b=a.dataset.bind;render();if(b){const el=document.querySelector(`[data-bind="${b}"]`);if(el){el.focus();try{const l=el.value.length;el.setSelectionRange(l,l)}catch(e){}}}return;}render();}
function afterRender(){
  if(S.role==="display"&&S.config){for(const k of cfg().kids){const w=getWeek(k.id,activeWeek(k.id));const p=w.goal?weekNet(w)/w.goal:0;const prev=S.ui.prevPct[k.id];
    if(prev!=null&&prev<1&&p>=1){confetti(220);chime(true);const el=document.querySelector(`.lane[data-kid="${k.id}"] .walker`);if(el)el.classList.add("cheer");}S.ui.prevPct[k.id]=p;}}
}

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

function trail(frac,cr,won,label){const f=Math.max(0,Math.min(1,frac||0));
  return `<div class="trail" role="img" aria-label="${esc(label||Math.round(f*100)+"% of goal")}"><div class="trail-fill" style="--f:${f}"></div><span class="walker ${won?"victory":""}" style="--f:${f}">${cr[1]}</span><span class="flag">🏁</span></div>`;}
function weekLabel(wk){return wk===mondayOf(new Date())?`Week of ${shortDate(wk)}`:`Next week starts ${shortDate(wk)}`;}
function daysLeft(wk){if(wk!==mondayOf(new Date()))return 7;return 7-((new Date().getDay()+6)%7);}

function viewKid(kidId,embedded){
  const k=kidCfg(kidId),ks=kidState(k.id),today=ymd(),wk=activeWeek(k.id),w=getWeek(k.id,wk),net=weekNet(w),cr=creatureFor(k.id);
  let h=embedded?"":`<div class="wrap">`;
  h+=`<header class="kid-head"><button class="avatar" data-act="pick-creature" aria-label="Change creature">${cr[1]}</button><div><h1>${esc(k.name)}</h1><p class="sub">${weekLabel(wk)}</p></div></header>`;
  h+=pushControl();
  if(S.ui.pickCreature)h+=`<section class="card"><div class="sec-head"><h2>Pick your creature</h2></div><div class="picker">${CREATURES.map(c=>`<button class="${c[0]===cr[0]?"on":""}" data-act="set-creature" data-id="${c[0]}"><span>${c[1]}</span>${c[2]}</button>`).join("")}</div></section>`;
  h+=reminderBanner(k,ks,today);
  h+=w.goal==null?goalSetter(k,wk):goalCard(k,ks,w,net,cr);
  h+=challengeCards(k.id)+prSection(k,ks,today)+choreSection(k,today)+moneySection(k,ks,w,net)+badgeSection(k.id)+activitySection(w);
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
    <div class="bonus">${won?"Bonus earned":"Bonus if you make it"}<b>+${money(bonus)}</b></div></div>${trail(net/w.goal,cr,won)}
    <p class="goal-msg">${won?"Goal reached! Your bonus is locked in.":`${money(w.goal-net)} to go`}</p>
    <label class="inline">Bonus goes to <select data-change="bonusTo" aria-label="Where your bonus goes">${["split","spend","save","invest","give"].map(o=>`<option value="${o}" ${o===bt?"selected":""}>${destName(ks,o)}</option>`).join("")}</select></label></section>`;
}
function challengeCards(kidId){let h="";for(const w of openWeeks(kidId))for(const d of w.deductions)if(d.status==="active")
  h+=`<section class="card challenge"><h3>Earn back ${money(d.amount)}</h3><p><b>${esc(d.reason)}</b></p>${d.how?`<p>How: ${esc(d.how)}</p>`:""}<p class="hint">When you've done it, ask a parent to mark it earned back. You have until Sunday's cash-out.</p></section>`;return h;}
function prSection(k,ks,today){const prs=prChores();if(!prs.length)return "";const done=ks.prLog[today]||[];const s=streak(k.id);
  return `<section class="card"><div class="sec-head"><h2>Every day</h2><span class="streak">🔥 ${s} day${s===1?"":"s"} in a row</span></div><div class="checks">${prs.map(c=>{const on=done.includes(c.id);
    return `<button class="check ${on?"on":""}" data-act="toggle-pr" data-id="${c.id}" aria-pressed="${on}"><span class="box">${on?"✓":""}</span><span><b>${esc(c.name)}</b>${c.note?`<small>${esc(c.note)}</small>`:""}</span></button>`;}).join("")}</div>
    <p class="hint">These don't pay. They're part of taking care of yourself. Finish all of them to keep your streak going.</p></section>`;}
function choreSection(k,today){const list=famChoresFor(k.id).sort((a,b)=>(a.assign==="pool")-(b.assign==="pool"));
  return `<section class="card"><div class="sec-head"><h2>Family chores</h2></div>${list.length?list.map(c=>{const n=choreCountToday(k.id,c,today),lim=c.limit||1,full=n>=lim,busy=S.busy["c:"+c.id];
    return `<div class="chore"><div><b>${esc(c.name)}</b><small><span class="tag ${c.assign===k.id?"mine":""}">${c.assign===k.id?"Yours":"Anyone"}</span>${n} of ${lim} done today</small></div><div class="c-val">+${money(choreValue(k,c))}</div><button class="btn small" data-act="do-chore" data-id="${c.id}" ${full||busy?"disabled":""}>${busy?"Saving…":full?"All done":"I did it"}</button></div>`;}).join(""):`<p class="empty">No chores set up yet.</p>`}</section>`;}
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
function moneySection(k,ks,w,net){const sp=splitAmt(Math.max(0,net));const goals=ks.goals;const g=S.ui.newGoal;
  return `<section class="card"><div class="sec-head"><h2>My money</h2></div><div class="buckets">
    <div class="bucket b-spend"><h3>Spend <small>${cfg().split.spend}%</small></h3><div class="money">${money(sp.spend)}</div><p>Cash you get Sunday night</p></div>
    <div class="bucket b-save"><h3>Save <small>${cfg().split.save}%</small></h3><div class="money">${money(goals.reduce((s,x)=>s+x.balance,0))}</div><p>+${money(sp.save)} this week</p>
      ${goals.map(x=>`<div class="sgoal"><div class="top"><span>${esc(x.name)}</span><span>${money(x.balance)}${x.target?" / "+money(x.target):""}</span></div>${x.target?`<div class="bar"><i style="width:${Math.min(100,x.balance/x.target*100)}%"></i></div>`:""}</div>`).join("")}
      ${splitEditor(k,ks,w,goals,sp.save)}
      <div class="mini-form"><input placeholder="New goal" aria-label="New goal name" data-bind="newGoal.name" value="${esc(g.name)}"><input type="number" inputmode="decimal" placeholder="$" aria-label="Goal amount" data-bind="newGoal.target" value="${esc(g.target)}"><button class="btn small" data-act="add-goal">Add</button></div></div>
    <div class="bucket b-invest"><h3>Invest <small>${cfg().split.invest}%</small></h3><div class="money">${money(ks.invest)}</div><p>+${money(sp.invest)} this week. Next monthly interest about ${money(calcInterest(ks.invest))}.</p>
      <label>Interest goes to<select data-change="interestTo">${["invest","spend","give",...goals.map(x=>x.id)].map(o=>`<option value="${o}" ${o===ks.interestTo?"selected":""}>${o==="invest"?"Back into Invest (it grows!)":destName(ks,o)}</option>`).join("")}</select></label></div>
    <div class="bucket b-give"><h3>Give <small>${cfg().split.give}%</small></h3><div class="money">${money(ks.give)}</div><p>+${money(sp.give)} this week</p></div></div></section>`;}
function badgeList(kidId){const ks=kidState(kidId),st=ks.stats;const live=openWeeks(kidId).reduce((s,w)=>s+choreCount(w),0);const chores=(st.chores||0)+live;
  const saved=ks.goals.reduce((s,g)=>s+g.balance,0)+ks.archived.reduce((s,g)=>s+(g.bought||0),0);
  return [["🧹","First chore",chores>=1],["💪","50 chores",chores>=50],["🎯","Goal getter",st.goalHits>=1],["🏆","5 goals hit",st.goalHits>=5],["🔥","7-day streak",bestStreak(kidId)>=7],["🔁","Comeback kid",st.redemptions>=1],["🐷","$25 saved",saved>=25],["🌱","$100 invested",ks.invest>=100],["💝","$10 given",ks.give>=10],["🎁","Bought a goal",ks.archived.length>=1]];}
function badgeSection(kidId){const b=badgeList(kidId);return `<section class="card"><div class="sec-head"><h2>Badges</h2><span class="sub">${b.filter(x=>x[2]).length} of ${b.length}</span></div><div class="badges">${b.map(x=>`<div class="badge ${x[2]?"":"locked"}"><span>${x[0]}</span>${x[1]}</div>`).join("")}</div></section>`;}
function choreLine(e){const rev=e.status==="reversed";return [`<span class="${rev?"struck":""}">${esc(e.name)}<br><small>${timeOf(e.t)}${rev?", reversed":""}</small></span>`,`<span class="amt ${rev?"struck":"pos"}">+${money(e.amount)}</span>`];}
function dedLine(d){const st={active:"can still earn back",redeemed:"earned back",final:"final"}[d.status]||d.status;return [`<span class="${d.status==="redeemed"?"struck":""}">${esc(d.reason)}<br><small>${timeOf(d.t)}, ${st}</small></span>`,`<span class="amt ${d.status==="redeemed"?"struck":"neg"}">−${money(d.amount)}</span>`];}
function activitySection(w){const list=[...w.entries.map(e=>({t:e.t,l:choreLine(e)})),...w.deductions.map(d=>({t:d.t,l:dedLine(d)}))].sort((a,b)=>b.t-a.t).slice(0,10);
  return `<section class="card"><div class="sec-head"><h2>This week</h2></div>${list.length?`<ul class="feed">${list.map(x=>`<li>${x.l.join("")}</li>`).join("")}</ul>`:`<p class="empty">Nothing yet. Pick a chore and get your creature moving.</p>`}</section>`;}

function viewDisplay(){
  const d=(7-new Date().getDay())%7;const cash=d===0?"Cash-out tonight":`Cash-out in ${d} day${d===1?"":"s"}`;
  const all=[];for(const w of Object.values(S.weeks))for(const e of w.entries||[])if(e.status!=="reversed")all.push({...e,kidId:w.kidId});
  const recent=all.sort((a,b)=>b.t-a.t).slice(0,5).map(e=>{const k=kidCfg(e.kidId);return k?`<b>${esc(k.name)}</b> ${esc(e.name.toLowerCase())} +${money(e.amount)}`:"";}).filter(Boolean);
  return `<div class="board"><header class="board-head"><h1>Boon Chore Tracker</h1><div class="when">${new Date().toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}. <b>${cash}</b></div></header>
  <div class="lanes">${kidsSorted().map(k=>{const ks=kidState(k.id),w=getWeek(k.id,activeWeek(k.id)),net=weekNet(w),cr=creatureFor(k.id),won=w.goal&&net>=w.goal,s=streak(k.id),saved=ks.goals.reduce((a,g)=>a+g.balance,0);
    return `<section class="lane ${won?"won":""}" data-kid="${k.id}"><div class="lane-who"><span class="lane-cr">${cr[1]}</span><div><h2>${esc(k.name)}</h2><span class="streak">🔥 ${s}</span></div></div>
      <div class="lane-track">${w.goal?trail(net/w.goal,cr,won,`${esc(k.name)} is at ${Math.round(net/w.goal*100)}% of their goal`):`<p class="sub">Waiting for this week's goal</p>`}</div>
      <div class="lane-num"><b>${money(net)}</b><span>${w.goal?"of "+money(w.goal):"No goal yet"}</span>${w.goal?`<em class="${won?"won-note":""}">${won?"Goal reached!":Math.round(net/w.goal*100)+"%"}</em>`:""}</div>
      <div class="lane-buckets"><span class="chip" style="--c:var(--sky)">Save ${money(saved)}</span><span class="chip" style="--c:var(--pine)">Invest ${money(ks.invest)}</span><span class="chip" style="--c:var(--coral)">Give ${money(ks.give)}</span></div></section>`;}).join("")}</div>
  <footer class="ticker">${recent.length?"Latest: "+recent.join("&emsp;"):"No chores done yet this week. Who's first?"}</footer></div>`;
}

/* ---------- parent ---------- */
function viewParent(){
  const adults=kidsSorted().filter(k=>k.adult);
  const tabs=[...adults.map(a=>["me:"+a.id,a.name]),["activity","Activity"],["board","Leaderboard"],["kids","Kid views"],["deductions","Deductions"],["cashout","Cash-out"],["goals","Savings goals"],["devices","Devices"],["settings","Settings"]];
  if(!tabs.some(t=>t[0]===S.ptab))S.ptab="activity";
  let body;if(S.ptab.startsWith("me:")){S.viewKid=S.ptab.slice(3);body=viewKid(S.viewKid,true);}
  else body={activity:pActivity,board:pBoard,kids:pKids,deductions:pDeductions,cashout:pCashout,goals:pGoals,devices:pDevices,settings:pSettings}[S.ptab]();
  return `<div class="wrap"><header class="p-head"><div><h1>Parent</h1><p class="sub">Signed in as ${esc(parentName())}</p></div><button class="btn ghost small" data-act="sign-out">Sign out</button></header>
  <nav class="tabs">${tabs.map(t=>`<button class="${S.ptab===t[0]?"on":""}" data-act="ptab" data-tab="${t[0]}">${esc(t[1])}</button>`).join("")}</nav>${body}</div>`;
}
function pBoard(){return `<div class="pboard">${viewDisplay()}</div>`;}
function pKids(){
  const kids=kidsSorted().filter(k=>!k.adult),cur=kids.find(k=>k.id===S.ui.kidView);
  if(!cur)return `<section class="card"><div class="sec-head"><h2>See a kid's screen</h2></div><p class="hint" style="margin:0 0 12px">Opens their tablet's screen exactly as they see it. Anything you tap there counts as them.</p>
    ${kids.length?`<div class="kid-list">${kids.map(k=>`<button class="choice" data-act="kid-view" data-kid="${k.id}"><span class="e">${creatureFor(k.id)[1]}</span><span><b>${esc(k.name)}</b><small>🔥 ${streak(k.id)} day streak</small></span></button>`).join("")}</div>`:`<p class="empty">No kids set up yet.</p>`}</section>`;
  S.viewKid=cur.id;
  return `<div class="asbar"><button class="btn ghost small" data-act="kid-view" data-kid="">← All kids</button><span>This is <b>${esc(cur.name)}</b>'s screen. Taps here count as ${esc(cur.name)}.</span></div>${viewKid(cur.id,true)}`;
}
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
    <label>Chore<select data-bind="log.chore">${lchores.map(c=>`<option value="${c.id}" ${c.id===L.chore?"selected":""}>${esc(c.name)} (+${money(choreValue(lk,c))})</option>`).join("")}</select></label>
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
  const saveParts=splitCents(storage.save,saveSplitFor(w,ks));
  return {wk,net,goal,met,bonus,bonusTo,owed,saveTo,saveParts,interestDue,interest,interestTo,goalInterest,cash,storage,chores:choreCount(w),activeDed:w.deductions.filter(e=>e.status==="active").length};
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
      Into storage: Save <b>${money(p.storage.save)}</b> (${savePartsText(ks,p.saveParts)}), Invest <b>${money(p.storage.invest)}</b>, Give <b>${money(p.storage.give)}</b>.${p.goalInterest?` Interest of <b>${money(p.goalInterest)}</b> goes to ${esc(goalName(ks,p.interestTo))}.`:""}</div>
    <button class="btn block" style="margin-top:12px" data-act="cashout" data-kid="${k.id}" ${S.busy["co:"+k.id]?"disabled":""}>Confirm cash-out for ${esc(k.name)}</button></section>`;}).join("");
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
  return `<div class="adjust"><h3>What ${esc(k.name)} has right now</h3><p class="hint" style="margin:0 0 10px">Use this for money from before the app, or to fix a mistake. Spend is handed over as cash each week, so it has no balance here.</p>
    <div class="grid-2">${ks.goals.map(g=>field(g.name,`adjust.goalBal.${g.id}`,a.goalBal[g.id])).join("")}${field("Invest","adjust.invest",a.invest)}${field("Give","adjust.give",a.give)}</div>
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
function startDraft(){const c=clone(cfg());c.kids.forEach(k=>k.remindStr=(k.remind||[]).join(", "));S.ui.draft=c;}
function pSettings(){
  if(!S.ui.draft)startDraft();const d=S.ui.draft;
  const choreRow=(c,i)=>`<div class="set-block" data-drag="chore" data-kind="${c.kind}" data-i="${i}"><div class="row"><span class="drag-handle" data-handle role="button" aria-label="Drag to reorder" title="Drag to reorder">⠿</span><label>Chore<input data-bind="draft.chores.${i}.name" value="${esc(c.name)}"></label>
    ${c.kind==="pr"?`<label>Details<input data-bind="draft.chores.${i}.note" value="${esc(c.note||"")}"></label>`:`<label>Pays (× base rate)<input type="number" step="0.5" min="0" data-type="num" data-bind="draft.chores.${i}.mult" value="${esc(c.mult)}"></label>
    <label>Daily limit<input type="number" step="1" min="1" data-type="num" data-bind="draft.chores.${i}.limit" value="${esc(c.limit)}"></label>
    <label>Who<select data-bind="draft.chores.${i}.assign"><option value="pool" ${c.assign==="pool"?"selected":""}>Anyone</option>${d.kids.map(k=>`<option value="${k.id}" ${c.assign===k.id?"selected":""}>${esc(k.name)}</option>`).join("")}</select></label>`}
    <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-chore" data-i="${i}">Remove</button></div></div>`;
  return `<section class="card"><div class="sec-head"><h2>People</h2><button class="btn ghost small" data-act="add-kid">Add person</button></div>
    ${d.kids.map((k,i)=>`<div class="set-block"><div class="row"><label>Name<input data-bind="draft.kids.${i}.name" value="${esc(k.name)}"></label>${k.adult?"":`<label>Age<input type="number" data-type="num" data-bind="draft.kids.${i}.age" value="${esc(k.age)}"></label>`}
    <label>Base rate per chore<input type="number" step="0.05" data-type="num" data-bind="draft.kids.${i}.rate" value="${esc(k.rate)}"></label>
    <label>Reminder times<input data-bind="draft.kids.${i}.remindStr" value="${esc(k.remindStr)}" placeholder="15:30, 19:30"></label>
    <button class="btn ghost small" style="flex:0 0 auto" data-act="rm-kid" data-i="${i}">Remove</button></div></div>`).join("")}</section>
  <section class="card"><div class="sec-head"><h2>Family chores (paid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="family">Add chore</button></div><p class="hint drag-hint">Drag the ⠿ handle to change the order kids see.</p>${d.chores.map((c,i)=>c.kind==="family"?choreRow(c,i):"").join("")}</section>
  <section class="card"><div class="sec-head"><h2>Personal responsibility (unpaid)</h2><button class="btn ghost small" data-act="add-chore" data-kind="pr">Add item</button></div><p class="hint drag-hint">Drag the ⠿ handle to change the order kids see.</p>${d.chores.map((c,i)=>c.kind==="pr"?choreRow(c,i):"").join("")}</section>
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
function guard(p,okMsg){return p.then(()=>{if(okMsg)toast(okMsg);}).catch(e=>toast("Couldn't save: "+errMsg(e)));}

async function doChore(kidId,choreId){
  const k=kidCfg(kidId),ch=choreById(choreId),today=ymd();if(!k||!ch)return;
  if(choreCountToday(k.id,ch,today)>=(ch.limit||1)){toast("That one's done for today.");return;}
  const wk=activeWeek(k.id),w=getWeek(k.id,wk),before=weekNet(w),amt=choreValue(k,ch);
  S.busy["c:"+choreId]=true;render();
  try{await call("completeChore")({kidId,choreId});
    if(w.goal&&before<w.goal&&before+amt>=w.goal){confetti(260);chime(true);toast("Goal reached! Bonus locked in.");}else{confetti(50);chime(false);toast(`+${money(amt)} for ${ch.name.toLowerCase()}`);}}
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
    for(const id in p.saveParts)addGoal(id,p.saveParts[id]);b.invest=r2((b.invest||0)+p.storage.invest);b.give=r2((b.give||0)+p.storage.give);
    if(p.interestDue){b.lastInterestMonth=month;addGoal(p.interestTo,p.goalInterest);}
    b.stats.chores=(b.stats.chores||0)+p.chores;b.stats.goalHits=(b.stats.goalHits||0)+(p.met?1:0);b.stats.earned=r2((b.stats.earned||0)+Math.max(0,p.net)+p.bonus);
    w.closed=true;w.cashout={at:Date.now(),by:parentName(),net:p.net,goal:p.goal,met:p.met,bonus:p.bonus,interest:p.interest,cash:p.cash,owed:p.owed,storage:p.storage,saveTo:p.saveTo,saveParts:p.saveParts,goalInterest:p.goalInterest};
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
  case "set-creature": S.ui.pickCreature=false;guard(setDoc(doc(db,"prefs",kid),{creature:ds.id},{merge:true}));break;
  case "goal-chip": S.ui.goalInput=String(ds.v);break;
  case "set-goal":{const v=q(S.ui.goalInput);if(!(v>0)){toast("Pick a goal of at least $0.25.");return;}const wk=activeWeek(kid);S.ui.goalInput="";
    guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,goal:v},{merge:true}));confetti(60);chime(false);break;}
  case "do-chore": doChore(kid,ds.id);return;
  case "toggle-pr":{const id=ds.id,ks=kidState(kid),done=ks.prLog[today]||[],on=done.includes(id);
    const complete=!on&&prChores().every(c=>c.id===id||done.includes(c.id));const upd={prLog:{[today]:on?arrayRemove(id):arrayUnion(id)}};
    if(complete)upd.prDone={[today]:true};else if(on)upd.prDone={[today]:false};
    guard(setDoc(doc(db,"prefs",kid),upd,{merge:true}));
    if(complete){confetti(90);chime(true);toast(ks.prDone[today]?"All done for today.":"All done for today. Streak +1!");}return;}
  case "add-goal":{const g=S.ui.newGoal;const name=String(g.name||"").trim();const t=r2(g.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.newGoal={name:"",target:""};guard(setDoc(doc(db,"prefs",kid),{goals:{[uid()]:{name,target:t,created:Date.now()}}},{merge:true}));break;}
  case "ptab": if(S.ptab==="settings"&&ds.tab!=="settings")S.ui.draft=null;S.ptab=ds.tab;S.ui.pickCreature=false;break;
  case "log-chore":{const L=S.ui.log;if(!L.chore)return;S.busy.log=true;render();try{const r=await call("completeChore")({kidId:L.kid,choreId:L.chore});toast(`Logged +${money(r.data.amount)} for ${kidCfg(L.kid).name}.`);}catch(e){toast(errMsg(e));}finally{delete S.busy.log;render();}return;}
  case "reverse": case "restore": guard(txWeek(ds.kid,ds.wk,w=>{const e=w.entries.find(x=>x.id===ds.id);if(e)e.status=act==="reverse"?"reversed":"ok";}));return;
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
  case "edit-goal":{const g=kidState(ds.kid).goals.find(x=>x.id===ds.goal);if(!g)return;S.ui.buy=null;S.ui.editGoal={kid:ds.kid,goal:ds.goal,name:g.name,target:g.target||""};break;}
  case "cancel-edit-goal": S.ui.editGoal=null;break;
  case "save-goal":{const e=S.ui.editGoal;if(!e)return;const name=String(e.name||"").trim();const t=r2(e.target);if(!name||!(t>0)){toast("Give the goal a name and an amount.");return;}
    S.ui.editGoal=null;guard(setDoc(doc(db,"prefs",e.kid),{goals:{[e.goal]:{name,target:t}}},{merge:true}),"Goal updated.");break;}
  case "split-even":{const s=S.ui.split,ids=kidState(kid).goals.map(g=>g.id),n=ids.length||1,base=Math.floor(100/n);let rem=100-base*n;ids.forEach(id=>{s.shares[id]=base+(rem>0?1:0);if(rem>0)rem--;});s.dirty=true;break;}
  case "save-split":{const s=S.ui.split,wk=activeWeek(kid),shares={};let tot=0;for(const g of kidState(kid).goals){const v=Math.max(0,Math.round(Number(s.shares[g.id])||0));if(v>0){shares[g.id]=v;tot+=v;}}
    if(tot!==100){toast("The split needs to add up to 100%.");return;}s.dirty=false;
    guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,saveSplit:shares},{mergeFields:["kidId","week","saveSplit"]}),"Savings split saved.");break;}
  case "kid-view": S.ui.kidView=ds.kid||null;S.ui.pickCreature=false;break;
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
  case "add-chore": S.ui.draft.chores.push(ds.kind==="pr"?{id:uid(),kind:"pr",name:"New item",note:""}:{id:uid(),kind:"family",name:"New chore",mult:1,limit:1,assign:"pool"});break;
  case "rm-chore": S.ui.draft.chores.splice(Number(ds.i),1);break;
  case "discard-settings": S.ui.draft=null;break;
  case "save-settings":{const d=clone(S.ui.draft);
    d.kids.forEach(k=>{k.remind=String(k.remindStr||"").split(",").map(s=>s.trim()).filter(s=>/^\d{1,2}:\d{2}$/.test(s)).map(s=>s.padStart(5,"0"));delete k.remindStr;k.rate=r2(k.rate);k.age=Number(k.age)||0;});
    d.chores.forEach(c=>{if(c.kind==="family"){c.mult=Number(c.mult)||1;c.limit=Math.max(1,Math.round(Number(c.limit)||1));if(c.assign!=="pool"&&!d.kids.some(k=>k.id===c.assign))c.assign="pool";}});
    S.ui.draft=null;guard(setDoc(doc(db,"app/config"),d),"Settings saved.");break;}
  }
  render();
}
function handleChange(act,el){const v=el.value,kid=S.viewKid;
  if(act==="bonusTo"||act==="saveTo"){const wk=activeWeek(kid);guard(setDoc(weekRef(kid,wk),{kidId:kid,week:wk,[act]:v},{merge:true}));}
  else if(act==="interestTo")guard(setDoc(doc(db,"prefs",kid),{interestTo:v},{merge:true}));}

/* ---------- events ---------- */
document.addEventListener("click",e=>{const el=e.target.closest("[data-act]");if(!el||el.disabled)return;handleAct(el.dataset.act,el.dataset);});
document.addEventListener("input",e=>{const el=e.target;if(!el.dataset.bind)return;let v=el.value;if(el.dataset.type==="num")v=v===""?"":Number(v);setPath(S.ui,el.dataset.bind,v);
  if(el.dataset.bind.startsWith("split.shares.")){S.ui.split.dirty=true;updateSplitUI();}
  if(el.dataset.bind==="goalInput"){const m=document.querySelector(".goal-set .goal-msg");const n=Number(v)||0;if(m)m.textContent=n>0?`Reach it and you get a +${money(r2(n*.1))} bonus.`:"Bigger goal, bigger bonus.";}});
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
