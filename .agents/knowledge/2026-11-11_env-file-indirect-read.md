---
id: 2026-11-11_env-file-indirect-read
kind: failure
status: active
supersedes: null
topics: [secrets, docker, compose, env]
decisions: [env-indirect-read-is-read]
symptoms: ["docker compose config output contains values from env_file", "a container started from compose.yaml got the real docker/.env"]
applies_to: all
source: audit 0.1.1 A-1
approved: { by: user, at: 2026-11-11, words: "4. 승인" }
---
## 결정
env 파일을 불러오는 명령은 그 파일을 읽는 것으로 본다. 로컬에서는 `docker/compose.dev.yaml`만 띄우고, compose 파일 검사는 `--env-file docker/.env.example config --no-env-resolution`으로만 한다.
## 이유
`--env-file`은 compose 파일 안의 `${…}` 보간에 쓸 값만 바꾼다. 서비스의 `env_file: [.env]`는 그대로 compose 파일 옆의 `.env`를 읽는다. 그래서 `docker compose --env-file docker/.env.example config`도 실제 `docker/.env` 값을 출력에 풀어 쓴다. 0.1.1 W-5에서 이 출력이 로그 파일에 남았고, 같은 날 실제 `.env`를 쓰는 compose 파일을 로컬에서 띄웠다(감사 0.1.1 A-1). 파일 도구의 deny 규칙은 프로그램이 대신 읽는 경로를 막지 못한다.
## 적용
- spec의 검사 명령에 compose·dotenv·source가 있으면 `env_file:`과 출력 리다이렉트를 함께 본다.
- 명령 출력을 파일로 남기기 전에 env 값을 담을 수 있는지 먼저 본다.
- `scripts/guard-env.mjs`(PreToolUse 훅)가 켜져 있으면 이 경우를 기계적으로 막는다. 자체 검사: `node scripts/guard-env.mjs --test`.
## 바뀌면
개발 머신에서 실제 `docker/.env`가 사라지면(사용자 계획) 위험은 줄지만, 운영 호스트에서도 같은 규칙을 지킨다.
