---
id: 2026-11-11_pnpm-release-age-strict
kind: failure
status: active
supersedes: null
topics: [install, pnpm, dependencies]
decisions: [release-age-strict]
symptoms: ["minimumReleaseAgeExclude entries appeared in pnpm-workspace.yaml after pnpm add"]
applies_to: all
source: v0.1.0 (W-5 incident)
approved: { by: user, at: 2026-11-11, words: "지식은 승격시켜도 되고." }
---
## 결정
`pnpm-workspace.yaml`에 `minimumReleaseAgeStrict: true`를 둔다. 공개 1일 미만 버전은 `pnpm add`가 실패해야 하며, 예외 목록으로 우회하지 않는다.
## 이유
비엄격 모드의 `pnpm add -E <pkg>@<new>`는 실패하지 않고 `minimumReleaseAgeExclude`에 의존성 여러 개를 자동으로 넣는다. v0.1.0에서 그대로 커밋됐다가 발견 뒤 한 단계 낮은 버전으로 내리고 예외를 지웠다.
## 적용
의존성 추가·갱신 뒤 `git diff pnpm-workspace.yaml`에 `minimumReleaseAgeExclude`가 없는지 본다. 실패하면 통과하는 가장 새 버전을 고른다.
## 바뀌면
pnpm이 기본을 strict로 바꾸면 설정 줄은 지워도 된다. 확인 절차는 남긴다.
