---
id: 2026-11-22_baseline-before-first-upgrade
kind: decision
status: active
supersedes: null
topics: [test, migration, server]
decisions: [baseline-before-first-upgrade]
symptoms: ["the upgrade check has no 'before' values", "the test server was rebuilt on the branch before the old state was recorded"]
applies_to: all
source: retro 0.1.5 (spec 011 V-5, A-43; first audit 0.1.5 F-5; .loctx/history/0.1.5.md 2026-11-21)
approved: { by: user, at: 2026-11-22, words: "네가 제안한대로 수용." }
---
## 결정
마이그레이션이 있는 버전은 시험 서버(:15174)를 그 브랜치 이미지로 처음 올리기 전에, 업그레이드 검사의 "올리기 전" 값부터 남긴다: 지난 릴리스 이미지가 도는 상태에서 행 수와 서버 계산값(예: MCP `get_allocation`·`get_overview`)을 파일로 받고, 필요하면 DB를 덤프해 둔다. 그 뒤에 브랜치 이미지를 올린다.
## 이유
0.1.5에서 W-2 검사를 위해 시험 서버를 브랜치 이미지로 다시 띄우면서 마이그레이션이 먼저 적용됐고, V-5의 "올리기 전" 값이 없어졌다. 사본 DB를 0.1.4 스키마로 되돌리는 대체 검사로 메웠지만 spec 문구와 달랐고 기록이 늦어 감사 F-5가 됐다.
## 적용
spec에 업그레이드·마이그레이션 검사가 있는 모든 버전. 구현 첫 서버 검사 전에 PM이 한다.
## 바뀌면
시험 서버 스크립트(`scripts/test-server/`)가 기준값 저장을 단계로 갖게 되면 그 단계를 쓴다.
