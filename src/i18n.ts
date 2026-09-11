import { UiLanguage } from './settings';
import type { LlmErrorKind } from './llm/client';

// 플러그인 화면(설정·챗봇)에 보이는 문자열입니다. ko를 기준으로 en도 같은 모양(키 구조)을 갖도록
// TypeScript가 강제합니다 — 문구를 하나만 추가하고 다른 언어를 빠뜨리면 빌드가 실패합니다.
// {seconds}, {count}처럼 중괄호로 된 부분은 코드에서 실제 값으로 바꿔 넣는 자리입니다.
//
// 용어 기준(문구를 추가할 때 지켜주세요)
// - 답변: 모델이 사용자에게 한 말. "응답"은 서버의 기술적인 응답(HTTP 등)에만 씁니다.
// - 확인: 연결/모델 점검. "검증"과 섞어 쓰지 않습니다.
// - 버튼·설정 이름은 실제 동작 그대로 부르고, 설명문에서 그 이름을 [대괄호]나 "따옴표"로 똑같이 인용합니다.
const ko = {
	tabs: {
		general: '일반',
		llm: 'LLM 연결',
	},
	general: {
		heading: '표시 및 도움말',
		languageName: '표시 언어',
		languageDesc:
			'플러그인 화면(설정·챗봇)에 쓰이는 언어를 바꿉니다. 사용자 가이드와 라이선스 문서는 한국어로만 제공됩니다.',
		guideName: '사용자 가이드',
		guideDesc: '플러그인 사용법 안내 문서를 새 창으로 엽니다. (초안)',
		guideButton: '열기',
	},
	llm: {
		heading: 'LLM 서버 연결',
		intro:
			'챗봇이 사용할 LLM 서버를 설정합니다. OpenAI 호환 API(예: vLLM으로 운영하는 사내 서버)를 지원합니다. ' +
			'연결을 확인할 때는 노트 내용을 보내지 않고, 정해진 테스트 문장만 보냅니다.',
		baseUrlName: '서버 주소',
		baseUrlDesc: 'LLM 서버의 API 주소입니다. 보통 /v1로 끝납니다. 예: http://서버주소:8000/v1',
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
		chatTimeoutName: '답변 대기 시간 (초)',
		chatTimeoutDesc:
			'챗봇 답변을 최대 몇 초까지 기다릴지 정합니다. 시간 초과로 실패하는 일이 잦으면 늘려보세요. ' +
			'10보다 작게 입력하면 10초로 저장되고, 비워두면 기본값(120초)으로 돌아갑니다. ' +
			'[모델 목록 불러오기]와 [연결 확인]은 이 값과 상관없이 30초까지 기다립니다.',
		systemPromptName: '기본 지시문 (시스템 프롬프트)',
		systemPromptDesc:
			'챗봇에 질문할 때마다 대화 맨 앞에 붙여 보내는 지시문입니다. 예: "항상 한국어로 간결하게 답해줘." 비워두면 보내지 않습니다.',
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
			auth: 'API 키가 없거나 올바르지 않거나, 이 서버를 쓸 권한이 없습니다(인증 실패). LLM 연결 탭에서 API 키를 확인하세요.',
			'not-found':
				'서버에는 연결됐지만 요청한 경로를 찾을 수 없습니다. 서버 주소가 API 주소(보통 /v1로 끝남)인지 확인하세요.',
			model:
				'서버가 선택한 모델로는 대화할 수 없다고 응답했습니다. 모델 이름이 틀렸거나, 대화용이 아닌 모델(음성·임베딩 등)일 수 있습니다. 다른 모델을 선택해보세요.',
			'context-length':
				'대화가 모델이 한 번에 처리할 수 있는 길이를 넘었습니다. 새 대화를 시작하거나, 고급 설정에서 "서버로 보낼 대화 기록 수"나 "답변 길이 제한"을 줄여보세요.',
			'rate-limit': '요청이 너무 많아 서버가 잠시 거절했습니다(사용량 제한). 잠시 후 다시 시도하세요.',
			'bad-request':
				'서버가 요청을 거절했습니다. 선택한 모델과 고급 설정 값(답변 길이 제한 등)을 확인하세요.',
			server: '서버 내부 오류입니다(서버 쪽 문제). 잠시 후 다시 시도하고, 계속되면 서버 관리자에게 문의하세요.',
			'invalid-response':
				'서버가 LLM API 형식이 아닌 응답을 보냈습니다. 서버 주소가 웹페이지 주소가 아니라 API 주소(보통 /v1로 끝남)인지 확인하세요.',
			unknown: '알 수 없는 이유로 요청에 실패했습니다. 오류 원문을 확인하세요.',
		},
	},
	chat: {
		title: '챗봇',
		ribbonTooltip: '챗봇 열기',
		inputPlaceholder: '메시지를 입력하세요 (Enter: 보내기, Shift+Enter: 줄바꿈)',
		sendButton: '보내기',
		emptyState: '아직 대화가 없습니다. 아래에 메시지를 입력해보세요.',
		thinking: '답변을 기다리는 중...',
		notConfigured: '설정 → Intra Copilot → LLM 연결 탭에서 서버 주소와 모델을 먼저 설정하세요.',
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
		busyNotice: '답변을 기다리는 중입니다. 답변이 온 뒤에 다시 시도하세요.',
		refreshModelsTooltip: '모델 목록 새로고침 및 연결 확인',
		newChatTooltip: '새 대화 시작 (지금 대화는 지난 대화 목록에 남습니다)',
		historyTooltip: '지난 대화 보기',
		historyTitle: '지난 대화',
		historyEmpty: '저장된 대화가 없습니다.',
		historyLoadButton: '불러오기',
		historyDeleteTooltip: '이 대화 삭제',
		historyLoadFailed: '대화를 불러오지 못했습니다.',
		historyCurrentDeleted: '보고 있던 대화가 삭제되어 새 대화로 전환했습니다.',
		failedLabel: '⚠ 답변을 받지 못해 이 질문은 대화 기록에 포함되지 않았습니다',
		errorDetails: '자세한 내용 (오류 원문)',
		emptyTitle: '(빈 대화)',
	},
	license: {
		summaryHeading: '라이선스 및 정책',
		summaryText:
			'사내 폐쇄망 전용으로 만든 플러그인입니다. 설정에서 지정한 LLM 서버와만 통신하며, 보내는 내용은 사용자가 채팅에 입력한 글' +
			'(이전 대화와 기본 지시문 포함)과 연결 확인용 테스트 문장뿐입니다. 노트 내용은 자동으로 전송되지 않습니다. ' +
			'(초안 — 정식 배포 전 검토가 필요합니다.)',
		versionLabel: '버전',
		descriptionLabel: '설명',
		publisherLabel: '제작자',
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
		heading: 'Display & help',
		languageDesc:
			'Change the language used in this plugin (settings and chatbot). The user guide and license documents are available in Korean only.',
		languageName: 'Display language',
		guideName: 'User guide',
		guideDesc: 'Open the plugin usage guide in a new window. (Draft)',
		guideButton: 'Open',
	},
	llm: {
		heading: 'LLM server connection',
		intro:
			'Set up the LLM server the chatbot uses. Supports OpenAI-compatible APIs ' +
			'(e.g. an internal server running vLLM). Checking the connection never sends ' +
			'note content — only a fixed test sentence.',
		baseUrlName: 'Server address',
		baseUrlDesc: 'The API address of the LLM server, usually ending in /v1. e.g. http://server:8000/v1',
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
		chatTimeoutName: 'Answer timeout (seconds)',
		chatTimeoutDesc:
			'How long to wait for a chatbot answer. Increase it if answers often fail with a timeout. ' +
			'Values below 10 are saved as 10; leave empty to restore the default (120 seconds). ' +
			'[Load model list] and [Check connection] always wait up to 30 seconds regardless of this value.',
		systemPromptName: 'Default instructions (system prompt)',
		systemPromptDesc:
			'Instructions added to the start of the conversation every time you ask the chatbot, e.g. "Always answer briefly." Leave empty to send nothing.',
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
			auth: 'The API key is missing or wrong, or you do not have access to this server (authentication failed). Check the API key in the LLM connection tab.',
			'not-found':
				'Reached the server, but the requested path was not found. Make sure the address is the API address (usually ending in /v1).',
			model:
				'The server says it cannot chat with the selected model. The name may be wrong, or it may not be a chat model (speech, embedding, etc.). Try another model.',
			'context-length':
				'The conversation is longer than the model can handle at once. Start a new conversation, or lower "Messages sent as history" or "Answer length limit" in advanced settings.',
			'rate-limit': 'Too many requests — the server is temporarily refusing them (rate limit). Try again shortly.',
			'bad-request':
				'The server rejected the request. Check the selected model and advanced settings (answer length limit, etc.).',
			server: 'Internal server error (a problem on the server side). Try again shortly; if it continues, contact the server admin.',
			'invalid-response':
				'The server replied with something that is not an LLM API response. Make sure the address is the API address (usually ending in /v1), not a web page.',
			unknown: 'The request failed for an unknown reason. Check the raw error message.',
		},
	},
	chat: {
		title: 'Chatbot',
		ribbonTooltip: 'Open chatbot',
		inputPlaceholder: 'Type a message (Enter: send, Shift+Enter: new line)',
		sendButton: 'Send',
		emptyState: 'No messages yet. Type something below to start.',
		thinking: 'Waiting for an answer...',
		notConfigured: 'Set the server address and model first in Settings → Intra Copilot → LLM connection.',
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
		busyNotice: 'Waiting for an answer. Try again after it arrives.',
		refreshModelsTooltip: 'Refresh model list and check connection',
		newChatTooltip: 'Start a new conversation (the current one stays in past conversations)',
		historyTooltip: 'View past conversations',
		historyTitle: 'Past conversations',
		historyEmpty: 'No saved conversations yet.',
		historyLoadButton: 'Load',
		historyDeleteTooltip: 'Delete this conversation',
		historyLoadFailed: 'Could not load the conversation.',
		historyCurrentDeleted: 'The conversation you were viewing was deleted, so a new one was started.',
		failedLabel: '⚠ No answer received — this question is not part of the conversation history',
		errorDetails: 'Details (raw error message)',
		emptyTitle: '(empty conversation)',
	},
	license: {
		summaryHeading: 'License & policy',
		summaryText:
			'Built for use inside a closed company network. The plugin only talks to the LLM server set in the settings, and sends only what you type in the chat ' +
			'(including earlier messages and the default instructions) plus a test sentence when checking the connection. Note content is never sent automatically. ' +
			'(Draft — review before real deployment.)',
		versionLabel: 'Version',
		descriptionLabel: 'Description',
		publisherLabel: 'Author',
		detailButton: 'View details',
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
