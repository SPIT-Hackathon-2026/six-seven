const fs = require('fs');
const path = require('path');

let count = 0;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules') continue;
      walk(full);
    } else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) {
      let content = fs.readFileSync(full, 'utf8');
      // Remove shadow-sm and shadow-md and shadow-lg (all trigger NativeWind bug)
      const updated = content.replace(/ shadow-sm/g, '').replace(/ shadow-md/g, '').replace(/ shadow-lg/g, '');
      if (updated !== content) {
        fs.writeFileSync(full, updated, 'utf8');
        count++;
        console.log('Fixed:', full);
      }
    }
  }
}

walk(path.join(__dirname, 'src'));
console.log('Done! Fixed', count, 'file(s).');
