const diagram=(title,width,height,nodes,edges=[],groups=[])=>({kind:'diagram',title,width,height,nodes,edges,groups});
const node=(id,label,x,y,width=180,height=76,shape='rect')=>({id,label,x,y,width,height,shape});
const edge=(from,to,label='',extra={})=>({from,to,label,...extra});
const cases=[];
function grid(id,title,cols,rows,width,height,names,grouped=false){
 const dx=(width-100)/cols,dy=(height-100)/rows;
 const nodes=Array.from({length:cols*rows},(_,i)=>node('n'+i,`${names[Math.floor(i/cols)%names.length]} ${i%cols+1}\n(healthy · v2.8)`,50+dx*(i%cols+.5),50+dy*(Math.floor(i/cols)+.5),Math.min(230,dx-50),80));
 const edges=[];
 for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){let i=r*cols+c;if(c<cols-1)edges.push(edge('n'+i,'n'+(i+1),c===0?'request':''));if(r<rows-1)edges.push(edge('n'+i,'n'+(i+cols),c===cols-1?'events':''));}
 const groups=grouped?Array.from({length:rows},(_,r)=>({label:names[r%names.length],x:25,y:50+dy*r,width:width-50,height:dy-16})):[];
 cases.push({id,spec:diagram(title,width,height,nodes,edges,groups)});
}
grid('microservices','01 · Commerce platform — 24 services',4,6,1440,1500,['Edge gateway','Identity services','Commerce APIs','Event consumers','Search & analytics','Persistent storage'],true);
grid('maximum','02 · Full deployment — 80 nodes / 160 edges / 12 groups',8,10,2400,3200,['Ingress','Authentication','Catalog','Orders','Payments','Inventory','Fulfilment','Notifications','Analytics','Storage'],true);
const max=cases.at(-1).spec;
max.groups.unshift({label:'Production platform · 8 shards across 10 service tiers',x:5,y:5,width:2390,height:3190});
max.groups.push({label:'Observability · distributed tracing enabled',x:25,y:3170,width:2350,height:25+25}); // reset within canvas below
max.groups.at(-1).y=3135;max.groups.at(-1).height=60;
for(let i=0;max.edges.length<160;i++)max.edges.push(edge('n'+i,'n'+i,'retry',{dashed:true}));
grid('tall','03 · Data lineage — 60 stages on a 4000px canvas',5,12,1600,4000,['Extract','Validate','Normalize','Enrich','Partition','Aggregate','Join','Score','Audit','Publish','Archive','Retention'],true);
const nested=diagram('04 · Nested architecture — reverse container order',1200,850,[node('api','Public API\n(rate limited)',240,250,220),node('worker','Worker pool\n(8 consumers)',720,350,230),node('db','Primary database',720,590,230,100,'cylinder')],[edge('api','worker','enqueue'),edge('worker','db','transaction')],[{label:'Data subnet',x:510,y:490,width:430,height:230},{label:'Private network',x:450,y:190,width:640,height:570},{label:'Cloud account',x:30,y:40,width:1130,height:770}]);cases.push({id:'nested',spec:nested});
const fanNodes=[node('gateway','Event router',140,750,200,90),...Array.from({length:15},(_,i)=>node('svc'+i,['Billing','Search','Email','Fraud','Shipping'][i%5]+' consumer '+(i+1),620,70+i*98,220,64))];
cases.push({id:'fanout',spec:diagram('05 · Event fan-out — 15 subscriptions',900,1540,fanNodes,fanNodes.slice(1).map((n,i)=>edge('gateway',n.id,'topic '+(i+1),{fromPort:'right',toPort:'left',points:[{x:340+i*8,y:750},{x:340+i*8,y:n.y}],labelPosition:{x:455,y:n.y}})))});
const labels=['Recalculate the preferred mode of every active cluster','Customer reconciliation and consistency verification','q0\n(Waiting for acknowledgment)','Primary storage\n(Replication factor: 3)','Authentication required?','LongIdentifierWithoutAnySpaces0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
cases.push({id:'long-labels',spec:diagram('06 · Long labels and every node shape',1100,760,labels.map((s,i)=>node('l'+i,s,280+(i%2)*550,125+Math.floor(i/2)*245,i===2?190:360,i===2?190:i===4?170:110,['rect','pill','circle','cylinder','diamond','text'][i])))});
cases.push({id:'unicode',spec:diagram('07 · Unicode, punctuation and inert markup',1050,760,['தமிழ் தரவு சேமிப்பு','日本語のサービス構成','العربية — معالجة الطلب','👩🏽‍💻 👨‍👩‍👧‍👦 🧑‍🚀','Café réplique · naïve','<script>alert("x")</script>','(Accepted!) [queue: A → B]','状态：已完成 ✅'].map((s,i)=>node('u'+i,s,270+(i%2)*510,90+Math.floor(i/2)*180,380,95)))});
cases.push({id:'loops',spec:diagram('08 · Multiple self-loops and nearby states',1000,650,[node('a','A',230,310,100,100,'circle'),node('b','B',520,310,100,100,'circle'),node('c','C',810,310,100,100,'circle')],[...['timeout','retry','wait','refresh'].map(s=>edge('a','a',s)),edge('a','b','ready'),edge('b','b','0'),edge('b','b','1'),edge('b','c','finish')])});
cases.push({id:'parallel',spec:diagram('09 · Parallel and opposing connections',1050,500,[node('a','API service',200,250,200,100),node('b','Database',800,250,200,110,'cylinder')],[edge('a','b','read'),edge('a','b','write'),edge('b','a','result')])});
cases.push({id:'label-crossing',spec:diagram('10 · Crossing connection labels',1000,700,[node('a','Web client',170,150),node('b','Mobile client',830,150),node('c','Service A',170,550),node('d','Service B',830,550)],[edge('a','d','Authenticated HTTPS request'),edge('b','c','Asynchronous event acknowledgment')])});
cases.push({id:'boundaries',spec:diagram('11 · Canvas boundaries and corner loops',800,500,[[0,0],[800,0],[0,500],[800,500]].map(([x,y],i)=>node('c'+i,'N'+i,x,y,80,80,'circle')),[0,1,2,3].map(i=>edge('c'+i,'c'+i,'retry at boundary')))});
const treeNodes=Array.from({length:63},(_,i)=>{const l=Math.floor(Math.log2(i+1)),k=i-(2**l-1);return node('t'+i,String(i+1),(k+.5)*2400/(2**l),70+l*160,48,48,'circle');});
cases.push({id:'tree',spec:diagram('12 · Balanced binary tree — 63 vertices',2400,950,treeNodes,treeNodes.slice(1).map((n,i)=>edge('t'+Math.floor(i/2),n.id)))});
const chain=Array.from({length:80},(_,i)=>node('p'+i,'Stage '+(i+1),140+(i%8)*295,120+Math.floor(i/8)*280,210,84));
cases.push({id:'chain',spec:diagram('13 · Workflow — 80 explicit processing stages',2400,2900,chain,chain.slice(1).map((n,i)=>edge('p'+i,n.id,'',{...(i%8===7?{fromPort:'bottom',toPort:'top',points:[{x:chain[i].x,y:chain[i].y+130},{x:n.x,y:chain[i].y+130}]}:{})})))});
cases.push({id:'queue',spec:diagram('14 · Queue and stack with status captions',1800,600,[...Array.from({length:10},(_,i)=>node('q'+i,String(i),100+i*175,180,120,70)),node('caption','Front → queued jobs → Rear',900,60,600,50,'text'),...Array.from({length:3},(_,i)=>node('s'+i,'Stack '+i,900,330+i*90,250,70))],Array.from({length:9},(_,i)=>edge('q'+i,'q'+(i+1))))});
grid('storage','15 · Storage architecture — 36 detailed components',6,6,2200,1800,['Request coordinators','Shard leaders','Read replicas','Index services','Backup workers','Object storage'],true);
cases.push({id:'state-reference',spec:{...require('./diagram-style.cjs'),title:'16 · State machine screenshot regression'}});
cases.push({id:'graphemes',spec:diagram('17 · Narrow Unicode labels — grapheme boundaries',1000,520,['👨‍👩‍👧‍👦'.repeat(5),'👩🏽‍💻'.repeat(6),'Café'.repeat(7),'🇮🇳'.repeat(8)].map((label,i)=>node('g'+i,label,140+i*240,250,120,200)))});
const regionNodes=[node('client','Web & mobile clients',1000,70,260),node('dns','Global traffic manager\n(health-based routing)',1000,230,290)];
const regionEdges=[edge('client','dns','HTTPS')];
const regionGroups=[];
for(const [r,x] of [['a',500],['b',1500]]){
 regionGroups.push({label:'Region '+r.toUpperCase()+' · isolated private network',x:x-430,y:365,width:860,height:1190});
 const rows=[['ingress','Ingress gateway\n(TLS + rate limiting)',x,460,'rect'],['auth','Identity service\n(OIDC / JWT)',x-220,660,'rect'],['api','Application API\n(autoscaled pods)',x+220,660,'rect'],['cache','Session cache\n(TTL: 15 minutes)',x-220,890,'cylinder'],['bus','Event stream\n(partitioned topics)',x+220,890,'pill'],['workers','Background workers\n(idempotent jobs)',x+220,1120,'rect'],['db','Transactional store\n(primary + replicas)',x-220,1340,'cylinder'],['objects','Object storage\n(versioned backups)',x+220,1340,'cylinder']];
 for(const [id,label,nx,y,shape] of rows)regionNodes.push(node(r+id,label,nx,y,300,96,shape));
 regionEdges.push(edge('dns',r+'ingress',r==='a'?'primary':'failover',{dashed:r==='b'}),edge(r+'ingress',r+'auth','authenticate'),edge(r+'ingress',r+'api','route'),edge(r+'auth',r+'cache','sessions'),edge(r+'api',r+'bus','publish'),edge(r+'bus',r+'workers','consume'),edge(r+'workers',r+'objects','archive'),edge(r+'workers',r+'db','commit'),edge(r+'api',r+'cache','read through',{fromPort:'left',toPort:'right',points:[{x:x,y:660},{x:x,y:890}],labelPosition:{x:x,y:800}}));
}
regionEdges.push(edge('adb','bdb','asynchronous replication',{fromPort:'bottom',toPort:'bottom',points:[{x:280,y:1650},{x:1280,y:1650}],labelPosition:{x:780,y:1650},dashed:true}));
cases.push({id:'regions',spec:diagram('18 · Regional application architecture with disaster recovery',2000,1750,regionNodes,regionEdges,regionGroups)});
module.exports=cases;
