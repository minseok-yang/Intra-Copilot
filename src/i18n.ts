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
		guideName: '사용자 가이드',
		guideDesc: '플러그인 사용법을 담은 안내 문서를 새 창으로 엽니다. (초안 — 아직 내용은 비어 있습니다)',
		guideButton: '열기',
	},
	llm: {
		heading: 'LLM 서버 연결',
		intro:
			'챗봇이 사용할 서버 정보입니다. OpenAI 호환 API(예: vLLM으로 띄운 사내 서버)를 지원합니다. ' +
			'연결 확인을 눌러도 노트 내용은 전송되지 않고, 고정된 테스트 문장만 보냅니다.',
		baseUrlName: '서버 주소',
		baseUrlDesc:
			'예: http://사내서버주소/v1 (집에서 테스트할 때는 임시로 다른 서버 주소를 넣어도 됩니다)',
		apiKeyName: 'API 키',
		apiKeyDesc: '키가 필요 없는 서버라면 비워두세요.',
		maxHistoryName: '대화 기록 길이 제한',
		maxHistoryDesc:
			'서버로 보낼 때 포함할 최근 메시지 개수입니다. 화면에는 전체 대화가 남지만, 오래된 부분은 서버로 보내지 않습니다. 0이면 제한 없음(전체 전송).',
		maxResponseName: '응답 길이 제한 (max_tokens)',
		maxResponseDesc:
			'답변이 너무 길어지지 않도록 서버에 요청하는 최대 길이입니다. 0이면 제한 없음(서버 기본값 사용). 사내 공용 서버 부담을 줄이는 데 도움이 됩니다.',
		advancedName: '고급 설정',
		modelCheckHeading: '모델 확인',
		modelCheckDesc: '연결된 서버에서 사용 가능한 모델 목록을 가져옵니다.',
		modelCheckButton: '모델 확인',
		modelPlaceholder: '모델을 선택하세요',
		testDesc: '선택한 모델로 실제 대화 요청을 보내 서버 연결을 확인합니다.',
		testButton: '연결 확인',
		testing: '확인 중...',
		statusIdle: '아직 확인 안 됨',
		statusChecking: '확인 중...',
		statusOk: '검증됨',
		statusError: '연결 실패',
		statusMissing: '모델을 먼저 선택하세요',
		statusReplyPrefix: '서버 응답: ',
		fillBaseUrlFirst: '서버 주소를 먼저 입력하세요.',
		fetchOk: '모델 목록을 불러왔습니다',
		fetchFailPrefix: '모델 목록을 가져오지 못했습니다: ',
		noModelsFound: '서버가 모델 목록을 비어 있게 반환했습니다.',
		lastVerifiedPrefix: '확인 시각: ',
		neverVerified: '아직 확인한 적이 없습니다.',
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
		refreshModelsTooltip: '모델 목록 새로고침',
		newChatTooltip: '새 대화 시작 (지금까지의 대화를 지웁니다)',
		historyTooltip: '지난 대화 보기',
		historyTitle: '지난 대화',
		historyEmpty: '저장된 대화가 없습니다.',
		historyLoadButton: '불러오기',
		historyDeleteTooltip: '이 대화 삭제',
		historyLoadFailed: '대화를 불러오지 못했습니다.',
	},
	license: {
		summaryHeading: '라이선스 및 정책',
		summaryText:
			'이 플러그인은 사내 폐쇄망 전용으로 제작되었으며, 사용자가 채팅으로 입력하거나 요청한 내용 외에는 ' +
			'어떤 데이터도 외부로 전송하지 않습니다. (초안 — 자세한 내용은 아래에서 확인하고, 정식 배포 전 검토가 필요합니다.)',
		versionLabel: '버전',
		descriptionLabel: '설명',
		publisherLabel: '배포자',
		detailButton: '자세히 보기',
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
		guideName: 'User guide',
		guideDesc: 'Open the usage guide for this plugin in a new window. (Draft — content not written yet)',
		guideButton: 'Open',
	},
	llm: {
		heading: 'LLM server connection',
		intro:
			'Server info the chatbot will use. Supports OpenAI-compatible APIs ' +
			'(e.g. an internal server run with vLLM). Checking the connection never ' +
			'sends note content — only a fixed test sentence.',
		baseUrlName: 'Server address',
		baseUrlDesc:
			'e.g. http://your-internal-server/v1 (feel free to use a different address temporarily while testing at home)',
		apiKeyName: 'API key',
		apiKeyDesc: 'Leave empty if the server does not require one.',
		maxHistoryName: 'Conversation history limit',
		maxHistoryDesc:
			'How many recent messages to include when sending to the server. The full conversation stays on screen, but older parts are not sent. 0 means no limit (send everything).',
		maxResponseName: 'Response length limit (max_tokens)',
		maxResponseDesc:
			'The maximum response length requested from the server, so replies don\'t run on forever. 0 means no limit (server default). Helps reduce load on a shared internal server.',
		advancedName: 'Advanced settings',
		modelCheckHeading: 'Model check',
		modelCheckDesc: 'Fetch the list of models available from the connected server.',
		modelCheckButton: 'Check models',
		modelPlaceholder: 'Choose a model',
		testDesc: 'Sends an actual chat request with the selected model to verify the server connection.',
		testButton: 'Check connection',
		testing: 'Checking...',
		statusIdle: 'Not verified yet',
		statusChecking: 'Checking...',
		statusOk: 'Verified',
		statusError: 'Connection failed',
		statusMissing: 'Choose a model first',
		statusReplyPrefix: 'Server replied: ',
		fillBaseUrlFirst: 'Enter the server address first.',
		fetchOk: 'Fetched the model list',
		fetchFailPrefix: 'Could not fetch the model list: ',
		noModelsFound: 'The server returned an empty model list.',
		lastVerifiedPrefix: 'Checked at: ',
		neverVerified: 'Not verified yet.',
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
		refreshModelsTooltip: 'Refresh model list',
		newChatTooltip: 'Start a new conversation (clears the current one)',
		historyTooltip: 'View past conversations',
		historyTitle: 'Past conversations',
		historyEmpty: 'No saved conversations yet.',
		historyLoadButton: 'Load',
		historyDeleteTooltip: 'Delete this conversation',
		historyLoadFailed: 'Could not load the conversation.',
	},
	license: {
		summaryHeading: 'License & policy',
		summaryText:
			'Built for use inside a closed company network. Nothing is sent anywhere except what the user ' +
			'explicitly types or requests in the chat. (Draft — see details below, and review before real deployment.)',
		versionLabel: 'Version',
		descriptionLabel: 'Description',
		publisherLabel: 'Publisher',
		detailButton: 'View details',
	},
};

const dictionaries: Record<UiLanguage, Dictionary> = { ko, en };

export function t(language: UiLanguage): Dictionary {
	return dictionaries[language];
}
