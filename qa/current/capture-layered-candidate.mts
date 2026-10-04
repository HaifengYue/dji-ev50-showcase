/** Read-only candidate review capture. It never marks a contract as reviewed. */
import fs from 'node:fs';import assert from 'node:assert/strict';import {captureModelReference,compareModelReference} from './model-reference.mts';import {verifiedReference} from './reference-records.mjs';
const out=process.argv[2];assert(out);const p=verifiedReference('previous-accepted-reference.json'),reports=[];
for(const[encoding,file]of [['source','assets/blender/xp4-source.glb'],['runtime','public/models/xp4.glb']]){const actual=await captureModelReference(file),before=p.data.models.find((m:any)=>m.encoding===encoding),changes=compareModelReference(before,actual);reports.push({encoding,source:file,actual,changes});console.log(encoding,JSON.stringify(changes));}
fs.writeFileSync(out,JSON.stringify({reviewed:false,previousAcceptedReferenceSha256:p.sha256,reports},null,2)+'\n');
