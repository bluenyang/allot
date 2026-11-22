---
id: 2026-11-23_codex-wait-on-output
kind: failure
status: active
supersedes: null
topics: [delegation, review, audit, tooling]
decisions: [codex-timeout-and-output-file]
symptoms: ["a codex review or audit seems to run for a long time after it has answered", "a wait loop on the codex process never ends"]
applies_to: all
source: retro 0.1.6 (reviews 6 and 7; history 2026-11-23)
approved: { by: user, at: 2026-11-23, words: "전부 수용 (Recommended)" }
---
## 결정
codex 위임(`codex exec -m <model> -s read-only -`)은 `timeout <초>`를 붙여 부르고, 브리프·출력·기록을 `.loctx/reports/<version>/review/`(감사는 `<version>/`)에 `<name>-brief.md`, `<name>-out.md`(stdout), `<name>-err.log`(stderr, 첫 줄 근처에 `model:`)로 남긴다. 끝났는지는 프로세스가 아니라 출력 파일의 최종 답과 기록의 `tokens used` 줄로 판단한다. 맡긴 모델은 기록의 `model:` 줄로 확인해 보고에 적는다.

## 이유
0.1.6 리뷰 6·7에서 codex가 답을 낸 뒤에도 프로세스가 남아, 프로세스를 기다리던 PM의 대기가 수십 분 늘어났고 사용자가 두 번 물었다("얼마나 걸려", "오래걸려?"). 남은 프로세스를 끄려던 명령은 권한 분류기가 막았다.

## 적용
codex로 리뷰·감사를 맡길 때마다.

## 바뀌면
codex CLI가 답 뒤에 바로 끝나게 바뀌면 timeout은 안전장치로만 남긴다.
