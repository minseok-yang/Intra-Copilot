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
	// 사내 공용 서버에 부담을 주지 않기 위한 제한값입니다. 0이면 제한 없음.
	maxHistoryMessages: number; // 서버로 보낼 때 포함할 최근 대화 메시지 개수
	maxResponseTokens: number; // 응답 최대 길이(max_tokens로 전달)
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
		maxHistoryMessages: 20,
		maxResponseTokens: 1024,
	},
};
