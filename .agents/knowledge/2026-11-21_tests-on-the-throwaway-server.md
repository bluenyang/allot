---
id: 2026-11-21_tests-on-the-throwaway-server
kind: failure
status: active
supersedes: null
topics: [test, data, server]
decisions: [tests-on-the-throwaway-server]
symptoms: ["an E2E or API check edits, deletes or restores rows of the account that holds real data", "a test leaves keys, proposals or settings behind on the staging stack", "a test 'restores' real data in finally"]
applies_to: all
source: retro 0.1.4 (audit 0.1.4: intent 010 supplementary Q-2, W-12 F-2; history 2026-11-20)
approved: { by: user, at: 2026-11-21, words: "D9. 인용" }
updated: { by: user, at: 2026-11-22, words: "네가 제안한대로 수용.", source: "retro 0.1.5 (first audit 0.1.5 F-3; history 0.1.5: overlapping delegated runs, leftover rows from stopped runs)" }
---
## 결정
E2E, `tests/api/*`, 화면 확인처럼 데이터를 쓰는 검사는 버려도 되는 시험 서버 :15174(`allot-rc`, DB `allot_rc`)에서만 돌린다. :15173(`docker/compose.dev.yaml`)은 사용자가 실제 데이터로 보는 스테이징이라 거기에는 시험을 돌리지 않는다. 기존 데이터를 바꿔야 하는 시험은 시험 서버 안에서도 임시 계정을 만들어 그 계정에서만 한다(id를 받자마자 try/finally, id로 지우고 지워졌는지 확인).
## 이유
0.1.4에서 모든 E2E를 실제 데이터가 든 :15173에 돌렸고, 네 번 실제 데이터를 건드렸다: 영어 흐름 시험이 소유자의 나머지 대상을 지웠다 되돌림(A-30→A-32), 월급 분배 시험이 소유자의 마지막 구간을 닫았다 되돌림(A-41), 바로 저장 시험이 표시 설정을 바꿨다 되돌림(A-42에서 복원 확인 추가), 끊긴 실행이 E2E 키·제안과 올림 단위 50000을 남김(A-35, A-38). 되돌리기는 내용은 살렸지만 `seq`(삽입 순서)가 바뀌었고 실행 원본이 없어 감사에서 확인 불가가 됐다. 원인은 서버 역할을 거꾸로 안 것이다(사용자 정정 2026-11-20: "변경 > 15174 테스트 > 문제 없으면 배포 > 15174 내리고 15173에 적용").
## 적용
시험 서버는 한 번에 한 검사만 쓴다: PM이 한 담당에게만 서버를 맡기고 그 브리프에 적는다(0.1.5에서 W-7·W-8 담당의 E2E·MCP 검사가 두 번 겹쳐 로그인 제한과 거짓 실패를 냈다). 검사 전에 남은 시험 행을 지우고(0.1.5에서 멈춘 실행이 남긴 V8·E2E 행이 V-4를 세 번 거짓 실패시킴) 시험 계정에 가짜 데이터가 있는지 확인한다. 모든 검사 실행과 위임 브리프. 실행 전에 BASE가 :15174인지 확인한다. 시험 계정의 비밀번호는 비밀값 파일에서만 읽고(AGENTS.md 두 번째 예외) 출력하지 않는다.
## 바뀌면
시험 서버를 띄우고 지우고 가짜 데이터를 넣는 공용 스크립트(`scripts/test-server/`, 회고 0.1.5 R3)가 머지되면 그 스크립트가 BASE·정리·시드를 정한다.
