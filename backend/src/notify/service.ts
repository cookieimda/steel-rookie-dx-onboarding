// 알림 서비스(012). 화면 알림함에 모든 알림을 넣고, 사용자가 켠 채널(이메일·사내 메신저)로 발송 기록을 만든다.
// - 만드는 알림: 오늘 복습할 개념, 배정 시험 마감 임박(2일 안)·마감 지남, 연속 학습일이 끊길 위험(18시 이후 오늘 공부 기록 없음),
//   자료 검수 요청·결과, 작업 완료, 내 설비 메모에 답글. dedupe_key로 같은 알림은 한 번만 만든다(하루 단위 알림은 날짜를 키에 넣는다).
// - 브라우저 알림은 화면이 알림함을 읽어 직접 띄운다(Notification API, 페이지가 열려 있을 때). 서버 Web Push(VAPID)는 아직 없다.
// - 외부 발송은 환경 변수로 연결한다. 없으면 'skipped(연결 설정 없음)'으로 남기고 보내지 않는다.
//   NOTIFY_MESSENGER_WEBHOOK: 사내 메신저 웹훅 주소(POST {text}). NOTIFY_EMAIL_WEBHOOK: 메일 발송 API 주소(POST {to, subject, text}).
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { buildEmployeeCard, kstDay, type CardEvent } from "../me/employee-card.js";

export const NOTIFY_KINDS = ["review_due", "assignment_due", "assignment_overdue", "streak_risk", "material_review", "job_done", "note_reply", "system"] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];
export const KIND_LABEL: Record<NotifyKind, string> = {
  review_due: "복습 일정", assignment_due: "배정 시험 마감", assignment_overdue: "마감 지난 시험", streak_risk: "연속 학습일",
  material_review: "자료 검수", job_done: "작업 완료", note_reply: "설비 메모 답글", system: "공지",
};

export interface NotifyPrefs {
  /** 브라우저 알림(화면이 열려 있을 때). */
  browser: boolean;
  email: boolean;
  email_address: string;
  messenger: boolean;
  /** 종류별로 끄고 켠다(없는 종류는 켬). */
  kinds: Partial<Record<NotifyKind, boolean>>;
}
export const DEFAULT_PREFS: NotifyPrefs = { browser: true, email: false, email_address: "", messenger: false, kinds: {} };

export interface NotificationRow { id: string; user_id: string; kind: NotifyKind; title: string; body: string; link: string | null; dedupe_key: string; read_at: string | null; created_at: string }

