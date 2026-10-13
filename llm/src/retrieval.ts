// 학습 모드 근거 검색: retrieve(section, query, screen) → 근거 조각 최대 5개. 설계는 docs/learning-mode.md '근거 문서와 검색'.
// 데이터 원천: content/materials/{섹션}/section.md가 있으면 그 문서, 없으면(지금) backend/data/ironmaking-sources.json의 공개 자료 메모.
// 원천만 바꾸면 되도록 검색은 조각(Chunk) 단위로만 다룬다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GlossaryEntry, Rubric } from "../../backend/src/rubrics.js";
import { publicSources, type PublicSource } from "./ironmaking-sources.js";

export type Section = Rubric["section"];

export interface Chunk {
  /** 조각 id. 공개 자료 메모는 `<자료 id>#<메모 번호>`, section.md는 제목의 `{#id}` 또는 `<섹션>-<순번>`. */
  id: string;
  section: Section;
  title: string;
  text: string;
  /** 근거 자료 id(ironmaking-sources.json). 화면의 출처 링크에 쓴다. */
  source_ids: string[];
  /** 이 조각과 관련된 설비·개념 id. 현재 설비 가중치에 쓴다. */
  tags: string[];
}

/** 화면 상태. process_id는 섹션 id와 같다. */
export interface Screen {
  process_id?: string | null;
  equipment_id?: string | null;
}

export interface Retrieved extends Chunk {
  score: number;
}

export const MAX_RESULTS = 5;
// 질문 조각과 겹치는 비율이 이보다 낮으면 근거로 보지 않는다.
const MIN_SCORE = 0.08;
// 현재 화면의 설비와 관련된 조각에 더하는 점수.
const SCREEN_BOOST = 0.15;
const TITLE_WEIGHT = 0.3;

// 공개 자료 메모에는 설비 id가 없어서, 메모에 나오는 말로 제선 설비를 붙인다(id는 frontend/3d-demo/data_v2.js 기준).
const IRONMAKING_EQUIPMENT_WORDS: Record<string, string[]> = {
  sinter_plant: ["소결"],
  coke_oven: ["코크스", "석탄"],
  blast_furnace: ["고로", "용광로", "환원", "용융"],
  hot_stove: ["열풍로", "풍구", "열풍"],
  taphole_casthouse: ["출선", "주상"],
  torpedo_car: ["토페도", "운반"],
};

/** 공개 자료 메모 하나를 조각 하나로 만든다. 모두 제선 자료다. */
export function publicSourceChunks(sources: PublicSource[] = publicSources): Chunk[] {
  return sources.flatMap((source) =>
    source.notes.map((note, i) => ({
      id: `${source.id}#${i + 1}`,
      section: "ironmaking" as const,
      title: `${source.title} (${source.topics.join(", ")})`,
      text: note,
      source_ids: [source.id],
      tags: Object.entries(IRONMAKING_EQUIPMENT_WORDS).filter(([, words]) => words.some((w) => note.includes(w))).map(([id]) => id),
    })),
  );
}

/**
 * section.md를 조각으로 나눈다. 제목(## 또는 ###) 하나가 조각 하나다.
 * - 제목 끝의 `{#id}`는 조각 id이자 태그(개념·설비 id). 여러 개면 `{#a #b}`.
 * - 본문의 `[src:자료id]`는 근거 자료 id로 모으고 본문에서는 지운다.
 */
export function parseSectionMarkdown(section: Section, markdown: string): Chunk[] {
  const chunks: Chunk[] = [];
  let current: { title: string; tags: string[]; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const body = current.lines.join("\n");
    const source_ids = [...new Set([...body.matchAll(/\[src:([^\]\s]+)\]/g)].map((m) => m[1]))];
    const text = body.replace(/\s*\[src:[^\]]+\]/g, "").trim();
    if (text) chunks.push({ id: current.tags[0] ?? `${section}-${chunks.length + 1}`, section, title: current.title, text, source_ids, tags: current.tags });
    current = null;
  };
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const tagMatch = /\{([^}]*)\}\s*$/.exec(heading[1]);
      const tags = tagMatch ? [...tagMatch[1].matchAll(/#([\w-]+)/g)].map((m) => m[1]) : [];
      current = { title: heading[1].replace(/\s*\{[^}]*\}\s*$/, ""), tags, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  return chunks;
}

/** 섹션의 조각. section.md가 있으면 그 문서를, 없으면 공개 자료 메모(제선만)를 쓴다. */
export function loadSectionChunks(section: Section, root = join(process.cwd(), "content", "materials")): Chunk[] {
  const path = join(root, section, "section.md");
  if (existsSync(path)) return parseSectionMarkdown(section, readFileSync(path, "utf8"));
  return section === "ironmaking" ? publicSourceChunks() : [];
}

// 한국어는 조사가 붙어 단어가 그대로 맞지 않으므로(고로에서·고로를) 두 글자 조각(bigram)으로 비교한다.
function bigrams(text: string): Set<string> {
  const out = new Set<string>();
  for (const word of text.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length === 1) out.add(word);
    for (let i = 0; i + 1 < word.length; i++) out.add(word.slice(i, i + 2));
  }
  return out;
}

