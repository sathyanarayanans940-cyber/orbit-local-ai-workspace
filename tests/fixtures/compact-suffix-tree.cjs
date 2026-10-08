// Synthetic reconstruction of the sparse BANANA suffix-tree layout.
module.exports={kind:'diagram',title:'BANANA suffix tree',width:1200,height:580,nodes:[
{id:'root',label:'ROOT',shape:'circle',width:80,x:600,y:55},
{id:'s6',label:'suffix 6',width:120,height:52,x:110,y:195},
{id:'a',label:'A',shape:'circle',width:64,x:400,y:195},
{id:'s0',label:'suffix 0',width:150,height:52,x:780,y:195},
{id:'na',label:'NA',shape:'circle',width:64,x:1070,y:195},
{id:'s5',label:'suffix 5',width:120,height:52,x:250,y:370},
{id:'ana',label:'ANA',shape:'circle',width:80,x:520,y:370},
{id:'s4',label:'suffix 4',width:120,height:52,x:950,y:370},
{id:'s2',label:'suffix 2',width:130,height:52,x:1120,y:370},
{id:'s3',label:'suffix 3',width:120,height:52,x:430,y:545},
{id:'s1',label:'suffix 1',width:120,height:52,x:640,y:545}],edges:[
['root','s6','$'],['root','a','A'],['root','s0','BANANA$'],['root','na','NA'],['a','s5','$'],['a','ana','NA'],['na','s4','$'],['na','s2','NA$'],['ana','s3','$'],['ana','s1','NA$']
].map(([from,to,label])=>({from,to,label}))};
