// Export actual PPTX and matching preview HTML for visual theme verification.
const fs=require('node:fs'),path=require('node:path');const W=require('../widgets.js');
const themes=['porcelain','blueprint','sage','aurora','goldleaf','orchid','vermilion','slate'];
(async()=>{const {generatePresentation}=await import('../presentation-engine.js');const out=path.join(__dirname,'output/ppt-themes-2026-10-16');fs.mkdirSync(out,{recursive:true});
for(const theme of themes){const label=theme[0].toUpperCase()+theme.slice(1),spec=W.normalize({kind:'pptx',theme,title:label+' theme',slides:[
{layout:'cover',title:label,subtitle:W.presentationThemes[theme],kicker:'LUNIVILO · PRESENTATION THEMES'},
{layout:'split',tone:'light',title:'A clear structure for your ideas',columns:[{title:'The question',body:'Give the audience the context they need. Keep the central question easy to find.'},{title:'The evidence',body:'Use the supplied facts and examples. Explain what they support and what remains uncertain.'}]},
{layout:'metrics',tone:'accent',title:'A sample project plan',subtitle:'Illustrative planning values, not measured results.',metrics:[{value:'3 phases',label:'Delivery plan',detail:'Research, build and review.'},{value:'2 weeks',label:'Sample review period',detail:'Confirm the scope before committing.'},{value:'1 owner',label:'Accountability',detail:'Keep decisions and evidence together.'}]},
{tone:'dark',title:'A consistent visual language',table:{headers:['Element','Purpose'],rows:[['Titles','Make the subject easy to identify.'],['Supporting text','Add the detail needed to understand it.'],['Accents','Draw attention to the important information.']]}}
]});
const pptx=await generatePresentation(spec);fs.writeFileSync(path.join(out,theme+'.pptx'),Buffer.from(await pptx.arrayBuffer()));const html=await generatePresentation(spec,{preview:true});fs.writeFileSync(path.join(out,theme+'.html'),html);}
console.log('Exported 8 theme decks and previews, 32 slides');})().catch(e=>{console.error(e);process.exitCode=1});
