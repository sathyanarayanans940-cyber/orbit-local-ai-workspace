const er={kind:'diagram',title:'Orders · entity relationships',width:1100,height:620,nodes:[
{id:'customer',shape:'entity',label:'Customer',x:175,y:150,width:250,attributes:['PK customer_id: UUID','name: text','email: text']},
{id:'order',shape:'entity',label:'Order',x:650,y:150,width:260,fill:'accent',attributes:['PK order_id: UUID','FK customer_id: UUID','status: enum']},
{id:'line',shape:'entity',label:'Order item',x:650,y:470,width:260,attributes:['PK item_id: UUID','FK order_id: UUID','FK product_id: UUID','quantity: integer']},
{id:'product',shape:'entity',label:'Product',x:175,y:470,width:250,fill:'#16a34a',attributes:['PK product_id: UUID','name: text','price: decimal']}
],edges:[{from:'customer',to:'order',label:'places',fromCardinality:'1',toCardinality:'0..*'},{from:'order',to:'line',label:'contains',fromCardinality:'1',toCardinality:'1..*'},{from:'product',to:'line',label:'appears in',fromCardinality:'1',toCardinality:'0..*'}]};
const activity={kind:'diagram',title:'Checkout · activity with parallel work',width:1000,height:1040,groups:[{label:'Customer',x:20,y:20,width:340,height:1000},{label:'Order service',x:380,y:20,width:600,height:1000}],nodes:[
{id:'start',shape:'initial',x:190,y:90},
{id:'submit',label:'Submit order',shape:'pill',x:190,y:210,width:220},
{id:'check',label:'In stock?',shape:'diamond',x:680,y:210,width:160,height:110},
{id:'reject',label:'Show unavailable items',x:190,y:400,width:240,fill:'#e11d48'},
{id:'stop',shape:'final',x:190,y:540},
{id:'fork',shape:'fork',x:680,y:400,width:320},
{id:'reserve',label:'Reserve inventory',x:525,y:560,width:220,fill:'accent'},
{id:'pay',label:'Authorize payment',x:835,y:560,width:220},
{id:'join',shape:'join',x:680,y:720,width:320},
{id:'confirm',label:'Confirm order',shape:'pill',x:680,y:845,width:220,fill:'#16a34a'},
{id:'end',shape:'final',x:680,y:965}
],edges:[{from:'start',to:'submit'},{from:'submit',to:'check',fromPort:'right',toPort:'top',points:[{x:400,y:210},{x:400,y:95},{x:680,y:95}]},{from:'check',to:'reject',label:'[no]',fromPort:'left',toPort:'right',points:[{x:430,y:210},{x:430,y:400}]},{from:'reject',to:'stop'},{from:'check',to:'fork',label:'[yes]'},{from:'fork',to:'reserve',fromPort:'bottom',toPort:'top',points:[{x:680,y:450},{x:525,y:450}]},{from:'fork',to:'pay',fromPort:'bottom',toPort:'top',points:[{x:680,y:450},{x:835,y:450}]},{from:'reserve',to:'join',fromPort:'bottom',toPort:'top',points:[{x:525,y:660},{x:680,y:660}]},{from:'pay',to:'join',fromPort:'bottom',toPort:'top',points:[{x:835,y:660},{x:680,y:660}]},{from:'join',to:'confirm'},{from:'confirm',to:'end'}]};
const cardinalities={kind:'diagram',title:'Cardinalities · all endpoint orientations',width:1100,height:550,nodes:[],edges:[]};
['0..1','1','0..*','1..*'].forEach((c,i)=>{const y=65+i*135;cardinalities.nodes.push({id:'a'+i,label:'Source',x:110,y,width:130},{id:'b'+i,label:'Target',x:890,y,width:130});cardinalities.edges.push({from:'a'+i,to:'b'+i,fromCardinality:c,toCardinality:c,label:c});});
const attributes={kind:'diagram',title:'Long attributes · Unicode and escaping',width:1000,height:900,nodes:[{id:'e',shape:'entity',label:'Audit event\n(immutable)',x:300,y:440,width:440,fill:'#f59e0b',attributes:['PK event_id: UUID','FK organization_id: UUID','தமிழ் குறிப்புகள்: text','👩🏽‍💻 author_name: text','unusually_long_field_name_that_wraps_without_losing_information: varchar(255)','<script>alert("plain text")</script>',...Array.from({length:6},(_,i)=>'metadata_'+i+': optional text')]}],edges:[{from:'e',to:'e',label:'supersedes',fromCardinality:'0..1',toCardinality:'0..*'}]};
module.exports={er,activity,cardinalities,attributes};
