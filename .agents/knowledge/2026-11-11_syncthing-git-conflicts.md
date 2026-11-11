---
id: 2026-11-11_syncthing-git-conflicts
kind: failure
status: active
supersedes: null
topics: [git, syncthing, workspace]
decisions: []
symptoms: ["*.sync-conflict-* files in the work tree or .git", "deleted files reappear", "unexpected branches named *.sync-conflict*"]
applies_to: all
source: v0.1.0 rc.3 incident
approved: { by: user, at: 2026-11-11, words: "지식은 승격시켜도 되고." }
---
## 결정
git 작업(머지, 태그, 이력 작업, 푸시) 전에 sync-conflict 사본과 되살아난 파일이 없는지 확인한다. Syncthing 설정(`.stfolder/`, `.stignore`)은 에이전트가 건드리지 않는다.
## 이유
rc.3 중 Syncthing이 다른 기기와 동기화하며 작업 트리에 충돌 사본 52개, `.git` 안에 충돌 파일과 충돌 브랜치를 만들고, 지웠던 실제 데이터 파일을 되살렸다. 공개 저장소에 들어갈 뻔했다.
## 적용
`find . -name '*sync-conflict*' -not -path './node_modules/*'` 와 `git status --short`가 비어 있어야 진행한다. 나오면 지우지 말고 멈춰서 사용자에게 알린다.
## 바뀌면
저장소가 Syncthing 폴더 밖으로 옮겨지면 다시 검토한다.
