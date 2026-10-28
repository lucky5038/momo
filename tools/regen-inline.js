// 把 src/public/index.html 重新内联成 public_inline.js
// 用法: node tools/regen-inline.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'source');
const htmlPath = path.join(root, 'src', 'public', 'index.html');
const outPath = path.join(root, 'public_inline.js');

if (!fs.existsSync(htmlPath)) {
  console.error('找不到界面文件: ' + htmlPath);
  process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const text =
  '// 自动生成: 内联前端页面（exe 打包时直接 require）\n' +
  '// 源文件: src/public/index.html, 修改页面后请重新运行 tools/regen-inline.js\n' +
  'module.exports = ' + JSON.stringify(html) + ';\n';

fs.writeFileSync(outPath, text, 'utf8');
console.log('已生成 ' + outPath + ' (' + text.length + ' 字符)');
