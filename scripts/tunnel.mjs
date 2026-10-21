// 원격 팀원 테스트: cloudflared quick tunnel로 로컬 서버(localhost)를 임시 공개 주소에 연결한다.
// 실행: npm start로 서버를 켠 뒤 다른 터미널에서 npm run tunnel. 끝내려면 Ctrl+C.
// 공개 주소이므로 TEST_PASSCODE가 없으면 터널을 열지 않는다.
import { spawn } from "node:child_process";

const port = Number(process.env.PORT ?? 3000);
const local = `http://localhost:${port}`;

const INSTALL = `cloudflared가 설치되어 있지 않습니다. 설치한 뒤 다시 실행하세요.
  macOS:   brew install cloudflared
  Windows: winget install --id Cloudflare.cloudflared
  Linux:   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/`;

let access;
try {
  access = await (await fetch(`http://127.0.0.1:${port}/api/access`)).json();
} catch {
  console.error(`${local}에서 서버를 찾지 못했습니다. 다른 터미널에서 먼저 npm start를 실행하세요.`);
  process.exit(1);
}
if (!access.passcode_required) {
  console.error("TEST_PASSCODE가 비어 있습니다. 공개 주소로 열리므로 .env에 TEST_PASSCODE를 정하고 서버를 다시 켠 뒤 실행하세요.");
  process.exit(1);
}

const child = spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", local], { stdio: ["ignore", "pipe", "pipe"] });
child.on("error", (error) => {
  console.error(error.code === "ENOENT" ? INSTALL : `cloudflared 실행 실패: ${error.message}`);
  process.exit(1);
});

let shown = false;
const watch = (chunk) => {
  const url = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
  if (!url || shown) return;
  shown = true;
  console.log(`
공유 주소가 준비됐습니다. 팀원에게 이름을 붙여 보내세요(접속 비밀번호는 따로 전달).
  ${url}/checkpoint-test.html?user=이름

사용자별 하루 LLM 호출 한도: ${access.daily_limit > 0 ? `${access.daily_limit}회` : "제한 없음"}
테스트가 끝나면 이 창에서 Ctrl+C로 터널을 닫고, .env의 TEST_PASSCODE를 바꾸세요.
`);
};
child.stdout.on("data", watch);
child.stderr.on("data", watch);
setTimeout(() => {
  if (!shown) console.error("30초 안에 공유 주소를 받지 못했습니다. 네트워크를 확인하거나 다시 실행하세요.");
}, 30_000).unref();

const stop = () => child.kill("SIGINT");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  console.log("터널을 닫았습니다.");
  process.exit(code ?? 0);
});
