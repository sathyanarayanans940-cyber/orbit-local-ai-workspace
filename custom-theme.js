/* Optional color overrides; regular appearance preferences remain untouched. */
(function(root){
'use strict';
const KEY='orbit-custom-theme-v1';
const fields=[
 ['sidebar','Sidebar','#17212b'],['sidebarText','Sidebar text','#edf4fa'],
 ['background','Chat background','#111923'],['text','Chat text','#edf4fa'],
 ['panel','Panels and menus','#1d2936'],['panelText','Panel text','#edf4fa'],
 ['bubble','Your messages','#2b4055'],['bubbleText','Your message text','#ffffff'],
 ['composer','Message input','#243447'],['composerText','Input text','#ffffff'],
 ['code','Code blocks','#0c1520'],['codeText','Code text','#e5edf6'],
 ['keyword','Code keywords','#c5a7ff'],['string','Code strings','#9bd19f'],['comment','Code comments','#9daebe'],
 ['indicator','Generating dot','#edf4fa'],
 ['button','Send button','#8ecaff'],['buttonText','Send icon','#102337'],['border','Borders','#425368']
];
const defaults=Object.fromEntries(fields.map(([key,,color])=>[key,color]));
function colors(value={}){return Object.fromEntries(fields.map(([key,,fallback])=>[key,/^#[0-9a-f]{6}$/i.test(value?.[key]||'')?value[key].toLowerCase():key==='indicator'&&/^#[0-9a-f]{6}$/i.test(value?.text||'')?value.text.toLowerCase():fallback]));}
function normalize(value={}){
 const presets=(Array.isArray(value?.presets)?value.presets:[]).slice(0,20).filter(p=>p&&typeof p.name==='string'&&p.name.trim()).map(p=>({name:p.name.trim().slice(0,40),colors:colors(p.colors)}));
 return {enabled:value?.enabled===true,colors:colors(value?.colors),presets:[...new Map(presets.map(p=>[p.name.toLowerCase(),p])).values()]};
}
function rgb(hex){return hex.slice(1).match(/../g).map(v=>parseInt(v,16));}
function mix(a,b,t){return '#'+rgb(a).map((v,i)=>Math.round(v+(rgb(b)[i]-v)*t).toString(16).padStart(2,'0')).join('');}
function luminance(hex){return rgb(hex).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function readable(bg){return contrast(bg,'#ffffff')>contrast(bg,'#111111')?'#ffffff':'#111111';}
function variables(c){return {
 '--sidebar':c.sidebar,'--sidebar-ink':c.sidebarText,'--sidebar-hover':mix(c.sidebar,c.sidebarText,.10),'--sidebar-selected':mix(c.sidebar,c.sidebarText,.18),
 '--bg':c.background,'--text':c.text,'--text-secondary':mix(c.text,c.background,.25),'--text-tertiary':mix(c.text,c.background,.35),
 '--panel':c.panel,'--panel-soft':c.panel,'--border':c.border,'--border-strong':c.border,'--conversation-menu-ink':c.panelText,
 '--user':c.bubble,'--chat-pill-bg':c.bubble,'--chat-pill-ink':c.bubbleText,'--composer-bg':c.composer,
 '--code':c.code,'--code-light-bg':c.code,'--code-dark-bg':c.code,'--code-text':c.codeText,'--code-border':c.border,
 '--code-keyword':c.keyword,'--code-preprocessor':c.keyword,'--code-type':c.keyword,'--code-string':c.string,'--code-comment':c.comment,
 '--code-function':c.codeText,'--code-number':c.string,'--code-constant':c.string,'--code-variable':c.codeText,'--code-operator':c.codeText,
 '--chat-send-bg':c.button,'--chat-send-ink':c.buttonText,'--button-bg':c.button,'--button-ink':c.buttonText,'--accent':c.button,'--diagram-accent':c.text,
 '--generation-indicator-color':c.indicator,'--inline-code-bg':mix(c.background,c.text,.12)
};}
function stylesheet(c){
 const declarations=Object.entries(variables(c)).map(([k,v])=>`${k}:${v} !important`).join(';');
 return `:root[data-custom-theme="on"]{${declarations}}
 :root[data-custom-theme="on"] .sidebar{--text:${c.sidebarText};--text-secondary:${mix(c.sidebarText,c.sidebar,.25)};--text-tertiary:${mix(c.sidebarText,c.sidebar,.35)}}
 :root[data-custom-theme="on"] .composer{--text:${c.composerText};--text-secondary:${mix(c.composerText,c.composer,.25)};--text-tertiary:${mix(c.composerText,c.composer,.35)}}
 :root[data-custom-theme="on"] :is(.dropdown-menu,.account-menu,.conversation-menu,.model-menu,.plus-menu,.thinking-menu){--text:${c.panelText};--text-secondary:${mix(c.panelText,c.panel,.25)}}`;
}
const api={normalize,colors,defaults,fields,variables,contrast,readable,stylesheet};
if(typeof module!=='undefined')module.exports=api;
if(!root.document)return;
let saved;try{saved=normalize(JSON.parse(root.localStorage.getItem(KEY)||'{}'));}catch(_){saved=normalize();}
let draft=null;
const $=id=>document.getElementById(id),style=document.createElement('style');style.id='custom-theme-overrides';document.head.append(style);
function apply(){
 const current=draft||saved;
 document.documentElement.toggleAttribute('data-custom-theme',current.enabled);
 if(current.enabled)document.documentElement.setAttribute('data-custom-theme','on');
 style.textContent=current.enabled?stylesheet(current.colors):'';
 if(current.enabled)root.OrbitAppearance?.sync(luminance(current.colors.background)<.18?'dark':'light',current.colors.background);
 else{
  // Restore the main theme attribute before reading its underlying surface.
  root.OrbitAppearance?.sync();
  const bg=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  root.OrbitAppearance?.sync(undefined,bg);
 }
}
function persist(next){root.localStorage.setItem(KEY,JSON.stringify(next));saved=next;}
function status(text){$('custom-status').textContent=text;}
function updatePreview(){
 const c=draft.colors,p=$('custom-theme-preview');for(const [k,v]of Object.entries(c))p.style.setProperty('--preview-'+k,v);
 const pairs=[['sidebar','sidebarText'],['background','text'],['panel','panelText'],['bubble','bubbleText'],['composer','composerText'],['code','codeText'],['code','keyword'],['code','string'],['code','comment'],['button','buttonText']];
 const low=pairs.filter(([a,b])=>contrast(c[a],c[b])<4.5).length;
 $('custom-contrast').textContent=low?`${low} color pair${low===1?' has':'s have'} low text contrast. Adjust the colors or use “Improve readability”.`:'Text colors have good contrast with their backgrounds.';
 $('custom-enabled').checked=draft.enabled;
 $('custom-override-note').hidden=!draft.enabled;
 apply();
}
function refreshPresets(selected=''){
 const select=$('custom-presets');select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a saved preset';select.append(placeholder);
 saved.presets.forEach((p,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=p.name;select.append(option);});select.value=selected;
 $('custom-load-preset').disabled=select.value==='';$('custom-delete-preset').disabled=select.value==='';
}
function renderColors(){
 const grid=$('custom-colors');grid.replaceChildren();
 for(const [key,label]of fields){
  const row=document.createElement('div');row.className='custom-color-row';
  const name=document.createElement('label');name.htmlFor='custom-color-'+key;name.textContent=label;
  const picker=document.createElement('input');picker.type='color';picker.id=name.htmlFor;picker.value=draft.colors[key];picker.setAttribute('aria-label',label);
  const hex=document.createElement('input');hex.type='text';hex.value=draft.colors[key];hex.maxLength=7;hex.pattern='#[0-9a-fA-F]{6}';hex.spellcheck=false;hex.setAttribute('aria-label',label+' hex value');
  picker.oninput=()=>{draft.colors[key]=picker.value;hex.value=picker.value;hex.setCustomValidity('');updatePreview();};
  hex.oninput=()=>{const valid=/^#[0-9a-f]{6}$/i.test(hex.value);hex.setCustomValidity(valid?'':'Use a hex color such as #16324f.');if(valid){draft.colors[key]=hex.value.toLowerCase();picker.value=hex.value;updatePreview();}};
  hex.onblur=()=>{if(!/^#[0-9a-f]{6}$/i.test(hex.value)){hex.value=draft.colors[key];hex.setCustomValidity('');status('Incomplete hex color restored to its last valid value.');}};
  row.append(name,picker,hex);grid.append(row);
 }
}
function begin(){draft=normalize(saved);renderColors();refreshPresets();$('custom-preset-name').value='';status('Changes preview live. Save settings to keep them; Cancel restores your previous colors.');updatePreview();}
function cancel(){draft=null;apply();}
function commit(){if(!draft)return;persist(normalize({...draft,presets:saved.presets}));draft=null;apply();}
function safe(action){try{action();}catch(_){status('Could not save custom colors. Browser storage may be full or unavailable. Your previous saved settings are unchanged.');}}
$('custom-enabled').onchange=e=>{if(!draft)return;draft.enabled=e.target.checked;renderColors();updatePreview();};
$('custom-presets').onchange=()=>{const disabled=$('custom-presets').value==='';$('custom-load-preset').disabled=disabled;$('custom-delete-preset').disabled=disabled;};
$('custom-save-preset').onclick=()=>safe(()=>{
 if(!draft)return;
 for(const input of $('custom-colors').querySelectorAll('input[type=text]'))if(!input.reportValidity())return;
 const name=$('custom-preset-name').value.trim().slice(0,40);if(!name){status('Give your preset a name first.');$('custom-preset-name').focus();return;}
 const presets=saved.presets.slice(),index=presets.findIndex(p=>p.name.toLowerCase()===name.toLowerCase());
 if(index<0&&presets.length>=20){status('You have 20 presets. Replace one by using its name, or delete a preset first.');return;}
 const item={name,colors:colors(draft.colors)};if(index<0)presets.push(item);else presets[index]=item;
 persist({...saved,presets});refreshPresets(String(index<0?presets.length-1:index));status(`Preset “${name}” saved. Save settings to keep your active colors.`);
});
$('custom-load-preset').onclick=()=>{const p=saved.presets[Number($('custom-presets').value)];if(!draft||$('custom-presets').value===''||!p)return;draft.colors=colors(p.colors);draft.enabled=true;$('custom-preset-name').value=p.name;renderColors();updatePreview();status(`Previewing “${p.name}”. Save settings to apply.`);};
$('custom-delete-preset').onclick=()=>safe(()=>{const index=Number($('custom-presets').value);if($('custom-presets').value===''||!saved.presets[index])return;persist({...saved,presets:saved.presets.filter((_,i)=>i!==index)});refreshPresets();status('Preset deleted. Your current colors are kept.');});
$('custom-readable').onclick=()=>{if(!draft)return;for(const [bg,fg]of [['sidebar','sidebarText'],['background','text'],['panel','panelText'],['bubble','bubbleText'],['composer','composerText'],['code','codeText'],['button','buttonText']])draft.colors[fg]=readable(draft.colors[bg]);for(const key of ['keyword','string','comment'])if(contrast(draft.colors.code,draft.colors[key])<4.5)draft.colors[key]=readable(draft.colors.code);renderColors();updatePreview();};
$('custom-reset').onclick=()=>{if(!draft)return;draft.colors=colors();renderColors();updatePreview();status('Starter palette restored. Saved presets are unchanged.');};
root.OrbitCustom={...api,apply,begin,cancel,commit};
apply();
})(typeof window==='undefined'?globalThis:window);
