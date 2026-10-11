import {readFile,writeFile} from 'node:fs/promises';
const packages=['react','react-dom','scheduler','lucide-react','pdfjs-dist'];
const notices=['IMONSOFT Files — third-party software notices.\nOriginal platform code is not licensed by this notice file.'];
for(const name of packages){
 const base=new URL(`../node_modules/${name}/`,import.meta.url);
 const pkg=JSON.parse(await readFile(new URL('package.json',base),'utf8'));
 let license;
 for(const filename of ['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','license.txt']) {
  try {license=await readFile(new URL(filename,base),'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 if(!license)throw new Error(`Missing license text for ${name}`);
 notices.push(`\n${'='.repeat(72)}\n${name} ${pkg.version}\n${'='.repeat(72)}\n${license}`);
 try {notices.push(await readFile(new URL('NOTICE',base),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
}
await writeFile(new URL('../public/THIRD_PARTY_NOTICES.txt',import.meta.url),notices.join('\n'));
console.log('Bundled third-party license notices: '+packages.length+' packages');
