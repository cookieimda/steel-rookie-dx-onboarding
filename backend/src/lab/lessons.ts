// 수업 모드(교육 담당자): 3D 실습 단계를 순서대로 묶은 수업. 3D 화면(v4)의 ?lab=lesson&lesson=<id>&step=<n>이 수업 막대를 띄우고 단계마다 그 실습을 연다.
// 내용은 content/lessons/lessons.json(검수 대상 콘텐츠). 서버 시작 때 단계가 가리키는 변수·이상 상황·사고 사례·갈림길이 실제로 있는지 검사한다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { NODES } from "./causal.js";
import type { FaultDrill } from "./faults.js";
import type { IncidentScenario } from "./incidents.js";

const Step = z.object({
  title: z.string().min(1), note: z.string().min(1),
  lab: z.enum(["plant", "map", "quiz", "diagnose", "rebalance", "fault", "incident"]),
  set: z.record(z.string(), z.number()).optional(), tour: z.boolean().optional(),
  level: z.union([z.literal(1), z.literal(2)]).optional(),
  fault: z.string().optional(), scenario: z.string().optional(), at: z.number().int().min(0).optional(), pick: z.number().int().min(0).optional(),
});
const Lesson = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), title: z.string(), minutes: z.number().int().positive(), goal: z.string(), steps: z.array(Step).min(1) });
const File = z.object({ lessons: z.array(Lesson).min(1) });
export type LessonDef = z.infer<typeof Lesson>;

export const LESSONS_PATH = join(process.cwd(), "content", "lessons", "lessons.json");

/** 형식·참조 검사(틀리면 예외, 서버가 시작하지 않는다). */
export function loadLessons(path = LESSONS_PATH, refs?: { faults: FaultDrill[]; scenarios: IncidentScenario[] }) {
  const parsed = File.parse(JSON.parse(readFileSync(path, "utf8")));
  const ids = new Set<string>();
  for (const l of parsed.lessons) {
    if (ids.has(l.id)) throw new Error(`수업 ${l.id}: id가 겹칩니다`);
    ids.add(l.id);
    l.steps.forEach((s, i) => {
      const where = `수업 ${l.id} ${i + 1}단계`;
      for (const [k, v] of Object.entries(s.set ?? {})) {
        const n = NODES.find((x) => x.id === k);
        if (!n?.control) throw new Error(`${where}: 인과 지도에 조정할 수 없는 값 ${k}`);
        if (v < n.control.min || v > n.control.max) throw new Error(`${where}: ${k} = ${v}, 범위 밖이에요`);
      }
      if (s.lab === "map" && !s.set) throw new Error(`${where}: 인과 지도 단계에는 조건(set)이 있어야 해요`);
      if (!refs) return;
      if (s.lab === "fault" && !refs.faults.some((f) => f.id === s.fault)) throw new Error(`${where}: 없는 이상 상황 ${s.fault}`);
      if (s.lab === "incident") {
        const sc = refs.scenarios.find((x) => x.id === s.scenario);
        if (!sc?.timeline[s.at ?? -1]?.branch?.options[s.pick ?? -1]) throw new Error(`${where}: 없는 사고 사례 갈림길 ${s.scenario} ${s.at}/${s.pick}`);
      }
    });
  }
  return parsed.lessons;
}
