import { UiLanguage } from './settings';
import type { LlmErrorKind } from './llm/client';

// 플러그인 화면(설정·챗봇)에 보이는 문자열입니다. ko를 기준으로 en도 같은 모양(키 구조)을 갖도록
// TypeScript가 강제합니다 — 문구를 하나만 추가하고 다른 언어를 빠뜨리면 빌드가 실패합니다.
// {seconds}, {count}처럼 중괄호로 된 부분은 코드에서 실제 값으로 바꿔 넣는 자리입니다.
//
// 용어 기준(문구를 추가할 때 지켜주세요)
// - 답변: 모델이 사용자에게 한 말. "응답"은 서버의 기술적인 응답(HTTP 등)에만 씁니다.
// - 확인: 연결/모델 점검. "검증"과 섞어 쓰지 않습니다.
// - 지정: @로 고른 폴더·노트(대화 대상). / 선택: /로 고른 스킬. 둘을 바꿔 쓰지 않습니다.
// - 버튼·설정 이름은 실제 동작 그대로 부르고, 설명문에서 그 이름을 [대괄호]나 "따옴표"로 똑같이 인용합니다.
// - 이미 누르고 들어온 카드·탭 이름을 그 안의 제목·항목 이름에서 되풀이하지 않습니다(예: [인덱스] 탭 안의 "인덱스 다시 만들기" → "다시 만들기").
const ko = {
	general: {
		// 설정을 열면 가장 먼저 보이는 곳입니다. 순서는 "이게 뭔지(이름·설명·문서·버전) → 기능별 설정 바로가기 →
		// (처음이면) 어떻게 시작하는지 → 설정값"입니다. 처음 쓰는 동료가 위에서부터 읽어 내려가면 되도록.
		// 무엇을 위한 플러그인인지(지식 관리), 어떤 환경을 위해 만들었는지(제한된 사내 환경·로컬 AI)를 먼저 알립니다.
		// (이 문자열은 공개 저장소에 올라가므로 회사명 같은 사내 정보는 넣지 않습니다.)
		// \n 줄바꿈은 styles.css의 .intra-copilot-intro-text(white-space: pre-wrap)가 살려 줍니다(\t 들여쓰기 포함).
		introText:
			'흩어진 정보를 지식으로 만들고, 연결하고, 다시 활용하세요.\n\n' +
			'지식관리에 필요한 핵심 기능을 하나의 플러그인에 담았습니다.\n' +
			'\t1. AI 기반 노트 작성·편집 및 변경 사항 검토\n' +
			'\t2. 연관 지식 노트 간 링크 추천\n' +
			'\t3. 문서·이메일·PDF 자동 요약 및 노트 생성\n' +
			'\t4. 오래 다시 보지 않은 지식 노트 리마인더\n\n' +
			'외부 인터넷 접속이 제한된 사내 환경에서도 사용할 수 있도록 개발되었으며, 사내 서버 또는 개인 로컬 환경의 AI 모델을 활용할 수 있습니다.\n',
		guideButton: '사용자 가이드',
		licenseButton: '라이선스 및 정책',
		// 기능 네 개로 가는 바로가기 줄의 제목(톱니바퀴 아이콘과 함께)
		settingsHeading: '설정',
		// 아직 서버를 설정하지 않았을 때만 보이는 안내
		setupHeading: '처음 설정하기',
		setupSteps:
			'① 위 [챗봇] 카드 → [LLM 연결]에서 서버 주소를 입력하고, ② [모델 목록 불러오기]로 모델을 고른 뒤 [연결 확인]을 누르고, ③ 왼쪽 리본의 챗봇 아이콘(가로줄 사이의 말풍선)으로 챗봇을 엽니다.',
		setupButton: 'LLM 연결 설정하기',
		displayHeading: '표시',
		languageName: '표시 언어',
		languageDesc:
			'플러그인 화면(설정·챗봇)에 쓰이는 언어를 바꿉니다. 사용자 가이드와 라이선스 문서는 한국어로만 제공됩니다.',
	},
	// Intra Copilot이 묶은 기능 네 가지(ui/settings/features.ts). 이름은 아직 가칭이라 여기서만 고치면
	// 설정 화면 전체(처음 화면의 카드, 기능 설정의 머리말)에 반영됩니다.
	features: {
		available: '사용 가능',
		upcoming: '준비 중',
		chatbot: {
			name: '챗봇',
			desc: 'AI와 대화하며 노트를 작성·편집하고, 제안된 변경 사항을 검토한 뒤 반영합니다.',
			// 오른쪽 사이드바 창 맨 위 한 줄 소개(ui/settings/features.ts의 renderViewHeading)
			tagline: '내 노트를 곁에 두고 AI와 함께 쓰고, 고치고, 묻습니다.',
		},
		connector: {
			name: '커넥터',
			desc: '연관된 지식 노트를 찾아 서로 링크하도록 추천합니다.',
			tagline: '지금 노트와 뜻이 통하는 노트를 찾아 지식을 이어 줍니다.',
		},
		maker: {
			name: '메이커',
			desc: '붙여 넣은 글을 정해진 양식에 맞춰 새 노트로 써 줍니다.',
			tagline: '받은 자료를 내 양식의 노트로 만들어 줍니다.',
		},
		reminder: {
			name: '리마인더',
			desc: '오래 다시 보지 않은 지식 노트를 하루 몇 개씩 다시 꺼내 보여 줍니다.',
			tagline: '잊혀 가던 지식 노트를 오늘 다시 꺼내 줍니다.',
		},
	},
	// 기능 탭 안의 섹션(하위 탭) 이름
	sections: {
		llm: 'LLM 연결',
		prompt: '시스템 프롬프트',
		skills: '스킬',
		embedding: '임베딩 서버',
		index: '인덱스',
		templates: '양식',
		prompts: '프롬프트',
		mcp: 'MCP 연결',
		reminderTargets: '대상 노트',
		schedule: '주기·알림',
		reminderProperties: '노트 속성',
	},
	// 준비 중인 기능의 설정 자리(ui/settings/upcoming-section.ts). 모두 잠겨 있고 아무것도 저장하지 않습니다.
	// 항목은 지금 계획한 것일 뿐이라, 기능을 실제로 만들 때 바뀔 수 있습니다.
	upcoming: {
		notice: '이 기능은 아직 만드는 중입니다. 아래는 앞으로 들어갈 설정의 자리이며, 지금은 바꿀 수 없습니다.',
		templatesIntro: '붙여 넣은 글로 새 노트를 만들 때 따를 양식 노트를 관리합니다.',
		templatesFolder: { name: '폴더', desc: '양식 노트를 모아 둔 폴더' },
		templatesDefault: { name: '기본 양식', desc: '따로 고르지 않을 때 쓸 양식' },
		promptsIntro: '새 노트를 만들 때 모델에게 줄 지시문을 관리합니다.',
		promptsInstructions: { name: '노트 생성 지시문', desc: '양식을 채울 때 모델이 따를 규칙' },
		mcpIntro: '새 노트를 만들 때 쓸 외부 도구(MCP 서버) 연결을 관리합니다.',
		mcpServers: { name: '서버', desc: '연결할 MCP 서버 목록' },
		buttonAdd: '추가',
	},
	// 사용자 가이드·라이선스 창(ui/guide-view.ts)의 이동 버튼
	docs: {
		toc: '목차',
		prev: '이전',
		next: '다음',
		upcoming: '준비 중',
	},
	llm: {
		// 연결 화면 맨 위에 자물쇠와 함께 보이는 전송 안내. 통신 대상이 늘어나는 기능을 만들면 이 문장도 고쳐야 합니다.
		privacyNote:
			'챗봇은 노트 내용을 여기서 설정한 LLM 서버로만 보내며, 입력칸 위에 칩으로 올라온 것만 전송합니다. 커넥터 기능은 커넥터 설정의 임베딩 서버를 따로 씁니다.',
		intro:
			'OpenAI 호환 API(예: vLLM으로 운영하는 사내 서버)를 지원합니다. ' +
			'연결을 확인할 때는 노트 내용을 보내지 않고, 정해진 테스트 문장만 보냅니다.',
		baseUrlName: '서버 주소',
		baseUrlDesc:
			'LLM 서버의 API 주소입니다. 보통 /v1로 끝납니다. 예: http://서버주소:8000/v1',
		baseUrlPlaceholder: 'http://서버주소:8000/v1',
		apiKeyName: 'API 키',
		apiKeyDesc: '서버에 접속할 때 쓰는 인증 키입니다. 키가 필요 없는 서버라면 비워두세요.',
		maxHistoryName: '서버로 보낼 대화 기록 수',
		maxHistoryDesc:
			'질문할 때 함께 보낼 최근 메시지 개수입니다. 질문과 답변을 각각 1개로 세므로, 20이면 지금 질문을 포함해 최근 약 10번 주고받은 분량입니다. ' +
			'화면에는 전체 대화가 그대로 남습니다. 0이면 제한 없음(전체 전송), 비워두면 기본값(20)으로 돌아갑니다.',
		maxResponseName: '답변 길이 제한 (max_tokens)',
		maxResponseDesc:
			'답변의 최대 길이를 토큰(모델이 글을 세는 단위) 수로 정합니다. 추론형 모델은 생각 과정도 이 한도 안에서 쓰기 때문에, 너무 작으면 답변이 잘립니다. ' +
			'0이면 제한 없음(서버 기본값), 비워두면 기본값(4096)으로 돌아갑니다.',
		maxContextName: '노트 자료 최대 글자 수',
		maxContextDesc:
			'챗봇 입력칸 위에 칩으로 올라온 폴더·노트를 질문에 붙일 때 최대 몇 글자까지 보낼지 정합니다. 넘치는 노트는 빼고 보내며, 빠진 자료가 있다는 사실도 모델에게 알립니다. ' +
			'"길이를 넘었다"며 답변이 실패하면 줄여보세요. 0이면 제한 없음, 비워두면 기본값(8000)으로 돌아갑니다.',
		streamingName: '답변 스트리밍',
		streamingDesc:
			'답변을 다 만들 때까지 기다리지 않고, 서버가 만드는 대로 글자가 차례로 나타나게 합니다. ' +
			'서버가 스트리밍을 막아 두었다면 끄세요(끄면 답변이 완성된 뒤 한 번에 보입니다). ' +
			'켜 두어도 조각을 하나도 받지 못하면 자동으로 예전 방식으로 한 번 더 시도합니다.',
		chatTimeoutName: '답변 대기 시간 (초)',
		chatTimeoutDesc:
			'챗봇 답변을 최대 몇 초까지 기다릴지 정합니다. 스트리밍을 켜면 마지막 조각이 온 뒤부터 다시 셉니다. 시간 초과로 실패하는 일이 잦으면 늘려보세요. ' +
			'10~3600초 사이로 저장되고(범위를 벗어나면 가까운 끝값으로), 비워두면 기본값(120초)으로 돌아갑니다. ' +
			'[모델 목록 불러오기]와 [연결 확인]은 이 값과 상관없이 30초까지 기다립니다.',
		systemPromptIntro:
			'챗봇에 질문할 때마다 대화 맨 앞에 붙여 보내는 지시문입니다. 예: "항상 한국어로 간결하게 답해줘." 비워두면 보내지 않습니다. ' +
			'고친 내용은 [저장]을 눌러야 반영되며, [취소]를 누르면 마지막으로 저장한 내용으로 돌아갑니다.',
		systemPromptSave: '저장',
		systemPromptCancel: '취소',
		systemPromptSaved: '시스템 프롬프트를 저장했습니다.',
		advancedName: '고급 설정',
		modelCheckHeading: '모델 선택 및 연결 확인',
		modelCheckDesc:
			'[모델 목록 불러오기]로 서버에서 쓸 수 있는 모델을 불러와 고른 뒤, [연결 확인]으로 그 모델이 실제로 답하는지 확인합니다.',
		modelCheckButton: '모델 목록 불러오기',
		loadingModels: '불러오는 중...',
		modelPlaceholder: '모델을 선택하세요',
		testDesc: '선택한 모델에 짧은 테스트 문장을 보내, 실제로 답하는지 확인합니다.',
		testButton: '연결 확인',
		testing: '확인 중...',
		statusIdle: '아직 확인하지 않음',
		statusChecking: '확인 중...',
		statusOk: '연결 확인됨',
		statusError: '확인 실패',
		statusMissing: '모델을 먼저 선택하세요',
		statusReplyPrefix: '모델 답변: ',
		fillBaseUrlFirst: '서버 주소를 먼저 입력하세요.',
		fetchOk: '모델 목록을 불러왔습니다 ({count}개)',
		fetchFailPrefix: '모델 목록을 불러오지 못했습니다: ',
		noModelsFound: '서버에 쓸 수 있는 모델이 없습니다(빈 목록).',
		modelsOkHint: '연결은 첫 대화나 [연결 확인] 버튼으로 확인됩니다',
		lastVerifiedPrefix: '확인 시각: ',
		lastSuccessPrefix: '마지막 연결 성공: ',
		neverVerified: '아직 연결에 성공한 기록이 없습니다.',
		statusConnectionChanged: '확인 필요 — 서버 설정이 바뀌었습니다',
		statusModelChanged: '확인 필요 — 모델이 바뀌었습니다',
		chatOk: '답변을 정상적으로 받았습니다',
		chatFailPrefix: '답변 받기 실패: ',
		modelNotInList: '선택한 모델이 서버의 모델 목록에 없습니다. 드롭다운에서 다시 선택하세요.',
		// 실패 원인별 안내문 — "무엇이 문제이고 어떻게 고치는지". 이름은 client.ts의 LlmErrorKind와 같아야 합니다.
		// 설정 화면과 챗봇에서 함께 쓰므로, 한쪽에서만 맞는 안내(예: 답변 대기 시간)는 넣지 않습니다.
		errors: {
			'invalid-url':
				'서버 주소 형식이 올바르지 않습니다. http:// 또는 https://로 시작하는 주소를 입력하세요. (예: http://서버주소:8000/v1)',
			timeout:
				'서버가 {seconds}초 안에 응답하지 않았습니다. 서버가 붐비거나 꺼져 있을 수 있으니 잠시 후 다시 시도하세요.',
			network:
				'서버에 연결할 수 없습니다. 서버 주소(오타, http/https, 포트 번호)와 네트워크(사내망·VPN) 연결을 확인하세요.',
			certificate:
				'서버의 보안 인증서를 신뢰할 수 없습니다. 주소가 맞는지 확인하고, 사내 서버라면 서버 관리자나 IT 부서에 문의하세요.',
			auth: 'API 키가 없거나 올바르지 않거나, 이 서버를 쓸 권한이 없습니다(인증 실패). 설정의 챗봇 → LLM 연결에서 API 키를 확인하세요.',
			'not-found':
				'서버에는 연결됐지만 요청한 경로를 찾을 수 없습니다. 서버 주소가 API 주소(보통 /v1로 끝남)인지 확인하세요.',
			model:
				'서버가 선택한 모델로는 대화할 수 없다고 응답했습니다. 모델 이름이 틀렸거나, 대화용이 아닌 모델(음성·임베딩 등)일 수 있습니다. 다른 모델을 선택해보세요.',
			'context-length':
				'대화가 모델이 한 번에 처리할 수 있는 길이를 넘었습니다. 새 대화를 시작하거나, 고급 설정에서 "서버로 보낼 대화 기록 수", "노트 자료 최대 글자 수", "답변 길이 제한"을 줄여보세요.',
			'rate-limit': '요청이 너무 많아 서버가 잠시 거절했습니다(사용량 제한). 잠시 후 다시 시도하세요.',
			'bad-request':
				'서버가 요청을 거절했습니다. 선택한 모델과 고급 설정 값(답변 길이 제한 등)을 확인하세요.',
			server: '서버 내부 오류입니다(서버 쪽 문제). 잠시 후 다시 시도하고, 계속되면 서버 관리자에게 문의하세요.',
			'invalid-response':
				'서버가 LLM API 형식이 아닌 응답을 보냈습니다. 서버 주소가 웹페이지 주소가 아니라 API 주소(보통 /v1로 끝남)인지 확인하세요.',
			unknown: '알 수 없는 이유로 요청에 실패했습니다. 오류 원문을 확인하세요.',
			redirect:
				'서버가 요청을 다른 주소로 넘기려 해서(리다이렉트) 따라가지 않았습니다. 보안을 위해 넘겨진 주소로는 연결하지 않습니다. 서버 주소를 정확한 API 주소(보통 /v1로 끝남)로 입력하세요.',
			cancelled: '답변 기다리기를 중지했습니다.',
		},
	},
	chat: {
		title: '챗봇',
		ribbonTooltip: '챗봇 열기',
		inputPlaceholder: '메시지를 입력하세요 (@: 폴더·노트, /: 스킬, Enter: 보내기, Shift+Enter: 줄바꿈)',
		sendButton: '보내기',
		emptyState:
			'아직 대화가 없습니다. 아래에 메시지를 입력해보세요. 지금 열려 있는 노트는 입력칸 위에 칩으로 올라오며, 그 상태로 질문하면 노트 내용이 함께 전송됩니다(칩의 ×로 뺄 수 있습니다). ' +
			'@를 입력하면 다른 폴더·노트도 골라서 함께 읽힐 수 있고, /를 입력하면 저장해 둔 스킬(자주 쓰는 작업 지시)을 불러옵니다.',
		editTooltip: '수정해서 다시 보내기 (이 메시지부터 아래 대화가 바뀝니다)',
		editBanner: '메시지 수정 중 — 보내면 이 메시지부터 아래 대화 {count}개가 새 내용으로 바뀝니다. (Esc: 취소)',
		editCancel: '취소',
		editSkillMissing: '이 메시지에 썼던 스킬을 찾을 수 없어 스킬 없이 수정합니다.',
		pickerWholeVault: '볼트 전체',
		pickerCurrentNote: '현재 노트',
		pickerNoMatch: '일치하는 폴더·노트가 없습니다',
		skillPickerNoMatch: '일치하는 스킬이 없습니다 — 설정 → 챗봇 → 스킬에서 추가할 수 있습니다',
		pickerHint: '↑↓ 이동 · Enter 선택 · Esc 닫기',
		targetRemoveTooltip: '지정 해제',
		// 자동으로 들어온 "지금 열려 있는 노트" 칩의 툴팁
		currentNoteChip: '지금 열려 있는 노트입니다. 이 대화에서 고칠 수 있는 노트는 이것뿐입니다. (×로 빼면 전송하지 않습니다)',
		skillRemoveTooltip: '스킬 선택 해제',
		targetMissing: '볼트에서 찾을 수 없어 지정을 해제했습니다: {names} — 확인한 뒤 다시 보내세요.',
		contextReadFailed: '지정한 노트를 읽지 못했습니다. 다시 시도하세요.',
		attachedInfo: '노트 {count}개 · {chars}자 첨부',
		attachedTruncated: ' · 글자 수 제한으로 일부 생략',
		thinking: '답변을 기다리는 중...',
		streamingReasoning: '생각하는 중...',
		notConfigured: '설정 → Intra Copilot → 챗봇 → LLM 연결에서 서버 주소와 모델을 먼저 설정하세요.',
		errorPrefix: '오류: ',
		retryButton: '다시 시도',
		emptyReply: '(빈 답변)',
		truncatedNotice:
			'답변 길이 제한(max_tokens)에 걸려 답변이 중간에 잘렸습니다. 고급 설정에서 제한을 늘리면 더 길게 받을 수 있습니다.',
		reasoningSummary: '생각 과정 보기',
		// 시간 초과 안내 뒤에 챗봇에서만 덧붙이는 문장입니다("답변 대기 시간"은 챗봇 답변에만 적용되므로).
		timeoutHint: '답변이 긴 질문이라면 고급 설정의 "답변 대기 시간"을 늘려보세요.',
		copyTooltip: '답변 복사',
		copied: '답변을 클립보드에 복사했습니다.',
		copyFailed: '클립보드에 복사하지 못했습니다.',
		saveFailed: '대화를 파일에 저장하지 못했습니다.',
		busyNotice: '답변을 기다리는 중입니다. 답변이 온 뒤에 다시 시도하거나 [중지]를 누르세요.',
		stopButton: '중지',
		stopTooltip: '답변 기다리기를 멈춥니다. (서버는 이미 받은 질문의 답변을 끝까지 만들 수 있습니다.)',
		sendTooltip: '보내기 (Enter)',
		linkBlockedNotice: '보안 정책상 답변 속 링크는 열 수 없습니다. 주소를 클립보드에 복사했습니다.',
		newChatButton: '새 대화',
		historyButton: '지난 대화',
		checkConnectionButton: '연결 확인',
		// 머리줄 상태등 옆에 붙는 짧은 상태 글자(자세한 설명은 마우스를 올리면 보임)
		statusLabelOk: '연결됨',
		statusLabelError: '연결 실패',
		statusLabelIdle: '확인 필요',
		statusLabelChecking: '확인 중',
		checkConnectionTooltip:
			'서버의 모델 목록을 다시 불러오고, 선택한 모델이 실제로 답하는지 짧은 테스트 문장으로 확인합니다',
		newChatTooltip: '새 대화 시작 (지금 대화는 지난 대화 목록에 남습니다)',
		historyTooltip: '지난 대화 보기',
		historyTitle: '지난 대화',
		historyEmpty: '저장된 대화가 없습니다.',
		historyLoadButton: '불러오기',
		historyDeleteTooltip: '이 대화 삭제',
		historyDeleteConfirm: '⚠ 한 번 더 누르면 이 대화가 영구 삭제됩니다.',
		historyDeleteConfirmTooltip: '한 번 더 눌러 삭제',
		historyLoadFailed: '대화를 불러오지 못했습니다.',
		historyCurrentDeleted: '보고 있던 대화가 삭제되어 새 대화로 전환했습니다.',
		failedLabel: '⚠ 답변을 받지 못해 이 질문은 대화 기록에 포함되지 않았습니다',
		errorDetails: '자세한 내용 (오류 원문)',
		emptyTitle: '(빈 대화)',

		// 승인형 Diff — 답변 속 노트 수정 제안 카드(ui/chat/edit-card.ts)
		editApplyButton: '적용',
		editApplyTooltip: '이 내용대로 노트를 고칩니다. 고치기 직전 원본은 따로 보관합니다.',
		editRevertButton: '되돌리기',
		editRevertTooltip: '이 수정을 적용하기 전으로 되돌립니다. 그 뒤에 직접 고친 다른 부분은 그대로 둡니다.',
		editAppliedLabel: '적용함',
		editAppendLabel: '노트 끝에 덧붙이기',
		editDeleteLabel: '이 부분 지우기',
		editDiffSkipped: '… 바뀌지 않은 {count}줄 생략',
		editChecking: '노트와 대조하는 중...',
		// 적용할 수 없는 이유(카드 안에 회색 글씨로 보이고, 이때 [적용] 버튼은 잠깁니다)
		editProblemNotCurrent:
			'이 질문을 보낼 때 열려 있던 노트가 아니라서 고칠 수 없습니다. 고칠 수 있는 노트는 그때 화면에 열어 둔 노트 하나뿐입니다. 이 노트를 열고 다시 요청하세요.',
		editProblemNoteMissing:
			'이 경로에 노트가 없습니다. 노트가 옮겨졌거나 이름이 바뀌었을 수 있습니다.',
		editProblemNotFound:
			'고칠 원문을 노트에서 찾지 못했습니다. 노트가 그새 바뀌었거나, 챗봇이 원문을 조금 다르게 옮겨 적었습니다. 챗봇에게 다시 물어보세요.',
		editProblemAmbiguous:
			'똑같은 내용이 노트에 여러 곳 있어 어디를 고쳐야 할지 알 수 없습니다. 앞뒤 줄을 더 포함해서 다시 제안해 달라고 하세요.',
		editProblemAlreadyThere: '덧붙이려는 내용이 이미 노트에 있습니다. 같은 글이 두 번 들어가지 않도록 막았습니다.',
		editProblemNoChange: '고치기 전과 후가 같아 바뀌는 것이 없습니다.',
		editApplied: '노트를 고쳤습니다: {path}',
		editReverted: '수정을 되돌렸습니다: {path}',
		editApplyFailed: '노트를 고치지 못했습니다: {reason}',
		editRevertFailed:
			'되돌리지 못했습니다 — 적용한 부분이 그 뒤에 또 바뀐 것 같습니다. 적용 전 원본은 플러그인 폴더의 backups/{name} 파일에 있습니다.',
		editRevertFailedNoBackup:
			'되돌리지 못했습니다 — 적용한 부분이 그 뒤에 또 바뀐 것 같습니다. 노트를 직접 확인하세요.',
		editBackupFailed: '노트는 고쳤지만, 적용 전 원본을 보관하지 못했습니다.',
		editOpenNoteTooltip: '이 노트 열기 (적용 전에 실제 노트를 확인하세요)',
		editFold: '내용 접기',
		editUnfold: '내용 펼치기',
		// 답변을 받는 중 수정 제안이 시작되면, 완성되지 않은 마커 대신 이 문구를 보여줍니다.
		editStreaming: '(노트 수정 제안을 쓰는 중…)',
		// 제안이 여러 개일 때 답변 맨 위에 붙는 줄
		editSummaryCount: '노트 수정 제안 {count}개',
		editApplyAllButton: '모두 적용',
		editApplyAllTooltip:
			'적용할 수 있는 제안을 위에서부터 모두 노트에 반영합니다. 하나씩 확인하려면 각 카드의 [적용]을 쓰세요.',
		editApplyAllConfirm: '⚠ 한 번 더 누르면 모두 적용',
		editApplyAllNone: '지금 적용할 수 있는 제안이 없습니다.',
		// 모델이 수정 제안 형식을 크게 벗어나게 답해서 카드를 만들지 못했을 때(답변에 마커만 글자로 남음)
		editFormatBroken:
			'⚠ 챗봇이 수정 제안 형식을 지키지 않아 [적용] 버튼을 만들지 못했습니다. "정해진 수정 형식을 그대로 지켜서 다시 알려 줘"라고 요청해 보세요.',
	},
	skills: {
		intro:
			'자주 쓰는 작업 지시를 스킬로 저장해 두고, 챗봇 입력칸에서 /를 입력해 불러 씁니다. 스킬마다 .md 파일 하나로 아래 폴더에 저장되므로, ' +
			'사내에서도 메모장 같은 편집기로 직접 고치거나 파일을 복사해 동료와 나눌 수 있습니다. 파일을 직접 고쳤다면 [목록 새로고침]을 누르세요.',
		folderLabel: '저장 폴더: ',
		openFolderButton: '폴더 열기',
		openFolderFailed: '스킬 폴더를 열지 못했습니다.',
		newButton: '새 스킬',
		reloadButton: '목록 새로고침',
		empty: '저장된 스킬이 없습니다. [새 스킬]로 추가하세요.',
		noDescription: '(설명 없음)',
		fileLabel: '파일: ',
		emptyInstructions: '⚠ 지시문이 비어 있어 챗봇 목록에 나오지 않습니다',
		editTooltip: '편집',
		deleteTooltip: '삭제',
		deleteConfirm: '⚠ 한 번 더 누르면 이 스킬 파일이 영구 삭제됩니다.',
		deleteConfirmTooltip: '한 번 더 눌러 삭제',
		deleteFailed: '스킬을 삭제하지 못했습니다.',
		loadFailed: '스킬 목록을 읽지 못했습니다.',
		newTitle: '새 스킬',
		editTitle: '스킬 편집',
		nameField: '이름',
		nameDesc: '챗봇에서 / 뒤에 입력해 찾는 이름입니다. 예: 노트 링크 정리',
		descriptionField: '설명',
		descriptionDesc: '목록에서 이름 아래 보이는 한 줄 설명입니다. (선택)',
		instructionsField: '지시문',
		instructionsDesc:
			'이 스킬을 고르면 질문과 함께 모델에게 보내는 작업 지시입니다. {{input}}을 넣으면 그 자리에 입력칸의 글이 들어가고, 없으면 입력한 글이 지시문 뒤에 붙습니다. ' +
			'@로 노트를 함께 지정하면 그 노트 내용도 전송됩니다.',
		saveButton: '저장',
		cancelButton: '취소',
		nameRequired: '이름을 입력하세요.',
		instructionsRequired: '지시문을 입력하세요.',
		saveFailed: '스킬을 저장하지 못했습니다.',
		saved: '스킬을 저장했습니다.',
	},
	// 커넥터 화면(ui/connector-view.ts)과 설정(ui/settings/connector-section.ts)
	connector: {
		title: '커넥터',
		ribbonTooltip: '커넥터 열기',
		noNote: '노트를 열면 뜻이 비슷한 노트를 보여 줍니다.',
		notIndexedNote:
			'이 노트는 아직 색인되지 않았습니다. 새로 만들었거나 고친 노트는 자동 갱신 주기에 따라 색인되며, 머리줄 [업데이트]로 바로 맞출 수 있습니다.',
		excludedNote: '이 노트는 제외 폴더·템플릿 폴더에 있어 색인하지 않습니다.',
		noResults: '비슷한 노트가 없습니다.',
		score: '유사도 {score}%',
		linked: '링크됨',
		linkedTooltip: '지금 노트에 이미 이 노트로 가는 링크가 있습니다. 같은 링크가 또 들어가지 않게 [링크 넣기]는 빠집니다.',
		previewTooltip:
			'누르면 이 카드 안에 노트 내용을 펼치고, 다시 누르면 접습니다. 커넥터 창은 지금 노트에 그대로 머뭅니다. Ctrl/Cmd를 누른 채 누르면 새 탭에서 엽니다.',
		selectTooltip: '챗봇에 올릴 노트로 고릅니다',
		chatSelectedButton: '선택한 노트 {count}개를 챗봇에 올리기',
		chatSelectedTooltip:
			'챗봇을 열고 체크한 노트를 입력칸 위에 칩으로 올립니다. 질문을 보낼 때 함께 전송되며, 보낼 양은 챗봇의 노트 자료 최대 글자 수까지입니다.',
		chatAdded: '챗봇 입력칸 위에 노트 {count}개를 올렸습니다. 질문을 보내면 함께 전송됩니다.',
		section: '비슷한 섹션: {section}',
		insertSectionButton: '섹션 링크',
		insertSectionTooltip:
			'비슷한 섹션({section})으로 바로 가는 링크를 넣습니다. 누르면 커서 자리에, 끌어다 노트에 놓으면 놓은 자리에 들어갑니다.',
		insertButton: '링크 넣기',
		insertTooltip:
			'이 노트로 가는 링크를 넣습니다. 누르면 지금 노트의 커서 자리에(편집 모드가 아니면 노트 끝에), 끌어다 노트에 놓으면 놓은 자리에 들어갑니다.',
		inserted: '{name} 링크를 넣었습니다.',
		insertFailed: '링크를 넣지 못했습니다.',
		stateNotConfigured: '설정 → Intra Copilot → 커넥터 → 임베딩 서버에서 서버 주소와 모델을 먼저 입력하세요.',
		stateNotBuilt:
			'아직 색인이 없습니다. [색인 만들기]를 누르면 보낼 양과 서버가 나오고, 거기서 [색인 시작]을 눌러야 볼트 노트의 제목과 본문을 임베딩 서버로 보내 색인합니다.',
		stateOtherModel:
			'지금 색인은 다른 서버·모델({model})로 만들어 쓸 수 없습니다. [색인 만들기]로 지금 설정에 맞게 다시 만드세요.',
		stateOptionsChanged:
			'고급 설정(노트당 벡터 수·문서 형식·조각 최대 글자 수·벡터 크기)이 바뀌어 지금 색인을 쓸 수 없습니다. [다시 만들기]로 새 설정에 맞게 다시 만드세요.',
		advancedWarning:
			'주의: 한 번에 보낼 조각 수를 뺀 아래 값을 바꾸면 지금 색인을 쓸 수 없어 [다시 만들기]로 볼트 노트 전체를 임베딩 서버로 다시 보내야 합니다. 노트가 많으면 오래 걸리고 서버 사용량도 많이 씁니다.',
		// 커넥터 창 머리줄 왼쪽의 색인 상태등
		indexLabelNone: '색인 없음',
		indexLabelIndexing: '색인 중 {done}/{total}',
		indexLabelError: '색인 오류',
		indexLabelPending: '갱신 필요 {count}',
		indexLabelReady: '색인 최신',
		pendingTooltip: '노트 {count}개가 새로 생겼거나 바뀌어 색인이 최신이 아닙니다. 자동 갱신을 기다리거나 [업데이트]를 누르세요.',
		updateButton: '업데이트',
		updateTooltip:
			'색인에 반영되지 않은 노트 {count}개를 지금 맞춥니다. 내용이 바뀐 노트만 임베딩 서버로 보내고, 링크·속성만 바뀐 노트는 보내지 않습니다.',
		stateIndexing: '색인하는 중… {done}/{total}',
		stateWaiting: '서버 사용량 제한에 걸려 잠시 기다린 뒤 이어서 보냅니다… {done}/{total}',
		stateError: '색인 실패: {reason}',
		stateReady: '노트 {count}개 색인됨',
		buildButton: '색인 만들기',
		rebuildButton: '다시 만들기',
		confirmTitle: '색인 만들기',
		confirmCounting: '보낼 양을 세는 중…',
		confirmSummary: '노트 {notes}개 · 조각 {chunks}개 → 서버 요청 약 {requests}번',
		confirmTarget: '보낼 곳: {url} (모델: {model})',
		confirmWarning:
			'위 노트의 제목과 본문(속성 제외)이 이 서버로 전송됩니다. 회사가 승인한 서버인지 확인하세요. 보내면 안 되는 폴더는 커넥터 → 인덱스의 제외 폴더에 먼저 넣으세요. 이미 만든 색인이 있으면 지우고 처음부터 다시 보냅니다.',
		confirmStart: '색인 시작',
		confirmCancel: '취소',
		retryButton: '다시 시도',
		checkTooltip:
			'임베딩 서버에 짧은 고정 문장 하나를 보내 연결을 확인합니다(노트 내용은 보내지 않음). 평소에는 서버에 따로 묻지 않고, 색인하며 보낸 요청의 결과로 상태등이 바뀝니다.',
		serverIdleTooltip:
			'Obsidian을 켠 뒤 아직 임베딩 서버에 보낸 요청이 없습니다. 노트를 고쳐 색인되거나 [연결 확인]을 누르면 상태가 바뀝니다.',
		serverIntro:
			'노트를 벡터(뜻을 나타내는 숫자 목록)로 바꿀 임베딩 서버를 연결합니다. OpenAI 호환 /embeddings API를 지원하며(사내 API, 직접 띄운 llama-server·Ollama·vLLM 등), 챗봇의 LLM 서버와 따로 둡니다.',
		privacyNote:
			'색인하면 볼트 노트의 제목과 본문(속성 제외)이 여기서 설정한 임베딩 서버로 전송됩니다. 회사가 승인한 서버만 입력하고, 보내면 안 되는 노트가 있는 폴더는 인덱스의 제외 폴더에 넣으세요.',
		baseUrlName: '서버 주소',
		baseUrlDesc: '임베딩 서버의 API 주소입니다. 보통 /v1로 끝납니다. 예: http://서버주소:8080/v1',
		baseUrlPlaceholder: 'http://서버주소:8080/v1',
		apiKeyName: 'API 키',
		apiKeyDesc: '서버에 접속할 때 쓰는 인증 키입니다. 키가 필요 없는 서버라면 비워두세요.',
		modelName: '모델',
		modelDesc:
			'노트를 벡터로 바꿀 모델 이름입니다. 직접 입력하거나, [모델 목록 불러오기] 뒤 입력칸을 눌러 고릅니다. 모델이나 서버 주소를 바꾸면 색인을 다시 만들어야 합니다.',
		modelListButton: '모델 목록 불러오기',
		loadingModels: '불러오는 중...',
		modelsLoaded: '모델 {count}개를 불러왔습니다. 입력칸을 눌러 고르세요.',
		noModels: '서버가 알려 준 모델이 없습니다. 모델 이름을 직접 입력하세요.',
		testName: '연결 확인',
		testDesc: '정해진 테스트 문장 하나를 보내 벡터가 돌아오는지 확인합니다. 노트 내용은 보내지 않습니다.',
		testButton: '연결 확인',
		testing: '확인 중...',
		testOk: '연결됨 · 벡터 {dims}차원',
		fillFirst: '서버 주소와 모델을 먼저 입력하세요.',
		statusIdle: '아직 확인하지 않음',
		indexIntro:
			'어떤 노트를 색인할지와 한 번에 보내는 양을 정합니다. 처음 색인은 [색인 만들기]를 눌러야 시작하고, 그 뒤로는 자동 갱신 주기에 따라 바뀐 노트만 보냅니다(속성만 바뀐 노트는 보내지 않음).',
		autoSyncName: '자동 갱신',
		autoSyncDesc:
			'바뀐 노트를 언제 임베딩 서버로 보내 색인할지 정합니다. Obsidian을 켤 때도 이 주기를 따릅니다. 10분·30분·1시간은 첫 변경부터 그 시간이 지나면 그동안 바뀐 노트를 한꺼번에 보냅니다. 주기를 길게 하거나 끄면 서버 호출이 줄고, 그동안은 커넥터 창 색인 상태등이 노랑이 되며 [업데이트]로 필요할 때 직접 맞출 수 있습니다.',
		autoSyncQuiet: '마지막으로 고치고 15초 뒤(기본)',
		autoSync10m: '10분마다',
		autoSync30m: '30분마다',
		autoSync1h: '1시간마다',
		autoSyncOff: '끄기(직접 [업데이트])',
		statusName: '색인 상태',
		statusDesc:
			'[다시 만들기]는 모든 노트를 처음부터 다시 보냅니다. 서버 주소·모델이나 고급 설정(한 번에 보낼 조각 수 제외)을 바꾸면 지금 색인을 쓸 수 없어 자동 색인이 멈추고 [색인 만들기]·[다시 만들기]가 나타납니다.',
		indexFileName: '색인 파일 위치',
		indexFileDesc:
			'{path} — 볼트 폴더 기준 경로입니다. 색인을 지우려면 Obsidian을 끈 뒤 이 파일을 지우세요(켜 둔 채 지우면 메모리에 있는 색인이 다시 저장됩니다). 여러 기기에서 동기화한다면 이 파일(과 .tmp)을 동기화에서 빼세요.',
		openFolderFailed: '색인 파일이 있는 폴더를 열지 못했습니다.',
		excludedFoldersName: '제외 폴더',
		excludedFoldersDesc:
			'쉼표(,)로 구분합니다. 이 폴더의 노트는 서버로 보내지도, 추천하지도 않습니다. 하위 폴더도 함께 빠지며 대소문자는 가리지 않습니다. 켜 둔 템플릿 플러그인의 템플릿 폴더와 Excalidraw 그림은 자동으로 뺍니다.',
		batchSizeName: '한 번에 보낼 조각 수',
		batchSizeDesc: '요청 하나에 담는 조각 수입니다. 서버가 너무 많다고 거절하면 줄이세요. 비워두면 기본값(16)으로 돌아갑니다.',
		chunkCharsName: '조각 최대 글자 수',
		chunkCharsDesc:
			'노트를 이 글자 수 이하의 조각으로 나눠 보냅니다(노트 하나에 최대 20조각, 넘는 뒷부분은 쓰지 않음). 서버가 입력이 너무 길다고 거절하면 줄이세요. 바꾼 값은 [다시 만들기] 뒤 모든 노트에 적용됩니다. 비워두면 기본값(1000)으로 돌아갑니다.',
		resultCountName: '보여 줄 노트 수',
		resultCountDesc: '커넥터 창에 보여 줄 비슷한 노트 개수입니다. 비워두면 기본값(10)으로 돌아갑니다.',
		linkedNotesName: '이미 링크된 노트',
		linkedNotesDesc:
			'지금 노트에 이미 링크가 있는 노트를 목록에서 어떻게 보여 줄지 정합니다. 새로 연결할 노트만 보고 싶으면 "맨 아래로"나 "숨기기"를 고르세요.',
		linkedNotesShow: '비슷한 순서대로 함께 보여 주기',
		linkedNotesBottom: '맨 아래로 보내기',
		linkedNotesHide: '숨기기',
		documentFormatName: '문서 형식',
		documentFormatDesc:
			'조각마다 서버로 보내는 글의 모양입니다. {title}은 노트 제목, {text}는 조각 본문이며 {text}는 꼭 있어야 합니다. 모델이 권장하는 접두어를 쓰면 추천이 더 정확해집니다. 예: embeddinggemma는 title: {title} | text: {text}, nomic-embed는 search_document: {title} {text}, e5 계열은 passage: {title} {text}. 바꾼 값은 [다시 만들기] 뒤 적용됩니다.',
		dimensionsName: '벡터 크기',
		dimensionsDesc:
			'서버에 요청할 벡터의 숫자 개수입니다. 0이면 모델 기본 크기를 씁니다. 크기를 줄이면 색인 파일이 작아지고 검색이 빨라지며, 지원하는 모델(예: Gemini, OpenAI text-embedding-3)은 품질 손실이 작습니다(예: 3072 → 768). 지원하지 않는 서버는 요청을 거절하니 그때는 0으로 두세요. 바꾼 값은 [다시 만들기] 뒤 적용되며, 먼저 [연결 확인]으로 크기를 확인하세요. 비워두면 기본값(0)으로 돌아갑니다.',
		vectorsPerNoteName: '노트당 벡터 수',
		vectorsPerNoteDesc:
			'노트 하나를 몇 개의 벡터로 저장할지 정합니다(1~5). 1이면 노트 전체의 평균 하나이고, 2 이상이면 뜻이 가까운 조각끼리 묶어 주제별로 저장해 주제가 여러 개인 긴 노트도 잘 찾습니다. 서버로 보내는 양은 같지만 색인 파일이 커지고 검색이 조금 느려집니다. 바꾼 값은 [다시 만들기] 뒤 모든 노트에 적용됩니다. 비워두면 기본값(1)으로 돌아갑니다.',
		// 챗봇 안내문(llm.errors)이 커넥터에는 맞지 않는 원인만 따로 둡니다. 나머지는 llm.errors를 그대로 씁니다.
		errors: {
			auth: 'API 키가 없거나 올바르지 않거나, 이 서버를 쓸 권한이 없습니다(인증 실패). 설정의 커넥터 → 임베딩 서버에서 API 키를 확인하세요.',
			model:
				'서버가 이 모델로는 벡터를 만들 수 없다고 응답했습니다. 모델 이름이 틀렸거나 임베딩용이 아닌 모델(대화용 등)일 수 있습니다.',
			'context-length':
				'조각이 모델이 한 번에 받을 수 있는 길이를 넘었습니다. 커넥터 → 인덱스에서 "조각 최대 글자 수"를 줄이고 [다시 만들기]를 누르세요.',
			'bad-request':
				'서버가 요청을 거절했습니다. 모델 이름을 확인하고, 커넥터 → 인덱스에서 "한 번에 보낼 조각 수"나 "조각 최대 글자 수"를 줄여 보세요.',
			'invalid-response':
				'서버가 임베딩 API 형식이 아닌 응답을 보냈거나, 받은 벡터의 개수·크기가 맞지 않습니다. 서버 주소가 API 주소(보통 /v1로 끝남)인지 확인하고, 서버의 모델이 바뀌었다면 [다시 만들기]를 누르세요.',
		},
	},
	// 리마인더 화면(ui/reminder-view.ts)과 설정(ui/settings/reminder-section.ts)
	reminder: {
		title: '리마인더',
		ribbonTooltip: '리마인더 열기',
		todayCount: '오늘 다시 볼 노트 {count}개',
		scopeNote: '이 볼트 안의 노트만 살펴보며, 노트 내용이나 목록을 어디로도 보내지 않습니다.',
		doneToday: '오늘 챙길 노트를 모두 챙겼습니다. 더 읽고 싶으면 아래 [더 보기]를 누르세요.',
		nothingDue: '지금 다시 볼 노트가 없습니다.',
		moreButton: '더 보기 ({count}개)',
		reasonNeverRead: '읽은 기록 없음 · 파일 수정 {date}',
		reasonRead: '{days}일 전에 읽음 ({date})',
		reasonOrphan: '들어오는 링크 없음',
		laterButton: '나중에',
		laterTooltip: '며칠 뒤에 다시 목록에 올릴지 고릅니다',
		laterChoice: '{days}일 뒤',
		postponedNotice: '{name} — {days}일 뒤에 다시 목록에 올립니다.',
		archivedNotice: '{name} — {folder} 폴더로 옮겼습니다.',
		deletedNotice: '{name} — 남은 시간이 지나면 휴지통으로 보냅니다.',
		undoButton: '되돌리기',
		undoCountdown: '({seconds}초)',
		undoArchiveFailed: '되돌리지 못했습니다. 그사이 노트가 옮겨지거나 지워졌거나, 원래 자리에 같은 이름의 노트가 있습니다.',
		undoDeleteTooLate: '이미 휴지통으로 보내서 되돌리지 못했습니다. 휴지통에서 되살리세요.',
		chatButton: '챗봇으로 열기',
		chatTooltip:
			'노트를 열고 새 대화를 시작해 입력칸 위에 칩으로 올리며, 읽은 날 속성에 오늘 날짜를 적습니다 (질문은 직접 써서 보냅니다)',
		archiveButton: '보관함',
		archiveTooltip: '보관 폴더({folder})로 옮깁니다',
		archiveExists: '보관 폴더에 같은 이름의 노트가 있어 옮기지 못했습니다: {path}',
		archiveFailed: '노트를 보관 폴더로 옮기지 못했습니다.',
		deleteButton: '삭제',
		deleteConfirmButton: '한 번 더 눌러 삭제',
		deleteTooltip: '두 번 눌러 확정하면 되돌리기 알림 시간 뒤에 휴지통으로 보냅니다',
		deleteFailed: '노트를 삭제하지 못했습니다.',
		propertyWriteFailed: '노트 속성(날짜)을 적지 못했습니다.',
		undoPropertiesFailed: '되돌리지 못했습니다. 노트 속성의 날짜를 직접 고쳐 주세요.',
		dailyNotice: '리마인더: 오늘 다시 볼 노트가 {count}개 있습니다. 여기를 눌러 열기',
		targetsIntro:
			'이 플러그인이 설치된 볼트 안의 모든 노트(.md)를 살펴봅니다. 다른 볼트나 볼트 밖의 파일은 보지 않으며, 노트 내용이나 목록을 어디로도 보내지 않습니다. ' +
			'제외 폴더·보관 폴더 안의 노트와 작성일부터 유예 기간이 안 된 노트는 목록에 올리지 않으며, 켜 둔 코어 템플릿·Templater 플러그인의 템플릿 폴더와 Excalidraw 그림도 자동으로 뺍니다.',
		excludedFoldersName: '제외 폴더',
		excludedFoldersDesc: '쉼표(,)로 구분합니다. 하위 폴더도 함께 빠지며, 대소문자는 가리지 않습니다. 예: Templates, Daily',
		graceDaysName: '새 노트 유예 기간(일)',
		graceDaysDesc:
			'작성일 속성부터 이 기간이 지나지 않은 노트는 목록에 올리지 않습니다(작성일 속성이 없으면 파일의 만든 날짜와 수정일 중 이른 날 기준). 0이면 바로 올립니다. 비워두면 기본값(7)으로 돌아갑니다.',
		deferTagsName: '미룸 태그',
		deferTagsDesc:
			'다시 볼 노트 중 이 태그가 붙은 노트를 목록 앞쪽에 보여 줍니다. 쉼표로 구분하고 #은 빼고 적습니다. 하위 태그(예: todo/업무)도 포함되며, 대소문자는 가리지 않습니다.',
		archiveFolderName: '보관 폴더',
		archiveFolderDesc:
			'노트 카드의 [보관함]을 누르면 노트를 이 폴더로 옮깁니다(링크는 Obsidian이 알아서 고칩니다). 폴더가 없으면 만들고, 이 폴더의 노트는 목록에 올리지 않습니다. 비워두면 기본값(Archive)으로 돌아갑니다.',
		scheduleIntro:
			'[나중에]에서 고를 기간, 하루에 챙길 노트 수, 되돌리기 알림 시간, 하루 한 번 알림을 정합니다. ' +
			'목록은 들어오는 링크가 없거나 미룸 태그가 붙은 노트가 앞에 오고(둘 다면 맨 앞), 나머지는 오래 손대지 않은 순서(읽은 기록이 있으면 마지막으로 읽은 날, 없으면 파일 수정일 기준)입니다.',
		snoozeName: '나중에 기본 기간(일)',
		snoozeDesc:
			'[나중에]를 누르면 나오는 기간 중 맨 위(기본)입니다. 또 읽은 날([챗봇으로 열기]·챗봇 수정 [적용] 포함)부터 이 기간이 지나기 전에는 노트를 다시 올리지 않습니다. [나중에]로 적힌 다시 볼 날은 이 값을 바꿔도 그대로입니다. 비워두면 기본값(7)으로 돌아갑니다.',
		snooze2Name: '나중에 기간 2(일)',
		snooze2Desc: '[나중에]에서 두 번째로 고를 수 있는 기간입니다. 비워두면 기본값(30)으로 돌아갑니다.',
		snooze3Name: '나중에 기간 3(일)',
		snooze3Desc:
			'[나중에]에서 세 번째로 고를 수 있는 기간입니다. 다 읽은 노트를 오래 미룰 때 씁니다. 비워두면 기본값(90)으로 돌아갑니다.',
		dailyLimitName: '하루 표시 개수',
		dailyLimitDesc:
			'하루에 챙길 노트 수입니다. [나중에]·[챗봇으로 열기]·[보관함]·[삭제]로 처리한 노트가 이 수에 들어가며([되돌리기]하면 빠집니다), 목록 아래 [더 보기]로 더 볼 수 있습니다. 비워두면 기본값(5)으로 돌아갑니다.',
		undoSecondsName: '되돌리기 알림 시간(초)',
		undoSecondsDesc:
			'[나중에]·[보관함]·[삭제]를 누른 뒤 [되돌리기]가 있는 알림을 보여 주는 시간입니다. 알림에 남은 시간이 함께 보이며, [삭제]한 노트는 이 시간이 지나야 휴지통으로 보냅니다. 비워두면 기본값(6)으로 돌아갑니다.',
		propertiesIntro:
			'리마인더는 기록을 노트 속성(frontmatter)에 날짜(YYYY-MM-DD)로 적습니다. 그래서 노트 이름을 바꾸거나 옮겨도 날짜가 따라가고, 노트를 열면 언제 쓰고·읽고·고쳤는지 보입니다. ' +
			'[나중에]는 읽은 날·다시 볼 날을, [챗봇으로 열기]는 읽은 날을, 챗봇 수정 [적용]은 수정일·읽은 날을 적고, 작성일이 비어 있으면 파일 날짜로 함께 채웁니다(있으면 덮어쓰지 않음). ' +
			'다른 플러그인이 이미 쓰는 속성이 있으면 아래에서 그 이름으로 맞추세요. 이름을 바꿔도 예전 이름으로 적힌 날짜는 옮기지 않습니다.',
		propCreatedName: '작성일',
		propCreatedDesc: '노트를 쓴 날. 비어 있을 때만 채우며, 새 노트 유예 기간의 기준입니다. 비워두면 기본값(created)으로 돌아갑니다.',
		propReadName: '읽은 날',
		propReadDesc:
			'[나중에]·[챗봇으로 열기]·챗봇 수정 [적용]을 한 날. 수정일과 둘 중 늦은 날을 "마지막으로 읽은 날"로 봅니다. 비워두면 기본값(read)으로 돌아갑니다.',
		propUpdatedName: '수정일',
		propUpdatedDesc: '챗봇 수정을 [적용]한 날. 고쳤으면 읽은 것으로 봅니다. 비워두면 기본값(updated)으로 돌아갑니다.',
		propReviewName: '다시 볼 날',
		propReviewDesc:
			'[나중에]에서 고른 기간으로 정한 날. 이날부터 다시 목록에 올라오며, 직접 고쳐도 됩니다. 비워두면 기본값(review)으로 돌아갑니다.',
		notifyName: '하루 한 번 알림',
		notifyDesc:
			'그날 처음 Obsidian을 켰을 때(켜 둔 채 날이 바뀌었다면 Obsidian 창을 보고 있을 때) 다시 볼 노트가 있으면 알림을 한 번 띄웁니다.',
	},
	license: {
		// 라이선스 문서 창의 제목입니다(본문은 content/docs.ts의 LICENSE_BOOK).
		summaryHeading: '라이선스 및 정책',
		versionLabel: '버전',
		buildLabel: '빌드',
		publisherLabel: '제작자',
	},
};

