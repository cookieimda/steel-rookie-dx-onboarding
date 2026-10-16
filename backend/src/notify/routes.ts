// 알림 API(notify/service.ts). 본인 알림만 읽고 쓴다. 관리자는 발송 기록을 보고 정기 알림을 바로 만들 수 있다.
//   GET /api/me/notifications(읽을 때 내 정기 알림을 먼저 만든다), POST /api/me/notifications/:id/read, POST /api/me/notifications/read-all
//   GET·PUT /api/me/notification-prefs
//   GET /api/admin/notifications/outbox, POST /api/admin/notifications/run(전체 정기 알림 + 발송)
import express from "express";
import { z } from "zod";
import { requireAdmin, requireUser, type AuthDeps } from "../auth/routes.js";
import type { User } from "../auth/users.js";
import { NOTIFY_KINDS, type Notifier } from "./service.js";

const Prefs = z.object({
  browser: z.boolean(),
  email: z.boolean(),
  email_address: z.string().trim().max(120).refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "메일 주소 형식이 올바르지 않아요."),
  messenger: z.boolean(),
  kinds: z.record(z.string(), z.boolean()).default({}).refine((k) => Object.keys(k).every((x) => (NOTIFY_KINDS as readonly string[]).includes(x)), "알 수 없는 알림 종류예요."),
}).refine((p) => !p.email || p.email_address !== "", { message: "메일로 받으려면 메일 주소를 적어 주세요." });

export function createNotifyRouter(auth: AuthDeps, notifier: Notifier): express.Router {
  const router = express.Router(), login = requireUser(auth);
  const userOf = (res: express.Response) => res.locals.user as User;
  router.get("/api/me/notifications", login, (_req, res) => {
    const user = userOf(res);
    if (user.role === "trainee") notifier.generateFor(user.id);
    res.json(notifier.list(user.id));
  });
  router.post("/api/me/notifications/read-all", login, (_req, res) => res.json({ read: notifier.readAll(userOf(res).id) }));
  router.post("/api/me/notifications/:id/read", login, (req, res) => {
    if (!notifier.markRead(userOf(res).id, String(req.params.id))) { res.status(404).json({ error: "알림을 찾지 못했어요." }); return; }
    res.json({ ok: true });
  });
  router.get("/api/me/notification-prefs", login, (_req, res) => res.json(notifier.prefs(userOf(res).id)));
  router.put("/api/me/notification-prefs", login, express.json(), (req, res) => {
    const body = Prefs.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.issues[0]?.message ?? "설정 형식이 올바르지 않아요." }); return; }
    res.json(notifier.setPrefs(userOf(res).id, body.data));
  });
  router.get("/api/admin/notifications/outbox", login, requireAdmin, (_req, res) => res.json({ deliveries: notifier.outbox() }));
  router.post("/api/admin/notifications/run", login, requireAdmin, async (_req, res) => {
    const made = notifier.generateAll();
    res.json({ made, delivery: await notifier.deliverPending() });
  });
  return router;
}
