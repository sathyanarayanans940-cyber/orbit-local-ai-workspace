const architecture={kind:'diagram',title:'Project architecture',width:1000,height:520,nodes:[
{id:'user',label:'Student',shape:'pill',x:100,y:260,width:130},
{id:'web',label:'Web interface',x:320,y:260,width:160,fill:'accent'},
{id:'api',label:'Application API',x:560,y:260,width:180,fill:'accent'},
{id:'db',label:'Records',shape:'cylinder',x:830,y:140,width:160,height:85},
{id:'files',label:'Documents',shape:'cylinder',x:830,y:380,width:160,height:85}],edges:[
{from:'user',to:'web',label:'request'},{from:'web',to:'api',label:'HTTPS'},{from:'api',to:'db',label:'query'},{from:'api',to:'files',label:'export'}]};
const trend={kind:'chart',title:'Illustrative response times',chartType:'bar',labels:['Baseline','Indexed','Cached'],series:[{name:'Synthetic example',values:[180,95,42]}],unit:'Milliseconds · synthetic data'};
const modernDeck={kind:'pptx',title:'Campus project platform',theme:'midnight',slides:[
{layout:'cover',kicker:'PROJECT PROPOSAL · ILLUSTRATIVE',title:'One place for project evidence',subtitle:'A proposed platform for submissions, review, and clear feedback.'},
{layout:'split',title:'Submission and review',subtitle:'Two connected workflows, with one shared record.',columns:[{title:'Students',body:'Submit the report, code, screenshots, and supporting diagrams together. Track what has been reviewed and what needs attention.'},{title:'Reviewers',body:'Read the same evidence, leave actionable feedback, and compare revised submissions without searching across messages.'}]},
{layout:'metrics',title:'Example operating targets',subtitle:'Planning assumptions, not measured production results.',metrics:[{value:'3 steps',label:'Submission flow',detail:'Choose project, attach evidence, submit.'},{value:'24 hours',label:'Review target',detail:'Illustrative turnaround objective.'},{value:'1 record',label:'Evidence history',detail:'Keep each revision alongside its feedback.'}]},
{layout:'section',tone:'accent',kicker:'SYSTEM DESIGN',title:'Architecture and data flow',subtitle:'A small set of responsibilities with explicit boundaries.'},
{layout:'visual',title:'The application connects records and evidence',visual:architecture,caption:'Orbit diagram embedded directly from its declarative recipe.'},
{layout:'visual',title:'Performance comparison',visual:trend,caption:'Synthetic example values for layout verification; not a benchmark.'},
{layout:'timeline',title:'Delivery plan',steps:[{title:'Define',body:'Agree on evidence formats and acceptance criteria.'},{title:'Build',body:'Implement submission and reviewer workflows.'},{title:'Validate',body:'Test permissions, recovery, and file rendering.'},{title:'Release',body:'Start a small pilot and collect feedback.'}]},
{layout:'quote',tone:'dark',title:'Design principle',quote:'Keep the evidence close to the decision.',attribution:'Proposed product principle · illustrative project'},
{title:'Acceptance criteria',table:{headers:['Area','Required behavior'],rows:[['Submission','A report and its images remain associated.'],['Review','Feedback identifies the relevant evidence.'],['Export','Diagrams and charts appear inside the file.']]}},
{title:'Next decisions',bullets:['Confirm the first project cohort and its document requirements.','Assign owners for implementation and review.','Agree on pilot success criteria before collecting results.'],notes:'No claims of measured project outcomes are made in this illustrative deck.'}
]};
if(typeof module!=='undefined')module.exports={modernDeck,architecture,trend};
