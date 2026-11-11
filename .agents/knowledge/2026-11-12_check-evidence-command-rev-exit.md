---
id: 2026-11-12_check-evidence-command-rev-exit
kind: decision
status: active
supersedes: null
topics: [test, evidence, audit]
decisions: [check-needs-command-rev-exit]
symptoms: ["audit: pass verdict without an exit code", "a test log without the command or the revision it ran on"]
applies_to: all
source: retro 0.1.1 (audits 0.1.0 A-5, 0.1.0-rc3 A-4, 0.1.0-stable A-2, 0.1.1 A-3)
approved: { by: user, at: 2026-11-12, words: "AGENTS.md는 너무 쉽게 수정하지마. 1, 2, 4, 5 인용한다." }
---
## 결정
검사(V-n) 원본에는 실행한 명령, 대상 rev, 종료 코드를 남긴다. 셋 중 하나라도 없으면 그 검사는 통과가 아니라 "증거 미달"이다. 음성 대조처럼 여러 단계인 검사는 단계마다 남긴다.
## 이유
네 번의 감사에서 같은 지적이 반복됐다. 실행은 했지만 로그에 종료 코드나 대상 rev가 없어 통과를 입증하지 못했다. 0.1.1에서는 V-6·V-6b·V-10을 사후에 다시 실행해야 했다.
## 적용
로그를 쓸 때 `echo "rev $(git rev-parse --short HEAD)"`, 명령 줄(`$ …`), 실행 뒤 `echo "exit=$?"`를 함께 남긴다. 판정은 그 세 줄이 있을 때만 통과로 적는다.
## 바뀌면
CI가 생기면 CI 실행 기록(run id, 커밋, 결과)이 같은 역할을 한다.
