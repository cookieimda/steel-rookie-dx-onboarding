# 설비 id (최종 페이지 v2 기준)

설비 `id`는 화면 선택, 튜터 화면 조작(`scene_actions`의 `target_id`), 3D 앵커, 콘텐츠를 잇는 키다. 바꾸지 않는다.

- 기준 파일: `frontend/3d-demo/data_v2.js`의 `PROCESSES[].equipment[].id` (공정 4개, 설비 24개). 최종 페이지 `Steel Academy v2.dc.html`이 쓴다.
- v1(`data.js`, 설비 16개)은 `Steel Academy.dc.html`(옛 페이지)용이다. v1의 id 16개는 v2에 모두 같은 id로 있고, v2에 8개가 새로 생겼다. 없어진 id는 없다.
- 3D 위치: v2 화면(`scene_v2.js`)은 `models/anchors-v2b.json`의 앵커로 설비를 찾는다. 현재 GLB 4개에는 `EQ_<설비 id>` 노드가 없다(`models/README.md`의 노드 규칙은 아직 적용되지 않음).
- 루브릭(`content/rubrics/final/`)과 `docs/learning-mode.md`에는 설비 id가 없다. 루브릭은 개념 id(`concept_id`)만 쓴다. 개념 ↔ 설비 연결(재학습 시 3D 하이라이트에 필요)은 루브릭 스키마에 개념별 `equipment_ids`를 추가하는 방향으로 정했다(팀원C 담당, CLAUDE.md '다음 단계').

| 공정 | v2 순서 | id | v2 이름 | v1(`data.js`) 이름 | v1 순서 | v2 앵커 |
|---|---|---|---|---|---|---|
| 제선 | 1 | `sinter_plant` | 소결기 | 소결 설비 | 1 | 있음 |
| 제선 | 2 | `coke_oven` | 코크스 오븐 | 같음 | 2 | 있음 |
| 제선 | 3 | `blast_furnace` | 고로·장입 장치 | 고로 | 4 | 있음 |
| 제선 | 4 | `hot_stove` | 열풍로·풍구 | 열풍로 | 3 | 있음 |
| 제선 | 5 | `taphole_casthouse` | 출선구·주상 | **없음(v2 신규)** | - | 있음 |
| 제선 | 6 | `torpedo_car` | 토페도카 | **없음(v2 신규)** | - | 있음 |
| 제강 | 1 | `hot_metal_pretreatment` | 용선 예비처리 | 같음 | 1 | 있음 |
| 제강 | 2 | `bof_converter` | 전로 (BOF·LD) | 전로 | 2 | 있음 |
| 제강 | 3 | `oxygen_lance_offgas` | 산소 랜스·배가스 설비 | **없음(v2 신규)** | - | **없음** |
| 제강 | 4 | `tapping_ladle_crane` | 출강 래들·크레인 | **없음(v2 신규)** | - | **없음** |
| 제강 | 5 | `secondary_refining` | 2차 정련 (LF·RH) | 2차 정련 | 3 | 있음 |
| 제강 | 6 | `ladle_transfer` | 래들 이송 | **없음(v2 신규)** | - | **없음** |
| 연주 | 1 | `ladle_turret` | 래들 터릿 | **없음(v2 신규)** | - | 있음 |
| 연주 | 2 | `tundish` | 턴디시 | 같음 | 1 | 있음 |
| 연주 | 3 | `cc_mold` | 주형·진동 장치 | 주형 | 2 | 있음 |
| 연주 | 4 | `secondary_cooling` | 2차 냉각·가이드 롤 | 2차 냉각대 | 3 | 있음 |
| 연주 | 5 | `withdrawal_straightener` | 인발·교정 롤 | **없음(v2 신규)** | - | 있음 |
| 연주 | 6 | `torch_cutter` | 절단기·배출 롤러 | 절단기 | 4 | 있음 |
| 열간압연 | 1 | `reheating_furnace` | 재가열로 | 가열로 | 1 | 있음 |
| 열간압연 | 2 | `descaler` | 스케일 제거기 | **없음(v2 신규)** | - | 있음 |
| 열간압연 | 3 | `roughing_mill` | 조압연기 | 같음 | 2 | 있음 |
| 열간압연 | 4 | `finishing_mill` | 사상압연기 | 같음 | 3 | 있음 |
| 열간압연 | 5 | `runout_table` | 런아웃 테이블·냉각 | 런아웃 테이블 | 4 | 있음 |
| 열간압연 | 6 | `coiler` | 권취기 | 같음 | 5 | 있음 |

차이 요약

- 순서가 실제로 바뀐 곳: 제선의 `blast_furnace`(고로)와 `hot_stove`(열풍로). v1은 열풍로 → 고로, v2는 고로 → 열풍로. 나머지 순서 차이는 새 설비가 끼어든 결과다.
- 이름이 바뀐 설비가 있다(예: 고로 → 고로·장입 장치). 튜터 답변이나 콘텐츠에서 설비를 가리킬 때는 이름이 아니라 id를 쓴다.
- 제강의 새 설비 3개(`oxygen_lance_offgas`, `tapping_ladle_crane`, `ladle_transfer`)는 `anchors-v2b.json`에 앵커가 없다([#16](https://github.com/steel-rookie/ST-ROOKIE/issues/16)). 이 설비로 `focus`·`highlight`가 되는지는 3D 담당과 확인한다.
- 추천 질문(`SUGGESTED`)은 v1·v2가 같다.
