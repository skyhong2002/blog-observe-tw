import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { pipeline } from './pipeline.mjs';
const cwd='/home/deck/.cache/blog-release-source-9888ebf36229400c2323ae12334d72280cbe699a';
function fake(code=0, existing=false){const calls=[];return {calls,realpath:async p=>p,lstat:async()=>{if(!existing)throw Object.assign(Error(),{code:'ENOENT'});return{};},spawn:(cmd,args,options)=>{calls.push({cmd,args,options});const c=new EventEmitter();queueMicrotask(()=>c.emit('exit',code));return c;}};}
test('installs and fixed build are sequential same PG, no shell and no env file loading',async()=>{const f=fake();await pipeline(cwd,f);assert.equal(f.calls.length,3);assert.deepEqual(f.calls[0].args,['ci','--no-audit','--no-fund']);assert.deepEqual(f.calls[1].args,['--prefix','web','ci','--no-audit','--no-fund']);assert.deepEqual(f.calls[2].args,[cwd+'/tools/build-web.mjs']);for(const c of f.calls){assert.equal(c.options.shell,false);assert.equal(c.options.detached,false);assert.equal(c.options.cwd,cwd);assert.equal(c.options.env.NEXT_TELEMETRY_DISABLED,'1');}});
test('existing outputs and wrong cwd preserved; failed install stops before build',async()=>{const a=fake(0,true);await assert.rejects(pipeline(cwd,a),/existing_owned_output/);assert.equal(a.calls.length,0);const b=fake(1);await assert.rejects(pipeline(cwd,b),/fixed_pipeline_step_failed/);assert.equal(b.calls.length,1);await assert.rejects(pipeline('/tmp/other',fake()),/fixed_fresh_checkout_required/);});
