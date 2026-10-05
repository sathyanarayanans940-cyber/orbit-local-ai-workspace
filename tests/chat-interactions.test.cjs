const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
test('only Analyze receives a clock; other stages stay text-only',()=>{
 let now=0,tick,stopped=0,elements=[];
 const c=vm.createContext({escapeHtml:s=>s,performance:{now:()=>now},setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>stopped++,document:{querySelectorAll:()=>elements}});
 vm.runInContext(source.slice(source.indexOf('const replyStatusClocks ='),source.indexOf('function renderMessages(')),c);
 const owner={};let html=c.replyStatusMarkup(owner,'Writing section 1 of 19…');assert.doesNotMatch(html,/status-elapsed|data-status-start/);now=121000;
 html=c.replyStatusMarkup(owner,'Writing section 2 of 19…');assert.doesNotMatch(html,/status-elapsed|data-status-start/);
 html=c.replyStatusMarkup(owner,'Analyzing…');assert.match(html,/0 sec/);
 now+=5000;assert.match(c.replyStatusMarkup(owner,'Analyzing…'),/5 sec/);
 const timer={dataset:{statusStart:'121000'},textContent:'0 sec'};elements=[timer];now=152000;tick();assert.equal(timer.textContent,'31 sec');elements=[];tick();assert.equal(stopped,1);
});
test('scroll snapshot does not resume follow after reader interrupts a pending update',()=>{
 const wrap={scrollTop:500,scrollHeight:1000,clientHeight:500};const c=vm.createContext({$:()=>wrap,updateJumpToLatest(){}});
 vm.runInContext(source.slice(source.indexOf('let followLatest ='),source.indexOf('// One lightweight clock')),c);
 const pinned=c.chatScrollSnapshot();assert.equal(pinned.follow,true);
 vm.runInContext('followLatest=false',c);wrap.scrollHeight+=300;c.restoreChatScroll(pinned);assert.equal(wrap.scrollTop,500);
 wrap.scrollTop=200;const reading=c.chatScrollSnapshot();wrap.scrollHeight+=300;c.restoreChatScroll(reading);assert.equal(wrap.scrollTop,200);
});
