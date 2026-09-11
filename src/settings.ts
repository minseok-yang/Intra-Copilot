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
	},
};
