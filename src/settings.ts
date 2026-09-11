export type UiLanguage = 'ko' | 'en';

export interface GeneralSettings {
	language: UiLanguage;
}

export interface LlmSettings {
	baseUrl: string;
	apiKey: string;
	model: string;
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
