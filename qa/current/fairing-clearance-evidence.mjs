/** Bind the exact bytes that were parsed, then fail if those inputs change during this gate. */
import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export function captureClearanceJson(path){const bytes=fs.readFileSync(path);return {path,sha256:digest(bytes),data:JSON.parse(bytes.toString('utf8'))};}
export function assertClearanceJsonStable(evidence){assert.equal(digest(fs.readFileSync(evidence.path)),evidence.sha256,'Evaluated clearance contract changed during verification: '+evidence.path);}
