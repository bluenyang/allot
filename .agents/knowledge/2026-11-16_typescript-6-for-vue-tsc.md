---
id: 2026-11-16_typescript-6-for-vue-tsc
kind: decision
status: active
supersedes: null
topics: [stack, typescript, dependencies]
decisions: [typescript-stays-on-6]
symptoms: ["pnpm add typescript@7 breaks pnpm typecheck", "vue-tsc errors after a TypeScript major update"]
applies_to: all
source: AGENTS.md stack line, moved here by the 0.1.2 retro (reins 0.3 AGENTS.md guide)
approved: { by: user, at: 2026-11-16, words: "A 제안대로, B 인용, C 인용, D dks gka." }
---
## 결정
TypeScript는 6.x에 둔다(정확한 버전 고정, `pnpm add -E`).
## 이유
게이트 `pnpm typecheck`가 `vue-tsc --noEmit`을 쓰는데, vue-tsc가 TypeScript 7을 아직 지원하지 않는다.
## 적용
`package.json`의 `typescript` 의존성. 의존성 갱신 때 TypeScript 7로 올리지 않는다.
## 바뀌면
vue-tsc가 TypeScript 7을 지원하는 판이 나오면 이 항목을 다시 보고, 올린 뒤 typecheck·build 게이트로 확인한다.
