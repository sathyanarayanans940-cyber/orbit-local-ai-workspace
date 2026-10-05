const {test}=require('node:test'), assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('app.js','utf8');
function fn(name){let start=source.indexOf('function '+name+'(');if(source.slice(start-6,start)==='async ')start-=6;return source.slice(start,source.indexOf('\nfunction ',start+1));}
function context(){const ctx={state:{currentChat:'a',savedChats:{a:{title:'A',updatedAt:1},b:{title:'B',pinned:true,updatedAt:3},c:{title:'C',pinned:true,updatedAt:2},d:{title:'D',archived:true,pinned:true,updatedAt:4}},deletedChats:new Set(),projects:{}},isArchivedChat:c=>c?.archived===true,persistChats(){},renderSavedHistory(){},updateConversationTools(){},showToast(){},closeConversationMenu(){},renderProjectSidebar(){}};vm.createContext(ctx);vm.runInContext(fn('toggleChatPin')+fn('sidebarChatGroups')+fn('archiveCurrentChat'),ctx);return ctx;}
test('pinned and recent are disjoint and ordered by last use',()=>{const c=context();const g=c.sidebarChatGroups();assert.equal(g.pinned.map(x=>x[0]).join(','),'b,c');assert.equal(g.recent.map(x=>x[0]).join(','),'a');c.state.savedChats.c.updatedAt=8;assert.equal(c.sidebarChatGroups().pinned[0][0],'c');});
test('pin, unpin, archive and unarchive preserve invariants',()=>{const c=context();c.toggleChatPin();assert.equal(c.state.savedChats.a.pinned,true);assert.equal(c.sidebarChatGroups().recent.length,0);c.archiveCurrentChat();assert.equal(c.state.savedChats.a.pinned,false);c.toggleChatPin();assert.equal(c.state.savedChats.a.pinned,false);c.archiveCurrentChat();assert.equal(c.state.savedChats.a.pinned,false);c.toggleChatPin();c.toggleChatPin();assert.equal(c.state.savedChats.a.pinned,false);});
test('deleted pins disappear; project chats can be pinned',()=>{const c=context();c.state.deletedChats.add('b');c.state.projects.p={};c.state.savedChats.a.projectId='p';c.toggleChatPin();assert.equal(c.sidebarChatGroups().pinned.map(x=>x[0]).join(','),'c,a');});
test('opening chats and background persistence preserve order; sending promotes only within its section',async()=>{
 const c=context();
 c.repairLoadedAutomaticTitle=()=>false;
 Object.assign(c,{voiceInput:null,chatLoadRevision:0,normalizedWidgetArtifacts:()=>[],structuredClone,Date:class extends Date {static now(){return 100;}},$:()=>({classList:{toggle(){} }}),$$:()=>[],syncChatUrl(){},renderConversationTitle(){},closeTitleEdit(){},showWorkspaceMode(){},renderArchiveSidebar(){},renderMessages(){},closeSidebar(){},startPersistentChat(){}});
 c.state.savedChats.a.messages=[{role:'user',text:'Earlier question'}];
 c.state.savedChats.e={title:'E',updatedAt:5,messages:[{role:'user',text:'Newer question'}]};
 vm.runInContext(fn('persistCurrentChat')+fn('loadChat')+fn('addMessage'),c);
 await c.loadChat('a','A');assert.equal(c.state.savedChats.a.updatedAt,1);assert.equal(c.sidebarChatGroups().recent[0][0],'e');
 c.persistCurrentChat();assert.equal(c.state.savedChats.a.updatedAt,1);
 c.addMessage('assistant','Recovered answer');assert.equal(c.state.savedChats.a.updatedAt,1);
 c.addMessage('user','New question');assert.equal(c.state.savedChats.a.updatedAt,100);assert.equal(c.sidebarChatGroups().recent[0][0],'a');
 c.state.savedChats.c.messages=[{role:'user',text:'Pinned question'}];c.loadChat('c','C');assert.equal(c.sidebarChatGroups().pinned[0][0],'b');
 c.addMessage('user','Pinned follow-up');assert.equal(c.sidebarChatGroups().pinned[0][0],'c');assert.equal(c.sidebarChatGroups().recent[0][0],'a');
 c.archiveCurrentChat();c.archiveCurrentChat();assert.equal(c.state.savedChats.c.updatedAt,100);
});

test('exporting the current pinned chat retains the pin in the downloaded conversation',()=>{
 const c=context();let exported;
 Object.assign(c,{downloadJson:payload=>exported=payload,normalizedWidgetArtifacts:x=>x});
 c.state.currentChat='b';c.state.currentTitle='B';c.state.messages=[{role:'user',text:'Question'}];
 vm.runInContext(fn('exportableMessage')+fn('exportableChat')+fn('safeFilename')+fn('shareCurrentChat'),c);
 c.shareCurrentChat();assert.equal(exported.pinned,true);assert.equal(exported.messages[0].text,'Question');
 c.state.savedChats.b.archived=true;c.shareCurrentChat();assert.equal(exported.pinned,false);
});
