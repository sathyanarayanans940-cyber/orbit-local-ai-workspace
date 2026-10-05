const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('app.js','utf8').match(/const ollamaBase = [\s\S]*?;/)[0];
test('installed local addresses use same-origin Ollama proxy, including Safari localhost',()=>{
 for(const hostname of ['orbit.com','localhost','127.0.0.1','[::1]']){
  assert.equal(vm.runInNewContext(code+'\nollamaBase',{window:{location:{hostname}}}),'/api/ollama');
 }
});
