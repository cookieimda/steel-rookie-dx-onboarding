// 학습 랩 카드 묶음: 설비 24개를 카드 한 장씩으로. 간격 반복(앞면 질문 → 뒷면 확인)과 소크라테스 모드의 목표가 같은 내용을 쓴다.
// 뒷면은 학습 화면의 설비 설명(data_v2.js의 role, 프론트 파일이라 읽기만 함)과 그 설비 공개 자료 메모(retrieval의 loadSectionChunks) 한 조각이다.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadSectionChunks, type Chunk } from "../../../llm/src/retrieval.js";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";

export interface DeckCard {
  /** 'eq:<설비 id>' */
  card_id: string;
  section: Section;
  section_name: string;
  equipment_id: string;
  equipment_name: string;
  /** 학습 화면 설명(한두 문장). */
  role: string;
  /** 공개 자료 메모(없으면 null). */
  memo: { title: string; text: string } | null;
}

export const DATA_V2_PATH = join(process.cwd(), "frontend", "3d-demo", "data_v2.js");

type RawProcess = { id: string; name: string; equipment: { id: string; name: string; role?: string }[] };

const bigrams = (text: string) => {
  const out = new Set<string>();
  for (const w of text.normalize("NFC").toLowerCase().split(/[^\p{L}\p{N}]+/u)) for (let i = 0; i + 1 < w.length; i++) out.add(w.slice(i, i + 2));
  return out;
};

/** 설비 id가 태그에 있는 조각 중 화면 설명(role)·설비 이름과 가장 많이 겹치는 것. 같으면 태그가 적은(그 설비에 가까운) 것. */
export function memoFor(chunks: readonly Chunk[], equipmentId: string, about = ""): Chunk | null {
  const want = bigrams(about);
  const score = (c: Chunk) => { const got = bigrams(`${c.title} ${c.text}`); let n = 0; for (const b of want) if (got.has(b)) n++; return n; };
  return chunks.filter((c) => c.tags.includes(equipmentId))
    .map((c) => ({ c, s: score(c) }))
    .sort((a, b) => b.s - a.s || a.c.tags.length - b.c.tags.length || a.c.id.localeCompare(b.c.id))[0]?.c ?? null;
}

export function buildDeck(processes: readonly RawProcess[], chunksFor: (s: Section) => Chunk[]): DeckCard[] {
  return processes
    .filter((p): p is RawProcess & { id: Section } => (SECTION_ORDER as readonly string[]).includes(p.id))
    .flatMap((p) => {
      const chunks = chunksFor(p.id);
      return p.equipment.map((e) => {
        const m = memoFor(chunks, e.id, `${e.name} ${e.role ?? ""}`);
        return { card_id: `eq:${e.id}`, section: p.id, section_name: p.name, equipment_id: e.id, equipment_name: e.name,
          role: e.role?.trim() || `${e.name}의 역할`, memo: m ? { title: m.title, text: m.text } : null };
      });
    });
}

/** 서버 시작 때 한 번 읽는다. 못 읽으면 빈 묶음으로 두고 경고만 남긴다(학습 랩의 카드 기능만 빈다). */
export async function loadDeck(path = DATA_V2_PATH): Promise<DeckCard[]> {
  try {
    const { PROCESSES } = (await import(pathToFileURL(path).href)) as { PROCESSES: RawProcess[] };
    return buildDeck(PROCESSES, (s) => loadSectionChunks(s));
  } catch (e) {
    console.warn(`학습 랩 카드(data_v2.js)를 읽지 못했습니다: ${(e as Error).message}`);
    return [];
  }
}
