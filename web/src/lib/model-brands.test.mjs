import test from 'node:test';
import assert from 'node:assert/strict';
import {modelBrand,MODEL_BRANDS} from './model-brands.ts';
test('brand follows model, never the OpenAI-compatible wire format',()=>{
 assert.equal(modelBrand({model:'deepseek-flash',format:'openai'}),'deepseek');
 assert.equal(modelBrand({model:'glm-4.7',format:'anthropic'}),'glm');
 assert.equal(modelBrand({model:'vendor/claude-sonnet-4',base_url:'https://gateway.invalid'}),'anthropic');
 assert.equal(modelBrand({model:'qwen3-coder-plus'}),'qwen');
});
test('explicit override wins for renamed gateway models; custom stays neutral',()=>{
 assert.equal(modelBrand({brand:'kimi',model:'renamed-private-model'}),'kimi');
 assert.equal(modelBrand({brand:'custom',model:'gpt-5'}),'custom');
 assert.equal(modelBrand({model:'unknown',format:'openai'}),'custom');
 assert.equal(modelBrand({model:'unknown',base_url:'https://api.deepseek.com.evil.invalid'}),'custom');
 assert.equal(modelBrand({model:'unknown',base_url:'https://api.deepseek.com'}),'deepseek');
});
test('all registered model families resolve',()=>{
 const models={openai:'gpt-5',anthropic:'claude-opus-4',gemini:'gemini-2.5-pro',qwen:'qwen3',kimi:'kimi-k2',minimax:'MiniMax-M2',xai:'grok-4',mistral:'codestral-latest',doubao:'doubao-pro',stepfun:'step-2',meta:'llama-3'};
 for(const[brand,model]of Object.entries(models))assert.equal(modelBrand({model}),brand);
 assert.equal(new Set(MODEL_BRANDS.map(x=>x[0])).size,MODEL_BRANDS.length);
});
test('every shipped brand has a verified local official asset', async()=>{
 const fs=await import('node:fs');const crypto=await import('node:crypto');
 const root=new URL('../../public/model-brands/',import.meta.url);const manifest=JSON.parse(fs.readFileSync(new URL('SOURCES.json',root),'utf8'));
 for(const[brand] of MODEL_BRANDS){if(brand==='custom')continue;const m=manifest[brand];assert.ok(m?.file,brand);const bytes=fs.readFileSync(new URL(m.file,root));assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),m.sha256);assert.ok(m.source.startsWith('https://'));}
});