export interface NotifierDeps {
  db: DatabaseSync;
  /** 사원증과 같은 학습 기록(연속 학습일 계산). */
  cardEvents: (userId: string) => CardEvent[];
  /** 배정 시험을 이미 통과했는지(통과했으면 마감 알림을 만들지 않는다). */
  passed: (userId: string, section: string) => boolean;
  now?: () => Date;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/** 한국 시간 시각(0~23). */
const kstHour = (d: Date) => Number(new Date(d.getTime() + 9 * 3600_000).toISOString().slice(11, 13));
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export class Notifier {
  private readonly now: () => Date;
  constructor(private readonly deps: NotifierDeps) { this.now = deps.now ?? (() => new Date()); }
  private get db() { return this.deps.db; }

  prefs(userId: string): NotifyPrefs {
    const row = this.db.prepare("SELECT prefs_json FROM notification_prefs WHERE user_id=?").get(userId);
    return row ? { ...DEFAULT_PREFS, ...JSON.parse(String(row.prefs_json)) } : { ...DEFAULT_PREFS };
  }
  setPrefs(userId: string, prefs: NotifyPrefs): NotifyPrefs {
    this.db.prepare("INSERT INTO notification_prefs(user_id,prefs_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET prefs_json=excluded.prefs_json, updated_at=excluded.updated_at")
      .run(userId, JSON.stringify(prefs), this.now().toISOString());
    return this.prefs(userId);
  }

  /** 알림 하나. 같은 dedupe_key가 있으면 만들지 않고 null. 사용자가 끈 종류도 null. 켠 외부 채널은 발송 대기로 남긴다. */
  notify(userId: string, kind: NotifyKind, title: string, body: string, link: string | null, dedupeKey: string): NotificationRow | null {
    const prefs = this.prefs(userId);
    if (prefs.kinds[kind] === false) return null;
    const id = randomUUID(), at = this.now().toISOString();
    const inserted = this.db.prepare("INSERT OR IGNORE INTO notifications(id,user_id,kind,title,body,link,dedupe_key,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, userId, kind, title, body, link, dedupeKey, at).changes;
    if (!inserted) return null;
    const channels: ("email" | "messenger")[] = [];
    if (prefs.messenger) channels.push("messenger");
    if (prefs.email && prefs.email_address) channels.push("email");
    for (const channel of channels) {
      this.db.prepare("INSERT INTO notification_deliveries(id,notification_id,channel,state,attempts,updated_at) VALUES(?,?,?,'pending',0,?)").run(randomUUID(), id, channel, at);
    }
    return this.db.prepare("SELECT * FROM notifications WHERE id=?").get(id) as unknown as NotificationRow;
  }

  /** 한 사람의 정기 알림을 만든다(복습·배정 시험·연속 학습일). 만든 알림 수. */
  generateFor(userId: string): number {
    const now = this.now(), today = kstDay(now);
    let made = 0;
    const add = (row: NotificationRow | null) => { if (row) made++; };
    // 오늘(또는 지난) 복습 일정
    const due = this.db.prepare("SELECT concept_name FROM review_tasks WHERE user_id=? AND completed_at IS NULL AND due_date<=? ORDER BY due_date").all(userId, today).map((r) => String(r.concept_name));
    if (due.length) add(this.notify(userId, "review_due", `오늘 복습할 개념 ${due.length}개`, `${due.slice(0, 3).join(", ")}${due.length > 3 ? " 외" : ""} · 평가 시험 화면의 학습 캘린더에서 확인해요.`, "/exam", `review_due:${today}`));
    // 배정 시험: 2일 안 마감, 마감 지남
    const assignments = this.db.prepare(`SELECT a.id,a.title,a.section,a.due_date FROM education_assignments a JOIN education_members m ON a.group_id=m.group_id WHERE m.user_id=?`).all(userId);
    for (const a of assignments) {
      if (this.deps.passed(userId, String(a.section))) continue;
      const dueDate = String(a.due_date);
      if (dueDate < today) add(this.notify(userId, "assignment_overdue", `마감이 지난 시험 · ${a.title}`, `${dueDate}까지였던 시험이에요. 지금 응시할 수 있어요.`, "/exam", `assignment_overdue:${a.id}`));
      else if (dueDate <= addDays(today, 2)) add(this.notify(userId, "assignment_due", `시험 마감 ${dueDate === today ? "오늘" : dueDate === addDays(today, 1) ? "내일" : "모레"} · ${a.title}`, `${dueDate}까지 응시해 주세요.`, "/exam", `assignment_due:${a.id}:${today}`));
    }
    // 연속 학습일이 끊길 위험: 저녁 6시 이후, 어제까지 이어졌는데 오늘 기록이 없을 때
    if (kstHour(now) >= 18) {
      const card = buildEmployeeCard(this.deps.cardEvents(userId), now);
      if (card.streak.current > 0 && !card.streak.today_done) {
        add(this.notify(userId, "streak_risk", `🔥 ${card.streak.current}일 연속 학습이 끊기기 전에!`, "오늘 튜터에게 질문 하나, 복습 카드 한 장이면 불꽃이 이어져요.", "/login", `streak_risk:${today}`));
      }
    }
    return made;
  }
  generateAll(): number {
    const users = this.db.prepare("SELECT id FROM users WHERE role='trainee'").all().map((r) => String(r.id));
    return users.reduce((n, id) => n + this.generateFor(id), 0);
  }

  list(userId: string, limit = 50) {
    const rows = this.db.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(userId, limit) as unknown as NotificationRow[];
    const unread = Number(this.db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL").get(userId)?.n ?? 0);
    return { notifications: rows.map((r) => ({ ...r, kind_label: KIND_LABEL[r.kind] ?? r.kind, read: r.read_at !== null })), unread };
  }
  markRead(userId: string, id: string): boolean {
    return this.db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND read_at IS NULL").run(this.now().toISOString(), id, userId).changes > 0;
  }
  readAll(userId: string): number {
    return Number(this.db.prepare("UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(this.now().toISOString(), userId).changes);
  }

  /** 발송 대기(pending)를 보낸다. 연결 설정이 없으면 skipped, 3번 실패하면 failed. 보낸 수·건너뛴 수·실패 수. */
  async deliverPending(limit = 50): Promise<{ sent: number; skipped: number; failed: number }> {
    const env = this.deps.env ?? process.env, doFetch = this.deps.fetch ?? fetch;
    const rows = this.db.prepare(`SELECT d.*, n.title, n.body, n.link, n.user_id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id
                                  WHERE d.state='pending' ORDER BY d.updated_at LIMIT ?`).all(limit);
    const out = { sent: 0, skipped: 0, failed: 0 };
    for (const r of rows) {
      const set = (state: string, detail: string, tried = true) => this.db.prepare("UPDATE notification_deliveries SET state=?,detail=?,attempts=attempts+?,updated_at=? WHERE id=?")
        .run(state, detail, tried ? 1 : 0, this.now().toISOString(), String(r.id));
      const url = r.channel === "messenger" ? env.NOTIFY_MESSENGER_WEBHOOK : env.NOTIFY_EMAIL_WEBHOOK;
      if (!url) { set("skipped", "연결 설정 없음", false); out.skipped++; continue; }
      const prefs = this.prefs(String(r.user_id));
      const payload = r.channel === "messenger"
        ? { text: `[ST-ROOKIE] ${r.title}\n${r.body}` }
        : { to: prefs.email_address, subject: `[ST-ROOKIE] ${r.title}`, text: `${r.body}${r.link ? `\n\n바로 가기: ${r.link}` : ""}` };
      try {
        const res = await doFetch(String(url), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        set("sent", `HTTP ${res.status}`); out.sent++;
      } catch (e) {
        const attempts = Number(r.attempts) + 1;
        set(attempts >= 3 ? "failed" : "pending", (e as Error).message); if (attempts >= 3) out.failed++;
      }
    }
    return out;
  }
  outbox(limit = 100) {
    return this.db.prepare(`SELECT d.id, d.channel, d.state, d.detail, d.attempts, d.updated_at, n.kind, n.title, u.username
                              FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id LEFT JOIN users u ON u.id=n.user_id
                             ORDER BY d.updated_at DESC LIMIT ?`).all(limit);
  }
  admins(): string[] { return this.db.prepare("SELECT id FROM users WHERE role='admin'").all().map((r) => String(r.id)); }
}
