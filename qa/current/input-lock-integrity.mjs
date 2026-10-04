/** 双清单必须等于当前实际依赖闭包，不能只核一个可被截短的文件列表。 */
import assert from 'node:assert/strict';
import path from 'node:path';

const sha256Pattern=/^[0-9a-f]{64}$/;
const validPath=value=>typeof value==='string'&&value.length>0&&!/[\r\n\0]/.test(value)&&!path.isAbsolute(value)&&path.normalize(value)===value&&!value.startsWith('..');
function pathSet(rows,label){
 assert(Array.isArray(rows)&&rows.length>0,label+'缺失或为空');
 assert(rows.every(validPath),label+'含非规范本地路径');
 assert.equal(new Set(rows).size,rows.length,label+'含重复路径');
 return [...rows].sort();
}

export function verifyInputLock(lock,text,expectedPaths,hash){
 const expected=pathSet(expectedPaths,'实际依赖闭包');
 assert(Array.isArray(lock?.files),'缺少JSON冻结清单');
 const actual=pathSet(lock.files.map(row=>row.path),'JSON冻结清单');
 assert.deepEqual(actual,expected,'JSON冻结清单不是完整实际依赖闭包');
 for(const row of lock.files)assert(sha256Pattern.test(row.sha256),'JSON冻结哈希格式错误 '+row.path);
 assert.equal(typeof text,'string','缺少文本冻结清单');
 const lines=text.endsWith('\n')?text.slice(0,-1).split('\n'):text.split('\n');
 const textRows=lines.map(line=>{const match=/^([0-9a-f]{64})  (.+)$/.exec(line);assert(match,'文本冻结清单格式错误');return {sha256:match[1],path:match[2]};});
 assert.deepEqual(pathSet(textRows.map(row=>row.path),'文本冻结清单'),expected,'文本冻结清单不是完整实际依赖闭包');
 const textHashes=new Map(textRows.map(row=>[row.path,row.sha256]));
 for(const row of lock.files){
  assert.equal(textHashes.get(row.path),row.sha256,'JSON/text冻结哈希分歧 '+row.path);
  assert.equal(hash(row.path),row.sha256,'冻结依赖已变 '+row.path);
 }
 return {files:expected.length,completeDependencyClosure:true,jsonAndTextAgree:true};
}
