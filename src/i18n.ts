import { UiLanguage } from './settings';

// 설정 화면에 쓰이는 문자열입니다. ko를 기준으로 en도 같은 모양(키 구조)을 갖도록
// TypeScript가 강제합니다 — 문구를 하나만 추가하고 다른 언어를 빠뜨리면 빌드가 실패합니다.
const ko = {
	tabs: {
		general: '일반',
		llm: 'LLM 연결',
	},
	general: {
		heading: '일반',
		languageName: '표시 언어',
		languageDesc: '설정 화면에 보이는 언어를 바꿉니다.',
	},
	llm: {
		heading: 'LLM 서버 연결',
		intro:
			'챗봇이 사용할 서버 정보입니다. OpenAI 호환 API(예: vLLM으로 띄운 사내 서버)를 지원합니다. ' +
			'테스트 버튼을 눌러도 노트 내용은 전송되지 않고, 고정된 테스트 문장만 보냅니다.',
		baseUrlName: '서버 주소',
		baseUrlDesc:
			'예: http://사내서버주소/v1 (집에서 테스트할 때는 임시로 다른 서버 주소를 넣어도 됩니다)',
		apiKeyName: 'API 키',
		apiKeyDesc: '키가 필요 없는 서버라면 비워두세요.',
		modelName: '모델 이름(ID)',
		modelDesc: '먼저 [모델 불러오기]를 눌러 서버가 제공하는 모델 중에서 고르세요.',
		modelPlaceholder: '먼저 모델을 불러오세요',
		fetchModelsButton: '모델 불러오기',
		fetching: '불러오는 중...',
		fetchOk: '모델 목록을 불러왔습니다',
		fetchFailPrefix: '모델 목록을 가져오지 못했습니다: ',
		noModelsFound: '서버가 모델 목록을 비어 있게 반환했습니다.',
		fillBaseUrlFirst: '서버 주소를 먼저 입력하세요.',
		testName: '연결 테스트',
		testDesc: '위 설정으로 서버에 짧은 메시지를 보내 응답이 오는지 확인합니다.',
		testButton: '테스트',
		testing: '확인 중...',
		statusIdle: '아직 확인 안 됨',
		statusChecking: '확인 중...',
		statusOk: '검증됨',
		statusError: '연결 실패',
		statusMissing: '서버 주소와 모델을 먼저 입력하세요',
		statusReplyPrefix: '서버 응답: ',
		lastVerifiedName: '마지막 연결 확인',
		lastVerifiedPrefix: '확인 시각: ',
		neverVerified: '아직 확인한 적이 없습니다.',
		refreshTooltip: '다시 확인',
	},
	chat: {
		title: '챗봇',
		ribbonTooltip: '챗봇 열기',
		inputPlaceholder: '메시지를 입력하세요 (Shift+Enter로 줄바꿈)',
		sendButton: '보내기',
		emptyState: '아직 대화가 없습니다. 아래에 메시지를 입력해보세요.',
		thinking: '생각 중...',
		notConfigured: 'LLM 연결 탭에서 서버 주소와 모델을 먼저 설정하세요.',
		errorPrefix: '오류: ',
	},
};

type Dictionary = typeof ko;

const en: Dictionary = {
	tabs: {
		general: 'General',
		llm: 'LLM connection',
	},
	general: {
		heading: 'General',
		languageName: 'Display language',
		languageDesc: 'Change the language shown in this settings screen.',
	},
	llm: {
		heading: 'LLM server connection',
		intro:
			'Server info the chatbot will use. Supports OpenAI-compatible APIs ' +
			'(e.g. an internal server run with vLLM). Testing the connection never ' +
			'sends note content — only a fixed test sentence.',
		baseUrlName: 'Server address',
		baseUrlDesc:
			'e.g. http://your-internal-server/v1 (feel free to use a different address temporarily while testing at home)',
		apiKeyName: 'API key',
		apiKeyDesc: 'Leave empty if the server does not require one.',
		modelName: 'Model name (ID)',
		modelDesc: 'Click "Fetch models" first, then choose one from what the server offers.',
		modelPlaceholder: 'Fetch models first',
		fetchModelsButton: 'Fetch models',
		fetching: 'Fetching...',
		fetchOk: 'Fetched the model list',
		fetchFailPrefix: 'Could not fetch the model list: ',
		noModelsFound: 'The server returned an empty model list.',
		fillBaseUrlFirst: 'Enter the server address first.',
		testName: 'Test connection',
		testDesc: 'Sends a short message with the settings above to confirm the server responds.',
		testButton: 'Test',
		testing: 'Testing...',
		statusIdle: 'Not verified yet',
		statusChecking: 'Checking...',
		statusOk: 'Verified',
		statusError: 'Connection failed',
		statusMissing: 'Enter the server address and model first',
		statusReplyPrefix: 'Server replied: ',
		lastVerifiedName: 'Last verified connection',
		lastVerifiedPrefix: 'Checked at: ',
		neverVerified: 'Not verified yet.',
		refreshTooltip: 'Refresh',
	},
	chat: {
		title: 'Chatbot',
		ribbonTooltip: 'Open chatbot',
		inputPlaceholder: 'Type a message (Shift+Enter for a new line)',
		sendButton: 'Send',
		emptyState: 'No messages yet. Type something below to start.',
		thinking: 'Thinking...',
		notConfigured: 'Set the server address and model in the LLM connection tab first.',
		errorPrefix: 'Error: ',
	},
};

const dictionaries: Record<UiLanguage, Dictionary> = { ko, en };

export function t(language: UiLanguage): Dictionary {
	return dictionaries[language];
}
