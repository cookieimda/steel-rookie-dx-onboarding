// npm start 전에 Node 버전을 확인한다. 서버는 node:sqlite(22.13부터 플래그 없이 사용)와 --env-file-if-exists(22.9부터)를 쓰므로,
// 그보다 낮으면 서버가 켜지자마자 꺼지고 브라우저에는 '서버에 연결하지 못했어요'만 보인다. 그 전에 이유를 알려 주고 멈춘다.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n[ST-ROOKIE] Node.js ${process.versions.node}로는 서버를 켤 수 없어요. Node.js 22.13 이상(권장: 24 LTS)을 설치한 뒤 다시 실행해 주세요.`);
  console.error('            설치: https://nodejs.org  ·  설치 후 새 터미널에서 node -v로 버전을 확인하세요.\n');
  process.exit(1);
}
