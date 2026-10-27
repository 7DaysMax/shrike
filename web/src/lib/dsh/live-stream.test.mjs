import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import ts from 'typescript';import {fromMarkdown} from 'mdast-util-from-markdown';
import {projectLive,acceptSnapshot}from './live-stream.ts';
const row={seq:0,worker:'mainagent',kind:'text',ts:'',summary:'',stream_id:'block-1',streaming:true,detail:'第'};
test('stream frames replace one keyed block; final commit never duplicates it',()=>{
 let snap={revision:1,items:[row]};let p=projectLive([],snap,0);assert.equal(p.length,1);const key=p[0].stream_id;
 snap={revision:2,items:[{...row,detail:'第一段'}]};p=projectLive([],snap,0);assert.equal(p.length,1);assert.equal(p[0].detail,'第一段');assert.equal(p[0].stream_id,key);
 const final={...row,seq:42,streaming:false,kind:'result',detail:'第一段完成'};p=projectLive([{...final,detail:undefined,stream_id:undefined}],{revision:3,items:[final]},0);assert.equal(p.length,1);assert.equal(p[0].seq,42);assert.equal(p[0].stream_id,key);
});
test('late revisions and other main segments cannot corrupt current output',()=>{
 const now={revision:4,items:[row]};assert.equal(acceptSnapshot(now,{revision:3,items:[]}),now);
 assert.equal(projectLive([],{revision:4,items:[{...row,main_seg:1}]},0).length,0);
 assert.equal(projectLive([],{revision:4,items:[{...row,worker:'planner'}]},0).length,0);
});
test('the original DSH incremental parser keeps frozen block keys while its tail grows',async()=>{
 const text=fs.readFileSync(new URL('../../components/dsh/upstream/primitives/markdown/incremental.ts',import.meta.url),'utf8');
 const js=ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const {IncrementalMarkdownParser}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
 const parser=new IncrementalMarkdownParser(fromMarkdown);const a=parser.update('第一段\n\n第二段\n\n第三段\n\n尾');const b=parser.update('第一段\n\n第二段\n\n第三段\n\n尾巴继续');
 assert.ok(a.frozen.length>0);assert.equal(a.frozen[0].key,b.frozen[0].key);
});
test('ported chat removes the legacy avatar-hiding rule and uses the original renderer and single header',()=>{
 const css=fs.readFileSync(new URL('../../styles/dsh/workbench.css',import.meta.url),'utf8');assert.ok(!css.includes('[data-dsh-message="user"] > div:last-child { display: none; }'));
 const chrome=fs.readFileSync(new URL('../../components/dsh/message-chrome.tsx',import.meta.url),'utf8');assert.ok(chrome.includes('MarkdownText'));assert.ok(chrome.includes('MessageIconActions'));
 const main=fs.readFileSync(new URL('../../app/(main)/_components/main-content.tsx',import.meta.url),'utf8');assert.ok(main.includes('pathname.replace(/\\/+$/, "")===')||main.includes('==="/chat"'));
});
