import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFlight, PHASES, phaseStart, TOTAL, advanceTime } from '../src/flight.ts';
test('八个飞行阶段及最终待命均可到达',()=>{
 assert.deepEqual([...PHASES.map((_,i)=>getFlight(phaseStart(i)).phase.id),getFlight(TOTAL).phase.id], ['idle','takeoff','hover','wing-transition','cruise','orbit','deceleration-transition','landing','idle']);
});
test('阶段边界的高度、位置、展开程度与旋翼转速连续',()=>{
 for(const edge of [...PHASES.slice(1).map((_,i)=>phaseStart(i+1)),TOTAL]){
  const a=getFlight(edge-1e-6), b=getFlight(edge);
  for(const key of ['altitude','x','z','unfold','rpm','speed'] as const)assert.ok(Math.abs(a[key]-b[key])<1e-4,`${edge}:${key}`);
  assert.ok(Math.abs(Math.sin(a.yaw)-Math.sin(b.yaw))<1e-4);
  assert.ok(Math.abs(Math.cos(a.yaw)-Math.cos(b.yaw))<1e-4);
 }
});
test('全部时间轴状态有限且展开程度与旋翼转速有界',()=>{
 for(let time=0;time<=TOTAL;time+=.01){const f=getFlight(time);for(const key of ['x','z','yaw','altitude','unfold','rpm','bank'] as const)assert.ok(Number.isFinite(f[key]));for(const key of ['unfold','rpm','speed'] as const)assert.ok(f[key]>=0&&f[key]<=1);}
});
test('十轮自动循环保持完整阶段顺序并在终点重复',()=>{
 let time=0;let wraps=0;const visited=new Set<string>();for(let i=0;i<Math.ceil(TOTAL*10/.02);i++){visited.add(getFlight(time).phase.id);const next=advanceTime(time,.02,true);if(next<time)wraps++;time=next;}
 assert.equal(visited.size,8);assert.ok(wraps>=9);
});
test('非循环模式限制终点时间、停止旋翼并返回原点待命',()=>{const f=getFlight(advanceTime(TOTAL-1,100,false));assert.equal(f.phase.id,'idle');assert.equal(f.rpm,0);assert.equal(f.altitude,0);assert.equal(f.x,0);assert.equal(f.z,0);});
