# 평가자 정확도 평가 세트

`npm run eval:evaluator -- --set smoke|hard`로 실제 Gemini 평가자를 돌려 기대 판정과 비교한다. 비용과 요청 제한 때문에 `npm test`에는 넣지 않는다(파일 형식 검사만 `backend/test/eval-set.test.ts`에서 한다).

| 세트 | 용도 |
|---|---|
| `smoke/` | **회귀 테스트용.** 루브릭 표현을 그대로 따른 쉬운 케이스. 프롬프트·루브릭을 바꾼 뒤 깨진 곳이 없는지 확인한다. 거의 100%가 나와야 정상이고, 평가자 품질의 근거로 쓰지 않는다. |
| `hard/` | **품질 평가용.** 키워드 없는 정답, 오개념 혼합, 오탈자·구어체·영어, 다른 개념 혼동, 은근한 인젝션, 같은 뜻 답변 쌍, 루브릭에 없지만 사실인 내용(사실 오류 규칙의 오탐 확인). 사람이 쓴 답변(`source: "human"`)도 여기에 넣는다. |

## 파일

- 세트 폴더 안의 `{섹션}.jsonl`과 `{섹션}.{아무 이름}.jsonl`(예: `ironmaking.human.jsonl`)을 모두 읽는다.
- 한 줄에 케이스 하나.

| 필드 | 필수 | 설명 |
|---|---|---|
| `concept_id` | ✓ | 루브릭의 개념 id |
| `phase` | ✓ | `initial` 또는 `recheck`(재확인에는 `assisted`가 없다) |
| `question`, `answer` | ✓ | 질문과 학습자 답변 |
| `expected_verdict` | ✓ | 사람이 루브릭으로 정한 기대 판정 |
| `source` | ✓ | `synthetic`(작성한 케이스) 또는 `human`(실제 사람 답변). 결과를 따로 집계한다 |
| `type` | | 케이스 유형(`paraphrase`, `mixed`, `noisy`, `confusion`, `injection`, `pair`, `out_of_rubric_fact`) |
| `pair_id` | | 같은 뜻 답변 쌍. 같은 값끼리 판정이 같은지 본다 |
| `question_id` | | 사람 답변 수집 질문 id(`hard/human-collection.md`) |
| `respondent` | | 익명 응답자(`p01`…). 내보내기 스크립트가 붙인다 |
| `case_id` | | 내보낸 사람 답변의 id. 모델 판정 파일과 맞춰 볼 때 쓴다 |
| `note` | | 기대 판정의 근거나 애매한 점 |

## 튜터 질문 표본

`npm run eval:questions -- --polish-count 3 --out questions.md`

- 질문 은행이 있는 개념: 은행 질문(첫 질문·재확인)마다 말투 다듬기를 `--polish-count`(기본 3)회 돌려, 원문 유출, 다듬은 결과와 그 유출(완화·엄격 4글자), 실제로 쓴 문장(다듬은 문장, 또는 유출로 원문)을 표로 적는다. '의미 변경' 열(다듬으면서 묻는 내용이 바뀌었는지)은 사람이 채운다.
- 은행이 빈 개념(대체 경로): 개념마다 LLM 질문을 `--count`(기본 10)개 만들어 처리(통과·재생성·대체)를 적는다. 유출 검사에 걸린 질문은 시도별 문장과 걸린 표현(정답 용어, 근거 문장 구)을 따로 표로 적는다. '범위 초과' 열(핵심 요소만으로 답할 수 없는 질문인지)은 사람이 채운다.

## 학습 모드 근거 검색

`npm run eval:retrieval [-- --public-only] [--ranking overlap] [--max-results 5]`

- 모델을 부르지 않는다(비용 없음). 세트는 `retrieval/ironmaking.jsonl`: 질문(`query`), 화면 설비(`screen`, 선택), 답이 있는 공개 자료 id(`expected_source_ids`, 빈 배열이면 검색 결과가 없어야 맞음).
- 출력: Recall@N(기대 출처가 상위 N개에 하나라도 있는 케이스 비율), MRR(첫 기대 출처 순위의 역수 평균), 놓친 케이스. 서버와 같이 루브릭 용어집으로 검색어를 넓힌다.
- `--public-only`는 section.md 없이 공개 자료 메모만, `--ranking overlap`은 예전 방식(겹친 두 글자 수)으로 잰다. 검색을 바꾸면 세 가지를 같이 비교한다.
- 검색 결과만 보는 평가다. 답이 맞는지는 `eval:learning`과 사람 검수로 따로 본다.

