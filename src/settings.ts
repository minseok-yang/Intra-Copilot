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

// 리마인더 설정입니다. 노트별 날짜는 설정이 아니라 노트 속성(reminder/note-properties.ts)에 적습니다.
export interface ReminderSettings {
	excludedFolders: string[]; // 볼트 기준 폴더 경로. 하위 폴더도 함께 빠지며, 대소문자는 가리지 않습니다.
	graceDays: number; // 만든 지 이 일수가 안 된 노트는 대상에서 뺍니다(작성일 속성, 없으면 만든 날짜·수정일 중 이른 날 기준, 0이면 바로 대상).
	deferTags: string[]; // '#' 없이. 이 태그(와 하위 태그)가 붙은 노트를 다시 볼 노트 중 앞에 보여 줍니다.
	archiveFolder: string; // [보관함]으로 옮길 폴더. 이 폴더의 노트는 대상에서 빠집니다.
	// [나중에 ▾]에서 고르는 세 기간(일). snoozeDays가 맨 위(기본)이고, 읽은 날부터 다시 띄울 때까지의 최소 기간으로도 씁니다.
	snoozeDays: number;
	snoozeDays2: number;
	snoozeDays3: number;
	undoSeconds: number; // [나중에]·[보관함]·[삭제] 뒤 [되돌리기] 알림을 보여 주는 시간(초). [삭제]는 이 시간 뒤에 휴지통으로 보냄
	dailyLimit: number; // 하루에 챙길 노트 수
	dailyNotice: boolean; // 하루 한 번 알림(그날 처음 켤 때, 켜 둔 채 날이 바뀌면 창을 보고 있을 때)
	// 날짜를 적는 노트 속성 이름(작성일·읽은 날·수정일·다시 볼 날). 다른 플러그인이 쓰는 이름에 맞출 수 있습니다.
	propCreated: string;
	propRead: string;
	propUpdated: string;
	propReview: string;
}

// 링크 설정입니다. 임베딩 서버는 챗봇의 LLM 서버와 따로 둡니다(사내에서 다른 서버로 열릴 수 있음).
// 색인 자체(노트별 벡터)는 설정이 아니라 플러그인 폴더의 link-index.json에 있습니다(link/link-index.ts).
export interface LinkSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
	excludedFolders: string[]; // 볼트 기준 폴더 경로. 하위 폴더도 함께 빠지며, 대소문자는 가리지 않습니다.
	batchSize: number; // 한 번의 요청에 담을 조각 수. 서버가 한 번에 받는 개수에 맞춥니다.
	chunkChars: number; // 노트를 나눌 조각 하나의 최대 글자 수. 모델이 한 번에 받는 길이에 맞춥니다.
	resultCount: number; // 비슷한 노트를 몇 개 보여 줄지
	// 노트 하나에 저장할 벡터 수(1~MAX_VECTORS_PER_NOTE). 1이면 노트 전체 평균, 2 이상이면 주제별로 나눠 저장합니다.
	vectorsPerNote: number;
	// 서버에 요청할 벡터 크기(OpenAI 호환 dimensions). 0이면 보내지 않아 모델 기본 크기를 씁니다.
	dimensions: number;
	// 조각마다 서버로 보내는 글의 모양. {title}은 노트 제목, {text}는 조각 본문입니다. 모델마다 권장 접두어가 다릅니다.
	documentFormat: string;
}

// 문서 형식에 {text}가 없으면 본문이 빠진 채 전송되므로 이 기본값으로 되돌립니다.
export const DEFAULT_DOCUMENT_FORMAT = '{title}\n\n{text}';

// 노트당 벡터 수의 최대값. 검색 때 두 노트의 벡터를 모든 쌍으로 비교하므로(수의 제곱), 크게 두면 느려집니다.
export const MAX_VECTORS_PER_NOTE = 5;

// 리마인더의 하루 단위 값입니다. 설정이 아니라 상태지만 노트와 상관없어 data.json에 함께 둡니다(reminder/daily-count.ts).
export interface ReminderDaily {
	day: string; // handled·extra를 센 날(YYYY-MM-DD). 날짜가 바뀌면 0부터 다시 셉니다.
	handled: number; // 그날 챙긴 노트 수
	extra: number; // 그날 [더 보기]로 늘린 개수
	notifiedDay: string; // 하루 한 번 알림을 마지막으로 띄운 날
}

export interface IntraCopilotSettings {
	general: GeneralSettings;
	llm: LlmSettings;
	link: LinkSettings;
	reminder: ReminderSettings;
	reminderDaily: ReminderDaily;
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
	link: {
		baseUrl: '',
		apiKey: '',
		model: '',
		excludedFolders: [],
		batchSize: 16,
		// embeddinggemma는 한 번에 2048토큰까지 받습니다. 한국어는 글자당 토큰이 많아 1000자면 넉넉히 들어갑니다.
		chunkChars: 1000,
		resultCount: 10,
		vectorsPerNote: 1,
		dimensions: 0,
		documentFormat: DEFAULT_DOCUMENT_FORMAT,
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
		dailyNotice: true,
		propCreated: 'created',
		propRead: 'read',
		propUpdated: 'updated',
		propReview: 'review',
	},
	reminderDaily: { day: '', handled: 0, extra: 0, notifiedDay: '' },
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
