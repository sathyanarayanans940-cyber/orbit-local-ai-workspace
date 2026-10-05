(async()=>{
 while(typeof renderMessages!=='function')await new Promise(resolve=>setTimeout(resolve,50));
 // Synthetic state on a separate origin; no provider or private chats.
 persistCurrentChat=()=>{};persistChats=()=>{};
 setTheme('dark');followLatest=false;
 state.currentChat='step-layout';state.currentTitle='Centered mathematical working';state.models=[];
 const stats=String.raw`# Centered statistical working

## Standard error

The symbol and first formula stay together. Each subsequent equality is centered independently.

\[
SE = \sqrt{\frac{p_0(1-p_0)}{n}} = \sqrt{\frac{0.05\times0.95}{400}} = \sqrt{0.00011875} = 0.0108972
\]

## p-value

\[
\begin{aligned}
\text{p-value}\\
&= P(Z > 2.2942)\\
&= 0.01089
\end{aligned}
\]
`;
 const integral=String.raw`# Centered integral working

## Integration by parts

The longer and shorter steps share a center, with no indentation to line up their equals signs.

\[
\begin{aligned}
I &= -\frac{x^2}{3}\cos(3x)-\int\left(-\frac13\cos(3x)\right)(2x)\,dx\\
&= -\frac{x^2}{3}\cos(3x)+\frac23\int x\cos(3x)\,dx
\end{aligned}
\]

Independent givens stay inline: \(p_0=0.05,\ n=400\).

## Code remains literal
`+'\n\n```python\nx = a = b\n```';
 const zscore=String.raw`# Centered Z-score working

\[
\begin{aligned}
z\\
&= \frac{\hat p-p_0}{SE}\\
&= \frac{0.075-0.05}{0.0108972}\\
&= \frac{0.025}{0.0108972}\\
&= 2.2942
\end{aligned}
\]
`;
 const adjacent=String.raw`# Adjacent formula rendering

Means: \(\bar{x} = 162/9 = 18\), \(\bar{y} = 719/9 = 79.8889\)

Corrected (centred) sums:

\[
S_{xx} = \sum x^2 - n\bar{x}^2 = 3156 - 9(18)^2 = 3156 - 2916 = 240
\]

## Emphasized formulas stay separate

**\(\bar{x} = 18\), \(\bar{y} = 79.8889\)**

\(x=1\), \(y=2\)

Values: \(a=1\), \(b=2\) ⇒ \(a+b=3\)

## Arrows inside one formula

\[a=1 \Rightarrow b=2\]
`;
 let current=stats,prompt='Show full working';
 function show(){state.messages=[{role:'user',text:prompt},{role:'assistant',text:current}];state.savedChats={'step-layout':{title:state.currentTitle,messages:state.messages}};renderConversationTitle();renderSavedHistory();renderMessages(false);$('#messages-wrap').scrollTop=0;}
 show();
 const controls=document.createElement('div');controls.style.cssText='position:fixed;left:20px;bottom:22px;z-index:10000;display:grid;gap:8px;width:170px';
 const summary=document.createElement('span');summary.id='step-layout-result';summary.style.cssText='font-size:12px;line-height:1.4;color:var(--text);padding:8px';
 for(const [label,text,request] of [['Statistics examples',stats,'Show full working'],['Integral example',integral,'Show full working'],['Z-score example',zscore,'Show full working'],['Adjacent formulas',adjacent,'Show full working'],['Compact reply requested',stats,'bro dont make the message too long']]){
  const button=document.createElement('button');button.className='preferences-button';button.textContent=label;
  button.onclick=()=>{current=text;prompt=request;show();verify(label);};controls.append(button);
 }
 controls.append(summary);document.body.append(controls);
 function verify(label){
  const errors=document.querySelectorAll('.katex-error,.math-display-fallback,.math-inline-fallback').length;
  const annotations=[...document.querySelectorAll('.message.assistant annotation')].map(node=>node.textContent);
  summary.textContent=`${label}: ${errors} formula errors; ${annotations.filter(text=>text.includes('begin{gathered}')).length} independently centered derivations.`;
 }
 verify('Statistics examples');
})();
