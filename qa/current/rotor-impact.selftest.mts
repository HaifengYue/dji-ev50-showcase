import assert from 'node:assert/strict';import fs from 'node:fs';import {rotorImpact} from './rotor-impact.mts';
const p=[{name:'Prop_L'},{name:'Prop_R'}],m=[{name:'Blade_L',owner:p[0]},{name:'Blade_R',owner:p[1]},{name:'Fixed'},{name:'Moving'}];
const child=(o:any,parent:any)=>o.owner===parent;
const before=rotorImpact(m,p,new Set(['Moving']),child);assert.equal(before.rerunPairCount,2);assert.equal(before.inheritedPairCount,2);assert.deepEqual(before.changedRotors,[]);
const moved=rotorImpact(m,p,new Set(['Moving','Blade_L']),child);assert.equal(moved.rerunPairCount,3);assert(moved.includes('Prop_L','Fixed'));assert(!moved.includes('Prop_R','Fixed'));assert.deepEqual(moved.changedRotors,['Prop_L']);
const both=rotorImpact(m,p,new Set(['Blade_L','Blade_R']),child);assert.equal(both.rerunPairCount,4);assert.equal(both.inheritedPairCount,0);
const r={passed:true,checks:['changed-body/all-rotors','changed-rotor/unchanged-body','both-moved-rotors/all-bodies','unchanged-pair-only-inheritance']};fs.writeFileSync(process.env.QA_OUT??'qa/current/rotor-impact-selftest-report.json',JSON.stringify(r,null,2)+'\n');console.log(r);