export type Dictionary = typeof ko;

// 화면 부품들이 "이 화면의 문구 묶음"을 인자로 받을 때 쓰는 타입입니다.
export type ChatStrings = Dictionary['chat'];
export type ReminderStrings = Dictionary['reminder'];
export type ConnectorStrings = Dictionary['connector'];

const en: Dictionary = {
	general: {
		introText:
			'Turn scattered information into knowledge, connect it, and put it to use again.\n\n' +
			'The core features you need for knowledge management, together in one plugin.\n' +
			'\t1. AI-assisted note writing and editing, with review of changes\n' +
			'\t2. Link suggestions between related knowledge notes\n' +
			'\t3. Automatic summaries of documents, emails, and PDFs turned into notes\n' +
			'\t4. Reminders for knowledge notes you have not revisited in a while\n\n' +
			'Built to work even in company environments with restricted internet access, it can use AI models on your company server or on your own local machine.\n',
		guideButton: 'User guide',
		licenseButton: 'License & policy',
		settingsHeading: 'Settings',
		setupHeading: 'Getting started',
		setupSteps:
			'① Enter the server address in the [Chatbot] card above → [LLM connection], ② pick a model with [Load model list] and press [Check connection], then ③ open the chatbot with the chatbot icon (a speech bubble between two lines) in the left ribbon.',
		setupButton: 'Set up LLM connection',
		displayHeading: 'Display',
		languageName: 'Display language',
		languageDesc:
			'Change the language used in this plugin (settings and chatbot). The user guide and license documents are available in Korean only.',
	},
	features: {
		available: 'Available',
		upcoming: 'Coming soon',
		chatbot: {
			name: 'Chatbot',
			desc: 'Write and edit notes with AI, and review suggested changes before applying them.',
			tagline: 'Write, refine, and ask about your notes side by side with AI.',
		},
		connector: {
			name: 'Connector',
			desc: 'Suggest links between related knowledge notes.',
			tagline: 'Finds notes that share this note’s meaning and connects your knowledge.',
		},
		maker: {
			name: 'Maker',
			desc: 'Writes a new note from pasted text, following your template.',
			tagline: 'Turns what you receive into a note in your own format.',
		},
		reminder: {
			name: 'Reminder',
			desc: 'Bring back a few knowledge notes you have not revisited in a while, every day.',
			tagline: 'Brings back the knowledge notes you were starting to forget.',
		},
	},
	sections: {
		llm: 'LLM connection',
		prompt: 'System prompt',
		skills: 'Skills',
		embedding: 'Embedding server',
		index: 'Index',
		templates: 'Templates',
		prompts: 'Prompts',
		mcp: 'MCP connections',
		reminderTargets: 'Target notes',
		schedule: 'Schedule & alerts',
		reminderProperties: 'Note properties',
	},
	upcoming: {
		notice: 'This feature is still being built. Below are placeholders for its future settings, which cannot be changed yet.',
		templatesIntro: 'Manage the template notes to follow when creating a new note from pasted text.',
		templatesFolder: { name: 'Folder', desc: 'Folder that holds template notes' },
		templatesDefault: { name: 'Default', desc: 'Template used when none is chosen' },
		promptsIntro: 'Manage the instructions given to the model when creating a new note.',
		promptsInstructions: { name: 'Note creation instructions', desc: 'Rules the model follows when filling in a template' },
		mcpIntro: 'Manage connections to external tools (MCP servers) used when creating new notes.',
		mcpServers: { name: 'Servers', desc: 'List of MCP servers to connect to' },
		buttonAdd: 'Add',
	},
	docs: {
		toc: 'Contents',
		prev: 'Previous',
		next: 'Next',
		upcoming: 'Coming soon',
	},
	llm: {
		privacyNote:
			'The chatbot sends note content only to the LLM server you configure here, and only what is shown as a chip above the chat box. The Connector uses its own embedding server from the Connector settings.',
		intro:
			'Supports OpenAI-compatible APIs ' +
			'(e.g. an internal server running vLLM). Checking the connection never sends ' +
			'note content — only a fixed test sentence.',
		baseUrlName: 'Server address',
		baseUrlDesc:
			'The API address of the LLM server, usually ending in /v1. e.g. http://server:8000/v1',
		baseUrlPlaceholder: 'http://server:8000/v1',
		apiKeyName: 'API key',
		apiKeyDesc: 'The key used to authenticate with the server. Leave empty if the server does not require one.',
		maxHistoryName: 'Messages sent as history',
		maxHistoryDesc:
			'How many recent messages to send along with each question. Questions and answers count as one each, so 20 is roughly the last 10 exchanges including the current question. ' +
			'The full conversation stays on screen. 0 means no limit (send everything); leave empty to restore the default (20).',
		maxResponseName: 'Answer length limit (max_tokens)',
		maxResponseDesc:
			'The maximum answer length in tokens (the unit models use to count text). Reasoning models spend part of this on their thinking, so a small value cuts answers off. ' +
			'0 means no limit (server default); leave empty to restore the default (4096).',
		maxContextName: 'Max note material length',
		maxContextDesc:
			'The maximum number of characters sent when attaching the folders and notes shown as chips above the chat box. Notes that do not fit are left out, and the model is told that some material is missing. ' +
			'Lower this if answers fail because the input is too long. 0 means no limit; leave empty to restore the default (8000).',
		streamingName: 'Streaming answers',
		streamingDesc:
			'Show the answer as the server produces it, instead of waiting for the whole answer. ' +
			'Turn it off if the server blocks streaming (the answer then appears at once when finished). ' +
			'Even when on, the plugin silently retries the old way if it receives no chunk at all.',
		chatTimeoutName: 'Answer timeout (seconds)',
		chatTimeoutDesc:
			'How long to wait for a chatbot answer. With streaming on, the wait restarts after each received chunk. Increase it if answers often fail with a timeout. ' +
			'Saved between 10 and 3600 seconds (values outside are moved to the nearest end); leave empty to restore the default (120 seconds). ' +
			'[Load model list] and [Check connection] always wait up to 30 seconds regardless of this value.',
		systemPromptIntro:
			'Instructions added to the start of the conversation every time you ask the chatbot, e.g. "Always answer briefly." Leave empty to send nothing. ' +
			'Changes apply only after you press [Save]; [Cancel] restores the last saved text.',
		systemPromptSave: 'Save',
		systemPromptCancel: 'Cancel',
		systemPromptSaved: 'System prompt saved.',
		advancedName: 'Advanced settings',
		modelCheckHeading: 'Model selection & connection check',
		modelCheckDesc:
			'Use [Load model list] to fetch the models available on the server and pick one, then [Check connection] to confirm that model actually answers.',
		modelCheckButton: 'Load model list',
		loadingModels: 'Loading...',
		modelPlaceholder: 'Choose a model',
		testDesc: 'Sends a short test sentence to the selected model to confirm it actually answers.',
		testButton: 'Check connection',
		testing: 'Checking...',
		statusIdle: 'Not checked yet',
		statusChecking: 'Checking...',
		statusOk: 'Connection OK',
		statusError: 'Check failed',
		statusMissing: 'Choose a model first',
		statusReplyPrefix: 'Model answered: ',
		fillBaseUrlFirst: 'Enter the server address first.',
		fetchOk: 'Loaded the model list ({count} models)',
		fetchFailPrefix: 'Could not load the model list: ',
		noModelsFound: 'The server has no models available (empty list).',
		modelsOkHint: 'the connection is confirmed by the first chat or the [Check] button',
		lastVerifiedPrefix: 'Checked at: ',
		lastSuccessPrefix: 'Last successful connection: ',
		neverVerified: 'No successful connection yet.',
		statusConnectionChanged: 'Needs checking — server settings changed',
		statusModelChanged: 'Needs checking — the model changed',
		chatOk: 'Answer received',
		chatFailPrefix: 'Could not get an answer: ',
		modelNotInList: 'The selected model is not in the server’s model list. Choose one from the dropdown again.',
		errors: {
			'invalid-url':
				'The server address is not valid. Enter an address starting with http:// or https:// (e.g. http://server:8000/v1).',
			timeout:
				'The server did not respond within {seconds} seconds. It may be busy or down — try again shortly.',
			network:
				'Cannot reach the server. Check the address (typos, http/https, port) and your network connection (company network / VPN).',
			certificate:
				'The server’s security certificate is not trusted. Check the address, and for an internal server ask the server admin or IT.',
			auth: 'The API key is missing or wrong, or you do not have access to this server (authentication failed). Check the API key in Settings → Chatbot → LLM connection.',
			'not-found':
				'Reached the server, but the requested path was not found. Make sure the address is the API address (usually ending in /v1).',
			model:
				'The server says it cannot chat with the selected model. The name may be wrong, or it may not be a chat model (speech, embedding, etc.). Try another model.',
			'context-length':
				'The conversation is longer than the model can handle at once. Start a new conversation, or lower "Messages sent as history", "Max note material length", or "Answer length limit" in advanced settings.',
			'rate-limit': 'Too many requests — the server is temporarily refusing them (rate limit). Try again shortly.',
			'bad-request':
				'The server rejected the request. Check the selected model and advanced settings (answer length limit, etc.).',
			server: 'Internal server error (a problem on the server side). Try again shortly; if it continues, contact the server admin.',
			'invalid-response':
				'The server replied with something that is not an LLM API response. Make sure the address is the API address (usually ending in /v1), not a web page.',
			unknown: 'The request failed for an unknown reason. Check the raw error message.',
			redirect:
				'The server tried to send the request to a different address (redirect), which was not followed for security. Enter the exact API address (usually ending in /v1).',
			cancelled: 'Stopped waiting for the answer.',
		},
	},
	chat: {
		title: 'Chatbot',
		ribbonTooltip: 'Open chatbot',
		inputPlaceholder: 'Type a message (@: folder/note, /: skill, Enter: send, Shift+Enter: new line)',
		sendButton: 'Send',
		emptyState:
			'No messages yet. Type something below to start. The note you have open appears as a chip above the box, and asking a question while it is there sends that note (remove it with ×). ' +
			'Type @ to add other folders or notes, and / to use a saved skill (a reusable task instruction).',
		editTooltip: 'Edit and resend (replaces the conversation from this message on)',
		editBanner: 'Editing a message — sending replaces this message and the {count} messages from here on. (Esc: cancel)',
		editCancel: 'Cancel',
		editSkillMissing: 'The skill used in this message was not found, so it is edited without a skill.',
		pickerWholeVault: 'Whole vault',
		pickerCurrentNote: 'Current note',
		pickerNoMatch: 'No matching folders or notes',
		skillPickerNoMatch: 'No matching skills — add them in Settings → Chatbot → Skills',
		pickerHint: '↑↓ move · Enter select · Esc close',
		targetRemoveTooltip: 'Remove',
		currentNoteChip:
			'The note you have open. It is the only note this conversation can edit. (Remove with × to stop sending it.)',
		skillRemoveTooltip: 'Clear skill',
		targetMissing: 'Removed because it no longer exists in the vault: {names} — check and send again.',
		contextReadFailed: 'Could not read the selected notes. Try again.',
		attachedInfo: '{count} notes · {chars} chars attached',
		attachedTruncated: ' · partly left out (length limit)',
		thinking: 'Waiting for an answer...',
		streamingReasoning: 'Thinking...',
		notConfigured: 'Set the server address and model first in Settings → Intra Copilot → Chatbot → LLM connection.',
		errorPrefix: 'Error: ',
		retryButton: 'Retry',
		emptyReply: '(empty answer)',
		truncatedNotice:
			'The answer hit the answer length limit (max_tokens) and was cut off. Raise the limit in advanced settings to get longer answers.',
		reasoningSummary: 'Show reasoning',
		timeoutHint: 'If the question needs a long answer, increase "Answer timeout" in advanced settings.',
		copyTooltip: 'Copy answer',
		copied: 'Copied the answer to the clipboard.',
		copyFailed: 'Could not copy to the clipboard.',
		saveFailed: 'Could not save the conversation to a file.',
		busyNotice: 'Waiting for an answer. Try again after it arrives, or press [Stop].',
		stopButton: 'Stop',
		stopTooltip: 'Stop waiting for the answer. (The server may still finish generating it.)',
		sendTooltip: 'Send (Enter)',
		linkBlockedNotice: 'For security, links in answers cannot be opened. The address was copied to the clipboard.',
		newChatButton: 'New chat',
		historyButton: 'History',
		checkConnectionButton: 'Check',
		statusLabelOk: 'Connected',
		statusLabelError: 'Failed',
		statusLabelIdle: 'Not checked',
		statusLabelChecking: 'Checking',
		checkConnectionTooltip:
			'Reload the server’s model list and send a short test sentence to confirm the selected model actually answers',
		newChatTooltip: 'Start a new conversation (the current one stays in past conversations)',
		historyTooltip: 'View past conversations',
		historyTitle: 'Past conversations',
		historyEmpty: 'No saved conversations yet.',
		historyLoadButton: 'Load',
		historyDeleteTooltip: 'Delete this conversation',
		historyDeleteConfirm: '⚠ Click again to permanently delete this conversation.',
		historyDeleteConfirmTooltip: 'Click again to delete',
		historyLoadFailed: 'Could not load the conversation.',
		historyCurrentDeleted: 'The conversation you were viewing was deleted, so a new one was started.',
		failedLabel: '⚠ No answer received — this question is not part of the conversation history',
		errorDetails: 'Details (raw error message)',
		emptyTitle: '(empty conversation)',

		editApplyButton: 'Apply',
		editApplyTooltip: 'Edit the note as shown. The note is backed up first.',
		editRevertButton: 'Undo',
		editRevertTooltip: 'Undo this edit. Other changes you made afterwards are kept.',
		editAppliedLabel: 'Applied',
		editAppendLabel: 'Append to the end of the note',
		editDeleteLabel: 'Remove this part',
		editDiffSkipped: '… {count} unchanged lines hidden',
		editChecking: 'Matching against the note...',
		editProblemNotCurrent:
			'This is not the note that was open when you sent the question, so it cannot be edited. Only that one note can be edited. Open this note and ask again.',
		editProblemNoteMissing: 'No note at this path. It may have been moved or renamed.',
		editProblemNotFound:
			'Could not find the original text in the note. The note may have changed, or the chatbot copied it slightly differently. Ask the chatbot again.',
		editProblemAmbiguous:
			'The same text appears in several places, so there is no way to tell which one to edit. Ask for a suggestion that includes more surrounding lines.',
		editProblemAlreadyThere:
			'The text to append is already in the note, so it was blocked to avoid adding it twice.',
		editProblemNoChange: 'Before and after are identical — nothing would change.',
		editApplied: 'Note edited: {path}',
		editReverted: 'Edit undone: {path}',
		editApplyFailed: 'Could not edit the note: {reason}',
		editRevertFailed:
			'Could not undo — the applied text seems to have changed again. The original is kept in the plugin folder at backups/{name}.',
		editRevertFailedNoBackup:
			'Could not undo — the applied text seems to have changed again. Please check the note yourself.',
		editBackupFailed: 'The note was edited, but the original could not be backed up.',
		editOpenNoteTooltip: 'Open this note (check it before applying)',
		editFold: 'Collapse',
		editUnfold: 'Expand',
		editStreaming: '(writing a suggested note edit…)',
		editSummaryCount: '{count} suggested note edits',
		editApplyAllButton: 'Apply all',
		editApplyAllTooltip:
			'Apply every suggestion that can be applied, from the top. Use each card’s [Apply] to go one by one.',
		editApplyAllConfirm: '⚠ Press again to apply all',
		editApplyAllNone: 'No suggestion can be applied right now.',
		editFormatBroken:
			'⚠ The chatbot did not follow the edit format, so no [Apply] button could be created. Ask it to use the exact edit format and try again.',
	},
	skills: {
		intro:
			'Save task instructions you use often as skills, then type / in the chatbot input to use them. Each skill is saved as one .md file in the folder below, ' +
			'so you can edit it directly in any text editor or copy the file to share it. If you edited a file directly, press [Reload list].',
		folderLabel: 'Folder: ',
		openFolderButton: 'Open folder',
		openFolderFailed: 'Could not open the skill folder.',
		newButton: 'New skill',
		reloadButton: 'Reload list',
		empty: 'No saved skills. Add one with [New skill].',
		noDescription: '(no description)',
		fileLabel: 'File: ',
		emptyInstructions: '⚠ Instructions are empty, so it does not appear in the chatbot list',
		editTooltip: 'Edit',
		deleteTooltip: 'Delete',
		deleteConfirm: '⚠ Click again to permanently delete this skill file.',
		deleteConfirmTooltip: 'Click again to delete',
		deleteFailed: 'Could not delete the skill.',
		loadFailed: 'Could not read the skill list.',
		newTitle: 'New skill',
		editTitle: 'Edit skill',
		nameField: 'Name',
		nameDesc: 'The name you type after / in the chatbot to find it, e.g. Tidy note links',
		descriptionField: 'Description',
		descriptionDesc: 'A one-line description shown under the name in the list. (Optional)',
		instructionsField: 'Instructions',
		instructionsDesc:
			'The task instructions sent to the model along with your message when you pick this skill. Put {{input}} where your typed text should go; without it, your text is added after the instructions. ' +
			'If you also pick notes with @, their content is sent too.',
		saveButton: 'Save',
		cancelButton: 'Cancel',
		nameRequired: 'Enter a name.',
		instructionsRequired: 'Enter the instructions.',
		saveFailed: 'Could not save the skill.',
		saved: 'Skill saved.',
	},
	connector: {
		title: 'Connector',
		ribbonTooltip: 'Open Connector',
		noNote: 'Open a note to see notes with similar meaning.',
		notIndexedNote:
			'This note is not indexed yet. New or edited notes are indexed on the automatic update schedule, or right away with [Update] in the header.',
		excludedNote: 'This note is in an excluded or template folder, so it is not indexed.',
		noResults: 'No similar notes.',
		score: 'Similarity {score}%',
		linked: 'Linked',
		linkedTooltip: 'The current note already links to this note. [Insert link] is hidden so the same link is not added twice.',
		previewTooltip:
			'Click to expand the note’s content inside this card; click again to collapse. The Connector view stays on the current note. Ctrl/Cmd-click opens it in a new tab.',
		selectTooltip: 'Select this note to add to the chatbot',
		chatSelectedButton: 'Add {count} selected to chatbot',
		chatSelectedTooltip:
			'Open the chatbot and add the checked notes as chips above the input. They are sent with your next question, up to the chatbot’s max note material length.',
		chatAdded: 'Added {count} notes above the chatbot input. They are sent with your next question.',
		section: 'Similar section: {section}',
		insertSectionButton: 'Section link',
		insertSectionTooltip:
			'Insert a link straight to the similar section ({section}). Click to insert at the cursor, or drag into the note to insert where you drop.',
		insertButton: 'Insert link',
		insertTooltip:
			'Insert a link to this note. Click to insert at the cursor in the current note (at the end if it is not in editing mode), or drag into the note to insert where you drop.',
		inserted: 'Inserted a link to {name}.',
		insertFailed: 'Could not insert the link.',
		stateNotConfigured: 'Enter the server address and model in Settings → Intra Copilot → Connector → Embedding server first.',
		stateNotBuilt:
			'No index yet. [Build index] shows how much will be sent and where; only [Start indexing] there sends the titles and bodies of the vault notes to the embedding server and indexes them.',
		stateOtherModel:
			'The current index was built with a different server or model ({model}) and cannot be used. Use [Build index] to rebuild it for the current settings.',
		stateOptionsChanged:
			'Advanced settings (vectors per note, document format, max chunk length, vector size) changed, so the current index cannot be used. Use [Rebuild] to rebuild it for the new settings.',
		advancedWarning:
			'Caution: changing any value below except chunks per request makes the current index unusable, and [Rebuild] must send every note in the vault to the embedding server again. With many notes this takes a long time and uses a lot of server quota.',
		indexLabelNone: 'No index',
		indexLabelIndexing: 'Indexing {done}/{total}',
		indexLabelError: 'Index error',
		indexLabelPending: '{count} to update',
		indexLabelReady: 'Up to date',
		pendingTooltip: '{count} notes are new or changed, so the index is not up to date. Wait for the automatic update or click [Update].',
		updateButton: 'Update',
		updateTooltip:
			'Bring {count} notes into the index now. Only notes whose content changed are sent to the embedding server; notes with only link or property changes are not sent.',
		stateIndexing: 'Indexing… {done}/{total}',
		stateWaiting: 'Hit the server rate limit; waiting a moment before continuing… {done}/{total}',
		stateError: 'Indexing failed: {reason}',
		stateReady: '{count} notes indexed',
		buildButton: 'Build index',
		rebuildButton: 'Rebuild',
		confirmTitle: 'Build index',
		confirmCounting: 'Counting what will be sent…',
		confirmSummary: '{notes} notes · {chunks} chunks → about {requests} server requests',
		confirmTarget: 'Destination: {url} (model: {model})',
		confirmWarning:
			'The titles and bodies (without properties) of these notes will be sent to this server. Make sure your company has approved it. Put folders that must not be sent in the excluded folders under Connector → Index first. An existing index is cleared and everything is sent again.',
		confirmStart: 'Start indexing',
		confirmCancel: 'Cancel',
		retryButton: 'Retry',
		checkTooltip:
			'Send one short fixed sentence to the embedding server to check the connection (no note content). Otherwise the server is not polled; the light follows the results of indexing requests.',
		serverIdleTooltip:
			'No request has been sent to the embedding server since Obsidian started. The light updates when notes are indexed or you click [Check].',
		serverIntro:
			'Connect the embedding server that turns notes into vectors (lists of numbers that represent meaning). Supports OpenAI-compatible /embeddings APIs (an internal API, or a self-hosted llama-server, Ollama, vLLM, etc.), separate from the chatbot LLM server.',
		privacyNote:
			'Indexing sends the titles and bodies (without properties) of vault notes to the embedding server configured here. Enter only servers approved by your company, and put folders with notes that must not be sent in the excluded folders under Index.',
		baseUrlName: 'Server address',
		baseUrlDesc: 'The API address of the embedding server, usually ending in /v1. e.g. http://server:8080/v1',
		baseUrlPlaceholder: 'http://server:8080/v1',
		apiKeyName: 'API key',
		apiKeyDesc: 'The key used to access the server. Leave empty if the server does not need one.',
		modelName: 'Model',
		modelDesc:
			'The model that turns notes into vectors. Type it, or click [Load model list] and pick one from the input. Changing the model or server address requires rebuilding the index.',
		modelListButton: 'Load model list',
		loadingModels: 'Loading...',
		modelsLoaded: 'Loaded {count} models. Click the input to pick one.',
		noModels: 'The server listed no models. Type the model name yourself.',
		testName: 'Check connection',
		testDesc: 'Sends one fixed test sentence and checks that a vector comes back. No note content is sent.',
		testButton: 'Check connection',
		testing: 'Checking...',
		testOk: 'Connected · {dims}-dimensional vectors',
		fillFirst: 'Enter the server address and model first.',
		statusIdle: 'Not checked yet',
		indexIntro:
			'Choose which notes to index and how much to send at once. The first index starts only when you click [Build index]; after that, only changed notes are sent on the automatic update schedule (notes whose properties alone changed are not sent).',
		autoSyncName: 'Automatic update',
		autoSyncDesc:
			'When to send changed notes to the embedding server for indexing. Startup follows the same schedule. With 10 minutes, 30 minutes, or 1 hour, notes changed in that time are sent together once it has passed since the first change. A longer schedule or Off means fewer server calls; meanwhile the index light in the Connector view turns yellow and you can click [Update] whenever you need.',
		autoSyncQuiet: '15 seconds after you stop editing (default)',
		autoSync10m: 'Every 10 minutes',
		autoSync30m: 'Every 30 minutes',
		autoSync1h: 'Every hour',
		autoSyncOff: 'Off (click [Update] yourself)',
		statusName: 'Index status',
		statusDesc:
			'[Rebuild] sends every note again from scratch. Changing the server address, model, or advanced settings (except chunks per request) makes the current index unusable, stops automatic indexing, and shows [Build index] or [Rebuild].',
		indexFileName: 'Index file location',
		indexFileDesc:
			'{path} — relative to the vault folder. To clear the index, quit Obsidian first and then delete this file (if Obsidian is running, the index in memory is saved again). Exclude it (and .tmp) from sync if you sync across devices.',
		openFolderFailed: 'Could not open the folder containing the index file.',
		excludedFoldersName: 'Excluded folders',
		excludedFoldersDesc:
			'Separate with commas. Notes in these folders are never sent to the server or suggested. Subfolders are excluded too, and case is ignored. Template folders of enabled template plugins and Excalidraw drawings are left out automatically.',
		batchSizeName: 'Chunks per request',
		batchSizeDesc: 'How many chunks go into one request. Lower it if the server says there are too many. Leave empty to restore the default (16).',
		chunkCharsName: 'Max chunk length (characters)',
		chunkCharsDesc:
			'Notes are split into chunks of at most this many characters (up to 20 chunks per note; the rest is not used). Lower it if the server says the input is too long. A new value applies to all notes after [Rebuild]. Leave empty to restore the default (1000).',
		resultCountName: 'Notes to show',
		resultCountDesc: 'How many similar notes the Connector view shows. Leave empty to restore the default (10).',
		linkedNotesName: 'Already linked notes',
		linkedNotesDesc:
			'How to show notes the current note already links to. Choose "Move to the bottom" or "Hide" to see only notes you have not connected yet.',
		linkedNotesShow: 'Show in similarity order',
		linkedNotesBottom: 'Move to the bottom',
		linkedNotesHide: 'Hide',
		documentFormatName: 'Document format',
		documentFormatDesc:
			'The shape of the text sent for each chunk. {title} is the note title and {text} is the chunk body; {text} is required. Using the prefix your model recommends makes suggestions more accurate, e.g. embeddinggemma: title: {title} | text: {text}, nomic-embed: search_document: {title} {text}, e5 models: passage: {title} {text}. A new value applies after [Rebuild].',
		dimensionsName: 'Vector size',
		dimensionsDesc:
			'How many numbers each vector should have. 0 uses the model default. Smaller vectors make the index file smaller and search faster, and models that support it (e.g. Gemini, OpenAI text-embedding-3) lose little quality (e.g. 3072 → 768). Servers that do not support it reject the request, so keep 0 there. A new value applies after [Rebuild]; check the size with [Check connection] first. Leave empty to restore the default (0).',
		vectorsPerNoteName: 'Vectors per note',
		vectorsPerNoteDesc:
			'How many vectors each note is stored as (1–5). 1 is the average of the whole note; 2 or more groups chunks with similar meaning and stores one vector per topic, so long notes with several topics are found better. The amount sent to the server stays the same, but the index file grows and search gets slightly slower. A new value applies to all notes after [Rebuild]. Leave empty to restore the default (1).',
		errors: {
			auth: 'The API key is missing or wrong, or you do not have access to this server (authentication failed). Check the API key in Settings → Connector → Embedding server.',
			model:
				'The server says it cannot create vectors with this model. The name may be wrong, or it may not be an embedding model (e.g. a chat model).',
			'context-length':
				'A chunk is longer than the model accepts at once. Lower "Max chunk length" under Connector → Index and click [Rebuild].',
			'bad-request':
				'The server rejected the request. Check the model name, and try lowering "Chunks per request" or "Max chunk length" under Connector → Index.',
			'invalid-response':
				'The server sent something that is not an embedding API response, or the number or size of the vectors does not match. Make sure the address is the API address (usually ending in /v1), and click [Rebuild] if the server’s model changed.',
		},
	},
	reminder: {
		title: 'Reminder',
		ribbonTooltip: 'Open reminder',
		todayCount: '{count} notes to revisit today',
		scopeNote: 'Only notes in this vault are checked, and neither their content nor the list is sent anywhere.',
		doneToday: "You have gone through today's notes. To read more, select [Show more] below.",
		nothingDue: 'No notes to revisit right now.',
		moreButton: 'Show more ({count})',
		reasonNeverRead: 'Never read · file modified {date}',
		reasonRead: 'Read {days} days ago ({date})',
		reasonOrphan: 'No incoming links',
		laterButton: 'Later',
		laterTooltip: 'Choose how many days until it returns to the list',
		laterChoice: 'In {days} days',
		postponedNotice: '{name} — it returns to the list in {days} days.',
		archivedNotice: '{name} — moved to the {folder} folder.',
		deletedNotice: '{name} — it goes to the trash when the time runs out.',
		undoButton: 'Undo',
		undoCountdown: '({seconds}s)',
		undoArchiveFailed:
			'Could not undo. The note was moved or deleted in the meantime, or a note with the same name is at the original location.',
		undoDeleteTooLate: 'Could not undo because the note is already in the trash. Restore it from the trash.',
		chatButton: 'Open in chatbot',
		chatTooltip:
			"Open the note, start a new conversation, add the note as a chip above the input, and write today's date to the read property (you write and send the question)",
		archiveButton: 'Archive',
		archiveTooltip: 'Move to the archive folder ({folder})',
		archiveExists: 'A note with the same name is already in the archive folder: {path}',
		archiveFailed: 'Could not move the note to the archive folder.',
		deleteButton: 'Delete',
		deleteConfirmButton: 'Click again to delete',
		deleteTooltip: 'Click twice to confirm; the note goes to the trash after the undo notice time',
		deleteFailed: 'Could not delete the note.',
		propertyWriteFailed: 'Could not write the date properties to the note.',
		undoPropertiesFailed: 'Could not undo. Fix the dates in the note properties yourself.',
		dailyNotice: 'Reminder: {count} notes to revisit today. Click here to open.',
		targetsIntro:
			'Checks every note (.md) in the vault where this plugin is installed. Other vaults and files outside the vault are never read, and neither note content nor the list is sent anywhere. ' +
			'Notes in the excluded or archive folders and notes whose created date is within the grace period are not listed, and template folders of the enabled core Templates or Templater plugin and Excalidraw drawings are left out automatically.',
		excludedFoldersName: 'Excluded folders',
		excludedFoldersDesc: 'Separate with commas. Subfolders are excluded too, and case is ignored, e.g. Templates, Daily',
		graceDaysName: 'Grace period for new notes (days)',
		graceDaysDesc:
			'Notes are not listed until this many days after the created property (or, without it, the earlier of the file created and modified dates). 0 lists them right away. Leave empty to restore the default (7).',
		deferTagsName: 'Deferral tags',
		deferTagsDesc:
			'Among notes to revisit, those with these tags are shown first. Separate with commas and leave out the #. Nested tags (e.g. todo/work) count too, and case is ignored.',
		archiveFolderName: 'Archive folder',
		archiveFolderDesc:
			'[Archive] on a note card moves the note here (Obsidian updates links to it). The folder is created if missing, and notes in it are not listed. Leave empty to restore the default (Archive).',
		scheduleIntro:
			'Set the periods offered by [Later], how many notes to go through each day, the undo notice time, and the daily notification. ' +
			'Notes without incoming links or with a deferral tag come first (both puts a note at the top), then the ones left untouched longest (by the last read date, or the file modified date if never read).',
		snoozeName: 'Default later period (days)',
		snoozeDesc:
			'The top (default) period offered by [Later]. A note is also not listed again until this many days after it was read (including [Open in chatbot] and applying a chatbot edit). Review dates already written by [Later] stay as they are when you change this. Leave empty to restore the default (7).',
		snooze2Name: 'Later period 2 (days)',
		snooze2Desc: 'The second period offered by [Later]. Leave empty to restore the default (30).',
		snooze3Name: 'Later period 3 (days)',
		snooze3Desc:
			'The third period offered by [Later], for putting off notes you have already read for a long time. Leave empty to restore the default (90).',
		dailyLimitName: 'Notes per day',
		dailyLimitDesc:
			'How many notes to go through each day. Notes handled with [Later], [Open in chatbot], [Archive], or [Delete] count toward it ([Undo] removes them), and [Show more] below the list shows more. Leave empty to restore the default (5).',
		undoSecondsName: 'Undo notice time (seconds)',
		undoSecondsDesc:
			'How long the notice with [Undo] stays after [Later], [Archive], or [Delete]. The remaining time is shown in the notice, and a deleted note goes to the trash only after this time. Leave empty to restore the default (6).',
		propertiesIntro:
			'Reminder records dates (YYYY-MM-DD) in note properties (frontmatter), so they follow the note when it is renamed or moved, and you can see when it was created, read, and updated. ' +
			'[Later] writes the read and review dates, [Open in chatbot] writes the read date, and applying a chatbot edit writes the updated and read dates; an empty created date is filled from the file dates (never overwritten). ' +
			'If another plugin already uses such properties, match their names below. Renaming does not move dates written under the old name.',
		propCreatedName: 'Created',
		propCreatedDesc: 'The day the note was written. Filled only when empty; used for the grace period. Leave empty to restore the default (created).',
		propReadName: 'Read',
		propReadDesc:
			'The day of [Later], [Open in chatbot], or applying a chatbot edit. The later of this and Updated is treated as the last read date. Leave empty to restore the default (read).',
		propUpdatedName: 'Updated',
		propUpdatedDesc: 'The day a chatbot edit was applied. An updated note counts as read. Leave empty to restore the default (updated).',
		propReviewName: 'Review',
		propReviewDesc:
			'The day set by the period chosen in [Later]. The note returns to the list from this day, and you can edit it yourself. Leave empty to restore the default (review).',
		notifyName: 'Daily notification',
		notifyDesc:
			'Show one notification when there are notes to revisit, the first time you open Obsidian each day (or, if Obsidian stays open past midnight, while you are using the Obsidian window).',
	},
	license: {
		summaryHeading: 'License & policy',
		versionLabel: 'Version',
		buildLabel: 'Build',
		publisherLabel: 'Author',
	},
};

