---
id: 2026-11-11_vite-lan-fs-deny
kind: failure
status: active
supersedes: null
topics: [vite, security, dev-server]
decisions: [vite-fs-deny]
symptoms: ["dev server on the LAN returns repository files such as .loctx/ or session files without login"]
applies_to: all
source: v0.1.0 review (blocker)
approved: { by: user, at: 2026-11-11, words: "지식은 승격시켜도 되고." }
---
## 결정
LAN에 여는 Vite dev 서버는 `vite.config.ts`의 `server.fs.deny`로 `.loctx/`, `server/`, `tests/`, `docker/`, `drizzle/`, 문서, 세션·상태 파일을 막는다.
## 이유
Vite 기본 deny는 `.env`·키·`.git`만 막는다. `/@fs/`나 상대 경로로 실제 데이터 시드와 테스트 세션 파일을 무인증으로 받을 수 있었다(리뷰 blocker, 재현 확인).
## 적용
새 비공개 경로나 파일 종류가 생기면 deny에 더하고, 15173에서 `curl`로 해당 경로가 403/404인지 확인한다.
## 바뀌면
dev 서버를 LAN에 열지 않게 되면 다시 검토한다.
