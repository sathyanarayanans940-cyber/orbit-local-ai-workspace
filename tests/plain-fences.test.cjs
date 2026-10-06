const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const context = vm.createContext({window:{katex:require('../vendor/katex/katex.min.js')},icons:{copy:''},state:{currentChat:'fences'}});
vm.runInContext(source.slice(source.indexOf('function escapeHtml('),source.indexOf('function latestUserMessageIndex(')),context);
const render = (text, options) => context.renderRichText(text,0,options);
const contents = html => [...html.matchAll(/<code class="code-content"[^>]*>([\s\S]*?)<\/code>/g)].map(match=>match[1].replace(/<[^>]*>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&'));
const {suffixes,tree} = require('./fixtures/plain-fences.json');

test('BANANA suffixes and tree are literal fenced blocks with indentation and dollars intact',()=>{
 const text = '# Dry run on BANANA\n\nSuffixes:\n```\n'+suffixes+'\n```\n\nThe tree:\n```\n'+tree+'\n```\n\nAfter.';
 const html = render(text);
 assert.deepEqual(contents(html),[suffixes,tree]);
 assert.doesNotMatch(html,/```|katex|<table/);
 assert.match(html,/After\./);
});

test('fences accept plain output, empty blocks and unknown languages without code heuristics',()=>{
 for(const fence of ['```','~~~~','`````'])for(const label of ['','text','console','output','custom-language'])for(const content of ['',suffixes,tree,'hello\n  world','x = 1 = 2\n$y$\n**literal**\n<table onclick="bad()">&</table>']){
  const html = render(fence+label+'\n'+content+'\n'+fence);
  assert.deepEqual(contents(html),[content],fence+label);
  assert.doesNotMatch(html,/class="katex|<table|onclick="bad/);
 }
});

test('unlabeled blocks preserve every arriving content prefix while streaming',()=>{
 for(const content of [suffixes,tree]){
  for(let i=0;i<=content.length;i++){
   const html = render('```\n'+content.slice(0,i),{streaming:true});
   assert.deepEqual(contents(html),[context.trimCodeValue(content.slice(0,i))]);
   assert.match(html,/aria-busy="true"/);
   assert.doesNotMatch(html,/class="katex/);
  }
  assert.doesNotMatch(render('```\n'+content+'\n```',{streaming:true}),/aria-busy/);
  assert.deepEqual(contents(render('```\n'+content)),[content]);
 }
});

test('fences honor character, length, indentation and literal nested delimiters',()=>{
 assert.deepEqual(contents(render('````markdown\n```\nhello\n```\n````')),['```\nhello\n```']);
 assert.deepEqual(contents(render('```\nhello\n~~~\n``\n``` trailing\n  ```\nAfter')),['hello\n~~~\n``\n``` trailing']);
 assert.deepEqual(contents(render('  ~~~ output\r\n  ROOT\r\n    child\r\n  ~~~~~\r\nAfter')),['ROOT\n  child']);
 assert.deepEqual(contents(render('``` text\nhello\n```')),['hello']);
});

test('inline fence mentions and backticks in backtick info strings do not open blocks',()=>{
 for(const text of ['Use ``` to mark a block.','``` is a fence; ``` closes it.','\\```\nordinary text','``literal``','```text`invalid\nordinary text'])assert.deepEqual(contents(render(text)),[],text);
});
