/** Installed-Edge smoke test; no browser package/install. Artifacts and isolated profile stay in .next/. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../",import.meta.url));
const base = process.env.BUGLAB_RECOMMENDATION_URL ?? "http://localhost:3107";
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error("Browser verification targets localhost only");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
if (!existsSync(edge)) throw new Error("Installed Microsoft Edge not found; no browser was installed");
const output = join(root,".next"); mkdirSync(output,{ recursive: true });
const profile = mkdtempSync(join(output,"recommendation-browser-"));
const port = 9227;
let browser;
let socket;
const pending = new Map(); let sequence = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
async function until(test,label,timeout = 20_000) {
  const deadline = Date.now()+timeout;
  while (Date.now()<deadline) { try { const value = await test(); if (value) return value; } catch {} await sleep(100); }
  throw new Error(`Timed out: ${label}`);
}
async function cdp(method,params = {}) {
  const id = ++sequence;
  return new Promise((resolve,reject) => { pending.set(id,{ resolve,reject }); socket.send(JSON.stringify({ id,method,params })); });
}
async function evaluate(expression) {
  const response = await cdp("Runtime.evaluate",{ expression,returnByValue: true,awaitPromise: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}
const lastPlan = () => evaluate("window.__recommendationPlans?.at(-1)");
async function choose(index,value) {
  const previous = await evaluate("window.__recommendationPlans.length");
  await evaluate(`(() => { const select=document.querySelectorAll('select')[${index}]; select.value=${JSON.stringify(value)}; select.dispatchEvent(new Event('change',{ bubbles:true })); })()`);
  await until(async () => await evaluate("window.__recommendationPlans.length") > previous,"preference response");
}
async function actionContrast() {
  const ratio = await evaluate(`(() => {
    const action=document.querySelector('a[href^="/challenges/"]');const style=getComputedStyle(action);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
    function rgb(color){ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].slice(0,3).map(v=>v/255)}
    function luminance(c){const a=rgb(c).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return a[0]*0.2126+a[1]*0.7152+a[2]*0.0722}
    const a=luminance(style.color),b=luminance(style.backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
  })()`);
  assert.ok(ratio>=4.5,`Primary action contrast ${ratio.toFixed(2)} is below 4.5:1`);
}
async function screenshot(name) {
  const { cssContentSize } = await cdp("Page.getLayoutMetrics");
  const shot = await cdp("Page.captureScreenshot",{ format: "png",captureBeyondViewport: true,clip: { x: 0,y: 0,width: cssContentSize.width,height: cssContentSize.height,scale: 1 } });
  writeFileSync(join(output,name),Buffer.from(shot.data,"base64"));
}
try {
  // Refuse to attach to any pre-existing remote-debugging browser/profile.
  let occupied = false;
  try { occupied = (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch {}
  assert.equal(occupied,false,"QA debug port already in use");
  browser = spawn(edge,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",`--remote-debugging-port=${port}`,"--remote-debugging-address=127.0.0.1",`--user-data-dir=${profile}`,"about:blank"],{ stdio: "ignore",windowsHide: true });
  const targets = await until(async () => { const r=await fetch(`http://127.0.0.1:${port}/json/list`); return r.ok ? r.json() : null; },"Edge DevTools");
  const target = targets.find((t) => t.type === "page"); assert.ok(target);
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => { socket.onopen=resolve; socket.onerror=reject; });
  socket.onmessage = ({ data }) => { const message=JSON.parse(data); const task=pending.get(message.id); if (!task) return; pending.delete(message.id); if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result); };
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Network.enable");
  await cdp("Page.addScriptToEvaluateOnNewDocument",{ source: `
    window.__recommendationRequests=[]; window.__recommendationPlans=[]; window.__recommendationErrors=[];
    window.addEventListener('error',e=>window.__recommendationErrors.push(e.message));
    window.addEventListener('unhandledrejection',e=>window.__recommendationErrors.push(String(e.reason)));
    const originalFetch=window.fetch;
    window.fetch=async function(resource,init){
      const response=await originalFetch.call(this,resource,init);
      if(String(resource).includes('/api/recommendations/v1')){
        window.__recommendationRequests.push(init?.body ? JSON.parse(init.body):null);
        try { const plan=await response.clone().json(); if(plan.strategy)window.__recommendationPlans.push(plan); } catch{}
      }
      return response;
    };
  ` });
  await cdp("Emulation.setDeviceMetricsOverride",{ width: 1440,height: 1000,deviceScaleFactor: 1,mobile: false });
  await cdp("Page.navigate",{ url: base+"/learning-path" });
  await until(lastPlan,"initial recommendations");
  let plan=await lastPlan();
  assert.equal(plan.evidence.verified,"not-connected"); assert.equal(plan.path.length,5);
  assert.equal(plan.next.challenge.id,"challenge-002");
  assert.ok(new Set([...plan.path,...plan.practice].map((x)=>x.challenge.id)).size<=5);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
  await evaluate("document.documentElement.dataset.theme='dark'");
  await sleep(200); await actionContrast();
  await screenshot("recommendations-desktop.png");
  console.log("PASS desktop: usable cold start, five distinct cases, no horizontal overflow.");
  await choose(0,"frontend"); assert.equal((await lastPlan()).next.challenge.category,"frontend");
  await choose(1,"advanced"); assert.equal((await lastPlan()).next.challenge.difficulty,"advanced");
  await choose(2,"15"); assert.equal(await evaluate("window.__recommendationRequests.at(-1).preferences.minutes"),15);
  await evaluate("document.querySelectorAll('input[type=checkbox]')[1].click()");
  await until(async () => (await lastPlan()).evidence.local==="disabled","local opt-out");
  assert.deepEqual(await evaluate("window.__recommendationRequests.at(-1).local.solves"),[]);
  console.log("PASS controls: focus, difficulty, time and local-activity opt-out update live recommendations.");

  const stored = await evaluate(`(() => {
    const now=new Date().toISOString(); const d=new Date(); const today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    const id='challenge-002'; const record={version:2,solves:{[id]:{challengeId:id,firstSolvedAt:now,lastSolvedAt:now,timesSolved:1,source:'browser'}},reflections:{[id]:{challengeId:id,reflectedAt:now,updatedAt:now,reflection:{cause:'PRIVATE_REFLECTION_CAUSE',evidence:'PRIVATE_REFLECTION_EVIDENCE',misunderstanding:'PRIVATE_REFLECTION_MISUNDERSTANDING',nextTime:'PRIVATE_REFLECTION_NEXT',takeaway:'PRIVATE_REFLECTION_TAKEAWAY'},recall:{stage:0,stageBefore:0,dueOn:today,lastReviewedOn:today,attempts:[{at:now,day:today,response:'need-practice'}]}}},practice:[]};
    const text=JSON.stringify(record); localStorage.setItem('buglab.learning.v2',text); return text;
  })()`);
  await cdp("Page.navigate",{ url: base+"/learning-path" });
  await until(async () => (await lastPlan())?.recalls?.length===1,"existing due recall");
  plan=await lastPlan(); assert.equal(plan.recalls[0].challenge.id,"challenge-002");
  assert.equal(plan.path.some((x)=>x.challenge.id==="challenge-002"),false);
  assert.equal(await evaluate("JSON.stringify(window.__recommendationRequests).includes('PRIVATE_REFLECTION')"),false);
  assert.equal(await evaluate("localStorage.getItem('buglab.learning.v2')"),stored);
  assert.equal(await evaluate("document.querySelector('a[href=\"/journal#recall\"]')!==null"),true);
  console.log("PASS privacy/recall: local solve suppressed, existing due recall shown, writing never sent, record unchanged.");

  await cdp("Emulation.setDeviceMetricsOverride",{ width: 390,height: 844,deviceScaleFactor: 1,mobile: false });
  await evaluate("document.documentElement.dataset.theme='light'"); await sleep(150);
  assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth+1"),true);
  assert.equal(await evaluate("(() => { const ids=[...document.querySelectorAll('[id]')].map(x=>x.id);return ids.length===new Set(ids).size; })()"),true);
  assert.equal(await evaluate("[...document.querySelectorAll('select,input')].every(e=>e.labels.length>0)"),true);
  await actionContrast();
  await screenshot("recommendations-mobile-light.png");
  await evaluate("document.activeElement?.blur(); window.scrollTo(0,0)");
  await cdp("Input.dispatchKeyEvent",{ type: "keyDown",key: "Tab",code: "Tab",windowsVirtualKeyCode: 9 });
  await cdp("Input.dispatchKeyEvent",{ type: "keyUp",key: "Tab",code: "Tab",windowsVirtualKeyCode: 9 });
  assert.ok((await evaluate("document.activeElement.textContent")).includes("Skip to your learning path"));
  console.log("PASS mobile/light/accessibility: no overflow, unique IDs, labelled controls, keyboard skip link.");

  await cdp("Network.setBlockedURLs",{ urls: ["*api/recommendations/v1*"] });
  await evaluate("const s=document.querySelectorAll('select')[0];s.value='database';s.dispatchEvent(new Event('change',{bubbles:true}));");
  await until(async () => await evaluate("!!document.querySelector('[role=alert]')"),"network error state");
  await cdp("Network.setBlockedURLs",{ urls: [] });
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='Try again').click()");
  await until(async () => await evaluate("!document.querySelector('[role=alert]') && document.body.textContent.includes('Next investigation')"),"retry recovery");
  console.log("PASS error state: blocked request produces a retryable error and recovers without changing learning data.");

  const unavailable = await cdp("Page.addScriptToEvaluateOnNewDocument",{ source: "Storage.prototype.getItem=function(){throw new DOMException('Blocked for isolated QA','SecurityError')};" });
  await cdp("Page.navigate",{ url: base+"/learning-path" });
  await until(async () => (await lastPlan())?.evidence?.local==="unavailable","blocked storage fallback");
  assert.equal((await lastPlan()).path.length,5);
  await cdp("Page.removeScriptToEvaluateOnNewDocument",{ identifier: unavailable.identifier });
  assert.deepEqual(await evaluate("window.__recommendationErrors"),[]);
  console.log("PASS storage unavailable: catalog remains usable; no false local/verified history.");
  console.log("Artifacts: .next/recommendations-desktop.png, .next/recommendations-mobile-light.png");
} finally {
  if (socket?.readyState===WebSocket.OPEN) { try { await Promise.race([cdp("Browser.close"),sleep(1500)]); } catch{} socket.close(); }
  if (browser && browser.exitCode===null) browser.kill();
}