const dictionaries: Record<UiLanguage, Dictionary> = { ko, en };

export function t(language: UiLanguage): Dictionary {
	return dictionaries[language];
}

// LLM 요청 실패를 화면용으로 바꿉니다.
// - summary: 원인과 해결 방법(사용자가 읽고 바로 고칠 수 있는 문장)
// - detail : 서버/네트워크가 준 원문(예: "HTTP 404: ...") — "자세한 내용"이나 툴팁에 보여줍니다.
export function describeLlmError(
	language: UiLanguage,
	failure: { kind: LlmErrorKind; detail: string; timeoutSeconds?: number },
): { summary: string; detail: string } {
	const template = t(language).llm.errors[failure.kind];
	return {
		summary: template.replace('{seconds}', String(failure.timeoutSeconds ?? '')),
		detail: failure.detail,
	};
}

// 커넥터(임베딩 서버) 요청 실패. 챗봇 안내문이 맞지 않는 원인만 connector.errors로 바꿉니다.
export function describeConnectorError(
	language: UiLanguage,
	failure: { kind: LlmErrorKind; detail: string; timeoutSeconds?: number },
): { summary: string; detail: string } {
	const override = (t(language).connector.errors as Partial<Record<LlmErrorKind, string>>)[failure.kind];
	return override ? { summary: override, detail: failure.detail } : describeLlmError(language, failure);
}
