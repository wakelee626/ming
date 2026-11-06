import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../dist/client.js',import.meta.url),'utf8');
const section=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to));
test('HTTP browser without randomUUID can prepare all action requests',()=>{
 const ctx=vm.createContext({crypto:{getRandomValues:a=>webcrypto.getRandomValues(a)},state:()=>({id:'game',revision:4})});
 vm.runInContext(section('function requestId()','async function execute()'),ctx);
 const ids=new Set();for(const action of [{ministerId:'sun',message:'问计'},{action:'appoint',officeId:'o',ministerId:'sun'},{mode:'rules',policy:0}]){
 ctx.action=action;const r=vm.runInContext('envelope(action)',ctx);assert.match(r.requestId,/^[a-f0-9-]{36}$/);assert.equal(r.revision,4);ids.add(r.requestId);
 }assert.equal(ids.size,3);
});
test('rejected request releases lock; uncertain network failure retains exact request',async()=>{
 for(const status of [400,409,429,undefined,500]){
  const request={url:'/api/office',body:{requestId:'same'},kind:'office'};
  const ctx=vm.createContext({busy:false,pendingRequest:request,game:{state:{}},synchronize(){},setBusy(){},say(){},render(){},refreshModal(){},api:async url=>{if(url==='/api/game')return {state:{}};throw Object.assign(Error('失败'),{status})}});
  vm.runInContext(section('async function execute()','function mutate('),ctx);await vm.runInContext('execute()',ctx);
  assert.equal(ctx.busy,false);assert.equal(ctx.pendingRequest,status>=400&&status<500?null:request);
 }
});
