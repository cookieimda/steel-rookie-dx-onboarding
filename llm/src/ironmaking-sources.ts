// 학습 튜터의 근거 자료 목록(backend/data/ironmaking-sources.json). 처음에는 제선 포스코 공개 자료만 있었고,
// 지금은 공정 4개(section)의 공개 자료(포스코, 철강협회, 다른 철강사, 철강 전문지, 국제기구 등)를 함께 둔다.
// 파일 이름은 루브릭 등에서 가리키고 있어 그대로 둔다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Section } from "../../backend/src/checkpoint/types.js";

export interface PublicSource {
  id: string;
  title: string;
  date: string;
  date_type: "발행일" | "발행연도" | "확인일";
  url: string;
  publisher: string;
  /** 어느 공정의 자료인지. 없으면 제선(처음부터 있던 자료). */
  section?: Section;
  /** 제선 자료의 경로 구분(고로·FINEX). 다른 공정 자료에는 없다. */
  route?: "고로" | "FINEX" | "비교";
  topics: string[];
  notes: string[];
  /** 메모마다 근거가 된 원문 문장(같은 순서). 검수용이고 화면·튜터에는 넘기지 않는다. 처음부터 있던 제선 자료에는 없다. */
  evidence?: string[];
}

const path = join(process.cwd(), "backend", "data", "ironmaking-sources.json");
const catalog = JSON.parse(readFileSync(path, "utf8")) as {
  notice: string;
  sources: PublicSource[];
};

export const sourceNotice = catalog.notice;
export const publicSources = catalog.sources;
const sourcesById = new Map(publicSources.map((source) => [source.id, source]));

/** 자료의 공정. section이 없으면 제선. */
export const sectionOf = (source: PublicSource): Section => source.section ?? "ironmaking";

export function getPublicSources(ids: string[]): PublicSource[] {
  return [...new Set(ids)].map((id) => sourcesById.get(id)).filter((source): source is PublicSource => Boolean(source));
}
