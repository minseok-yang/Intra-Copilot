import { Plugin, setTooltip } from 'obsidian';
import { clampChatTimeout, DEFAULT_SETTINGS, IntraCopilotSettings } from './settings';
import { IntraCopilotSettingTab } from './ui/settings-tab';
import { CHAT_VIEW_TYPE, ChatView, refreshChatViews, revealChatView } from './ui/chat-view';
import { GUIDE_VIEW_TYPE, GuideView } from './ui/guide-view';
import { refreshReminderViews, registerReminder, revealReminderView } from './ui/reminder-view';
import { ReminderStore } from './reminder/reminder-store';
import { t } from './i18n';
import { ConnectionSource, ConnectionStatusStore } from './llm/connection-status';
import type { StatusState } from './ui/status-light';
import { featureIcon, registerFeatureIcons } from './ui/settings/features';

// 저장 파일(data.json)을 손으로 고쳤거나 예전 버전에서 넘어온 값이 이상해도 안전한 값으로 맞춥니다.
function nonNegativeInt(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export default class IntraCopilotPlugin extends Plugin {
	settings!: IntraCopilotSettings;
	// 리마인더의 [나중에] 기록(reminder.json)
	reminderStore!: ReminderStore;
	// 챗봇 상태등이 보여주는 서버 연결 상태(모든 확인 결과가 여기로 모입니다).
	readonly connectionStatus = new ConnectionStatusStore();
	private chatRibbonEl!: HTMLElement;
	private reminderRibbonEl!: HTMLElement;

	async onload() {
		await this.loadSettings();
		this.reminderStore = await ReminderStore.load(this);
		// 리본·챗봇 탭·설정 화면이 쓰는 기능 아이콘을 가장 먼저 등록합니다.
		registerFeatureIcons();
		this.addSettingTab(new IntraCopilotSettingTab(this.app, this));

		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(GUIDE_VIEW_TYPE, (leaf) => new GuideView(leaf, this));
		registerReminder(this);

		const strings = t(this.settings.general.language);
		this.chatRibbonEl = this.addRibbonIcon(featureIcon('chatbot'), this.ribbonTooltip(strings.chat.ribbonTooltip), () => {
			void revealChatView(this);
		});
		this.reminderRibbonEl = this.addRibbonIcon(
			featureIcon('reminder'),
			this.ribbonTooltip(strings.reminder.ribbonTooltip),
			() => {
				void revealReminderView(this);
			},
		);
		// 명령 팔레트(Ctrl+P)에서 열 수 있고, 설정 → 단축키에서 원하는 키를 지정할 수도 있습니다.
		// 명령 이름은 플러그인을 켤 때의 언어로 정해집니다(언어를 바꾸면 다음 실행부터 반영).
		this.addCommand({
			id: 'open-chat',
			name: strings.chat.ribbonTooltip,
			callback: () => {
				void revealChatView(this);
			},
		});
		this.addCommand({
			id: 'open-reminder',
			name: strings.reminder.ribbonTooltip,
			callback: () => {
				void revealReminderView(this);
			},
		});
	}

	// 설정 화면에서 언어·모델·서버 주소·리마인더 설정이 바뀐 뒤 호출합니다. 설정 밖의 화면들
	// (리본 아이콘 툴팁, 열려 있는 챗봇·리마인더)이 바뀐 설정을 바로 따라가게 합니다.
	notifySettingsChanged(): void {
		const strings = t(this.settings.general.language);
		setTooltip(this.chatRibbonEl, this.ribbonTooltip(strings.chat.ribbonTooltip));
		setTooltip(this.reminderRibbonEl, this.ribbonTooltip(strings.reminder.ribbonTooltip));
		refreshChatViews(this);
		refreshReminderViews(this);
	}

	// 리본에는 다른 플러그인 아이콘도 함께 있으므로 "Intra Copilot: 챗봇 열기"처럼 플러그인 이름을 붙입니다.
	// (명령 팔레트는 Obsidian이 플러그인 이름을 알아서 붙이므로 명령 이름에는 붙이지 않습니다.)
	private ribbonTooltip(label: string): string {
		return `${this.manifest.name}: ${label}`;
	}

	// 서버 주소·키만 묶은 값입니다. 모델 목록은 모델 선택과 상관없으므로, 목록 확인 결과가
	// 아직 유효한지 판단할 때는 이 값을 씁니다.
	serverSnapshot(): string {
		const { baseUrl, apiKey } = this.settings.llm;
		return `${baseUrl}\n${apiKey}`;
	}

	// 확인을 시작할 때의 서버 주소·키·모델을 한 줄로 묶은 값입니다.
	connectionSnapshot(): string {
		const { baseUrl, apiKey, model } = this.settings.llm;
		return `${baseUrl}\n${apiKey}\n${model}`;
	}

	// 확인 결과를 상태등에 기록합니다. 기다리는 동안 서버 주소·키·모델이 바뀌었다면
	// 그 결과는 지금 설정과 상관없는 옛 결과이므로 기록하지 않습니다.
	reportConnection(
		source: ConnectionSource,
		snapshot: string,
		state: StatusState,
		message: string,
	): void {
		if (snapshot === this.connectionSnapshot()) {
			this.connectionStatus.record(source, state, message);
		}
	}

	async loadSettings() {
		const loaded = (await this.loadData()) as
			| Partial<IntraCopilotSettings>
			| null;
		this.settings = {
			general: { ...DEFAULT_SETTINGS.general, ...loaded?.general },
			llm: { ...DEFAULT_SETTINGS.llm, ...loaded?.llm },
			reminder: { ...DEFAULT_SETTINGS.reminder, ...loaded?.reminder },
		};

		const { general, llm, reminder } = this.settings;
		const defaults = DEFAULT_SETTINGS.llm;
		if (general.language !== 'ko' && general.language !== 'en') {
			general.language = DEFAULT_SETTINGS.general.language;
		}
		// 글자여야 하는 값에 숫자·null 등이 들어 있으면 요청 주소나 드롭다운이 이상해지므로 되돌립니다.
		for (const key of ['baseUrl', 'apiKey', 'model', 'systemPrompt'] as const) {
			if (typeof llm[key] !== 'string') llm[key] = defaults[key];
		}
		llm.maxHistoryMessages = nonNegativeInt(llm.maxHistoryMessages, defaults.maxHistoryMessages);
		llm.maxResponseTokens = nonNegativeInt(llm.maxResponseTokens, defaults.maxResponseTokens);
		llm.maxContextChars = nonNegativeInt(llm.maxContextChars, defaults.maxContextChars);
		if (typeof llm.streaming !== 'boolean') llm.streaming = defaults.streaming;
		llm.chatTimeoutSeconds = clampChatTimeout(
			nonNegativeInt(llm.chatTimeoutSeconds, defaults.chatTimeoutSeconds),
		);

		const reminderDefaults = DEFAULT_SETTINGS.reminder;
		for (const key of ['excludedFolders', 'deferTags'] as const) {
			if (!isStringArray(reminder[key])) reminder[key] = [...reminderDefaults[key]];
		}
		if (typeof reminder.archiveFolder !== 'string' || !reminder.archiveFolder) {
			reminder.archiveFolder = reminderDefaults.archiveFolder;
		}
		reminder.graceDays = nonNegativeInt(reminder.graceDays, reminderDefaults.graceDays);
		// 0일·0개는 뜻이 없으므로 1 이상으로 맞춥니다.
		for (const key of ['snoozeDays', 'snoozeDays2', 'snoozeDays3', 'dailyLimit', 'undoSeconds'] as const) {
			reminder[key] = Math.max(1, nonNegativeInt(reminder[key], reminderDefaults[key]));
		}
		if (typeof reminder.notifyOnStartup !== 'boolean') {
			reminder.notifyOnStartup = reminderDefaults.notifyOnStartup;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
