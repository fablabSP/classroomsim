// Builds public/app.js (Firebase), public/pdf.js (PDF reports, loaded on demand) and demo/ClassroomSim_demo.html (no server, for previews).
import { build } from 'esbuild';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const common = { bundle: true, format: 'iife', target: ['es2020', 'safari15'], legalComments: 'none', logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/main-firebase.js'], outfile: 'public/app.js', minify: true, sourcemap: true });
// jsPDF's HTML-to-PDF add-ons (html2canvas, dompurify, canvg) are not used: leave them out.
await build({ ...common, entryPoints: ['src/pdf.js'], outfile: 'public/pdf.js', minify: true, external: ['html2canvas', 'dompurify', 'canvg'] });
const demoApp = await build({ ...common, entryPoints: ['src/main-demo.js'], write: false, minify: true });
const demoHost = await build({ ...common, entryPoints: ['src/demo-host.js'], write: false, minify: true });

const js = s => JSON.stringify(s).replace(/<\//g, '<\\/');
const shell = readFileSync('demo/shell.html', 'utf8');
const out = shell
  // Function replacements: a plain string would treat "$&", "$1" etc. inside the code as patterns.
  .replace('__APP_CSS__', () => js(readFileSync('public/styles.css', 'utf8')))
  .replace('__APP_JS__', () => js(demoApp.outputFiles[0].text))
  .replace('__CARDS__', () => JSON.stringify(Object.fromEntries(readdirSync('public/cards').filter(f => f.endsWith('.webp')).map(f => [f.slice(0, -5), 'data:image/webp;base64,' + readFileSync('public/cards/' + f).toString('base64')]))))
  .replace('__PDF_JS__', () => js(readFileSync('public/pdf.js', 'utf8')))
  .replace('__FAVICON__', () => js('data:image/svg+xml,' + encodeURIComponent(readFileSync('public/favicon.svg', 'utf8'))))
  .replace('/*__HOST__*/', () => demoHost.outputFiles[0].text.replace(/<\/script/gi, '<\\/script'));
writeFileSync('demo/ClassroomSim_demo.html', out);
console.log('Built public/app.js and demo/ClassroomSim_demo.html (' + Math.round(out.length / 1024) + ' KB)');
