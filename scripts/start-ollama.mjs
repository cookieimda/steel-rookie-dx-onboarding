// 로컬 모델 서버 실행(npm run start:ollama). 학습·평가·보충학습·시험·관리자 요약 모두 Ollama를 쓴다(docs/llm-providers.md).
// - PRIVATE_LLM_ONLY=1: 외부 API(Gemini)를 부르지 않는다. .env의 GEMINI_API_KEY는 그대로 둬도 쓰이지 않는다.
// - 모델을 먼저 메모리에 올려 첫 질문이 모델 로딩(수십 초)을 기다리지 않게 한다. Ollama가 꺼져 있거나 모델이 없으면 안내하고 멈춘다.
// - WARM_ANSWERS: 추천 질문 답 미리 받기는 CPU를 오래 써서 기본으로 끈다(서버가 ollama면 on일 때만 받는다).
process.env.LLM_PROVIDER = 'ollama';
process.env.PRIVATE_LLM_ONLY = '1';
const { OllamaClient, ollamaSettings } = await import('../.build/llm/src/ollama.js');
const { baseUrl, model } = ollamaSettings();
const client = new OllamaClient();
const { connected, reason } = await client.checkConnection();
if (!connected) {
  console.error(reason === 'model_missing'
    ? `Ollama에 ${model} 모델이 없습니다. 먼저 'ollama pull ${model}'을 실행하세요.`
    : `Ollama(${baseUrl})에 연결하지 못했습니다. Ollama를 켠 뒤 다시 실행하세요.`);
  process.exit(1);
}
console.log(`Ollama 모드: ${model} (${baseUrl}) · 모델 올리는 중…`);
const started = Date.now();
await client.warmUp();
console.log(`모델 준비 ${Math.round((Date.now() - started) / 1000)}초. 웹 서버를 시작합니다.`);
await import('../.build/backend/src/ironmaking-server.js');
