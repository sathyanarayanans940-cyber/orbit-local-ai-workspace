const {test}=require('node:test');
const assert=require('node:assert/strict');

test('OpenAI requests participate in API accounting and output caps',()=>{
 const B=require('../workspace-budget.js');
 const rows=[{kind:'model',provider:'OpenAI',model:'gpt-6-luna',requests:2,reported:2,input:100,output:40,total:140,reasoning:30,cached:80}];
 const sum=B.estimate(rows,{'OpenAI:gpt-6-luna':{input:1,output:2}});
 assert.equal(sum.requests,2);assert.equal(sum.total,140);assert.equal(sum.cost,180/1e6);
 const limited=JSON.parse(B.cap(JSON.stringify({max_tokens:65536,reasoning_effort:'max'}),'OpenAI',16000));
 assert.equal(limited.max_tokens,16000);assert.equal(limited.reasoning_effort,'max');
});
