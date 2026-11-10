// 테스트용: 브라우저처럼 스크립트 파일들을 한 공간에 차례로 읽고, 그 안의 이름(함수·상수)을 꺼내 씀
// (게임 코드는 <script>로 읽는 그냥 파일이라 module.exports 같은 것이 없음)
const fs = require('node:fs');
const path = require('node:path');

module.exports = (...files) => {
  const src = files.map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')).join('\n;\n');
  const get = new Function(`${src}\nreturn name => eval(name);`)();
  return new Proxy({}, { get: (_, name) => get(name) });
};
