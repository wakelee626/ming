import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const catalog=JSON.parse(readFileSync(new URL('../data/army-composition.json',import.meta.url)));
const armies=JSON.parse(readFileSync(new URL('../data/armies.json',import.meta.url)));
const ctx=vm.createContext({});vm.runInContext(readFileSync(new URL('../dist/army-composition.js',import.meta.url),'utf8'),ctx);
test('all armies have complete valid composition and distinct artwork paths',()=>{
 assert.equal(new Set(Object.values(catalog.armies).map(a=>a.image)).size,armies.length);
 for(const army of armies){const roster=catalog.armies[army.id].composition;assert.equal(new Set(roster.map(e=>e.unitId)).size,roster.length);for(const entry of roster)assert.ok(catalog.units[entry.unitId]);const base=roster.filter(e=>!catalog.units[e.unitId].requires);assert.equal(base.reduce((n,e)=>n+e.weight,0),100);}
});
test('composition conserves total soldiers across casualties and rounding',()=>{
 for(const army of armies)for(const total of [0,1,3,17,7999,army.men]){const rows=ctx.armyComposition(total,catalog.armies[army.id].composition);assert.equal(rows.reduce((n,r)=>n+r.men,0),total);assert.ok(rows.every(r=>Number.isInteger(r.men)&&r.men>=0));}
});
