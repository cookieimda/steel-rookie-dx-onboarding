// 시연용 계정. 로그인 화면의 일반 사용자/관리자 토글이 목록을 받아 아이디·비밀번호 칸을 채운다.
// .env의 DEMO_ACCOUNTS=off면 만들지도, 목록을 내주지도 않는다.
import type { Role, UserRepository } from "./users.js";

export interface DemoAccount {
  username: string;
  role: Role;
  name: string;
  employee_no: string;
}

// 시연 신입사원 20명(trainee01~20, 사번 T2026001~020)과 관리자 1명. 이름은 시연용으로 지은 것이다.
const TRAINEE_NAMES = [
  "김신입", "이신입", "박신입", "최신입", "정다은", "강민준", "조서연", "윤도현", "장하은", "임지호",
  "한유진", "오승우", "서지민", "신예린", "권태윤", "황수아", "안준서", "송채원", "류현우", "전소율",
];
const pad = (n: number, width: number) => String(n).padStart(width, "0");

export const DEMO_ACCOUNTS: DemoAccount[] = [
  ...TRAINEE_NAMES.map((name, i): DemoAccount => ({ username: `trainee${pad(i + 1, 2)}`, role: "trainee", name, employee_no: `T2026${pad(i + 1, 3)}` })),
  { username: "admin01", role: "admin", name: "관리자", employee_no: "A2026001" },
];

/** 시연 기록(db:seed-demo)을 넣는 시연 신입사원 trainee02~20. users.is_demo = 1(006_demo_accounts.sql). trainee01은 팀원 실제 테스트 계정이다. */
export const DEMO_RECORD_TRAINEES: string[] = DEMO_ACCOUNTS.filter((a) => a.role === "trainee").slice(1).map((a) => a.username);

const DEFAULT_DEMO_PASSWORD = "steel-2026-demo";

export const demoAccountsEnabled = () => process.env.DEMO_ACCOUNTS?.trim().toLowerCase() !== "off";
export const demoPassword = () => process.env.DEMO_PASSWORD?.trim() || DEFAULT_DEMO_PASSWORD;

/** 없는 시연 계정만 만든다. 이미 있는 계정의 비밀번호는 바꾸지 않는다. 시연 기록 계정(trainee02~20)에는 is_demo를 표시한다. */
export async function seedDemoAccounts(users: UserRepository): Promise<number> {
  if (!demoAccountsEnabled()) return 0;
  let created = 0;
  for (const account of DEMO_ACCOUNTS) {
    if (users.exists(account.username)) continue;
    await users.create({ ...account, password: demoPassword() });
    created++;
  }
  users.markDemo(DEMO_RECORD_TRAINEES);
  return created;
}
