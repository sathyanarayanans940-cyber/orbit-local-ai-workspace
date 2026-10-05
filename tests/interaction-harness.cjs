const fs=require('node:fs'),vm=require('node:vm');
module.exports=ctx=>{
 Object.assign(ctx,{performance:{now:()=>0},setInterval:()=>1,clearInterval(){},document:{querySelectorAll:()=>[]}});
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('const replyStatusClocks ='),source.indexOf('function renderMessages(')),ctx);
};
