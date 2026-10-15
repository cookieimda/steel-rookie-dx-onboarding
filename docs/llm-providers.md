# LLM provider: Gemini와 Ollama

튜터(학습·체크포인트·보충학습·평가 시험)와 평가자, 관리자 AI 요약은 하나의 LLM 클라이언트를 같이 쓴다. `LLM_PROVIDER`로 Gemini(기본)와 로컬 모델(Ollama)을 고른다. 에이전트 코드는 `LlmClient` 계약(`llm/src/llm-client.ts`)만 알고 provider를 모른다. [agent-roadmap.md](agent-roadmap.md) Stage 4(Mads-Serve: 모델 비교)의 기반이다.

## 실행

| 명령 | provider | 비고 |
|---|---|---|
| `npm start` | `.env`의 `LLM_PROVIDER`(없으면 gemini) | |
| `npm run start:gemini` | gemini 고정 | 시연용. 추천 질문 미리 받기(유료) 기본 끔 |
| `npm run start:ollama` | ollama 고정, `PRIVATE_LLM_ONLY=1` | Ollama 연결·모델을 확인하고 모델을 메모리에 올린 뒤 서버를 켠다 |

Ollama 준비: [Ollama](https://ollama.com) 설치 → `ollama pull qwen2.5:3b` → `npm run start:ollama`. 설정은 `.env.example`의 `OLLAMA_*`.

- `PRIVATE_LLM_ONLY=1`이면 Gemini를 쓰지 않는다. `LLM_PROVIDER=gemini`와 함께 쓰면 서버가 시작하지 않는다(학습자 답이 밖으로 나가지 않게).
- `/api/status`는 지금 provider와 모델, Ollama면 연결 상태(`ready`·`model_missing`·`unreachable`)를 돌려준다.
- 사용자별 하루 호출 한도(`LLM_DAILY_LIMIT`)는 provider와 상관없이 센다.

## 코드

| 파일 | 역할 |
|---|---|
| `llm/src/provider.ts` | `configuredProvider`, `providerInfo`(label `provider:모델`), `createLlmClient`, `profileFor` |
| `llm/src/ollama.ts` | Ollama `/api/chat` 클라이언트. `responseSchema`를 JSON Schema(`json-schema.ts`)로 바꿔 `format`에 넣고, 스트리밍(NDJSON), 연결 확인, 미리 올리기 |
| `llm/src/gemini.ts` | Gemini 클라이언트 |
| `llm/src/learning-context.ts`, `llm/prompts/learning-compact.md` | 로컬 모델용 학습 튜터 입력 줄이기·짧은 프롬프트 |
| `llm/src/evaluator.ts` | 채점 보강 `repairFormat`·`verifyBoundary`(`llm/prompts/evaluator-keypoints.md`) |

- 오류는 provider와 상관없이 `GeminiCallError`(reason: `timeout`·`network`·`http`·`rate_limit`)로 올라와 재시도·오류 응답을 같이 탄다. Ollama 오류에서 Gemini로 넘어가지 않는다.
- 응답 형식 검증(source id·개념 id·화면 조작·키워드 카드)은 provider와 상관없이 서버가 한다.
- 요청 trace(`docs/agent-observability.md`)는 호출마다 `gemini:모델`·`ollama:모델`을 남겨 `npm run trace:report`가 모델별로 나눠 보여 준다.
- 학습 답 저장(`answer-cache.ts`)은 버전에 provider·모델·프롬프트가 들어가 Gemini 답과 로컬 모델 답이 섞이지 않는다.

## provider별 설정 (`profileFor`)

| | Gemini | Ollama |
|---|---|---|
| 학습 튜터 프롬프트 | `learning-system.md`(full) | `learning-compact.md`(compact) |
| 학습 튜터 입력 | 그대로 | 근거 조각 3개·2,200자, 최근 대화 2턴, 메모 3개, 관련 설비만 |
| 학습 튜터 출력 상한 | 1,200토큰 | 450토큰, 형식 오류로 다시 부를 때 temperature 0 |
| 채점 보강 | 끔 | `repairFormat`(어긋난 판정 필드를 규칙대로 보정) + `verifyBoundary`(wrong·partial이면 핵심 요소별로 다시 물어 한 단계만 올림) |
| 추천 질문 미리 받기 | 켬(`start:gemini`는 끔) | 끔(`WARM_ANSWERS=on`이면 켬) |

compact를 쓰는 이유: 3B 모델을 CPU로 돌리면 입력 길이가 곧 지연이고, 긴 프롬프트에서 JSON 형식이 자주 깨진다. 근거 조각은 자르지 않고 개수만 줄인다(잘린 근거를 인용하지 않게). 형식 검증도 줄인 입력 기준이라, 보내지 않은 조각을 인용하면 버린다.

## 평가 (같은 세트로 provider 비교)

`eval:evaluator`, `eval:learning`, `eval:supplement`, `eval:questions`는 `LLM_PROVIDER`를 따른다. Ollama 결과는 `llm/eval/results/{이름}-ollama.jsonl`에 따로 쌓여 Gemini 기록과 섞이지 않는다. 로컬 모델은 케이스 사이 대기가 없다.

```
LLM_PROVIDER=ollama npm run eval:evaluator -- --set smoke   # 채점 보강 켬, --no-guards로 끄고 비교
LLM_PROVIDER=ollama npm run eval:learning -- --section ironmaking
LLM_PROVIDER=ollama npm run eval:supplement
```

`eval:learning` 보고서에는 답 시간(p50·p95)과 근거 겹침이 붙는다.

### 측정 기록

2026-10-15, 노트북 CPU(GPU 없음), Ollama `qwen2.5:3b`(Q4_K_M), 각 1회. Gemini는 유료 평가를 하지 않기로 해서 저장해 둔 예전 기록과 비교한다.

| 평가 | Ollama qwen2.5:3b | Gemini flash-lite(예전 기록) |
|---|---|---|
| 채점 smoke(29) | 21/29 (72.4%), 형식 오류 0, 채점 보강 켬 | 거의 100%(회귀용 세트) |
| 채점 hard(18) | 9/18 (50.0%). 오류 대부분 correct→partial(9개 중 7개) | - |
| 학습 답변 제선(55, 추천 질문 22 포함) | 전체 통과 44/55 (80.0%): 근거 판정 96.4%, 화면 조작 11/17, 오개념 감지 53/55 | 2026-10-06 같은 세트 51/51 |
| 학습 답 시간 | p50 35.1초, p95 153.8초 | 호출당 2~5초(혼잡하면 15~33초) |
| 답변 사실(facts·must_not, 11문항, 저장한 답 다시 채점) | 10/11 | 9/11(10/13 기록) |

로컬 3B 모델의 약점(학습 답변):

- 근거 없는 질문(고로 건설비·신입 연봉)에 모른다고 하지 않고 지어서 grounded로 답했다(unverified 0/2).
- 학습자가 오개념을 단정한 질문 2개(코크스·소결)를 둘 다 오개념으로 기록하지 못했다. 코크스 질문에는 "코크스가 불순물을 줄인다"는 틀린 문장이 섞였다.
- 이미 보고 있는 설비를 가리키는 질문("이 설비는?")에 엉뚱한 설비를 보여 줬다(0/2). 다른 공정 이동(0/2)도 못 했다.
- 추천 질문 하나는 중국어로 답했다.
- 작동 보기(`show_operation`)를 화면 목록에 표시하자 역할 질문에 작동 보기를, 작동 질문에 focus를 골랐다(7문항 1/7). 그래서 compact에서는 표시하지 않고, 작동 과정을 묻는 질문이면 서버가 작동 보기를 붙인다(`operationTarget`). 고친 뒤 같은 7문항 4/7(작동 2/2, 역할 2/2 회복, 남은 3개는 원래 틀리던 문항).

정리: 시연은 Gemini, Ollama는 비용 없는 개발·반복 측정과 외부 전송이 안 되는 환경용이다. 품질을 올리려면 더 큰 모델(qwen2.5:7b 등)을 같은 세트로 비교해야 한다(CPU에서는 더 느려진다).

## 하지 않은 것

- vLLM(OpenAI 호환 서버): 이전 브랜치(#126)에 있었지만 GPU가 없어 이번에는 넣지 않았다.
- 요청마다 provider를 바꾸는 것(예: 채점은 Gemini, 학습은 Ollama): 지금은 서버 전체가 한 provider다.
