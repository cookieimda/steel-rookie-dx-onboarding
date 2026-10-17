// 시연 서버 실행(npm run start:gemini, 이슈 #143). 학습·평가·관리자 요약 모두 Gemini를 쓴다.
// - LLM_PROVIDER·PRIVATE_LLM_ONLY: .env에 로컬 모델 설정(LLM_PROVIDER=ollama, docs/llm-providers.md)이 남아 있어도 Gemini로 고정한다.
// - WARM_ANSWERS: 서버를 켤 때 추천 질문 답을 미리 받는 호출(유료)을 기본으로 끈다. 켜려면 WARM_ANSWERS=on.
// - QUESTION_POLISH: 시험 질문 말투 다듬기(유료 호출)를 기본으로 끄고 검수한 질문 은행 원문을 그대로 묻는다. 켜려면 QUESTION_POLISH=on.
process.env.LLM_PROVIDER = 'gemini';
process.env.PRIVATE_LLM_ONLY = '0';
process.env.WARM_ANSWERS ??= 'off';
process.env.QUESTION_POLISH ??= 'off';
const warm = process.env.WARM_ANSWERS.trim().toLowerCase() !== 'off';
console.log(`Gemini 시연 모드: 모델 ${process.env.GEMINI_MODEL || '기본값(llm/src/gemini.ts)'} · 추천 질문 미리 받기 ${warm ? '켬' : '끔'}`);
await import('../.build/backend/src/ironmaking-server.js');
