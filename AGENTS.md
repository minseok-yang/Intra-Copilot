# Intra Copilot — 작업 안내

Obsidian 데스크톱 전용 플러그인입니다(`isDesktopOnly: true`). 사내 환경에서 쓰며 기능은 네 가지입니다: 챗봇·커넥터·제너레이터·리마인더.

## 명령

- `npm run build` — tsc 검사 후 `main.js` 생성. `tsc`만 돌리면 `main.js`가 바뀌지 않으니 Obsidian에서 확인하기 전에는 꼭 이것을 돌립니다.
- `npm run lint` — eslint(`eslint-plugin-obsidianmd`).
- `npm test` — `test/*.test.ts`를 하나씩 번들해 Node로 실행합니다. `obsidian` 모듈은 `test/obsidian-mock.ts`로 바꿔 끼웁니다.
- CI(`.github/workflows/lint.yml`)는 모든 push에서 build·lint·test를 돌립니다.

## 구조

- `src/main.ts` — 플러그인 수명주기만. 기능 로직은 기능별 폴더로.
- `src/chat`, `src/connector`, `src/generator`, `src/reminder` — 기능별 로직.
- `src/llm` — OpenAI 호환 서버 연결. `src/skills` — `SKILL/*.md` 스킬.
- `src/ui` — 사이드바 창·모달, `src/ui/settings` — 설정 탭(일반 + 기능별).
- `src/content/docs.ts` — 플러그인 안 사용자 가이드·라이선스 문서.

## 규칙

- 주석·README·릴리즈 노트·화면 문구는 한국어로 씁니다.
- 저장소는 공개입니다. 사내 서버 주소·모델 이름 같은 사내 정보를 코드·문서·커밋에 넣지 않습니다.
- `minAppVersion`은 1.7.2입니다. 그보다 새 API는 lint가 막습니다. 올리려면 회사 Obsidian 버전을 먼저 확인합니다. `obsidian` 타입 패키지는 1.12.3으로 고정합니다.
- `src/llm/client.ts`의 `fetch`는 답변 스트리밍 때문에 일부러 씁니다(lint 경고 유지).
- `src/generator/office-import.ts`의 PowerShell 스크립트는 문자열이라 tsc가 검사하지 못합니다. 고치면 스크립트를 파일로 꺼내 PowerShell 파서로 문법을 확인합니다.
- 명령 id·설정 키·뷰 id는 발행 뒤 바꾸지 않습니다. 바꿔야 하면 이전 값을 옮기는 코드를 함께 넣습니다.
- `main.js`·`node_modules`는 커밋하지 않습니다.

## 릴리즈

1. `npm version patch` — `manifest.json`·`versions.json`·`package.json` 버전을 올리고 커밋과 태그(`.npmrc` 설정으로 앞에 `v` 없음)까지 만듭니다. 발행한 번호는 다시 쓰지 않습니다.
2. `git push` 후 태그를 push합니다: `git push origin <버전>`.
3. `release.yml`이 빌드·출처 증명(attestation)과 함께 초안 릴리즈를 만듭니다. 한국어 노트를 채워 공개합니다.
4. 릴리즈를 GitHub 화면에서 새로 만들지 않습니다. 태그가 새로 생기면서 워크플로가 초안을 하나 더 만듭니다.
