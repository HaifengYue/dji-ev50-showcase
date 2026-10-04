/** 无文件写入的冻结清单反例。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyInputLock} from './input-lock-integrity.mjs';

const hashes={'src/main.ts':'a'.repeat(64),'src/helper.ts':'b'.repeat(64)};
function fixture(){const files=Object.entries(hashes).map(([path,sha256])=>({path,sha256}));return {lock:{files},text:files.map(row=>`${row.sha256}  ${row.path}\n`).join(''),expectedPaths:Object.keys(hashes),hash:path=>hashes[path]};}
const verify=value=>verifyInputLock(value.lock,value.text,value.expectedPaths,value.hash);
test('完整实际闭包与JSON/text清单逐路径逐哈希一致',()=>assert.deepEqual(verify(fixture()),{files:2,completeDependencyClosure:true,jsonAndTextAgree:true}));
for(const [name,mutate]of[
 ['JSON缺项',value=>value.lock.files.pop()],
 ['JSON为空',value=>value.lock.files=[]],
 ['JSON重复',value=>value.lock.files.push(value.lock.files[0])],
 ['JSON额外未使用文件',value=>value.lock.files.push({path:'unused.ts',sha256:'c'.repeat(64)})],
 ['文本缺项',value=>value.text=value.text.split('\n')[0]+'\n'],
 ['文本重复',value=>value.text+=value.text.split('\n')[0]+'\n'],
 ['文本额外未使用文件',value=>value.text+='c'.repeat(64)+'  unused.ts\n'],
 ['JSON/text哈希分歧',value=>value.text=value.text.replace('a'.repeat(64),'c'.repeat(64))],
 ['JSON哈希格式错误',value=>value.lock.files[0].sha256='bad'],
 ['文本哈希格式错误',value=>value.text=value.text.replace('a'.repeat(64),'bad')],
 ['文本空行',value=>value.text+='\n'],
 ['JSON路径逃逸',value=>value.lock.files[0].path='../outside'],
 ['闭包自身重复',value=>value.expectedPaths.push(value.expectedPaths[0])],
 ['实际文件已变',value=>value.hash=()=> '0'.repeat(64)],
 ['JSON及文本共同截短',value=>{value.lock.files.pop();value.text=value.text.split('\n')[0]+'\n';}],
])test(name,()=>{const value=fixture();mutate(value);assert.throws(()=>verify(value));});
