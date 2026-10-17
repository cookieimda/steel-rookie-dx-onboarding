// 시연 서버 실행(npm run start:gemini, 이슈 #143). 학습 답·채점·부가 설명·관리자 요약은 Gemini를 쓴다.
// - LLM_PROVIDER·PRIVATE_LLM_ONLY: .env에 로컬 모델 설정(LLM_PROVIDER=ollama, docs/llm-providers.md)이 남아 있어도 Gemini로 고정한다.
// - WARM_ANSWERS: 서버를 켤 때 추천 질문 답을 미리 받는 호출(유료)을 기본으로 끈다. 켜려면 WARM_ANSWERS=on.
// - QUESTION_POLISH: 시험 질문 말투 다듬기(유료 호출)를 기본으로 끄고 검수한 은행 원문을 그대로 묻는다. 켜려면 QUESTION_POLISH=on.
// - LLM_LOCAL_TASKS: 보충학습 확인 문제는 로컬 모델(Ollama)에 먼저 맡긴다(설정하지 않으면 practice). Ollama가 없으면 Gemini로 대체. 끄려면 off.
process.env.LLM_PROVIDER = 'gemini';
process.env.PRIVATE_LLM_ONLY = '0';
process.env.WARM_ANSWERS ??= 'off';
process.env.QUESTION_POLISH ??= 'off';
process.env.LLM_LOCAL_TASKS ??= 'practice';
const warm = process.env.WARM_ANSWERS.trim().toLowerCase() !== 'off';
console.log(`Gemini 시연 모드: 모델 ${process.env.GEMINI_MODEL || '기본값(llm/src/gemini.ts)'} · 추천 질문 미리 받기 ${warm ? '켬' : '끔'} · 로컬 모델에 먼저 맡김 ${process.env.LLM_LOCAL_TASKS || 'off'}`);
await import('../.build/backend/src/ironmaking-server.js');
