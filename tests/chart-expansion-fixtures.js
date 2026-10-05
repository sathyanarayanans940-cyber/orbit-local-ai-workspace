(function(root){
 const base={kind:'chart',title:'Sample comparison',labels:['Plan','Build','Ship'],series:[{name:'Team A',values:[4,8,6]},{name:'Team B',values:[2,4,3]}]};
 const specs=['horizontal-bar','stacked-bar','percent-bar','stacked-area','step','radar'].map(chartType=>({...base,chartType,title:chartType.replace(/-/g,' ')+' · sample data'}));
 specs.push(
  {kind:'chart',chartType:'gantt',title:'Release schedule · sample dates',tasks:[{label:'Plan',start:'2026-10-03',end:'2026-10-05',progress:100},{label:'Build',start:'2026-10-05',end:'2026-10-12',progress:45},{label:'Review',start:'2026-10-10',end:'2026-10-13',progress:0},{label:'Release milestone',start:'2026-10-14',end:'2026-10-14'}]},
  {kind:'chart',chartType:'histogram',title:'Latency distribution · sample data',samples:[1,2,2,3,3,3,4,5,5,8],bins:4,xLabel:'Seconds'},
  {kind:'chart',chartType:'heatmap',title:'Topic scores · sample data',labels:['Algebra','Statistics','Calculus'],rowLabels:['Group A','Group B','Group C'],values:[[70,85,60],[80,null,75],[50,65,95]],unit:'Marks'},
  {kind:'chart',chartType:'bubble',title:'Effort, score and group size · sample data',x:[1,2,3,4],xLabel:'Study hours',series:[{name:'Students',values:[45,65,70,85],sizes:[5,15,10,25]}],unit:'Marks'},
  {kind:'chart',chartType:'waterfall',title:'Budget changes · sample data',labels:['Opening','Income','Expense','Closing'],series:[{name:'Budget',values:[100,50,-30,120]}],totals:[3],unit:'INR'},
  {kind:'chart',chartType:'funnel',title:'Conversion stages · sample data',labels:['Visitors','Signups','Trials','Paid'],series:[{name:'People',values:[1000,500,200,80]}]},
  {kind:'chart',chartType:'treemap',title:'Storage usage · sample data',nodes:[{id:'files',label:'Files',parent:''},{id:'code',label:'Code',parent:'files'},{id:'js',label:'JavaScript',parent:'code',value:35},{id:'py',label:'Python',parent:'code',value:25},{id:'docs',label:'Documents',parent:'files',value:40}],unit:'MB'}
 );
 root.chartExpansionFixtures=specs;
 if(typeof module!=='undefined')module.exports=specs;
})(typeof window==='undefined'?globalThis:window);
