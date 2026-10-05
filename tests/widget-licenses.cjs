// Generate redistributable notices from the locked build dependencies.
const fs = require('node:fs');
const path = require('node:path');
const seen = new Set(), notices = [];
function visit(name, parent = process.cwd()) {
  let base = parent;
  while (!fs.existsSync(path.join(base, 'node_modules', name, 'package.json'))) {
    if (base === path.dirname(base)) throw new Error(`Missing dependency ${name}`);
    base = path.dirname(base);
  }
  const dir = path.join(base, 'node_modules', name);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (seen.has(key)) return;
  seen.add(key);
  const licenses = fs.readdirSync(dir).filter(file => /^(license|licence|copying|notice)/i.test(file) && fs.statSync(path.join(dir,file)).isFile());
  notices.push(`${key}\nLicense: ${pkg.license || 'See package'}\n${licenses.map(file => fs.readFileSync(path.join(dir,file),'utf8')).join('\n')}`);
  for (const dependency of Object.keys(pkg.dependencies || {})) visit(dependency, dir);
}
for (const name of ['pdfmake','docx','pptxgenjs','jszip','mathjax-full','docx-preview','@fontsource/noto-serif','@fontsource/roboto-mono']) visit(name);
notices.push(fs.readFileSync('vendor/widgets/ROBOTO-LICENSE.txt', 'utf8'));
notices.push(fs.readFileSync('vendor/widgets/fonts/LICENSE.txt', 'utf8'));
fs.writeFileSync('vendor/widgets/LICENSES.txt', 'Orbit bundled document tools — third-party notices\n\n'+notices.join('\n\n'+'='.repeat(72)+'\n\n'));
