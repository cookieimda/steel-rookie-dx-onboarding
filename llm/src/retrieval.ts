// 학습 모드 근거 검색: retrieve(section, query, screen) → 근거 조각 최대 5개. 설계는 docs/learning-mode.md '근거 문서와 검색'.
// 데이터 원천: content/materials/{섹션}/section.md가 있으면 그 문서, 없으면(지금) backend/data/ironmaking-sources.json에서 그 공정의 공개 자료 메모.
// 원천만 바꾸면 되도록 검색은 조각(Chunk) 단위로만 다룬다.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { GlossaryEntry, Rubric } from "../../backend/src/rubrics.js";
import { publicSources, sectionOf, type PublicSource } from "./ironmaking-sources.js";

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

/** 질문에 나온 말로 제선 개념(section.md 조각의 태그)을 짐작한다. 설비 이름이 여러 조각에 겹칠 때 순위를 가르는 검색 힌트이고, 답이 아니다. */
function queryConcepts(section: Section, query: string): string[] {
  if (section !== "ironmaking") return [];
  const hints: string[] = [];
  if (/소결/.test(query)) hints.push("sinter_purpose");
  if (/코크스/.test(query) && /고로|환원|일산화탄소|역할|왜/.test(query) && !/제조|생산|화성|코크스로/.test(query)) hints.push("coke_reduction");
  if (/열풍/.test(query)) hints.push("hot_stove_role");
  if (/토페도|어뢰|TLC|옮|운반/i.test(query)) hints.push("torpedo_role");
  if (/출선|배출|나와|나오/.test(query) && /고로|쇳물|용선|출선/.test(query)) hints.push("taphole_role");
  if (/FINEX|파이넥스/i.test(query)) hints.push("finex_route");
  return hints;
}

// 공개 자료 메모에는 설비 id가 없어서, 메모에 나오는 말로 그 공정의 설비를 붙인다(id는 frontend/3d-demo/data_v2.js 기준).
export const EQUIPMENT_WORDS: Record<Section, Record<string, string[]>> = {
  ironmaking: {
    sinter_plant: ["소결"],
    coke_oven: ["코크스", "석탄"],
    blast_furnace: ["고로", "용광로", "환원", "용융"],
    hot_stove: ["열풍로", "풍구", "열풍"],
    taphole_casthouse: ["출선", "주상"],
    torpedo_car: ["토페도", "운반"],
  },
  steelmaking: {
    hot_metal_pretreatment: ["예비처리", "탈황", "탈인"],
    bof_converter: ["전로", "취련", "탈탄", "BOF"],
    oxygen_lance_offgas: ["랜스", "배가스", "LDG", "집진"],
    tapping_ladle_crane: ["출강", "크레인"],
    secondary_refining: ["2차 정련", "2차정련", "LF", "RH", "탈가스"],
    ladle_transfer: ["이송", "래들카", "연주공장", "연주공정"],
  },
  continuous_casting: {
    ladle_turret: ["터릿"],
    tundish: ["턴디시"],
    cc_mold: ["주형", "몰드", "진동", "오실레이션"],
    secondary_cooling: ["2차 냉각", "2차냉각", "스프레이", "가이드 롤"],
    withdrawal_straightener: ["인발", "교정", "핀치"],
    torch_cutter: ["절단", "토치"],
  },
  rolling: {
    reheating_furnace: ["재가열"],
    descaler: ["스케일"],
    roughing_mill: ["조압연"],
    finishing_mill: ["사상압연", "마무리 압연"],
    runout_table: ["런아웃", "냉각대", "층류"],
    coiler: ["권취", "코일러"],
  },
};

