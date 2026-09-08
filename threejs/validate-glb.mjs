import fs from 'node:fs';import validator from 'gltf-validator';
const result=await validator.validateBytes(new Uint8Array(fs.readFileSync('public/ev50.glb')),{uri:'ev50.glb',maxIssues:100});
fs.writeFileSync('../docs/gltf_validator.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({errors:result.issues.numErrors,warnings:result.issues.numWarnings,infos:result.issues.numInfos}));
if(result.issues.numErrors)process.exitCode=1;
