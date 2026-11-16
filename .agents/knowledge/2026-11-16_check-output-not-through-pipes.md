---
id: 2026-11-16_check-output-not-through-pipes
kind: failure
status: active
supersedes: null
topics: [test, evidence, audit, shell]
decisions: [check-exit-from-the-script-itself]
symptoms: ["a check piped into tail or grep logs exit 0 while the script failed", "review: 'the log claims more than it shows'", "pipefail on, yet a failure on the left is hidden by grep's 1 on the right"]
applies_to: all
source: retro 0.1.2 (audit 0.1.2 A-2, supplement B-4; rc.1 test server log; reviews 17–19)
approved: { by: user, at: 2026-11-16, words: "1~5, 8, 9 승격 허가 함." }
---
## 결정
검사 결과를 파이프(`| tail`, `| grep`, `| sed`)로 거른 뒤에 종료 코드를 읽지 않는다. 출력은 파일로 받고, 종료 코드는 검사 스크립트 자신의 것(`cmd > out.txt 2>&1; rc=$?`)을 쓴 다음 파일을 읽는다. "없어야 하는" 검사(grep의 1이 통과인 경우)는 만드는 단계를 따로 검사하고 grep이 파일을 직접 읽게 한다.
## 이유
0.1.2에서 같은 일이 네 번 있었다. rc.1 테스트 서버에서 `node crud.mjs create | tail -2`가 tail의 0을 남겨, 4건 실패 뒤에도 실행이 이어졌다. 보완 로그는 명령 대신 설명을 적거나 파이프 앞 단계의 실패를 볼 수 없어 리뷰 17·18·19에서 "로그보다 넓은 주장"으로 지적됐다. `pipefail`을 켜도 오른쪽 grep이 "일치 없음"(1)을 내면 왼쪽의 실패 코드가 가려진다(리뷰 19 재현).
## 적용
검사 로그를 남기는 모든 실행(V-n, 보완, 릴리스 뒤 테스트 서버). 단계마다 `$ 명령`, 출력, `exit: <스크립트의 코드>`를 남긴다. 긴 `node -e`는 스크립트 파일로 두고 로그에는 그 파일을 실행한 명령을 적는다. 결정 [[2026-11-12_check-evidence-command-rev-exit]]를 지키는 방법이다.
## 바뀌면
검사 실행이 공용 스크립트(로드맵 로컬 후보)나 CI로 옮겨 가면, 그 스크립트가 이 규칙을 대신 지킨다.