## 긴 실행: 결과 기록, 이어 하기, 연결 재시도

두 스크립트(`eval:evaluator`, `eval:questions`) 공통.

- 절전에 들어가면 호출이 시간 초과로 끊긴다. macOS에서는 `caffeinate -i npm run eval:evaluator -- --set hard`처럼 실행한다.
- 케이스(질문 표본은 질문 1개)마다 결과를 JSONL로 바로 덧붙인다. 기본 파일은 `results/evaluator-{set}.jsonl`, `results/questions.jsonl`(Git 제외), `--records 파일.jsonl`로 바꾼다.
- `--resume`: 같은 설정으로 이미 끝난 케이스를 건너뛰고 나머지만 실행한다. 보고서는 파일의 기록 전체로 만든다.
  - 같은 설정 = 모델, 프롬프트(평가자는 루브릭·용어집이 들어간 프롬프트 전체와 질문·답변, 질문 표본은 튜터 프롬프트 파일·개념 루브릭·용어집)가 같음. 바뀐 케이스는 다시 실행한다.
  - `--resume` 없이 결과 파일이 이미 있으면 덮어쓰지 않고 멈춘다. 처음부터 하려면 파일을 지운다.
- 429·시간 초과·연결 실패(fetch failed 등)는 `EVAL_RETRY_BASE_MS`(기본 10000ms)부터 2배씩(10초, 20초, 40초) 최대 3회 다시 호출한다. 다른 HTTP 오류(400 등)는 다시 호출하지 않는다.
- 그래도 실패하면 `infra_error`로 기록한다. 평가자 형식 오류(`format_error`, 질문 표본은 빈 응답)와 따로 세고, 일치율·처리 비율에서 빼되 개수는 보여 준다. `--resume` 때 다시 실행된다.
- `infra_error`가 연속 3케이스면 멈춘다(일일 한도 소진, 키 오류 등). 원인을 확인한 뒤 `--resume`으로 이어서 실행한다.
- 진행 표시: `.` 일치(질문 표본은 통과·다듬은 문장 사용), `x` 불일치, `o` 다듬은 문장이 유출되어 원문 사용, `r` 재생성, `F` 대체 질문, `?` 빈 응답, `E` 연결 오류, `-` 이전 기록 사용.

## 사람 답변 모으기

1. 팀원 테스트([docs/team-test.md](../../docs/team-test.md))로 각자의 `data/st-rookie.sqlite`를 받는다.
2. `npm run eval:export-human -- --db team-a.sqlite --db team-b.sqlite`
   - 체크포인트의 첫 판정(initial) 답변만 꺼낸다. 재확인 답변은 설명을 들은 뒤라 빼고, 질문은 튜터가 만든 질문 그대로다.
   - 출력: `hard/pending/ironmaking.human.jsonl`(`expected_verdict` 빈칸, `source: "human"`)과 `hard/pending/ironmaking.human.model-verdicts.jsonl`(당시 모델 판정, `case_id`로 연결). `pending/`은 Git에서 제외한다.
   - 사용자 id는 DB·사용자별로 `p01`, `p02`…로 바꾼다. 이미 파일이 있으면 덮어쓰지 않는다(`--force`로 덮어쓰기).
3. 모델 판정 파일을 보지 않고 `expected_verdict`를 채운다(블라인드 판정).
4. 채운 파일을 `hard/ironmaking.human.jsonl`로 옮긴 뒤 모델 판정 파일과 비교하거나 `--set hard`로 다시 채점한다.

## 출력

- 일치율: 전체, 단계별, source별, 유형별
- 혼동 표: source별
- 평가자 형식 오류(`format_error`, 일치율에 포함)와 연결 오류(`infra_error`, 일치율에서 제외) 개수
- 평가자 형식 재시도: 케이스별 횟수와 전체 비율
- 연결 재시도 횟수와 연결 오류 케이스 목록
- 같은 뜻 쌍 일치율과 판정이 갈린 쌍
- 틀린 케이스 목록
