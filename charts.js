/* Bounded, offline SVG charts. Recipes describe data, never executable code. */
(function(root){
  'use strict';
  const types=Object.freeze(['gantt','horizontal-bar','stacked-bar','percent-bar','stacked-area','step','histogram','heatmap','bubble','waterfall','radar','funnel','treemap']);
  const categorical=['horizontal-bar','stacked-bar','percent-bar','stacked-area','step','waterfall','radar','funnel'];
  const colors=['#5276e8','#18a89b','#ec9862','#a075d4','#de6b96'];
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
  function fail(message){throw new Error(message);}
  function text(v,max=100){if(typeof v!=='string'||v.length>max)fail('Chart labels must be text, up to '+max+' characters.');return v.replace(/[\u0000-\u001f]/g,'');}
  function list(v,max){if(!Array.isArray(v)||!v.length||v.length>max)fail('Supply 1–'+max+' chart items.');for(let i=0;i<v.length;i++)if(!Object.hasOwn(v,i))fail('Chart arrays must contain every item; use null only for missing heatmap cells.');return v;}
  function numbers(v,max){const a=list(v,max);if(!a.every(number))fail('Chart data must be finite numbers, up to 10¹² in magnitude.');return a.slice();}
  function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))return null;const n=Date.parse(v+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v?n:null;}
  const time=v=>typeof v==='number'?v:date(v);
  const sameTotal=(a,b)=>a===b||Math.abs(a-b)<=16*Number.EPSILON*Math.max(Math.abs(a),Math.abs(b));
  function treeTotals(nodes){
    const map=new Map(nodes.map(n=>[n.id,n])), children=new Map();
    for(const n of nodes){if(n.parent&&!map.has(n.parent))fail('Treemap parent does not exist.');if(!children.has(n.parent))children.set(n.parent,[]);children.get(n.parent).push(n);}
    const totals=new Map(),visiting=new Set();
    function visit(n,depth){if(depth>8||visiting.has(n.id))fail('Treemap hierarchy must be acyclic and at most eight levels deep.');if(totals.has(n.id))return totals.get(n.id);visiting.add(n.id);const kids=children.get(n.id)||[];const total=kids.length?kids.reduce((sum,k)=>sum+visit(k,depth+1),0):n.value;if(kids.length&&n.value!==undefined&&!sameTotal(total,n.value))fail('Treemap parent values must equal their leaf totals, or be omitted.');totals.set(n.id,total);visiting.delete(n.id);return total;}
    // Visit every node: a disconnected cycle must also be rejected.
    for(const n of nodes)visit(n,1);
    for(const n of nodes){let p=n,depth=1;while(p.parent){p=map.get(p.parent);if(++depth>8)fail('Treemap hierarchy is at most eight levels deep.');}}
    if(!(nodes.filter(n=>!n.parent).reduce((s,n)=>s+totals.get(n.id),0)>0))fail('Treemap needs a positive leaf total.');
    return {totals,children};
  }
  function normalize(raw,spec){
    spec={...spec,chartType:raw.chartType,unit:text(raw.unit||'',60),xLabel:text(raw.xLabel||'',60)};
    const type=spec.chartType;
    if(type==='gantt'){
      spec.tasks=list(raw.tasks,40).map(t=>{if(!t||typeof t!=='object')fail('Gantt tasks need label, start and end.');const a=time(t.start),b=time(t.end);if(a===null||b===null||typeof t.start!==typeof t.end||typeof t.start==='number'&&(!number(t.start)||!number(t.end))||b<a)fail('Gantt start/end must be ordered numbers or valid YYYY-MM-DD dates.');const item={label:text(t.label),start:t.start,end:t.end};if(t.progress!==undefined){if(!number(t.progress)||t.progress<0||t.progress>100)fail('Gantt progress must be 0–100 percent.');item.progress=t.progress;}return item;});
      if(spec.tasks.some(t=>typeof t.start!==typeof spec.tasks[0].start))fail('Use one date or numeric scale throughout a Gantt chart.');
    }else if(type==='histogram'){
      spec.samples=numbers(raw.samples,2000);
      spec.bins=raw.bins===undefined?Math.min(30,Math.max(1,Math.ceil(Math.sqrt(spec.samples.length)))):raw.bins;
      if(!Number.isInteger(spec.bins)||spec.bins<1||spec.bins>40)fail('Histogram bins must be an integer from 1 to 40.');
    }else if(type==='heatmap'){
      spec.labels=list(raw.labels,30).map(v=>text(v));spec.rowLabels=list(raw.rowLabels,30).map(v=>text(v));
      if(!Array.isArray(raw.values)||raw.values.length!==spec.rowLabels.length)fail('Heatmap values need one row per row label.');
      spec.values=list(raw.values,30).map(row=>{list(row,30);if(row.length!==spec.labels.length||row.some(v=>v!==null&&!number(v)))fail('Heatmap cells must be numbers or null, matching column labels.');return row.slice();});
      if(!spec.values.some(row=>row.some(v=>v!==null)))fail('Heatmap needs at least one numeric cell.');
    }else if(type==='bubble'){
      spec.x=numbers(raw.x,200);
      spec.series=list(raw.series,5).map(s=>{const values=numbers(s.values,200),sizes=numbers(s.sizes,200);if(values.length!==spec.x.length||sizes.length!==spec.x.length||sizes.some(v=>v<0)||!sizes.some(v=>v>0))fail('Bubble Y values and nonnegative sizes must match X, with at least one positive size per series.');return {name:text(s.name||'Values'),values,sizes};});
    }else if(type==='treemap'){
      const ids=new Set();spec.nodes=list(raw.nodes,80).map(n=>{if(!n||typeof n!=='object')fail('Treemap needs nodes with id, label, parent and leaf value.');const id=text(n.id,60);if(!id||ids.has(id))fail('Treemap IDs must be unique and nonempty.');ids.add(id);const item={id,label:text(n.label||id),parent:text(n.parent||'',60)};if(n.value!==undefined){if(!number(n.value)||n.value<0)fail('Treemap values must be nonnegative numbers.');item.value=n.value;}return item;});
      const parents=new Set(spec.nodes.map(n=>n.parent));if(spec.nodes.some(n=>!parents.has(n.id)&&n.value===undefined))fail('Treemap leaves need explicit values.');treeTotals(spec.nodes);
    }else if(categorical.includes(type)){
      spec.labels=list(raw.labels,type==='radar'?12:40).map(v=>text(v));
      spec.series=list(raw.series,5).map(s=>{const values=numbers(s.values,40);if(values.length!==spec.labels.length)fail('Supply one numeric chart value per label.');return {name:text(s.name||'Values'),values};});
      if(['funnel','waterfall'].includes(type)&&spec.series.length!==1)fail('Funnel and waterfall charts use exactly one series.');
      if(['percent-bar','stacked-area','radar','funnel'].includes(type)&&spec.series.some(s=>s.values.some(v=>v<0)))fail(type+' needs nonnegative values.');
      if(type==='radar'&&spec.labels.length<3)fail('Radar charts need 3–12 axes on a comparable scale.');
      if(type==='funnel'&&(!spec.series[0].values.some(v=>v>0)||spec.series[0].values.some((v,i)=>i&&v>spec.series[0].values[i-1])))fail('Funnel stages must decrease or stay equal, with a positive first stage.');
      if(type==='waterfall'){
        spec.totals=raw.totals===undefined?[]:raw.totals;
        if(!Array.isArray(spec.totals)||spec.totals.length>40||new Set(spec.totals).size!==spec.totals.length||spec.totals.some(i=>!Number.isInteger(i)||i<0||i>=spec.labels.length))fail('Waterfall totals must be unique valid label indexes.');
        spec.totals=spec.totals.slice();
        // Total bars show the running sum; never silently reset it to unrelated data.
        let sum=0;spec.series[0].values.forEach((v,i)=>{if(spec.totals.includes(i)){if(!sameTotal(v,sum))fail('Waterfall total values must equal the running sum.');}else sum+=v;});
      }
    }else fail('Unsupported extended chart type.');
    return spec;
  }
  function histogram(spec){
    const low=Math.min(...spec.samples),high=Math.max(...spec.samples);
    // A constant sample occupies a single bin, rather than fabricated variation.
    if(low===high)return [{start:low,end:high,count:spec.samples.length}];
    const span=high-low;let bins=spec.bins;
    // At floating-point limits, reduce the bin count until every interval has
    // distinct boundaries. Never show a populated zero-width interval.
    while(bins>1&&Array.from({length:bins},(_,i)=>low+span*((i+1)/bins)<=low+span*(i/bins)).some(Boolean))bins--;
    const boundaries=Array.from({length:bins+1},(_,i)=>i===bins?high:low+span*(i/bins)),counts=Array(bins).fill(0);
    // Assign against the very same boundaries shown in the table/SVG. Ratio
    // rounding can put an exact boundary observation into its preceding bin.
    for(const value of spec.samples){let lo=0,hi=bins;while(lo<hi){const mid=Math.floor((lo+hi)/2);if(value>=boundaries[mid+1])lo=mid+1;else hi=mid;}counts[Math.min(bins-1,lo)]++;}
    return counts.map((count,i)=>({start:boundaries[i],end:boundaries[i+1],count}));
  }
  function data(spec){
    if(spec.chartType==='gantt')return {headers:['Task','Start','End','Progress (%)'],rows:spec.tasks.map(t=>[t.label,t.start,t.end,t.progress??'Not supplied'])};
    if(spec.chartType==='histogram')return {headers:['Bin start','Bin end','Count'],rows:histogram(spec).map(b=>[b.start,b.end,b.count])};
    if(spec.chartType==='heatmap')return {headers:['Row',...spec.labels],rows:spec.values.map((r,i)=>[spec.rowLabels[i],...r.map(v=>v===null?'Missing':v)])};
    if(spec.chartType==='treemap'){const {totals}=treeTotals(spec.nodes);return {headers:['Label','ID','Parent','Value'],rows:spec.nodes.map(n=>[n.label,n.id,n.parent,totals.get(n.id)])};}
    if(spec.chartType==='bubble')return {headers:['X',...spec.series.flatMap(s=>[s.name+' (Y)',s.name+' (size)'])],rows:spec.x.map((x,i)=>[x,...spec.series.flatMap(s=>[s.values[i],s.sizes[i]])])};
    return {headers:[spec.xLabel||'Label',...spec.series.map(s=>s.name)],rows:spec.labels.map((l,i)=>[l,...spec.series.map(s=>s.values[i])])};
  }
  // Keep axis labels within their margins. Exact values remain in tables and
  // tooltips; long decimal expansions otherwise clip in chat and exports.
  const fmt=v=>v!==0&&(Math.abs(v)>=1e6||Math.abs(v)<1e-3)?Number(v.toPrecision(3)).toExponential():Number(v.toPrecision(4)).toString();
  function svg(spec){
    let out='';const type=spec.chartType;
    const label=(x,y,value,anchor='middle',size=13,fill='')=>`<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}"${fill?` data-chart-fill="${fill}" fill="${fill==='dark'?'#172334':'#ffffff'}"`:''}>${esc(value)}</text>`;
    const rect=(x,y,w,h,color,title,extra='')=>`<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" fill="${color}" ${extra}><title>${esc(title)}</title></rect>`;
    const line=(x,y,x2,y2,color='#dce1ea')=>`<path d="M ${x} ${y} L ${x2} ${y2}" fill="none" stroke="${color}"/>`;
    const legend=()=>{spec.series.forEach((s,i)=>{const x=70+i*720/spec.series.length;out+=rect(x,422,10,10,colors[i],s.name)+label(x+16,432,s.name.slice(0,Math.floor(95/spec.series.length)),'start');});};
    function axes(low,high){const span=high-low||1;const y=v=>362-(v-low)/span*265;for(let i=0;i<=4;i++){const v=low+span*i/4;out+=line(76,y(v),762,y(v))+label(68,y(v)+4,fmt(v),'end');}return y;}
    function categoryLabels(px){spec.labels.forEach((v,i)=>{if(i%Math.max(1,Math.ceil(spec.labels.length/8))===0)out+=label(px(i),385,v.slice(0,12));});if(spec.xLabel)out+=label(419,406,spec.xLabel);}
    if(type==='gantt'){
      const starts=spec.tasks.map(t=>time(t.start)),ends=spec.tasks.map(t=>time(t.end)),lo=Math.min(...starts),hi=Math.max(...ends),span=hi-lo||1,x=v=>200+(v-lo)/span*550;
      const step=265/spec.tasks.length;
      const dates=typeof spec.tasks[0].start==='string',days=(hi-lo)/86400000,ticks=dates?Math.min(4,days):hi===lo?0:4;
      for(let i=0;i<=ticks;i++){const v=ticks?(dates?lo+Math.round(days*i/ticks)*86400000:lo+(hi-lo)*i/ticks):lo;out+=line(x(v),97,x(v),362)+label(x(v),385,dates?new Date(v).toISOString().slice(0,10):fmt(v));}
      spec.tasks.forEach((t,i)=>{const yy=97+(i+.5)*step,h=Math.min(22,step*.65),a=x(starts[i]),b=x(ends[i]),title=`${t.label}: ${t.start} to ${t.end}${t.progress===undefined?'':', '+t.progress+'% complete'}`;
        out+=label(190,yy+4,t.label.slice(0,24),'end',Math.min(13,step*.8));
        if(a===b)out+=`<path d="M ${a} ${yy-5} l 5 5 -5 5 -5 -5 Z" fill="${colors[i%5]}"><title>${esc(title)}</title></path>`;
        else {out+=rect(a,yy-h/2,b-a,h,colors[i%5],title,'fill-opacity=".3" rx="3"');out+=rect(a,yy-h/2,(b-a)*(t.progress===undefined?1:t.progress/100),h,colors[i%5],title,'rx="3"');}
      });out+=label(470,410,spec.xLabel||'Schedule');
    }else if(type==='heatmap'){
      const a=spec.values.flat().filter(v=>v!==null),lo=Math.min(...a),hi=Math.max(...a),w=620/spec.labels.length,h=265/spec.rowLabels.length;
      const color=v=>{if(v===null)return '#e5e7eb';const t=hi===lo?.5:(v-lo)/(hi-lo),from=lo<0&&hi>0&&v<0?[217,82,105]:[55,108,206],k=lo<0&&hi>0?Math.abs(v)/(v<0?-lo:hi):t;return `rgb(${from.map(c=>Math.round(245+(c-245)*k)).join(',')})`;};
      spec.values.forEach((row,i)=>{out+=label(128,97+(i+.5)*h+4,spec.rowLabels[i].slice(0,17),'end',Math.min(13,h*.75));row.forEach((v,j)=>{const shade=color(v),rgb=shade.match(/\d+/g)?.map(Number),dark=rgb?(rgb[0]*299+rgb[1]*587+rgb[2]*114)/1000<150:false;out+=rect(140+j*w,97+i*h,w,h,shade,`${spec.rowLabels[i]} / ${spec.labels[j]}: ${v===null?'Missing':v}`,'stroke="white" stroke-width="1"');if(w>=40&&h>=20)out+=label(140+(j+.5)*w,97+(i+.5)*h+4,v===null?'—':fmt(v),'middle',13,dark?'light':'dark');});});
      spec.labels.forEach((v,i)=>{if(i%Math.max(1,Math.ceil(spec.labels.length/8))===0)out+=label(140+(i+.5)*w,385,v.slice(0,12));});
      for(let i=0;i<100;i++)out+=rect(270+i*2.5,412,2.6,10,color(lo+(hi-lo)*i/99),'Color scale');out+=label(260,422,fmt(lo),'end')+label(530,422,fmt(hi),'start');
    }else if(type==='treemap'){
      const {totals,children}=treeTotals(spec.nodes);
      // Recursive balanced partition: leaf area remains proportional to value.
      function tile(nodes,x,y,w,h,depth){nodes=nodes.filter(n=>totals.get(n.id)>0);if(!nodes.length)return;const sum=nodes.reduce((s,n)=>s+totals.get(n.id),0);
        if(nodes.length>1){let split=1,left=totals.get(nodes[0].id);while(split<nodes.length-1&&Math.abs(left+totals.get(nodes[split].id)-sum/2)<Math.abs(left-sum/2))left+=totals.get(nodes[split++].id);const f=left/sum;if(w>=h){tile(nodes.slice(0,split),x,y,w*f,h,depth);tile(nodes.slice(split),x+w*f,y,w*(1-f),h,depth);}else{tile(nodes.slice(0,split),x,y,w,h*f,depth);tile(nodes.slice(split),x,y+h*f,w,h*(1-f),depth);}return;}
        const n=nodes[0],kids=children.get(n.id)||[],color=colors[spec.nodes.indexOf(n)%5];out+=rect(x,y,w,h,color,`${n.label}: ${totals.get(n.id)}`,'stroke="white" stroke-width="2" fill-opacity=".25"');
        if(w>45&&h>18)out+=label(x+6,y+16,n.label.slice(0,Math.max(1,Math.floor((w-12)/7))),'start',12);
        // Keep child areas exact within their available rectangle; headings are
        // omitted when a branch is too small rather than hiding its data.
        if(kids.length)tile(kids,x+2,y+Math.min(22,h*.15),Math.max(0,w-4),h-Math.min(22,h*.15)-2,depth+1);
        else if(w>60&&h>40)out+=label(x+6,y+34,fmt(totals.get(n.id)),'start',12);
      }tile(children.get('')||[],36,95,728,310,0);
    }else if(type==='radar'){
      const max=Math.max(...spec.series.flatMap(s=>s.values))||1,n=spec.labels.length,cx=400,cy=240,r=135,p=(i,f)=>[cx+Math.sin(i*2*Math.PI/n)*r*f,cy-Math.cos(i*2*Math.PI/n)*r*f];
      for(let k=1;k<=4;k++){out+=`<polygon points="${spec.labels.map((_,i)=>p(i,k/4).join(',')).join(' ')}" fill="none" stroke="#dce1ea"/>`+label(cx+6,cy-r*k/4,fmt(max*k/4),'start',11);}
      spec.labels.forEach((v,i)=>{const a=p(i,1),b=p(i,1.15);out+=line(cx,cy,...a)+label(b[0],b[1]+4,v.slice(0,20));});
      spec.series.forEach((s,si)=>{out+=`<polygon points="${s.values.map((v,i)=>p(i,v/max).join(',')).join(' ')}" fill="${colors[si]}" fill-opacity=".15" stroke="${colors[si]}" stroke-width="2"/>`;s.values.forEach((v,i)=>{const a=p(i,v/max);out+=`<circle cx="${a[0]}" cy="${a[1]}" r="3" fill="${colors[si]}"><title>${esc(spec.labels[i]+' / '+s.name+': '+v)}</title></circle>`;});});legend();
    }else if(type==='funnel'){
      const values=spec.series[0].values,step=265/values.length,max=values[0];values.forEach((v,i)=>{const width=v/max*430,yy=97+i*step;out+=rect(430-width/2,yy,width,step*.85,colors[i%5],`${spec.labels[i]}: ${v} (${fmt(v/max*100)}% of first stage)`)+label(176,yy+step*.5,spec.labels[i].slice(0,22),'end',Math.min(13,step*.65))+label(758,yy+step*.5,`${fmt(v)} · ${fmt(v/max*100)}%`,'end',Math.min(13,step*.65));});
    }else if(type==='horizontal-bar'){
      const all=spec.series.flatMap(s=>s.values),lo=Math.min(0,...all),hi=Math.max(0,...all),span=hi-lo||1,x=v=>180+(v-lo)/span*560,step=265/spec.labels.length;
      for(let i=0;i<=4;i++){const v=lo+span*i/4;out+=line(x(v),97,x(v),362)+label(x(v),385,fmt(v));}
      spec.labels.forEach((l,i)=>{out+=label(170,97+(i+.5)*step+4,l.slice(0,22),'end',Math.min(13,step*.8));spec.series.forEach((s,j)=>{const hh=step*.8/spec.series.length,v=s.values[i];out+=rect(Math.min(x(0),x(v)),97+i*step+step*.1+j*hh,Math.abs(x(v)-x(0)),hh*.9,colors[j],`${l} / ${s.name}: ${v}`);});});legend();
    }else if(type==='bubble'){
      const values=spec.series.flatMap(s=>s.values),lo=Math.min(...values),hi=Math.max(...values),y=axes(lo,hi),xmin=Math.min(...spec.x),xmax=Math.max(...spec.x),x=v=>100+(v-xmin)/(xmax-xmin||1)*635,maxSize=Math.max(...spec.series.flatMap(s=>s.sizes));
      spec.series.forEach((s,j)=>s.values.forEach((v,i)=>{if(s.sizes[i]>0)out+=`<circle cx="${x(spec.x[i])}" cy="${y(v)}" r="${Math.sqrt(s.sizes[i]/maxSize)*24}" fill="${colors[j]}" fill-opacity=".45" stroke="${colors[j]}"><title>${esc(s.name)}: X ${spec.x[i]}, Y ${v}, size ${s.sizes[i]}</title></circle>`;}));
      const ticks=xmin===xmax?0:4;for(let i=0;i<=ticks;i++){const v=ticks?xmin+(xmax-xmin)*i/ticks:xmin;out+=label(x(v),393,fmt(v));}out+=label(419,410,spec.xLabel||'X');legend();
    }else if(type==='histogram'){
      const bins=histogram(spec),y=axes(0,Math.max(...bins.map(b=>b.count))),step=686/bins.length;
      bins.forEach((b,i)=>{out+=rect(76+i*step, y(b.count),step,362-y(b.count),colors[0],`${b.start} ≤ value ${i===bins.length-1?'≤':'<'} ${b.end}: ${b.count}`,'stroke="white" stroke-width="1"');if(i%Math.max(1,Math.ceil(bins.length/6))===0)out+=label(76+i*step,385,fmt(b.start));});out+=label(762,385,fmt(bins.at(-1).end))+label(419,410,spec.xLabel||'Sample value (bin boundaries)');
    }else{
      const n=spec.labels.length,step=686/n,px=i=>76+step*(i+.5),all=spec.series.flatMap(s=>s.values);
      const stacked=['stacked-bar','percent-bar','stacked-area'].includes(type),percent=type==='percent-bar';
      let low=Math.min(0,...all),high=Math.max(0,...all),rows=[],sum=0;
      if(type==='waterfall'){rows=spec.series[0].values.map((v,i)=>{const a=spec.totals.includes(i)?0:sum;if(!spec.totals.includes(i))sum+=v;return [a,sum];});low=Math.min(0,...rows.flat());high=Math.max(0,...rows.flat());}
      if(stacked){low=Math.min(0,...spec.labels.map((_,i)=>spec.series.reduce((s,a)=>s+Math.min(0,a.values[i]),0)));high=Math.max(0,...spec.labels.map((_,i)=>spec.series.reduce((s,a)=>s+Math.max(0,a.values[i]),0)));if(percent){low=0;high=100;}}
      const y=axes(low,high),pos=Array(n).fill(0),neg=Array(n).fill(0);
      if(type==='waterfall'){rows.forEach(([a,b],i)=>{const color=spec.totals.includes(i)?colors[0]:b>=a?colors[1]:'#d95269';out+=rect(px(i)-step*.35,Math.min(y(a),y(b)),step*.7,Math.max(1,Math.abs(y(b)-y(a))),color,`${spec.labels[i]}: ${spec.series[0].values[i]}, running total ${b}`);if(i<n-1)out+=line(px(i)+step*.35,y(b),px(i+1)-step*.35,y(b),'#8792a2');});}
      else spec.series.forEach((s,j)=>{
        if(type==='step'){let path=`M ${px(0)} ${y(s.values[0])}`;s.values.slice(1).forEach((v,i)=>{path+=` H ${px(i+1)} V ${y(v)}`;});out+=`<path d="${path}" fill="none" stroke="${colors[j]}" stroke-width="3"/>`;s.values.forEach((v,i)=>out+=`<circle cx="${px(i)}" cy="${y(v)}" r="3" fill="${colors[j]}"><title>${esc(spec.labels[i]+' / '+s.name)}: ${v}</title></circle>`);return;}
        const lower=[],upper=[];s.values.forEach((v,i)=>{const total=spec.series.reduce((s,a)=>s+a.values[i],0),scaled=percent?(total?v/total*100:0):v,base=v<0?neg:pos,a=base[i],b=a+scaled;base[i]=b;lower.push(a);upper.push(b);if(type!=='stacked-area')out+=rect(px(i)-step*.35,Math.min(y(a),y(b)),step*.7,Math.abs(y(b)-y(a)),colors[j],`${spec.labels[i]} / ${s.name}: ${v}${percent?' ('+fmt(scaled)+'%)':''}`);});
        if(type==='stacked-area'){const points=[...upper.map((v,i)=>[px(i),y(v)]),...lower.map((v,i)=>[px(i),y(v)]).reverse()];if(n===1)out+=rect(px(0)-12,y(upper[0]),24,y(lower[0])-y(upper[0]),colors[j],s.name+': '+s.values[0]);else out+=`<polygon points="${points.map(p=>p.join(',')).join(' ')}" fill="${colors[j]}" fill-opacity=".65"><title>${esc(s.name)}</title></polygon>`;}
      });categoryLabels(px);if(type!=='waterfall')legend();
    }
    const table=data(spec),desc=table.rows.map(r=>r.join(': ')).join('; ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 480" width="800" height="480" role="img" aria-label="${esc(spec.title)}"><title>${esc(spec.title)}</title><desc>${esc(desc)}</desc><rect width="800" height="480" rx="16" fill="#fff"/><g font-family="Arial, sans-serif" font-size="13" fill="#283243"><text x="36" y="40" font-size="22" font-weight="bold">${esc(spec.title.slice(0,58))}</text><text x="36" y="65" fill="#697386">${esc(spec.unit)}</text>${out}</g></svg>`;
  }
  function variants(spec){return categorical.includes(spec.chartType)&&spec.chartType!=='waterfall'?['bar','horizontal-bar','stacked-bar','percent-bar','line','step','area','stacked-area','pie','doughnut','radar','funnel']:[spec.chartType];}
  root.OrbitCharts={types,normalize,svg,data,variants,histogram};
  if(typeof module!=='undefined')module.exports=root.OrbitCharts;
})(typeof window==='undefined'?globalThis:window);
