# Intra Copilot

옵시디언(Obsidian)용 플러그인 프로젝트입니다. 공식 [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 템플릿을 기반으로 만들어졌습니다.

> 이 README는 한국어로 작성되어 있습니다. 영어 버전은 필요할 때 나중에 추가할 예정입니다.

## 이 프로젝트는 무엇인가요?

`manifest.json`의 플러그인 id는 `intra-copilot`이며, 아직은 템플릿에서 가져온 기본 예시 기능(리본 아이콘 클릭, 모달 창 열기, 설정 탭 등)만 들어있는 뼈대 상태입니다. 실제 기능은 앞으로 `src/main.ts`, `src/settings.ts`에 채워나갈 예정입니다.

## 개발 환경 준비하기

1. [Node.js](https://nodejs.org/) 설치 (버전 18 이상 권장). 설치 후 터미널에서 `node --version`으로 확인할 수 있습니다.
2. 이 저장소를 내려받은 뒤, 프로젝트 폴더에서 의존성을 설치합니다.

	```
	npm install
	```

3. 개발 중에는 아래 명령으로 파일 변경을 감지해 자동으로 다시 빌드하도록 할 수 있습니다.

	```
	npm run dev
	```

4. 배포용으로 한 번만 빌드하려면 다음 명령을 사용합니다.

	```
	npm run build
	```

	빌드가 성공하면 `main.js` 파일이 생성됩니다. 이 파일은 git에는 커밋하지 않고(`.gitignore`에서 제외), GitHub Release에 첨부하는 방식으로 배포합니다.

## 옵시디언에서 플러그인 테스트하기

빌드된 `main.js`, `manifest.json`, `styles.css` 세 파일을 옵시디언 볼트(vault)의 아래 경로에 복사하면 로컬에서 테스트할 수 있습니다.

```
<내 볼트 폴더>/.obsidian/plugins/intra-copilot/
```

복사한 뒤 옵시디언의 `설정 → 커뮤니티 플러그인`에서 Intra Copilot을 활성화하면 됩니다. 개발 중에는 이 폴더 자체를 이 저장소 경로로 심볼릭 링크 해두면 매번 복사하지 않아도 됩니다.

## 코드 검사 (ESLint)

아래 명령으로 코드에 흔한 실수나 개선할 부분이 없는지 검사할 수 있습니다.

```
npm run lint
```

## 새 버전 릴리즈하기 (앞으로 사용할 절차)

1. `manifest.json`의 `version`과 `minAppVersion`을 새 값으로 갱신합니다.
2. `versions.json`에 새 버전과 그에 대응하는 최소 옵시디언 버전을 추가합니다.
3. GitHub에서 새 버전 번호로 Release를 생성하고(`v` 접두사 없이, 예: `1.0.1`), `main.js`, `manifest.json`, `styles.css`를 첨부합니다.
4. 릴리즈 노트는 한국어로 작성합니다. (영어 버전은 필요해지면 추후 추가)

> `npm version patch|minor|major` 명령을 사용하면 `manifest.json`, `package.json`, `versions.json` 갱신을 한 번에 처리할 수 있습니다.

## 참고 문서

- 옵시디언 플러그인 API 문서: https://docs.obsidian.md
