// 로그인·아이디 찾기·비밀번호 재설정의 실패 횟수 제한. 터널 주소가 공개되면 사번을 바꿔 가며 맞혀 보는 시도를 막는다.
// 확인(bcrypt·DB 조회)을 하기 전에 실패 1회를 먼저 적어 두고, 성공하면 지운다.
// 확인 뒤에 적으면 동시에 온 요청 여러 개가 모두 "아직 한도 전"을 보고 통과한다.
// 서버 메모리에 두므로 서버를 다시 켜면 비워진다(서버 한 대 전제).

export const ATTEMPT_LIMITS = { perAccount: 5, perIp: 20, windowMs: 5 * 60_000 } as const;

export interface Attempt {
  /** 확인에 성공했을 때 부른다. 먼저 적어 둔 실패 기록을 지운다. */
  succeeded(): void;
}

export class LoginAttempts {
  private readonly entries = new Map<string, number[]>();

  constructor(private readonly limits = ATTEMPT_LIMITS, private readonly now = () => Date.now()) {}

  /** 한도를 넘었으면 null. 아니면 실패 1회를 먼저 적고, 성공 때 지울 수 있는 Attempt를 돌려준다. */
  begin(account: string, ip: string | undefined): Attempt | null {
    const keys = [`account:${account.trim().toLowerCase()}`, `ip:${ip ?? "unknown"}`];
    const [accountKey, ipKey] = keys;
    if (this.recent(accountKey).length >= this.limits.perAccount || this.recent(ipKey).length >= this.limits.perIp) return null;
    const at = this.now();
    for (const key of keys) this.entries.set(key, [...this.recent(key), at]);
    return {
      succeeded: () => {
        for (const key of keys) {
          const list = this.entries.get(key) ?? [];
          const i = list.lastIndexOf(at);
          if (i >= 0) list.splice(i, 1);
        }
      },
    };
  }

  private recent(key: string): number[] {
    const from = this.now() - this.limits.windowMs;
    return (this.entries.get(key) ?? []).filter((t) => t > from);
  }
}