/** 공개 자료 메모 하나를 조각 하나로 만든다. 조각의 공정은 자료의 section(없으면 제선)이다. */
export function publicSourceChunks(sources: PublicSource[] = publicSources): Chunk[] {
  return sources.flatMap((source) => {
    const section = sectionOf(source);
    return source.notes.map((note, i) => ({
      id: `${source.id}#${i + 1}`,
      section,
      title: `${source.title} (${source.topics.join(", ")})`,
      text: note,
      source_ids: [source.id],
      tags: [
        ...Object.entries(EQUIPMENT_WORDS[section]).filter(([, words]) => words.some((w) => note.includes(w))).map(([id]) => id),
        ...(section === "ironmaking" && /코크스/.test(note) && /환원|일산화탄소|열원/.test(note) ? ["coke_reduction"] : []),
      ],
    }));
  });
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

/** 섹션의 조각: 개념별 자료(content/materials/{섹션}/section.md)와 그 공정의 공개 자료 메모를 함께 검색한다. 같은 id면 개념별 자료가 우선이다. */
export function loadSectionChunks(section: Section, root = join(process.cwd(), "content", "materials")): Chunk[] {
  const path = join(root, section, "section.md");
  const curated = existsSync(path) ? parseSectionMarkdown(section, readFileSync(path, "utf8")) : [];
  const publicNotes = publicSourceChunks().filter((c) => c.section === section);
  return [...new Map([...publicNotes, ...curated].map((c) => [c.id, c])).values()];
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

// 섹션과 상관없는 질문 말 → 메모 말. 메모는 온도를 "1,300℃의 고온"처럼 적어 "몇 도"와 겹치는 글자가 없다.
// 자료는 FINEX를 영어로만 적어 "파이넥스"로 물으면 겹치는 글자가 없다.
const QUESTION_WORDS: GlossaryEntry[] = [{ term: "온도", aliases: ["몇 도", "몇도", "고온"] }, { term: "FINEX", aliases: ["파이넥스"] }];

export interface RetrieverOptions {
  /** idf는 자료에 흔한 표현보다 구별되는 검색어에 높은 가중치를 준다. overlap은 이전 기준 비교용이다. */
  ranking?: "idf" | "overlap";
  maxResults?: number;
  /** 섹션별 조각을 돌려준다. 기본은 loadSectionChunks(테스트는 가짜 조각을 넣는다). */
  chunksFor?: (section: Section) => Chunk[];
  /** 섹션별 용어집. 보통 루브릭의 glossary. */
  glossaryFor?: (section: Section) => GlossaryEntry[];
}

export class Retriever {
  private readonly cache = new Map<Section, Chunk[]>();
  private readonly frequencies = new Map<Section, Map<string, number>>();
  private readonly ranking: "idf" | "overlap";
  private readonly maxResults: number;
  private readonly chunksFor: (section: Section) => Chunk[];
  private readonly glossaryFor: (section: Section) => GlossaryEntry[];

  constructor(options: RetrieverOptions = {}) {
    this.ranking = options.ranking ?? "idf";
    this.maxResults = options.maxResults ?? MAX_RESULTS;
    if (!Number.isInteger(this.maxResults) || this.maxResults < 1) throw new Error("maxResults는 양의 정수입니다.");
    this.chunksFor = options.chunksFor ?? ((s) => loadSectionChunks(s));
    this.glossaryFor = options.glossaryFor ?? (() => []);
  }

  private chunks(section: Section): Chunk[] {
    if (!this.cache.has(section)) {
      const chunks = this.chunksFor(section);
      this.cache.set(section, chunks);
      const df = new Map<string, number>();
      for (const c of chunks) for (const g of bigrams(`${c.title} ${c.text}`)) df.set(g, (df.get(g) ?? 0) + 1);
      this.frequencies.set(section, df);
    }
    return this.cache.get(section)!;
  }

  /** 같은 섹션 안에서 질문과 가장 많이 겹치는 조각을 최대 5개. 겹치는 조각이 없으면 빈 배열(모델은 unverified로 답한다). */
  retrieve(section: Section, query: string, screen: Screen = {}): Retrieved[] {
    const q = bigrams(expandQuery(query, [...QUESTION_WORDS, ...this.glossaryFor(section)]));
    if (q.size === 0) return [];
    const chunks = this.chunks(section);
    const concepts = this.ranking === "idf" ? queryConcepts(section, query) : [];
    const df = this.frequencies.get(section)!;
    const weight = (g: string) => this.ranking === "idf" ? 1 + Math.log((chunks.length + 1) / ((df.get(g) ?? 0) + 1)) : 1;
    const total = [...q].reduce((sum, g) => sum + weight(g), 0);
    const share = (text: string) => {
      const c = bigrams(text);
      let hit = 0;
      for (const g of q) if (c.has(g)) hit += weight(g);
      return hit / total;
    };
    return chunks
      .map((chunk) => {
        // 제목(공개 자료는 자료 제목·주제 목록)은 같은 자료의 메모가 모두 공유하므로 본문보다 약하게 센다.
        const overlap = share(chunk.text) + TITLE_WEIGHT * share(chunk.title);
        const boost = overlap > 0 && screen.equipment_id && chunk.tags.includes(screen.equipment_id) ? SCREEN_BOOST : 0;
        const conceptBoost = overlap >= MIN_SCORE && concepts.some((id) => chunk.tags.includes(id)) ? 0.25 : 0;
        // 코크스와 전로를 견주는 조각(coke_vs_converter)은 비교를 물을 때만 쓸모 있어서, 그 밖에는 순위를 낮춘다.
        const contrastPenalty = chunk.tags.includes("coke_vs_converter") && !/불순물|전로|제강|제거|비교|다르|탄소/.test(query) ? 0.25 : 0;
        return { ...chunk, score: Math.round((overlap + boost + conceptBoost - contrastPenalty) * 1000) / 1000 };
      })
      .filter((r) => r.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, this.maxResults);
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
