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
	// 모든 대화 앞에 붙는 기본 지시문입니다(예: "항상 한국어로 답해줘"). 비어 있으면 보내지 않습니다.
	systemPrompt: string;
	// 사내 공용 서버에 부담을 주지 않기 위한 제한값입니다. 0이면 제한 없음.
	maxHistoryMessages: number; // 서버로 보낼 때 포함할 최근 대화 메시지 개수
	maxResponseTokens: number; // 응답 최대 길이(max_tokens로 전달)
	// 챗봇 답변을 기다리는 최대 시간(초). 모델 목록 조회/연결 확인은 이 값과 상관없이 30초입니다.
	chatTimeoutSeconds: number;
	lastVerified?: LlmVerification;
}

export interface IntraCopilotSettings {
	general: GeneralSettings;
	llm: LlmSettings;
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
	},
};

// 타임아웃이 너무 짧으면 거의 모든 답변이 실패하므로 최소값을 둡니다.
export const MIN_CHAT_TIMEOUT_SECONDS = 10;
