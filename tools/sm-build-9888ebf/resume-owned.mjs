import { execFile } from 'node:child_process';
import { readFile, readdir, readlink, lstat, statfs, writeFile } from 'node:fs/promises';
import { loadavg } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { gateReason, resourceReason, procIdentity, isBuildCommand, HOMES } from './guarded-build-blue.mjs';
const exec=promisify(execFile), GiB=2**30;
export const PAUSE_EPOCH='median-20261013T2047Z'; // Explicit user authorization resets this epoch once; old receipts stay intact.
export const CURL_FORMAT='%{http_code} %{time_total} %{size_download}\ncf:%header{cf-cache-status}';
export const TARGET={pid:3000146,ticks:'428008428',pipelinePid:3000159,pipelineTicks:'428008441',uid:1000,cwd:'/home/deck/.cache/blog-release-source-9888ebf36229400c2323ae12334d72280cbe699a',sha:'9888ebf36229400c2323ae12334d72280cbe699a',node:'/home/deck/.local/node-v24.15.0-linux-x64/bin/node',pipeline:'/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/pipeline.mjs',guard:'/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf/guarded-build-blue.mjs',lock:'/home/deck/.cache/observe-build-0.lock',lockFd:21,lockInode:1742187};
async function identity(pid){const meta=await lstat(`/proc/${pid}`);return {...procIdentity(pid,await readFile(`/proc/${pid}/stat`,'utf8')),uid:meta.uid,cwd:await readlink(`/proc/${pid}/cwd`),argv:(await readFile(`/proc/${pid}/cmdline`,'utf8')).split('\0').filter(Boolean)};}
export function owned(v){return v?.uid===TARGET.uid&&v.pid===TARGET.pid&&v.pgid===TARGET.pid&&v.session===TARGET.pid&&v.startTicks===TARGET.ticks&&v.cwd===TARGET.cwd&&JSON.stringify(v.argv)===JSON.stringify([TARGET.node,TARGET.guard,'--handshake-child',TARGET.cwd])&&!['X','Z'].includes(v.state);}
async function lockHeld(){const path=`/proc/${TARGET.pid}/fd/${TARGET.lockFd}`;const st=await lstat(TARGET.lock);return await readlink(path)===TARGET.lock&&(await lstat(`/proc/${TARGET.pid}`)).uid===TARGET.uid&&st.uid===TARGET.uid&&st.isFile()&&!st.isSymbolicLink()&&st.ino===TARGET.lockInode;}
async function resources(){const disk=await statfs('/home',{bigint:true}),groups=new Set();for(const n of await readdir('/proc')){if(!/^\d+$/.test(n)||Number(n)<2)continue;try{const p=procIdentity(Number(n),await readFile(`/proc/${n}/stat`,'utf8'));if(p.pgid===TARGET.pid||['X','Z'].includes(p.state))continue;const a=(await readFile(`/proc/${n}/cmdline`,'utf8')).split('\0').filter(Boolean);if(isBuildCommand(a))groups.add(p.pgid);}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw Error('scan_unproven');}}const m=/^MemAvailable:\s+(\d+) kB$/m.exec(await readFile('/proc/meminfo','utf8'));if(!m)throw Error('memory_unproven');return {available:Number(disk.bavail*disk.bsize),load1:loadavg()[0],otherBuilds:groups.size,memoryAvailable:Number(m[1])*1024};}
export const curlTimeoutSeconds=h=>h.site==='blog'?13:5;
export const curlArgs=h=>['--disable','--silent','--max-time',String(curlTimeoutSeconds(h)),'--max-filesize','8388608','--header','DNT: 1','--header','Accept: text/html','--output','/dev/null','--write-out',CURL_FORMAT,h.url];
export function parseSample(h,stdout,code,startedAt,finishedAt){
 const m=/^(\d{3}) ([0-9.]+) ([0-9]+)\ncf:([^\r\n]*)\s*$/.exec(stdout);
 const cf=m?.[4]?.trim().toUpperCase();
 const totalMs=m?Number(m[2])*1000:null,bytes=m?Number(m[3]):null;
 const numeric=Number.isFinite(totalMs)&&totalMs>=0&&Number.isSafeInteger(bytes)&&bytes>=0;
 return {site:h.site,startedAt,finishedAt,curlExitCode:code,status:m&&m[1]!=='000'?Number(m[1]):null,totalMs,receivedBytes:bytes,cfCacheStatus:cf&&/^(HIT|MISS|DYNAMIC|BYPASS|EXPIRED|STALE|UPDATING|REVALIDATED|NONE|UNKNOWN)$/.test(cf)?cf:null,complete:code===0&&!!m&&numeric};
}
export function summarizeSamples(h,samples){
 const valid=samples.length===3&&samples.every(s=>s.site===h.site&&s.complete===true&&s.curlExitCode===0&&s.status===200&&Number.isFinite(s.totalMs)&&s.totalMs>=0&&Number.isSafeInteger(s.receivedBytes)&&s.receivedBytes>=0&&Number.isFinite(Date.parse(s.startedAt))&&Number.isFinite(Date.parse(s.finishedAt))&&Date.parse(s.finishedAt)>=Date.parse(s.startedAt));
 const medianMs=samples.length===3&&samples.every(s=>Number.isFinite(s.totalMs)&&s.totalMs>=0)?samples.map(s=>s.totalMs).sort((a,b)=>a-b)[1]:null;
 return {site:h.site,status:valid?200:null,totalMs:medianMs,medianMs,limitMs:h.limitMs,complete:valid,samples};
}
export async function collectProbes(run=exec,now=()=>new Date().toISOString()){
 const results=[];for(const h of HOMES){const samples=[];for(let i=0;i<3;i++){
 const startedAt=now();let stdout='',code=0;try{stdout=(await run('curl',curlArgs(h),{timeout:curlTimeoutSeconds(h)*1000+2000,maxBuffer:4096})).stdout;}catch(e){stdout=typeof e.stdout==='string'?e.stdout:'';code=Number.isInteger(e.code)?e.code:-1;}
 samples.push({...parseSample(h,stdout,code,startedAt,now()),sample:i+1});
 }results.push(summarizeSamples(h,samples));}return results;
}
const probes=()=>collectProbes();
export function medianGate(resource,measurements,estimate,stage){
 if(!Array.isArray(measurements)||measurements.length!==HOMES.length)return 'homepage_unproven';
 const verified=[];for(const home of HOMES){const m=measurements.filter(x=>x?.site===home.site);if(m.length!==1||!Array.isArray(m[0].samples))return 'homepage_unproven';verified.push(summarizeSamples(home,m[0].samples));}
 return gateReason(resource,verified,estimate,stage);
}
export const rssPidAllowed=n=>/^\d+$/.test(n)&&Number(n)>1;
async function rss(){let sum=0,count=0;for(const n of await readdir('/proc')){if(!rssPidAllowed(n))continue;try{const p=procIdentity(Number(n),await readFile(`/proc/${n}/stat`,'utf8'));if(p.pgid!==TARGET.pid||(await lstat(`/proc/${n}`)).uid!==TARGET.uid)continue;const m=/^VmRSS:\s+(\d+) kB$/m.exec(await readFile(`/proc/${n}/status`,'utf8'));sum+=m?Number(m[1])*1024:0;count++;}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw Error('rss_unproven');}}return {sum,count};}
const defaults={identity,lockHeld,resources,probes,rss,source:async()=> {if(await (await import('node:fs/promises')).realpath(TARGET.cwd)!==TARGET.cwd)throw Error('source_realpath');const head=(await exec('git',['-C',TARGET.cwd,'rev-parse','HEAD'])).stdout.trim();const dirty=(await exec('git',['-C',TARGET.cwd,'status','--porcelain=v1','--untracked-files=no'])).stdout.trim();if(dirty)throw Error('source_dirty');return head;},signal:(p,s)=>process.kill(p,s),now:()=>Date.now(),wait:ms=>new Promise(r=>setTimeout(r,ms)),onContinued:()=>{},permitContinue:()=>true};
export async function resumeOwned(priorPauseCount=0,injected={}){const d={...defaults,...injected},events=[];let continues=0,peak=0,peakAt=null,minMemory=null,samples=0,count=priorPauseCount,inFlight=null,homes=[],probeFailure=false;const probeRounds=[];
 const result=(status,reason)=>({status,reason,pauseEpoch:PAUSE_EPOCH,APP_SHA:TARGET.sha,ownerUid:TARGET.uid,ownedPid:TARGET.pid,ownedPgid:TARGET.pid,ownedStartTicks:TARGET.ticks,continues,pauseCount:count,autoResume:false,samples,peakObservedAggregateRssBytes:peak,peakObservedAt:peakAt,minimumMemAvailableBytes:minMemory,events,probeRounds,exitCode:null,measurementLimitation:'Sampled VmRSS sum double counts shared pages; not exact instantaneous peak or PSS. Original exited controller cannot reap nonchild exit status.'});
 const note=(stage,resource,probe)=>{if(events.length>=100)events.shift();events.push({utc:new Date(d.now()).toISOString(),stage,...(resource?{availableBytes:resource.available,load1:resource.load1,memoryAvailableBytes:resource.memoryAvailable,otherBuilds:resource.otherBuilds}:{}),...(probe?{homes:probe}:{})});};
 const stop=async why=>{const v=await d.identity(TARGET.pid);if(!owned(v))return result('unmonitored','owner_unproven_no_signal');if(v.state!=='T')d.signal(-TARGET.pid,'SIGSTOP');count++;return result('paused',why);};
 try{if(!Number.isInteger(count)||count<0||count>=3||d.now()>=Date.parse('2026-10-13T22:30:00Z'))return result('blocked','budget_or_expired');
 let v=await d.identity(TARGET.pid),p=await d.identity(TARGET.pipelinePid);if(!owned(v)||v.state!=='T'||p.uid!==TARGET.uid||p.pgid!==TARGET.pid||p.session!==TARGET.pid||p.startTicks!==TARGET.pipelineTicks||p.ppid!==TARGET.pid||p.state!=='T'||p.cwd!==TARGET.cwd||JSON.stringify(p.argv)!==JSON.stringify([TARGET.node,TARGET.pipeline,TARGET.cwd])||!await d.lockHeld()||await d.source()!==TARGET.sha)return result('blocked','owner_or_source_unproven');
 for(let i=0;i<3;i++){let r=await d.resources();const bad=resourceReason(r,3*GiB,'start');if(bad)return result('blocked',bad);homes=await d.probes();probeRounds.push({stage:`fresh-round-${i+1}`,completedAt:new Date(d.now()).toISOString(),homes});r=await d.resources();note(`fresh-round-${i+1}`,r,homes);const why=medianGate(r,homes,3*GiB,'start');if(why)return result('blocked',why);}
 v=await d.identity(TARGET.pid);if(!owned(v)||v.state!=='T'||!await d.lockHeld()||d.now()>=Date.parse('2026-10-13T22:30:00Z'))return result('blocked','owner_or_expiry_changed');if(resourceReason(await d.resources(),3*GiB,'start'))return result('blocked','resource_changed');
 if(!d.permitContinue())return result('blocked','controller_interrupted');
 d.signal(-TARGET.pid,'SIGCONT');continues++;d.onContinued();let next=d.now()+10000;
 while(true){try{v=await d.identity(TARGET.pid);}catch(e){if(['ENOENT','ESRCH'].includes(e.code))return result('exited','exit_status_unobserved');throw e;}if(['X','Z'].includes(v.state))return result('exited','exit_status_unobserved');if(!owned(v))return result('unmonitored','owner_changed_no_signal');if(v.state==='T'){count++;return result('paused','controller_eof_or_external_stop');}
 const r=await d.resources(),s=await d.rss();samples++;if(s.sum>peak){peak=s.sum;peakAt=new Date(d.now()).toISOString();}minMemory=minMemory===null?r.memoryAvailable:Math.min(minMemory,r.memoryAvailable);
 let why=resourceReason(r,0,'monitor');if(!why){if(!inFlight&&d.now()>=next){next=d.now()+10000;if(probeRounds.length>=1000)return await stop('probe_receipt_capacity');inFlight=d.probes().then(x=>{homes=x;probeRounds.push({stage:'monitor',completedAt:new Date(d.now()).toISOString(),homes:x});},()=>{homes=[];probeFailure=true;}).finally(()=>{inFlight=null;});}why=probeFailure?'homepage_unproven':medianGate(r,homes,0,'monitor');}note('monitor',r,homes);if(why)return await stop(why);await d.wait(1000);}
 }catch{if(continues){try{return await stop('monitor_unproven');}catch{return result('unmonitored','owner_unproven_no_signal');}}return result('failed','precondition_unproven');}finally{if(inFlight)await inFlight;}}
