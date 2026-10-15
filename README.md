# 제선 공정 질문형 교육 MVP

포스코 공개 공식 자료에 근거해 신입사원의 제선 기초 질문에 한국어로 답하는 단일 화면입니다. 고로와 FINEX 경로를 구분하며, 출처 링크를 함께 표시합니다.

실행과 자료 범위는 [README-ko.txt](README-ko.txt)를 참고하세요.

```powershell
npm.cmd ci
# .env 파일의 GEMINI_API_KEY= 뒤에 본인의 키 입력
npm.cmd start
```

시연 서버는 `npm.cmd run start:gemini`로 켭니다. Gemini로 고정하고, 서버를 켤 때 추천 질문 답을 미리 받는 유료 호출을 끕니다(켜려면 `WARM_ANSWERS=on`). 기존 기록을 이어 쓰려면 `DB_PATH`에 그 SQLite 파일을, 포트는 `PORT`를 지정합니다(`$env:PORT=3001; $env:DB_PATH="data/demo.sqlite"; npm.cmd run start:gemini`).

브라우저에서 <http://localhost:3000>을 엽니다. `.env`는 서버 시작 시 읽으며 Git에서 제외됩니다. Gemini API 키가 없으면 미연결 상태를 표시하고 답변을 생성하지 않습니다.

공개 공식 자료 목록: [backend/data/ironmaking-sources.json](backend/data/ironmaking-sources.json). 기존 3D 데모는 이 화면과 연결되지 않습니다.
