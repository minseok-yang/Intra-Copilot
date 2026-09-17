import { Notice, Plugin, setTooltip } from 'obsidian';
import {
	clampChatTimeout,
	type ConnectorSettings,
	DEFAULT_SETTINGS,
	IntraCopilotSettings,
	LINKED_NOTES_MODES,
	MAX_VECTORS_PER_NOTE,
} from './settings';
import { IntraCopilotSettingTab } from './ui/settings-tab';
import { CHAT_VIEW_TYPE, ChatView, refreshChatViews, revealChatView } from './ui/chat-view';
import { GUIDE_VIEW_TYPE, GuideView } from './ui/guide-view';
import { refreshReminderViews, registerReminder, revealReminderView } from './ui/reminder-view';
import { refreshConnectorViews, registerConnector, revealConnectorView } from './ui/connector-view';
import { refreshGeneratorViews, registerGenerator, revealGeneratorView } from './ui/generator-view';
import { ConnectorIndex } from './connector/connector-index';
import { type Dictionary, t } from './i18n';
import { ConnectionSource, ConnectionStatusStore } from './llm/connection-status';
import type { StatusState } from './ui/status-light';
import { type FeatureId, featureIcon, registerFeatureIcons } from './ui/settings/features';

// 저장 파일(data.json)을 손으로 고쳤거나 예전 버전에서 넘어온 값이 이상해도 안전한 값으로 맞춥니다.
function nonNegativeInt(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// API 키는 data.json이 아니라 운영체제 키체인(Obsidian SecretStorage, 1.11.4+)에 둡니다.
// 메모리의 settings에는 키가 그대로 있어서 키를 쓰는 곳은 바뀌지 않고, 파일에 쓸 때 빼고 읽을 때 채웁니다.
const API_KEY_SECRETS = {
	llm: 'intra-copilot-llm-api-key',
	connector: 'intra-copilot-connector-api-key',
} as const;

export default class IntraCopilotPlugin extends Plugin {
	settings!: IntraCopilotSettings;
	// 챗봇 상태등이 보여주는 서버 연결 상태(모든 확인 결과가 여기로 모입니다).
	readonly connectionStatus = new ConnectionStatusStore();
	// 커넥터의 노트 색인(플러그인 폴더의 connector-index.bin)
	readonly connectorIndex = new ConnectorIndex(this);
	private chatRibbonEl!: HTMLElement;
	private connectorRibbonEl!: HTMLElement;
	private generatorRibbonEl!: HTMLElement;
	private reminderRibbonEl!: HTMLElement;
	// 사이드바 창의 톱니로 설정을 열었을 때, 설정 화면이 처음 그릴 때 보여 줄 기능(한 번 쓰고 비움).
	private pendingSettingsTab: FeatureId | null = null;
	// 키체인에 쓰지 못했다는 알림은 켜 있는 동안 한 번만 띄웁니다(설정은 입력할 때마다 저장되기 때문).
	private keychainFailureNoticed = false;

	// 지금 표시 언어의 화면 문구 묶음입니다. 화면마다 t(...)를 부르는 대신 이걸 씁니다.
	strings(): Dictionary {
		return t(this.settings.general.language);
	}

	// 플러그인 폴더의 볼트 기준 경로입니다(예: .obsidian/plugins/intra-copilot).
	// 대화 기록(conversations/)·스킬(SKILL/)·백업(backups/)·커넥터 색인이 이 폴더 안에 저장됩니다.
	// 노트가 아니라서 일반 파일 탐색기/검색에는 나타나지 않습니다.
	// 주의: 플러그인 폴더를 통째로 지우고 다시 넣으면 그 안의 대화 기록·스킬도 함께 사라집니다.
	pluginDir(): string {
		return this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
	}

	// 사이드바 창(챗봇·커넥터·제너레이터·리마인더) 머리말의 톱니에서 부릅니다.
	// 설정 창을 열고 이 플러그인 탭으로 옮긴 뒤, 그 기능의 설정 화면부터 보여 줍니다.
	// app.setting은 Obsidian이 공개 타입으로 내놓지 않은 부분입니다(설정 창을 여는 공개 API가 없음).
	// 그래서 쓰는 두 함수만 적어 두고, 없거나 바뀌었으면 아무 일도 하지 않습니다(창이 안 열릴 뿐).
	openFeatureSettings(feature: FeatureId): void {
		const { setting } = this.app as unknown as {
			setting?: { open?: () => void; openTabById?: (id: string) => unknown };
		};
		if (!setting?.open || !setting.openTabById) return;
		this.pendingSettingsTab = feature;
		setting.open();
		setting.openTabById(this.manifest.id);
	}

	// 설정 화면(ui/settings-tab.ts)이 그리기 직전에 한 번 읽어 갑니다.
	takePendingSettingsTab(): FeatureId | null {
		const pending = this.pendingSettingsTab;
		this.pendingSettingsTab = null;
		return pending;
	}

	async onload() {
		await this.loadSettings();
		// 리본·챗봇 탭·설정 화면이 쓰는 기능 아이콘을 가장 먼저 등록합니다.
		registerFeatureIcons();
		this.addSettingTab(new IntraCopilotSettingTab(this.app, this));

		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(GUIDE_VIEW_TYPE, (leaf) => new GuideView(leaf, this));
		registerConnector(this);
		registerGenerator(this);
		registerReminder(this);

		const strings = t(this.settings.general.language);
		this.chatRibbonEl = this.addRibbonIcon(featureIcon('chatbot'), this.ribbonTooltip(strings.chat.ribbonTooltip), () => {
			void revealChatView(this);
		});
		this.connectorRibbonEl = this.addRibbonIcon(featureIcon('connector'), this.ribbonTooltip(strings.connector.ribbonTooltip), () => {
			void revealConnectorView(this);
		});
		this.generatorRibbonEl = this.addRibbonIcon(
			featureIcon('generator'),
			this.ribbonTooltip(strings.generator.ribbonTooltip),
			() => {
				void revealGeneratorView(this);
			},
		);
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
			id: 'open-connector',
			name: strings.connector.ribbonTooltip,
			callback: () => {
				void revealConnectorView(this);
			},
		});
		this.addCommand({
			id: 'open-generator',
			name: strings.generator.ribbonTooltip,
			callback: () => {
				void revealGeneratorView(this);
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
		setTooltip(this.connectorRibbonEl, this.ribbonTooltip(strings.connector.ribbonTooltip));
		setTooltip(this.generatorRibbonEl, this.ribbonTooltip(strings.generator.ribbonTooltip));
		setTooltip(this.reminderRibbonEl, this.ribbonTooltip(strings.reminder.ribbonTooltip));
		refreshChatViews(this);
		refreshConnectorViews(this);
		refreshGeneratorViews(this);
		refreshReminderViews(this);
		// 제외 폴더 등이 바뀌었을 수 있으니 자동 갱신 주기에 맞춰 색인 맞추기를 예약합니다(끄기면 커넥터 창 [업데이트]로 맞춤).
		this.connectorIndex.requestSync();
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
		detail?: string,
	): void {
		if (snapshot === this.connectionSnapshot()) {
			this.connectionStatus.record(source, state, message, detail);
		}
	}

	async loadSettings() {
		// link는 1.0.0에서 커넥터 설정을 저장하던 이름입니다. 그대로 두면 업그레이드한 사용자의 주소·키·모델과
		// 제외 폴더가 모두 기본값으로 돌아가, 예전에 빼 둔 폴더가 임베딩 서버로 나갑니다. 새 이름이 있으면 그쪽이 이깁니다.
		const loaded = (await this.loadData()) as
			| (Partial<IntraCopilotSettings> & { link?: Partial<ConnectorSettings> })
			| null;
		this.settings = {
			general: { ...DEFAULT_SETTINGS.general, ...loaded?.general },
			llm: { ...DEFAULT_SETTINGS.llm, ...loaded?.llm },
			connector: { ...DEFAULT_SETTINGS.connector, ...loaded?.link, ...loaded?.connector },
			generator: { ...DEFAULT_SETTINGS.generator, ...loaded?.generator },
			reminder: { ...DEFAULT_SETTINGS.reminder, ...loaded?.reminder },
			reminderDaily: { ...DEFAULT_SETTINGS.reminderDaily, ...loaded?.reminderDaily },
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

		const { connector } = this.settings;
		const connectorDefaults = DEFAULT_SETTINGS.connector;
		for (const key of ['baseUrl', 'apiKey', 'model'] as const) {
			if (typeof connector[key] !== 'string') connector[key] = connectorDefaults[key];
		}
		if (!isStringArray(connector.excludedFolders)) connector.excludedFolders = [...connectorDefaults.excludedFolders];
		// 0개·0자는 뜻이 없으므로 1 이상으로 맞춥니다.
		for (const key of ['batchSize', 'chunkChars', 'resultCount', 'vectorsPerNote'] as const) {
			connector[key] = Math.max(1, nonNegativeInt(connector[key], connectorDefaults[key]));
		}
		connector.vectorsPerNote = Math.min(MAX_VECTORS_PER_NOTE, connector.vectorsPerNote);
		connector.dimensions = nonNegativeInt(connector.dimensions, connectorDefaults.dimensions);
		connector.autoSyncSeconds = nonNegativeInt(connector.autoSyncSeconds, connectorDefaults.autoSyncSeconds);
		if (!LINKED_NOTES_MODES.includes(connector.linkedNotes)) connector.linkedNotes = connectorDefaults.linkedNotes;
		if (typeof connector.documentFormat !== 'string' || !connector.documentFormat.includes('{text}')) {
			connector.documentFormat = connectorDefaults.documentFormat;
		}

		const { generator } = this.settings;
		const generatorDefaults = DEFAULT_SETTINGS.generator;
		for (const key of ['templateFolder', 'outputFolder'] as const) {
			if (typeof generator[key] !== 'string') generator[key] = generatorDefaults[key];
		}
		// 폴더가 비면 처음 폴더로 되돌립니다. 양식 폴더가 볼트 맨 위면 볼트의 모든 노트가 양식 목록에
		// 올라오고, 저장 폴더가 볼트 맨 위면 만든 노트가 볼트 맨 위에 쌓이기 때문입니다.
		if (!generator.templateFolder.trim()) generator.templateFolder = generatorDefaults.templateFolder;
		if (!generator.outputFolder.trim()) generator.outputFolder = generatorDefaults.outputFolder;
		// 지시문이 비면 양식만 보내게 되어 결과가 크게 나빠지므로 처음 지시문으로 되돌립니다.
		if (typeof generator.instructions !== 'string' || !generator.instructions.trim()) {
			generator.instructions = generatorDefaults.instructions;
		}
		if (typeof generator.openAfterCreate !== 'boolean') {
			generator.openAfterCreate = generatorDefaults.openAfterCreate;
		}

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
		if (typeof reminder.dailyNotice !== 'boolean') {
			reminder.dailyNotice = reminderDefaults.dailyNotice;
		}
		// 속성 이름이 비면 날짜를 어디에 적을지 알 수 없으므로 처음 이름으로 되돌립니다.
		for (const key of ['propCreated', 'propRead', 'propUpdated', 'propReview'] as const) {
			if (typeof reminder[key] !== 'string' || !reminder[key].trim()) reminder[key] = reminderDefaults[key];
		}

		const daily = this.settings.reminderDaily;
		const dailyDefaults = DEFAULT_SETTINGS.reminderDaily;
		for (const key of ['day', 'notifiedDay'] as const) {
			if (typeof daily[key] !== 'string') daily[key] = dailyDefaults[key];
		}
		daily.handled = nonNegativeInt(daily.handled, dailyDefaults.handled);
		daily.extra = nonNegativeInt(daily.extra, dailyDefaults.extra);

		// data.json에 키가 남아 있으면(1.0.0에서 넘어왔거나 지난번 키체인 저장이 실패함) 그 키를 키체인으로 옮기고
		// 파일에서 지웁니다. 없으면 키체인에서 읽습니다.
		let keyInFile = false;
		for (const section of ['llm', 'connector'] as const) {
			if (this.settings[section].apiKey) {
				keyInFile = true;
			} else {
				// 키체인을 읽지 못해도 플러그인은 켜져야 하므로 빈 키로 둡니다(저장할 때 실패를 알림).
				try {
					this.settings[section].apiKey = this.app.secretStorage.getSecret(API_KEY_SECRETS[section]) ?? '';
				} catch (error) {
					console.error('Intra Copilot: 키체인에서 API 키를 읽지 못했습니다.', error);
				}
			}
		}
		if (keyInFile) await this.saveSettings();
	}

	async saveSettings() {
		const data = {
			...this.settings,
			llm: { ...this.settings.llm },
			connector: { ...this.settings.connector },
		};
		for (const section of ['llm', 'connector'] as const) {
			const id = API_KEY_SECRETS[section];
			const key = this.settings[section].apiKey;
			try {
				if ((this.app.secretStorage.getSecret(id) ?? '') !== key) this.app.secretStorage.setSecret(id, key);
				data[section].apiKey = '';
			} catch (error) {
				// 키체인을 못 쓰면 키를 잃지 않도록 예전처럼 data.json에 남기고 알립니다.
				console.error('Intra Copilot: API 키를 키체인에 저장하지 못했습니다.', error);
				if (!this.keychainFailureNoticed) {
					this.keychainFailureNoticed = true;
					new Notice(this.strings().general.keychainSaveFailed, 0);
				}
			}
		}
		await this.saveData(data);
	}
}