/** 질문에 나온 용어집 표제어·동의어를 서로 붙여 넣는다(예: 쇳물 → 용선). */
export function expandQuery(query: string, glossary: GlossaryEntry[] = []): string {
  const extra = glossary.flatMap(({ term, aliases }) => {
    const words = [term, ...aliases];
    return words.some((w) => query.includes(w)) ? words.filter((w) => !query.includes(w)) : [];
  });
  return [query, ...extra].join(" ");
}

// '이 설비', '이거', '여기'처럼 화면의 설비를 가리키는 말.
const POINTING = /(?:이|그|저)\s?(?:설비|장치|기계|거|것|건|게)|여기|거기/;

/**
 * 질문이 화면의 설비를 가리키기만 하면(예: 설비 패널의 '이 설비의 역할은?') 검색어에 그 설비 이름을 붙인다.
 * 질문 글자만으로 찾으면 설비 이름이 없어서, '이'·'설비'가 겹치는 엉뚱한 조각이 위로 온다.
 */
export function withScreenEquipment(query: string, equipmentName?: string | null): string {
  return equipmentName && POINTING.test(query) ? `${query} ${equipmentName}` : query;
}

export interface RetrieverOptions {
  /** 섹션별 조각을 돌려준다. 기본은 loadSectionChunks(테스트는 가짜 조각을 넣는다). */
  chunksFor?: (section: Section) => Chunk[];
  /** 섹션별 용어집. 보통 루브릭의 glossary. */
  glossaryFor?: (section: Section) => GlossaryEntry[];
}

export class Retriever {
  private readonly cache = new Map<Section, Chunk[]>();
  private readonly chunksFor: (section: Section) => Chunk[];
  private readonly glossaryFor: (section: Section) => GlossaryEntry[];

  constructor(options: RetrieverOptions = {}) {
    this.chunksFor = options.chunksFor ?? ((s) => loadSectionChunks(s));
    this.glossaryFor = options.glossaryFor ?? (() => []);
  }

  private chunks(section: Section): Chunk[] {
    if (!this.cache.has(section)) this.cache.set(section, this.chunksFor(section));
    return this.cache.get(section)!;
  }

  /** 같은 섹션 안에서 질문과 가장 많이 겹치는 조각을 최대 5개. 겹치는 조각이 없으면 빈 배열(모델은 unverified로 답한다). */
  retrieve(section: Section, query: string, screen: Screen = {}): Retrieved[] {
    const q = bigrams(expandQuery(query, this.glossaryFor(section)));
    if (q.size === 0) return [];
    const share = (text: string) => {
      const c = bigrams(text);
      let hit = 0;
      for (const g of q) if (c.has(g)) hit++;
      return hit / q.size;
    };
    return this.chunks(section)
      .map((chunk) => {
        // 제목(공개 자료는 자료 제목·주제 목록)은 같은 자료의 메모가 모두 공유하므로 본문보다 약하게 센다.
        const overlap = share(chunk.text) + TITLE_WEIGHT * share(chunk.title);
        const boost = overlap > 0 && screen.equipment_id && chunk.tags.includes(screen.equipment_id) ? SCREEN_BOOST : 0;
        return { ...chunk, score: Math.round((overlap + boost) * 1000) / 1000 };
      })
      .filter((r) => r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, MAX_RESULTS);
  }

  /**
   * 저장된 조각 id → 근거 자료 id(출처 표시용, 겹치면 한 번). 저장된 대화를 다시 보여 줄 때 쓴다.
   * 지금 조각 목록에 없는 id(자료가 바뀐 경우)는 공개 자료 메모 형식(`자료id#번호`)이면 앞부분을 쓰고, 아니면 버린다.
   */
  sourceIdsOf(section: Section, chunkIds: string[]): string[] {
    const byId = new Map(this.chunks(section).map((c) => [c.id, c]));
    return [...new Set(chunkIds.flatMap((id) => byId.get(id)?.source_ids ?? (id.includes("#") ? [id.slice(0, id.indexOf("#"))] : [])))];
  }
}
