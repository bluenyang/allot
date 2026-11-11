---
id: 2026-11-12_drizzle-pk-composite-fk-order
kind: failure
status: active
supersedes: null
topics: [drizzle, migrations, schema]
decisions: []
symptoms: ["multiple primary keys for table … are not allowed", "there is no unique constraint matching given keys for referenced table"]
applies_to: all
source: 0.1.1 W-1
approved: { by: user, at: 2026-11-12, words: "AGENTS.md는 너무 쉽게 수정하지마. 1, 2, 4, 5 인용한다." }
---
## 결정
기본 키를 다른 열로 바꾸거나, 새 unique 제약을 참조하는 복합 외래 키를 더하는 스키마 변경은 `pnpm db:generate`를 두 단계로 나눠 만든다. 생성된 SQL을 손으로 고치지 않는다.
## 이유
drizzle-kit 0.31(drizzle-orm 0.45)은 한 마이그레이션 안에서 ① 기존 PK 열을 지우기 전에 새 PK를 추가하고 ② unique 제약보다 그것을 참조하는 외래 키를 먼저 만든다. 그대로 적용하면 실패한다.
## 적용
1단계: 열 추가·not null·unique·옛 PK 열 삭제(새 PK와 복합 FK는 빼 둔다) → generate. 2단계: 새 PK와 복합 FK → generate. 0.1.1의 0007/0008이 예.
## 바뀌면
drizzle-kit이 순서를 고치면 한 단계로 돌아간다. 생성된 SQL의 순서를 먼저 확인한다.