export function pauseAccounting(records, unfinishedAttempt=false){if(unfinishedAttempt)throw Error('unfinished_attempt_operator_review');let count=0;for(const r of records){if(r.pauseEpoch!==PAUSE_EPOCH)continue;if(r.APP_SHA!==TARGET.sha||r.ownedPid!==TARGET.pid||r.ownedStartTicks!==TARGET.ticks)continue;if(!Number.isInteger(r.pauseCount)||r.pauseCount<0||r.pauseCount>3)throw Error('prior_pause_unproven');count=Math.max(count,r.pauseCount);}return count;}
export async function interruptOwned(prior,continued,d){const didContinue=()=>typeof continued==='function'?continued():continued;let status='blocked',reason='interrupt_before_continue',count=prior;try{const v=await d.identity(TARGET.pid);if(didContinue()){count=Math.min(3,prior+1);status='unmonitored';reason='owner_unproven_no_signal';if(owned(v)){if(v.state!=='T')d.signal(-TARGET.pid,'SIGSTOP');status='paused';reason='operator_interrupt';}}}catch{if(didContinue()){count=Math.min(3,prior+1);status='unmonitored';reason='owner_unproven_no_signal';}}const r={status,reason,pauseEpoch:PAUSE_EPOCH,APP_SHA:TARGET.sha,ownedPid:TARGET.pid,ownedStartTicks:TARGET.ticks,pauseCount:count,autoResume:false};await d.persist(r);return r;}
async function privateJson(path){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.uid!==TARGET.uid||st.mode&0o077||st.size>8*1024*1024)throw Error('private_receipt_unproven');return JSON.parse(await readFile(path,'utf8'));}
async function main(){if(process.argv.length!==4||process.argv[2]!=='--continue-owned-build')throw Error('explicit_command_required');const prior=Number(process.argv[3]);
const original=await privateJson('/home/deck/.t3/projects/blog-observe-tw/.reviews/guarded-build/run-1791923056586-3000007.json');
if(original.status!=='paused'||original.sha!==TARGET.sha||original.ownedPid!==TARGET.pid||original.ownedStartTicks!==TARGET.ticks)throw Error('original_pause_unproven');
const approval=await privateJson('/home/deck/.t3/projects/blog-observe-tw/.reviews/guarded-build/sm-9888ebf-blue.json');
if(approval.sha!==TARGET.sha||approval.cwd!==TARGET.cwd||approval.gatewayInternalUrl!=='http://127.0.0.1:18174'||Date.parse(approval.expiresAt)<=Date.now())throw Error('original_approval_unproven');
const directory='/home/deck/.t3/projects/blog-observe-tw/.reviews/sm-build-9888ebf',names=await readdir(directory),records=[];let unfinished=false;
for(const name of names){if(/^resume-[0-9]+\.json$/.test(name))records.push(await privateJson(directory+'/'+name));else if(/^attempt-[0-9]+\.json$/.test(name)){const a=await privateJson(directory+'/'+name);if(!/^resume-[0-9]+\.json$/.test(a.resultName))throw Error('invalid_attempt');if(!names.includes(a.resultName))unfinished=true;}}
if(prior!==pauseAccounting(records,unfinished))throw Error('pause_count_mismatch');
const stamp=Date.now(),resultName=`resume-${stamp}.json`,path=directory+'/'+resultName;
// A missing result after crash makes the next attempt fail closed; never delete an attempt marker.
await writeFile(directory+`/attempt-${stamp}.json`,JSON.stringify({pauseEpoch:PAUSE_EPOCH,authorizationUtc:"2026-10-13T20:47:00Z",APP_SHA:TARGET.sha,ownedPid:TARGET.pid,resultName,priorPauseCount:prior})+'\n',{flag:'wx',mode:0o600});
let continued=false,stopping=false;
const persist=r=>writeFile(path,JSON.stringify({...r,completedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
const interrupt=async()=>{if(stopping)return;stopping=true;try{await interruptOwned(prior,()=>continued,{identity,signal:(p,s)=>process.kill(p,s),persist});}finally{process.exit(143);}};
process.once('SIGTERM',interrupt);process.once('SIGINT',interrupt);
const result=await resumeOwned(prior,{onContinued:()=>{continued=true;},permitContinue:()=>!stopping});
process.off('SIGTERM',interrupt);process.off('SIGINT',interrupt);if(stopping)return;
await persist(result);console.log(JSON.stringify({status:result.status,reason:result.reason,pauseCount:result.pauseCount,receipt:path}));if(result.status!=='exited')process.exitCode=1;}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('owned_resume_refused');process.exitCode=1;});
