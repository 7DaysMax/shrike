import test from 'node:test';import assert from'node:assert/strict';
import {groupSteps,nestToolGroups,toolTaskSummary,toolState,containsFocusedTool}from './execution-tree.ts';
const row=(seq,kind,extra={})=>({seq,kind,worker:'mainagent',ts:'2026-10-27T05:00:00Z',summary:'',...extra});
const use=(seq,id,extra={})=>row(seq,'tool_use',{tool:'Bash',tool_use_id:id,...extra});
const result=(seq,id,extra={})=>row(seq,'tool_result',{tool:'Bash',tool_use_id:id,...extra});
test('tools belong to second-level task groups; user turns and replies stay in main flow',()=>{
 const tree=nestToolGroups(groupSteps([row(1,'user',{summary:'检查项目'}),use(2,'a'),result(3,'a'),row(4,'text',{summary:'继续检查'}),use(5,'b'),result(6,'b'),row(7,'result',{summary:'检查完毕'})],true));
 assert.deepEqual(tree.map(g=>g.type),['user','task-tools','answer','answer']);assert.equal(tree[1].tools.length,2);assert.equal(tree[1].label,'检查项目');assert.ok(!tree.some(g=>g.type==='tool'));
});
test('parallel tool results pair by tool ID instead of arrival order',()=>{
 const tree=nestToolGroups(groupSteps([use(1,'a'),use(2,'b'),result(3,'b'),result(4,'a')],true));assert.equal(tree.length,1);assert.equal(tree[0].tools[0].result.seq,4);assert.equal(tree[0].tools[1].result.seq,3);
});
test('matching tool IDs from different workers and inherited tasks never cross-pair',()=>{
 const groups=groupSteps([use(1,'same',{worker:'work#1'}),use(2,'same',{worker:'work#2'}),result(3,'same',{worker:'work#2'}),result(4,'same',{worker:'work#1'}),use(5,'same',{source_task_id:'old'}),result(6,'same',{source_task_id:'new'})],false);
 const tools=groups.filter(g=>g.type==='tool');assert.equal(tools[0].result.seq,4);assert.equal(tools[1].result.seq,3);assert.equal(tools[2].result,undefined);assert.equal(tools[3].use,undefined);const tree=nestToolGroups(groups);assert.equal(tree.length,4);
});
test('user turns, planning rounds, segments and intents establish separate parents',()=>{
 const rows=[row(1,'user',{summary:'第一轮'}),use(2,'a'),result(3,'a'),row(4,'user',{summary:'第二轮'}),use(5,'b'),use(6,'c',{main_seg:1}),use(7,'d',{intent_id:'intent-2'}),row(8,'round',{summary:'新的规划轮次'}),use(9,'e')];const tree=nestToolGroups(groupSteps(rows,true));const tasks=tree.filter(g=>g.type==='task-tools');assert.equal(tasks.length,5);assert.equal(tasks[0].label,'第一轮');assert.equal(tasks[1].label,'第二轮');assert.equal(tasks.at(-1).label,'新的规划轮次');
});
test('parent keys survive live append and settlement; individual calls retain their own keys',()=>{
 const base=[row(1,'user',{summary:'运行测试'}),use(2,'a')];const before=nestToolGroups(groupSteps(base,true))[1];const after=nestToolGroups(groupSteps([...base,result(3,'a'),use(4,'b')],true))[1];assert.equal(before.key,after.key);assert.equal(before.tools[0].key,after.tools[0].key);assert.equal(after.tools.length,2);
});
test('unfinished calls are running only while execution is live; stopped histories show interrupted',()=>{
 const group=nestToolGroups(groupSteps([use(1,'a'),result(2,'a'),use(3,'b'),result(4,'b',{is_error:true}),use(5,'c')],true))[0];assert.deepEqual(toolTaskSummary(group,true),{total:3,running:1,succeeded:1,failed:1,interrupted:0});assert.deepEqual(toolTaskSummary(group,false),{total:3,running:0,succeeded:1,failed:1,interrupted:1});assert.equal(toolState(group.tools[2],false),'interrupted');
});
test('approval requests remain visible outside folded task tools; focus matches use and result',()=>{
 const tree=nestToolGroups(groupSteps([use(1,'a'),row(2,'intercept_request',{summary:'需要审批'}),result(3,'a')],true));assert.deepEqual(tree.map(g=>g.type),['task-tools','intercept']);assert.ok(containsFocusedTool(tree[0],1));assert.ok(containsFocusedTool(tree[0],3));assert.equal(containsFocusedTool(tree[0],99),false);
});
test('orphan results and repeated IDs are preserved once without creating phantom persisted tasks',()=>{
 const tree=nestToolGroups(groupSteps([use(1,'same'),use(2,'same'),result(3,'same'),result(4,'same'),result(5,'orphan')],true));assert.equal(tree[0].tools.length,3);assert.equal(tree[0].tools[0].result.seq,3);assert.equal(tree[0].tools[1].result.seq,4);assert.equal(tree[0].tools[2].result.seq,5);assert.equal(tree[0].sourceTaskId,undefined);
});
test('attachment prompts get readable titles; no tools means no extra task disclosure',()=>{
 const source=[row(1,'user',{summary:JSON.stringify({text:'检查\n附件'})}),use(2,'a')];assert.equal(nestToolGroups(groupSteps(source,true))[1].label,'检查 附件');assert.deepEqual(nestToolGroups(groupSteps([row(1,'user'),row(2,'thinking'),row(3,'result')],true)).map(g=>g.type),['user','msg','answer']);
});
test('new live turns do not relabel unfinished history as running; inherited tools stay historical',()=>{
 const tree=nestToolGroups(groupSteps([row(1,'user'),use(2,'old'),row(3,'result'),row(4,'user'),use(5,'new')],true));const tasks=tree.filter(g=>g.type==='task-tools');assert.equal(toolTaskSummary(tasks[0],true).interrupted,1);assert.equal(toolTaskSummary(tasks[1],true).running,1);assert.equal(toolState({type:'tool',key:1,worker:'mainagent',use:use(9,'copy',{inherited:true})},true),'interrupted');
});
