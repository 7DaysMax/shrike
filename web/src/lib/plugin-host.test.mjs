import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PluginKernel}from './plugins/kernel.ts';
const manifest=(id,extra={})=>({id,name:id,version:'1.0.0',apiVersion:1,...extra});
const c=(id,order=0)=>({id,point:'panel',label:id,order});
test('plugin contributions carry ownership and deterministic priority; duplicates roll back',async()=>{
 const k=new PluginKernel();k.register({manifest:manifest('alpha'),activate:ctx=>{ctx.contribute(c('low',20));ctx.contribute(c('high',1))}});await k.activate('alpha');assert.deepEqual(k.contributions('panel').map(c=>c.key),['panel:alpha:high','panel:alpha:low']);
 k.register({manifest:manifest('bad'),activate:ctx=>{ctx.contribute(c('x'));ctx.contribute(c('x'))}});await assert.rejects(k.activate('bad'),/贡献点重复/);assert.equal(k.status('bad').state,'failed');assert.equal(k.contributions('panel').filter(c=>c.pluginId==='bad').length,0);await k.dispose();
});
test('plugin dependencies activate first and block invalid unload; cycles and missing dependencies fail',async()=>{
 const k=new PluginKernel(),order=[];k.register({manifest:manifest('base'),activate:()=>{order.push('base')}});k.register({manifest:manifest('child',{dependencies:['base']}),activate:()=>{order.push('child')}});await k.activate('child');assert.deepEqual(order,['base','child']);await assert.rejects(k.deactivate('base'),/依赖方/);await k.deactivate('child');await k.deactivate('base');
 k.register({manifest:manifest('aa',{dependencies:['bb']}),activate:()=>{}});k.register({manifest:manifest('bb',{dependencies:['aa']}),activate:()=>{}});await assert.rejects(k.activate('aa'),/循环依赖/);k.register({manifest:manifest('missing',{dependencies:['absent']}),activate:()=>{}});await assert.rejects(k.activate('missing'),/依赖插件缺失/);await k.dispose();
});
test('failed activation cleans up in reverse order and aborts scoped resources',async()=>{
 const k=new PluginKernel(),trace=[];let scope;k.register({manifest:manifest('fail'),activate:ctx=>{scope=ctx;ctx.dispose(()=>trace.push(1));ctx.dispose(()=>trace.push(2));ctx.contribute(c('a'));throw Error('activation broke')}});await assert.rejects(k.activate('fail'),/activation broke/);assert.equal(scope.signal.aborted,true);assert.deepEqual(trace,[2,1]);assert.equal(k.contributions('panel').length,0);await k.dispose();
});
test('services enforce declared capability and scope cleanup; event listener errors are isolated',async()=>{
 const k=new PluginKernel();let base,consumer,unprivileged,seen=0;k.register({manifest:manifest('svc'),activate:ctx=>{base=ctx;ctx.service('sum',v=>v+1)}});k.register({manifest:manifest('client',{permissions:['sum']}),activate:ctx=>{consumer=ctx;ctx.on('tick',()=>{seen++});ctx.on('tick',()=>{throw Error('isolated')})}});k.register({manifest:manifest('nop'),activate:ctx=>{unprivileged=ctx}});await k.activate('svc');await k.activate('client');await k.activate('nop');assert.equal(await consumer.invoke('sum',2),3);await assert.rejects(unprivileged.invoke('sum',0),/未声明服务/);base.emit('tick',null);assert.equal(seen,1);assert.match(k.status('svc').error,/isolated/);await k.deactivate('client');base.emit('tick',null);assert.equal(seen,1);await k.deactivate('svc');await assert.rejects(unprivileged.invoke('sum',0),/服务未注册/);await k.dispose();
});
test('stopped contexts stay stopped after reactivation, deferred cleanup runs immediately',async()=>{
 const k=new PluginKernel();let old,current,disposed=0;k.register({manifest:manifest('mod'),activate:ctx=>{current=ctx}});await k.activate('mod');old=current;await k.deactivate('mod');await k.activate('mod');assert.notEqual(current,old);assert.throws(()=>old.contribute(c('late')),/插件已停止/);old.dispose(()=>{disposed++});assert.equal(disposed,1);assert.equal(current.signal.aborted,false);await k.dispose();assert.equal(current.signal.aborted,true);
});
test('protected core and serialized lifecycle cannot leave active contributions after dispose',async()=>{
 const k=new PluginKernel();k.register({manifest:manifest('core',{required:true}),activate:ctx=>{ctx.contribute(c('core'))}});await k.activate('core');await assert.rejects(k.deactivate('core'),/宿主插件/);let done=false;k.register({manifest:manifest('slow'),activate:async ctx=>{await new Promise(r=>setTimeout(r,10));ctx.contribute(c('later'));ctx.dispose(()=>{done=true})}});const start=k.activate('slow');const end=k.dispose();await Promise.all([start,end]);assert.equal(done,true);assert.equal(k.contributions('panel').length,0);
});
test('backend builtin catalog matches generated frontend catalog and every renderer has an adapter',()=>{
 const front=JSON.parse(fs.readFileSync(new URL('./plugins/builtin-catalog.json',import.meta.url)));const back=JSON.parse(fs.readFileSync(new URL('../../../server/plugin_builtin.json',import.meta.url)));assert.deepEqual(front,back);const adapter=fs.readFileSync(new URL('../components/plugins/renderers.tsx',import.meta.url),'utf8');for(const m of front)for(const entry of m.contributions??[])if(entry.renderer)assert.ok(adapter.includes(`"${entry.renderer}"`),entry.renderer);
});
test('example is a self-contained installable plugin package with declared services and SDK bridge',()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../../public/examples/task-board.artex-plugin.json',import.meta.url)));assert.equal(p.manifest.apiVersion,1);assert.deepEqual(p.manifest.permissions,['host.tasks.list']);for(const c of p.manifest.contributions)if(c.renderer)assert.ok(p.files[c.renderer]);assert.ok(p.files['ui/index.html'].includes('window.artex'));assert.ok(p.files['ui/index.html'].includes('host.tasks.list'));
});
test('external SDK ignores foreign sources and channels, then correlates allowed RPC replies',async()=>{
 const vm=await import('node:vm');let receive,counter=0;const sent=[],timers=new Map();const parent={postMessage:(data)=>sent.push(data)};const window={addEventListener:(name,callback)=>{assert.equal(name,'message');receive=callback}};vm.runInNewContext(fs.readFileSync(new URL('../../../pluginhost/sdk.js',import.meta.url),'utf8'),{window,parent,crypto:{randomUUID:()=>`rpc-${++counter}`},setTimeout:(callback)=>{timers.set(counter,callback);return counter},clearTimeout:id=>timers.delete(id),Error,Map,Set,Promise,Object});
 receive({source:{},data:{type:'artex.init',channel:'foreign'}});assert.equal(window.artex.context(),undefined);receive({source:parent,data:{type:'artex.init',channel:'channel-1',context:{task:1}}});await window.artex.ready;assert.equal(window.artex.context().task,1);const call=window.artex.invoke('host.version');await new Promise(setImmediate);assert.equal(sent.length,1);const message=sent[0];assert.equal(message.channel,'channel-1');assert.equal(message.method,'host.version');receive({source:parent,data:{type:'artex.result',channel:'wrong',id:message.id,result:'wrong'}});assert.equal(timers.size,1);receive({source:parent,data:{type:'artex.result',channel:'channel-1',id:message.id,result:'ARTEX'}});assert.equal(await call,'ARTEX');assert.equal(timers.size,0);
});
