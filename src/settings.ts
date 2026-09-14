export type UiLanguage = 'ko' | 'en';

export interface GeneralSettings {
	language: UiLanguage;
}

export interface LlmVerification {
	at: string; // ISO 날짜 문자열
	baseUrl: string;
	model: string;
}

export interface LlmSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
	// 모든 대화 앞에 붙는 시스템 프롬프트입니다(예: "항상 한국어로 답해줘"). 비어 있으면 보내지 않습니다.
	systemPrompt: string;
	// 사내 공용 서버에 부담을 주지 않기 위한 제한값입니다. 0이면 제한 없음.
	maxHistoryMessages: number; // 서버로 보낼 때 포함할 최근 대화 메시지 개수
	maxResponseTokens: number; // 응답 최대 길이(max_tokens로 전달)
	// 챗봇 답변을 기다리는 최대 시간(초). 모델 목록 조회/연결 확인은 이 값과 상관없이 30초입니다.
	chatTimeoutSeconds: number;
	// 채팅에서 @로 지정한 폴더·노트를 질문에 붙일 때 보낼 최대 글자 수. 0이면 제한 없음.
	maxContextChars: number;
	// 답변을 조각으로 받아 글자가 차례로 나타나게 할지. 서버가 스트리밍을 막아 두면 끕니다.
	streaming: boolean;
	lastVerified?: LlmVerification;
}

// 리마인더 설정입니다. [나중에] 기록은 설정이 아니라 reminder.json에 따로 저장합니다.
export interface ReminderSettings {
	excludedFolders: string[]; // 볼트 기준 폴더 경로. 하위 폴더도 함께 빠집니다.
	graceDays: number; // 만든 지 이 일수가 안 된 노트는 대상에서 뺍니다(0이면 바로 대상).
	deferTags: string[]; // '#' 없이. 이 태그(와 하위 태그)가 붙은 노트를 앞에 보여 줍니다.
	archiveFolder: string; // [보관]으로 옮길 폴더. 이 폴더의 노트는 대상에서 빠집니다.
	// [나중에 ▾]에서 고르는 세 기간(일). snoozeDays가 맨 위(기본)이고, 기간을 따로 기록하지 않은 노트에도 씁니다.
	snoozeDays: number;
	snoozeDays2: number;
	snoozeDays3: number;
	undoSeconds: number; // [나중에]·[보관함]·[삭제] 뒤 [되돌리기] 알림을 보여 주는 시간(초). [삭제]는 이 시간 뒤에 실제로 지움
	dailyLimit: number; // 하루에 챙길 노트 수
	notifyOnStartup: boolean; // 그날 처음 Obsidian을 켤 때 알림
}

export interface IntraCopilotSettings {
	general: GeneralSettings;
	llm: LlmSettings;
	reminder: ReminderSettings;
}

export const DEFAULT_SETTINGS: IntraCopilotSettings = {
	general: {
		language: 'ko',
	},
	llm: {
		baseUrl: '',
		apiKey: '',
		model: '',
		systemPrompt: '',
		maxHistoryMessages: 20,
		// 1024는 한국어 답변 한두 문단이면 차고, 추론형 모델은 생각 과정도 이 안에서 써서 쉽게 잘렸습니다.
		// vLLM은 이 값만큼 메모리를 미리 잡지 않으므로(실제로 생성한 만큼만 씀) 넉넉히 잡아도 부담이 늘지 않습니다.
		maxResponseTokens: 4096,
		chatTimeoutSeconds: 120,
		// 한국어 8000자는 모델(토크나이저)에 따라 대략 5천~1만 토큰입니다. 사내 모델이 한 번에 처리할 수 있는
		// 길이를 넘으면 답변이 실패하므로, 그때는 설정에서 줄이면 됩니다(코드 수정 불필요).
		maxContextChars: 8000,
		streaming: true,
	},
	reminder: {
		excludedFolders: [],
		graceDays: 7,
		deferTags: ['someday', 'todo'],
		archiveFolder: 'Archive',
		snoozeDays: 7,
		snoozeDays2: 30,
		snoozeDays3: 90,
		undoSeconds: 6,
		dailyLimit: 5,
		notifyOnStartup: true,
	},
};

// 타임아웃이 너무 짧으면 거의 모든 답변이 실패하므로 최소값을 둡니다.
export const MIN_CHAT_TIMEOUT_SECONDS = 10;
// 브라우저 타이머는 약 24.8일(2,147,483초)을 넘으면 오히려 즉시 끝나버립니다.
// 그래서 "넉넉하게" 큰 값을 넣으면 모든 답변이 바로 시간 초과로 실패했습니다. 1시간이면 충분합니다.
export const MAX_CHAT_TIMEOUT_SECONDS = 3600;

// 저장 파일을 손으로 고쳤거나 입력칸에 이상한 값을 넣어도 항상 최소~최대 사이로 맞춥니다.
export function clampChatTimeout(seconds: number): number {
	return Math.min(MAX_CHAT_TIMEOUT_SECONDS, Math.max(MIN_CHAT_TIMEOUT_SECONDS, seconds));
}
