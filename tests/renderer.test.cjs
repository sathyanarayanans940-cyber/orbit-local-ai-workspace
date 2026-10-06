const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const katex = require('../vendor/katex/katex.min.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const renderer = vm.createContext({ window: { katex }, icons: { copy: '' }, state: { currentChat: 'test' } });
vm.runInContext(source.slice(source.indexOf('function escapeHtml('), source.indexOf('function latestUserMessageIndex(')), renderer);
require('./interaction-harness.cjs')(renderer);
const render = (text) => renderer.renderRichText(text, 0);
test('plain BANANA fences survive widget extraction and saved/streaming message rendering',()=>{
 const {suffixes,tree}=require('./fixtures/plain-fences.json');
 const text='Suffixes:\n```\n'+suffixes+'\n```\n\nThe tree:\n```\n'+tree+'\n```';
 for(const generating of [false,true]){
  const message={role:'assistant',text,generating};
  const before=JSON.stringify(message),html=renderer.messageContentMarkup(message,0);
  assert.equal((html.match(/class="code-content"/g)||[]).length,2);
  assert.doesNotMatch(html,/```|class="katex/);
  assert.match(html.replace(/<[^>]*>/g,''),/\|   \|/);
  assert.equal(JSON.stringify(message),before);
 }
});
test('saved repaired PDF displays its download card without the old malformed draft',()=>{
 const fixture=require('./fixtures/pdf-draft-leak.json'),message=JSON.parse(JSON.stringify(fixture));
 const before=JSON.stringify(message),html=renderer.messageContentMarkup(message,0);
 assert.doesNotMatch(html,/&quot;kind&quot;|"kind"|&quot;blocks&quot;|"blocks"/);
 assert.match(html,/data-widget-download/);assert.match(html,/Done — your file is ready/);
 assert.ok(html.indexOf('data-widget-download')<html.indexOf('Done —'));
 assert.equal(JSON.stringify(message),before);
});
const expressions = (html) => [...html.matchAll(/<annotation encoding="application\/x-tex">(.*?)<\/annotation>/gs)].map(match => match[1]);

test('worked display chains keep the first equality whole and center each step independently',()=>{
 const input=String.raw`r = \frac{0.75-0.30}{\sqrt{0.64\times0.75}} = \frac{0.45}{\sqrt{0.48}} = 0.6495`;
 const expected=String.raw`\begin{gathered}r = \frac{0.75-0.30}{\sqrt{0.64\times0.75}} \\ = \frac{0.45}{\sqrt{0.48}} \\ = 0.6495\end{gathered}`;
 assert.equal(renderer.workedEquationLayout(input),expected);
 assert.equal(renderer.workedEquationLayout(expected),expected);
 for(const text of [`\\[${input}\\]`,`$$${input}$$`,`$${input}$`]){
  const html=render(text);assert.equal(expressions(html)[0],expected.replaceAll('&','&amp;'));
  assert.doesNotMatch(html,/katex-error|math-display-fallback/);
 }
 assert.match(expressions(render('x = 2 + 3 = 5'))[0],/begin\{gathered\}/);
});
test('existing aligned derivations become centered rows while preserving every expression',()=>{
 const input=String.raw`\begin{aligned}r &= a = b\\ &= c = d\\ \text{Given }x &= 1\end{aligned}`;
 const expected=String.raw`\begin{gathered}r = a \\ = b \\ = c \\ = d \\ \text{Given }x = 1\end{gathered}`;
 assert.equal(renderer.workedEquationLayout(input),expected);
 assert.doesNotMatch(render('$$'+input+'$$'),/katex-error|math-display-fallback/);
 for(const expression of [String.raw`\begin{aligned}a&=b&=c\end{aligned}`,String.raw`\begin{aligned}a=b=c\\[1em]d=e\end{aligned}`,String.raw`a=b=c\tag{1}`])assert.equal(renderer.workedEquationLayout(expression),expression);
});
test('SE, z and p-value saved layouts join orphan symbols to their first formulas',()=>{
 const examples=[
  [String.raw`\begin{aligned}SE\\ &= \sqrt{\frac{p_0(1-p_0)}{n}}\\ &= \sqrt{\frac{0.05\times0.95}{400}}\\ &= \sqrt{0.00011875}\\ &= 0.0108972\end{aligned}`,String.raw`SE = \sqrt{\frac{p_0(1-p_0)}{n}}`],
  [String.raw`\begin{aligned}z\\ &= \frac{\hat p-p_0}{SE}\\ &= \frac{0.075-0.05}{0.0108972}\\ &= 2.2942\end{aligned}`,String.raw`z = \frac{\hat p-p_0}{SE}`],
  [String.raw`\begin{aligned}\text{p-value}\\ &= P(Z > 2.2942)\\ &= 0.01089\end{aligned}`,String.raw`\text{p-value} = P(Z > 2.2942)`],
 ];
 for(const [input,first] of examples){
  const formatted=renderer.workedEquationLayout(input),rows=formatted.replace(/^\\begin\{gathered\}|\\end\{gathered\}$/g,'').split(String.raw` \\ `);
  assert.equal(rows[0],first);assert.ok(rows.slice(1).every(row=>row.startsWith('= ')));assert.doesNotMatch(formatted,/&|begin\{aligned\}/);
  assert.equal(renderer.workedEquationLayout(formatted),formatted);
  assert.doesNotMatch(render('$$'+input+'$$'),/katex-error|math-display-fallback/);
 }
});
test('already separated equalities and integral derivations use independent centered rows',()=>{
 const input=String.raw`\begin{aligned}I &= -\frac{x^2}{3}\cos(3x)-\int\left(-\frac13\cos(3x)\right)(2x)\,dx\\ &= -\frac{x^2}{3}\cos(3x)+\frac23\int x\cos(3x)\,dx\end{aligned}`;
 const expected=String.raw`\begin{gathered}I = -\frac{x^2}{3}\cos(3x)-\int\left(-\frac13\cos(3x)\right)(2x)\,dx \\ = -\frac{x^2}{3}\cos(3x)+\frac23\int x\cos(3x)\,dx\end{gathered}`;
 assert.equal(renderer.workedEquationLayout(input),expected);assert.doesNotMatch(render('$$'+input+'$$'),/katex-error|math-display-fallback/);
 assert.equal(renderer.workedEquationLayout(String.raw`\begin{aligned}a &= b\\ &= c\\ &= d\end{aligned}`),String.raw`\begin{gathered}a = b \\ = c \\ = d\end{gathered}`);
 assert.equal(renderer.workedEquationLayout(String.raw`\begin{gathered}= a = b\\ = c\end{gathered}`),String.raw`\begin{gathered}= a \\ = b \\ = c\end{gathered}`);
 assert.equal(renderer.workedEquationLayout(String.raw`\begin{aligned}x&=1\\y&=2\end{aligned}`),String.raw`\begin{aligned}x&=1\\y&=2\end{aligned}`);
});
test('ambiguous math, independent givens, matrices and code retain their original layouts',()=>{
 const untouched=[String.raw`x=1, y=2`,String.raw`x=a=b\approx c`,String.raw`x = a = b \qquad y = c`,String.raw`x=1;y=2`,String.raw`\begin{cases}x=1\\y=2\end{cases}`,String.raw`\begin{pmatrix}x=1&y=2\end{pmatrix}`,String.raw`S=\{x=1,y=2\}`,String.raw`f(x=a)=b`,String.raw`x=\frac{a=b}{c=d}`,String.raw`a==b==c`,String.raw`x = (a = b = c`,String.raw`x = a =`,String.raw`|X| = a = b`];
 for(const text of untouched)assert.equal(renderer.workedEquationLayout(text),text,text);
 const inline=String.raw`Given $x=1=y$ and BT$$z=a=b$$BT.`.replaceAll('BT','`');
 assert.equal(renderer.formatWorkedDisplayMath(inline),inline);
 const code='```python\nx = a = b\n```';assert.deepEqual(expressions(render(code)),[]);
 const partial=String.raw`\[x = a =`;assert.equal(renderer.formatWorkedDisplayMath(partial),partial);
});
test('compact working follows the relevant user request, leaves raw messages intact and resets next turn',()=>{
 const text='$$x = 2 + 3 = 5$$',message={role:'assistant',text};
 for(const prompt of ['bro dont make the message too long','keep it concise','short please','compact equations']){
  assert.equal(renderer.prefersCompactWorking(prompt),true);
  renderer.state.messages=[{role:'user',text:prompt},message];
  assert.deepEqual(expressions(renderer.messageContentMarkup(message,1)),['x = 2 + 3 = 5']);
 }
 for(const prompt of ['show full working','do not keep it short','not compact please','implement short circuit evaluation'])assert.equal(renderer.prefersCompactWorking(prompt),false,prompt);
 renderer.state.messages=[{role:'user',text:'keep it short'},message,{role:'user',text:'show full working'},message];
 assert.match(expressions(renderer.messageContentMarkup(message,3))[0],/begin\{gathered\}/);
 assert.deepEqual(expressions(renderer.messageContentMarkup({role:'user',text},2)),['x = 2 + 3 = 5']);
 assert.equal(message.text,text);renderer.state.messages=[];
});
test('compact replies still center existing rows and keep the first formula with its symbol',()=>{
 const input=String.raw`\begin{aligned}z\\ &= a = b\\ &= c = d\end{aligned}`;
 const expected=String.raw`\begin{gathered}z = a = b \\ = c = d\end{gathered}`;
 assert.equal(renderer.workedEquationLayout(input,{compact:true}),expected);
 assert.equal(renderer.workedEquationLayout(expected,{compact:true}),expected);
 const html=renderer.renderRichText('$$'+input+'$$',0,{compactMath:true});
 assert.deepEqual(expressions(html),[expected]);assert.doesNotMatch(html,/katex-error|math-display-fallback/);
 assert.equal(renderer.workedEquationLayout('x = 2 + 3 = 5',{compact:true}),'x = 2 + 3 = 5');
});

test('adjacent multiline display formulas retain their delimiters and surrounding prose', () => {
  const html = render(String.raw`Before:
\[
\mu_D = -7
\]
\[
\sigma_D = 2.5
\] So this is the distribution.`);
  assert.deepEqual(expressions(html), [String.raw`\mu_D = -7`, String.raw`\sigma_D = 2.5`]);
  assert.match(html, /Before:/); assert.match(html, /So this is the distribution/);
  assert.doesNotMatch(html, /\\\[|\\\]|katex-error|math-display-fallback/);
  assert.deepEqual(expressions(render('$$\nx = 1\n$$\n$$\ny = 2\n$$')), ['x = 1', 'y = 2']);
});

test('table formulas keep absolute-value bars, escaped pipes and inline code inside their cells', () => {
  const html = render(String.raw`| Question | Answer |
| --- | --- |
| Q4 | \(P(\|X-Y\|\ge1)=0.9925\) |
| Nodes | $|V|$ |
| A\|B | BTa|bBT |`.replaceAll('BT', String.fromCharCode(96)));
  assert.deepEqual(expressions(html), [String.raw`P(\|X-Y\|\ge1)=0.9925`, '|V|']);
  assert.equal((html.match(/<td>/g) || []).length, 6);
  assert.match(html, /<td>A\|B<\/td>/); assert.match(html, /<code>a\|b<\/code>/);
  assert.doesNotMatch(html, /katex-error|math-inline-fallback/);
});

test('explicit display recovery leaves inline code, headings, lists and math chains intact', () => {
  const code = String.raw`BT\[x\]BT and BT$$y$$BT`.replaceAll('BT', String.fromCharCode(96));
  assert.deepEqual(expressions(render(code)), []);
  assert.deepEqual(expressions(render(String.raw`# Formula \[x = 1\]`)), ['x = 1']);
  assert.match(render(String.raw`1. Use \[x = 1\] here.`), /<ol>/);
  assert.deepEqual(expressions(render(String.raw`$$x=1$$ → $$y=2$$`)), ['x=1', 'y=2']);
  assert.match(render(String.raw`$$x_1=1$$ ⇒ $$y_1=2$$`), /math-equation-chain/);
});

test('labelled and emphasized adjacent formulas never merge their delimiter pairs', () => {
  const formulas = [String.raw`\bar{x} = 162/9 = 18`, String.raw`\bar{y} = 719/9 = 79.8889`];
  for (const [open, close] of [['\\(', '\\)'], ['\\[', '\\]'], ['$', '$'], ['$$', '$$']]) {
    const pair = formulas.map(expression => open + expression + close).join(', ');
    const expected = open === '\\[' || open === '$$' ? [
      String.raw`\begin{gathered}\bar{x} = 162/9 \\ = 18\end{gathered}`,
      String.raw`\begin{gathered}\bar{y} = 719/9 \\ = 79.8889\end{gathered}`,
    ] : formulas;
    for (const text of ['Means: ' + pair, '**' + pair + '**', '__' + pair + '__', 'Means:\n' + pair]) {
      const html = render(text);
      assert.deepEqual(expressions(html), expected);
      assert.doesNotMatch(html, /katex-error|math-(?:inline|display)-fallback/);
    }
    // A single labelled formula still receives its existing display layout.
    assert.match(render('Mean: ' + open + formulas[0] + close), /math-equation-chain/);
  }
  for (const text of [String.raw`Means: \(x = 1\), $y = 2$`, String.raw`**\(x = 1\), $y = 2$**`]) {
    assert.deepEqual(expressions(render(text)), ['x = 1', 'y = 2']);
  }
  for (const [open, close] of [['\\(', '\\)'], ['\\[', '\\]'], ['$', '$'], ['$$', '$$']]) {
    const text = open + 'x=1' + close + ', ' + open + 'y=2' + close;
    const html = render(text);
    assert.deepEqual(expressions(html), ['x=1', 'y=2']);
    assert.doesNotMatch(html, /katex-error|math-(?:inline|display)-fallback/);
  }
  const mixed = render(String.raw`x = \(2\) + \(3\)`);
  assert.deepEqual(expressions(mixed), ['2', '3']);
  assert.doesNotMatch(mixed, /katex-error|math-(?:inline|display)-fallback/);
});

test('adjacent formula streaming retains the first formula when the next one closes', () => {
  const text = String.raw`Means: \(\bar{x} = 162/9 = 18\), \(\bar{y} = 719/9 = 79.8889\)`;
  const first = text.indexOf('\\)') + 2;
  for (let length = first; length <= text.length; length++) {
    const partial = text.slice(0, length);
    const html = renderer.renderRichText(partial, 0, {streaming: true});
    assert.equal(expressions(html)[0], String.raw`\bar{x} = 162/9 = 18`);
    assert.doesNotMatch(html, /katex-error|math-(?:inline|display)-fallback/);
  }
  assert.equal(expressions(render(text)).length, 2);
});

test('arrows preserve complete formulas and never join adjacent independent spans', () => {
  const adjacent = render(String.raw`Values: \(a = 1\), \(b = 2\) ⇒ \(a+b=3\)`);
  assert.deepEqual(expressions(adjacent), ['a = 1', 'b = 2', 'a+b=3']);
  assert.doesNotMatch(adjacent, /katex-error|math-(?:inline|display)-fallback/);
  for (const arrow of ['⇒', String.raw`\Rightarrow`, String.raw`\Longrightarrow`]) {
    const formula = 'a=1 ' + arrow + ' b=2';
    assert.equal(renderer.workedEquationLayout(formula), formula);
    const html = render('\\[' + formula + '\\]');
    assert.equal(expressions(html).length, 1);
    assert.doesNotMatch(html, /katex-error|math-(?:inline|display)-fallback/);
  }
  const gathered = render(String.raw`\[\begin{gathered}a=1 \Rightarrow b=2\\ c=3\end{gathered}\]`);
  assert.equal(expressions(gathered).length, 1);
  assert.doesNotMatch(gathered, /katex-error|math-(?:inline|display)-fallback/);
});

test('formula delimiters in text, code, currency and tables stay independent', () => {
  const pair = String.raw`\(x = 1\), \(y = 2\)`;
  const html = render('Means: ' + pair + ' (verified).\n\n' + '`Means: ' + pair + '`' + '\n\n```latex\nMeans: ' + pair + '\n```\n\nCosts $25 and $50.\n\n| Item | Values |\n| --- | --- |\n| Means | ' + pair + ' |');
  assert.deepEqual(expressions(html), ['x = 1', 'y = 2', 'x = 1', 'y = 2']);
  assert.match(html, /\(verified\)/);
  assert.ok(html.includes('<code>Means: ' + pair + '</code>'));
  assert.match(html, /Costs \$25 and \$50/);
  assert.equal((html.match(/<td>/g) || []).length, 2);
  assert.doesNotMatch(html, /katex-error|math-(?:inline|display)-fallback/);
});

test('bold step labels keep their inline products separate from the following equation', () => {
  for (const product of ['ac', 'bd']) {
    const html = render(`- **Step 1 (Calculate $${product}$):** $12 \\times 6 = 72$`);
    assert.match(html, /<strong>Step 1 \(Calculate <span class="math-inline">/);
    assert.match(html, /<\/span>\):<\/strong> <span class="math-inline">/);
    assert.deepEqual(expressions(html), [product, '12 \\times 6 = 72']);
    assert.doesNotMatch(html, /\*\*|katex-error|math-inline-fallback/);
  }
});

test('parenthesized equations and binary table cells render with real KaTeX', () => {
  assert.deepEqual(expressions(render('$(a+b)(c+d) = 195$')), ['(a+b)(c+d) = 195']);
  assert.deepEqual(expressions(render('| A | Q |\n| --- | --- |\n| $110101$ | $001111$ |')), ['110101', '001111']);
});

test('Bellman-Ford list renders cardinalities, edges and indexed distances', () => {
  const html = render(String.raw`1. Repeat the relaxation process $|V| - 1$ times, where $|V|$ is the number of vertices.
2. In each pass, check every edge $(u, v)$ and if $dist[u] + weight < dist[v]$, update $dist[v]$.
3. Time complexity is $O(V \times E)$.`);
  assert.deepEqual(expressions(html), ['|V| - 1', '|V|', '(u, v)', 'dist[u] + weight &lt; dist[v]', 'dist[v]', String.raw`O(V \times E)`]);
  assert.doesNotMatch(html, /\$|math-inline-fallback|katex-error/);
  assert.equal((html.match(/<li>/g) || []).length, 3);
});

test('parenthesized math keeps shell commands, currency and literal LaTeX source intact', () => {
  assert.deepEqual(expressions(renderer.renderText('Use $(a+b)$, $(x)$, $(u, v)$ and $A[i,j]$.')), ['(a+b)', '(x)', '(u, v)', 'A[i,j]']);
  assert.equal(renderer.renderText('Run $(date) then $HOME; costs $25 and $50.'), 'Run $(date) then $HOME; costs $25 and $50.');
  assert.equal(renderer.renderText('`$O(V \\times E)$` and `$|V|-1$`'), '<code>$O(V \\times E)$</code> and <code>$|V|-1$</code>');
  assert.deepEqual(expressions(render('```latex\n$|V|$ and $(u, v)$\n```')), []);
});

test('partial streaming formulas recover once their closing delimiter arrives', () => {
  for (const expression of ['|V|', '(u, v)', 'dist[v]']) {
    assert.deepEqual(expressions(renderer.renderText(`Use $${expression}`)), []);
    assert.deepEqual(expressions(renderer.renderText(`Use $${expression}$ next.`)), [expression]);
  }
});

test('literal code and currency survive beside separate math spans', () => {
  const inline = '`**Step 1 (ac$):**12 \\times 6 = 72$`';
  assert.equal(renderer.renderText(inline), '<code>**Step 1 (ac$):**12 \\times 6 = 72$</code>');
  assert.equal(renderer.renderText('Costs $25 and $50.'), 'Costs $25 and $50.');
  assert.equal(renderer.renderText('Run $(date) then $HOME.'), 'Run $(date) then $HOME.');
  assert.deepEqual(expressions(render('$x$ and `$HOME` and $y$')), ['x', 'y']);
  const fenced = render('```python\nprice = "$25"\n# **bold** $ac$\n```');
  assert.deepEqual(expressions(fenced), []);
  assert.match(fenced, /\$ac\$/);
});

test('the earlier malformed step label is repaired without consuming a later expression', () => {
  const html = renderer.renderText('**Step 1 (ac$):**1234 \\times 0 = 0$');
  assert.match(html, /<strong>Step 1 \(ac\):<\/strong>/);
  assert.deepEqual(expressions(html), ['1234 \\times 0 = 0']);
});

test('bold final numeric display results use a real KaTeX box', () => {
  const html = render(String.raw`$$= \mathbf{83,815,538,040}$$`);
  assert.deepEqual(expressions(html), [String.raw`= \boxed{83,815,538,040}`]);
  assert.match(html, /class="boxpad"/);
  assert.doesNotMatch(html, /katex-error|math-display-fallback/);
  assert.deepEqual(expressions(render('**$165$**')), [String.raw`\boxed{165}`]);
});

test('boxing preserves intermediate terms, vectors, inline emphasis and existing boxes', () => {
  for (const expression of [String.raw`\mathbf{v} = \mathbf{u}`, String.raw`\mathbf{12} + 3 = 15`, String.raw`= \boxed{42}`]) {
    assert.deepEqual(expressions(render(`$$${expression}$$`)), [expression]);
  }
  assert.deepEqual(expressions(renderer.renderText(String.raw`Use $\mathbf{12}$ here.`)), [String.raw`\mathbf{12}`]);
  assert.equal(renderer.renderText('**Final answer:**'), '<strong>Final answer:</strong>');
  assert.deepEqual(expressions(render(String.raw`$$\boxed{x = \frac{1}{2}}$$`)), [String.raw`\boxed{x = \frac{1}{2}}`]);
});

test('web links render citations without brackets and preserve URL punctuation', () => {
  for (const text of ['[Apple Inc (AAPL)](https://exa.ai/library/markets/stock/AAPL)', '【https://exa.ai/library/markets/stock/AAPL】', '[https://exa.ai/library/markets/stock/AAPL]']) {
    const html=renderer.renderText(text);
    assert.match(html, /class="web-link" href="https:\/\/exa.ai\/library\/markets\/stock\/AAPL"/);
    assert.match(html, /web-link-icon/);
    assert.doesNotMatch(html, /【|】|\[|\]/);
  }
  assert.match(renderer.renderText('[Article](https://example.com/a_(b)?x=1&y=2)'), /href="https:\/\/example.com\/a_\(b\)\?x=1&amp;y=2"/);
  assert.match(renderer.renderText('Visit https://example.com/path.'), /<\/a>\.$/);
  assert.doesNotMatch(renderer.renderText('[bad](javascript:alert(1))'), /<a /);
  assert.equal(renderer.renderText('`https://example.com`'), '<code>https://example.com</code>');
  assert.doesNotMatch(render('```text\nhttps://example.com\n```'), /class="web-link"/);
});

test('title-only citations resolve against saved sources, including currency and CNBC labels', () => {
  const title='Apple Inc (AAPL) | Currently at $335.58 (-0.42%) | Sep 18, 2026';
  const cnbc='AAPL: Apple Inc. - Stock Price, Quote and News - CNBC';
  const webSources=[{title,url:'https://exa.ai/library/markets/stock/AAPL'}, {title:cnbc,url:'https://www.cnbc.com/quotes/AAPL'}];
  const html=renderer.renderRichText(`- Close: $335.58 [${title}].\n- After hours: $334.88 [${cnbc}].`,0,{webSources});
  assert.match(html,/class="web-link" href="https:\/\/www.cnbc.com\/quotes\/AAPL"/);
  assert.match(html,/class="web-link" href="https:\/\/exa.ai\/library\/markets\/stock\/AAPL"/);
  assert.match(html,/web-link-icon/);
  assert.doesNotMatch(html,/\[|\]|katex/);
  assert.match(renderer.renderRichText('[AAPL: Apple Inc. — Stock Price, Quote and News — CNBC]',0,{webSources}), /class="web-link"/);
});

test('citation recovery leaves code, unknown or ambiguous titles and existing links alone', () => {
  const webSources=[{title:'Example',url:'https://example.com/'}];
  assert.equal(renderer.resolveSourceCitations('`[Example]` [Unknown] [Example](https://other.example/)',webSources),'`[Example]` [Unknown] [Example](https://other.example/)');
  assert.doesNotMatch(renderer.renderRichText('```text\n[Example]\n```',0,{webSources}),/class="web-link"/);
  assert.equal(renderer.resolveSourceCitations('[Example]',[...webSources,{title:'Example',url:'https://other.example/'}]),'[Example]');
  assert.equal(renderer.resolveSourceCitations('[Example]',[{title:'Example',url:'javascript:alert(1)'}]),'[Example]');
  assert.equal(renderer.resolveSourceCitations('[Example]'),'[Example]');
});

const W = require('../widgets.js');
renderer.OrbitWidgets = W;
renderer.crypto = require('node:crypto').webcrypto;
renderer.attachmentFileKind = () => ({className:'image',icon:'icon-file'});
vm.runInContext(fs.readFileSync(require.resolve('../widgets-ui.js'),'utf8'),renderer);
const graph = title => ({kind:'chart',title,chartType:'line',labels:['A','B'],series:[{name:'Value',values:[2,5]}]});
const fence = spec => '```orbit-widget\n'+JSON.stringify(spec)+'\n```';
const interleaved = 'Opening explanation.\n\n'+fence(graph('First graph'))+'\n\nBetween graphs.\n\n```python\nprint(1)\n```\n\n'+fence({...graph('Second graph'),chartType:'pie'})+'\n\nFinal explanation.\n\n```python\nprint(2)\n```';
function assertOrdered(html) {
  const parts=['Opening explanation.','aria-label="First graph"','Between graphs.','aria-label="Second graph"','Final explanation.'];
  let cursor=-1;
  for(const part of parts) {const next=html.indexOf(part);assert.ok(next>cursor,part);cursor=next;}
  assert.equal((html.match(/class="orbit-chart"/g)||[]).length,2);
  assert.doesNotMatch(html,/orbit-widget|"series"/);
  const ids=[...html.matchAll(/\sid="(code-[^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
}
test('multiple charts retain text order during streaming and after saved recovery',()=>{
  const message={role:'assistant',text:interleaved,generating:true};
  const live=renderer.messageContentMarkup(message,3);
  assertOrdered(live);
  assert.doesNotMatch(live,/Preparing chart/);
  assert.match(live,/data-chart-options disabled/);
  delete message.generating;
  assert.equal(renderer.recoverMessageWidgets(message),true);
  assertOrdered(renderer.messageContentMarkup(message,3));
  message.artifacts=renderer.normalizedWidgetArtifacts(JSON.parse(JSON.stringify(message.artifacts)));
  const saved=renderer.messageContentMarkup(message,3);
  assertOrdered(saved);
  assert.match(saved,/data-chart-key="3:0"/);
  assert.match(saved,/data-chart-key="3:1"/);
});
test('a second unfinished chart shows preparation without swallowing the first graph or prose',()=>{
  const text='Opening explanation.\n'+fence(graph('First graph'))+'\nBetween graphs.\n```orbit-widget\n{"kind":"chart","title":"Sec';
  const html=renderer.messageContentMarkup({role:'assistant',text,generating:true},0);
  assert.match(html,/First graph/);assert.match(html,/Between graphs/);assert.match(html,/Preparing chart/);
  assert.doesNotMatch(html,/orbit-widget|"kind"/);
  assert.equal((html.match(/class="orbit-chart"/g)||[]).length,1);
});
test('legacy charts without positions remain at the end',()=>{
 const html=renderer.messageContentMarkup({role:'assistant',text:'Old explanation.',artifacts:[{spec:graph('Old graph')}]},0);
 assert.ok(html.indexOf('Old explanation.')<html.indexOf('aria-label="Old graph"'));
});

test('stopped chart streams never expose unfinished JSON and retain completed charts',()=>{
 const text='Before\n'+fence(graph('Complete chart'))+'\nAfter\n```orbit-widget\n{"kind":"chart","title":"unfinished';
 const html=renderer.messageContentMarkup({role:'assistant',text,footer:'Generation stopped.'},0);
 assert.match(html,/Complete chart/);assert.match(html,/Generation stopped/);assert.match(html,/After/);
 assert.doesNotMatch(html,/orbit-widget|"kind"|Preparing chart/);
});
test('hostile markup, code, URLs and long punctuation remain escaped',()=>{
 for(const input of ['<img src=x onerror=alert(1)>','[click](javascript:alert(1))','```html\n<script>alert(1)</script>\n```','[x](https://example.com/\"onclick=\"x)','**'.repeat(3000),'$'.repeat(3000)]) {
  const html=render(input);assert.doesNotMatch(html,/<script|<img|href="javascript:| onclick=/);
 }
});

// Replays the mixed code/chart structure that previously rendered raw JSON.
test('mixed R and JSON widgets stream and recover through the actual message renderer',()=>{
 const fixture=fs.readFileSync(__dirname+'/fixtures/mixed-code-charts.md','utf8');
 for(let end=1;end<=fixture.length;end+=17){
   const text=fixture.slice(0,end),html=renderer.messageContentMarkup({role:'assistant',text,generating:true},0);
   assert.doesNotMatch(html,/&quot;kind&quot;|&quot;series&quot;|saved widget is invalid/,'prefix '+end);
 }
 const message={role:'assistant',text:fixture};
 assert.equal(renderer.recoverMessageWidgets(message),true);
 const html=renderer.messageContentMarkup(message,0);
 assert.equal((html.match(/class="orbit-chart"/g)||[]).length,4);
 assert.doesNotMatch(html,/orbit-widget|Preparing chart|saved widget is invalid/);
 assert.equal((html.match(/class="code-block"/g)||[]).length,4);
});

test('diagrams stream in-place, show shimmer for the next snapshot, then preserve continued prose',()=>{
 const {triangle}=require('./fixtures/diagrams.cjs');const block='```orbit-widget\n'+JSON.stringify(triangle)+'\n```';
 const text='Step one\n'+block+'\nStep two\n'+block+'\nStep three\n```orbit-widget\n{"kind":"diagram","nodes":[';
 const html=renderer.messageContentMarkup({role:'assistant',text,generating:true},0);
 assert.equal((html.match(/class="orbit-diagram"/g)||[]).length,2);assert.match(html,/Preparing diagram/);assert.doesNotMatch(html,/&quot;nodes&quot;|orbit-widget/);
 assert.ok(html.indexOf('Step one')<html.indexOf('class="orbit-diagram"'));assert.ok(html.indexOf('Step two')>html.indexOf('class="orbit-diagram"'));
 const complete=renderer.messageContentMarkup({role:'assistant',text:'Step\n'+block+'\nContinue the explanation.',generating:true},0);assert.doesNotMatch(complete,/Preparing diagram/);assert.match(complete,/Continue the explanation/);
});

test('title inference respects hierarchy and preserves equal-ranked peer headings',()=>{
 const positive=[
  'Sure bro.\n\n## Understanding abstraction\n\nBody.\n\n### Examples\n\nDetails.',
  'Sure bro.\n## Understanding abstraction\nBody.\n### Examples\nDetails.',
  '**Topic: Understanding abstraction**\n\nBody.\n\n## Examples\n\nDetails.'
 ];
 for(const text of positive){const m={role:'assistant',text};const html=renderer.messageContentMarkup(m,0);assert.equal((html.match(/response-title/g)||[]).length,1);assert.equal(m.text,text);assert.equal(renderer.styleResponseTitle(html),html);assert.doesNotMatch(renderer.messageContentMarkup({...m,role:'user'},0),/response-title/);}
 for(const [a,b] of [['AWS Shield Standard','AWS Shield Advanced'],['Advantages','Disadvantages'],['Understanding abstraction','Examples'],['1. Standard','2. Advanced'],['Step 1: Start','Step 2: Continue'],['1️⃣ Standard','2️⃣ Advanced'],['A) First option','B) Second option'],['I. First method','II. Second method'],['Option A: First','Option B: Second']]){
  for(const marker of ['##','###','####','**']){
   const heading=t=>marker==='**'?'**'+t+'**':marker+' '+t;
   const text='Here is the breakdown.\n\n'+heading(a)+'\n\nUseful body.\n\n'+heading(b)+'\n\nMore useful body.';
   for(const generating of [false,true])assert.doesNotMatch(renderer.messageContentMarkup({role:'assistant',text,generating},0),/response-title/,text);
  }
 }
});
test('incomplete numbered series and partial streamed titles never get speculative promotion',()=>{
 for(const title of ['1. AWS Shield Standard','(1) First','1: Start','1 - Start','1️⃣ First','Step 1: Start','Part I: Overview','Phase 1: Start','Lesson 1: Correlation','🔹 1. Standard']){
  const text='### '+title+'\n\nBody.';
  assert.doesNotMatch(renderer.messageContentMarkup({role:'assistant',text},0),/response-title/,title);
 }
 assert.doesNotMatch(renderer.messageContentMarkup({role:'assistant',text:'## Unfinished explanation\n\nBody.',generating:true},0),/response-title/);
 const explicit=renderer.messageContentMarkup({role:'assistant',text:'# Understanding correlation\n\n## 1. Positive\n\n## 2. Negative',generating:true},0);assert.match(explicit,/<h1>/);assert.doesNotMatch(explicit,/response-title/);
});
test('title inference excludes nested content, body sections, bold prose and existing H1',()=>{
 for(const html of [
  '<div class="orbit-chart"><h2>Widget heading</h2></div><p>Body</p>',
  '<blockquote><h2>Quoted heading</h2></blockquote>',
  '<ul><li><strong>List label</strong></li></ul>',
  '<p><strong>Advantages</strong></p><p>Body</p><p><strong>Disadvantages</strong></p>',
  '<p><strong>This is a statement.</strong></p>',
  '<p><strong><span class="math-inline">x=42</span></strong></p>',
  '<h1>Existing title</h1><h3>Section</h3>',
  '<p>'+('Long introduction. '.repeat(30))+'</p><h2>A later section</h2>'
 ])assert.equal(renderer.styleResponseTitle(html),html);
});
