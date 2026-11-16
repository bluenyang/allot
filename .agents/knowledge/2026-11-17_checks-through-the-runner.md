---
id: 2026-11-17_checks-through-the-runner
kind: failure
status: active
supersedes: 2026-11-16_check-output-not-through-pipes
topics: [test, evidence, audit, shell]
decisions: [check-exit-from-the-script-itself, checks-through-the-runner]
symptoms: ["a check piped into tail or grep logs exit 0 while the script failed", "review: 'the log claims more than it shows'", "pipefail on, yet a failure on the left is hidden by grep's 1 on the right", "audit: a step log without command, rev or exit code", "audit: a helper search through '| grep' / '| tail' in a server log"]
applies_to: all
source: retro 0.1.2 (audit 0.1.2 A-2, supplement B-4; rc.1 test server log; reviews 17–19); retro 0.1.3 (first audit F-2, F-3; second audit R-1: rc1-server-15174*.log, stable-server.log)
approved: { by: user, at: 2026-11-17, words: "k3. 수용" }
---
## 결정
검사 로그를 남기는 실행은 모두 공용 실행기로 돌린다(`scripts/check-run.sh`, 로그 검사 `pnpm check:logs` — PR #24: 단계마다 rev, `$ 명령`, 전체 출력, `exit=<코드>`; 출력은 리디렉션으로만 받고 파이프 없음; 첫 실패에서 멈춤; 정리 단계는 trap에서 따로 기록). 보조 확인(포트, 로그 안의 비밀값·WARNING 검색)도 실행기의 한 단계로 둔다. 손으로 짠 스크립트에서 `| tail`, `| grep`, `| sed` 뒤의 종료 코드를 읽지 않는다. "없어야 하는" 검사는 grep이 파일을 직접 읽고, 1을 통과로 바꾸는 단계를 따로 둔다.
## 이유
0.1.2에서 같은 일이 네 번 있었고(파이프가 실패를 가림, 로그보다 넓은 주장), 규칙을 적은 뒤에도 0.1.3에서 반복됐다: 명령·rev·종료 코드가 빠진 단계 로그(F-2, 다시 검사함), 실패 뒤 계속 돈 스크립트(F-3), 테스트 서버 로그의 `| tail`·`| grep` 보조 확인(R-1). 규칙만으로는 지켜지지 않았고, 실행기로 돌린 F-2 재검사와 테스트 서버 실행에서만 증거가 온전했다.
## 적용
V-n, 보완 재검사, 릴리스 뒤 테스트 서버, 감사 전 자료 모으기. 위임할 때도 같은 지시를 준다. 로그는 `pnpm check:logs`가 통과해야 증거다(AGENTS.md Conventions). 결정 [[2026-11-12_check-evidence-command-rev-exit]], [[2026-11-16_stop-at-first-failure]]를 지키는 방법이다.
## 바뀌면
검사 실행이 CI로 옮겨 가면 CI 기록이 같은 역할을 한다.
