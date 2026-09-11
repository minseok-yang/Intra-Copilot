import {
	App,
	ButtonComponent,
	DropdownComponent,
	PluginSettingTab,
	Setting,
	debounce,
	setIcon,
} from 'obsidian';
import IntraCopilotPlugin from '../main';
import {
	clampChatTimeout,
	DEFAULT_SETTINGS,
	MAX_CHAT_TIMEOUT_SECONDS,
	MIN_CHAT_TIMEOUT_SECONDS,
	UiLanguage,
} from '../settings';
import { t } from '../i18n';
import { createStatusLight, setStatusLight, StatusState } from './status-light';
import {
	checkSelectedModel,
	CheckOutcome,
	fetchModelList,
	fillModelDropdown,
	ModelListOutcome,
} from './model-dropdown';
import { openGuideWindow } from './guide-view';

// 숫자 입력칸 값을 정수로 바꿉니다. 비어 있거나 숫자가 아니거나 음수면 기본값으로 되돌립니다.
// (예전에는 비우면 0 = "제한 없음"이 되어, 서버 보호 설정이 실수로 풀릴 수 있었습니다.)
// 0은 사용자가 일부러 입력한 "제한 없음"이므로 그대로 허용합니다.
function parseLimit(value: string, fallback: number): number {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseTimeoutSeconds(value: string): number {
	return clampChatTimeout(parseLimit(value, DEFAULT_SETTINGS.llm.chatTimeoutSeconds));
}

type TabId = 'general' | 'llm';
// 새 모듈(예: 임베딩 연결)이 생기면 여기에 id를 추가하고,
// display()의 tabs 배열에 정의 하나만 더 넣으면 탭이 늘어납니다.

interface TabDefinition {
	id: TabId;
	label: string;
	render: (containerEl: HTMLElement) => void;
}

export class IntraCopilotSettingTab extends PluginSettingTab {
	plugin: IntraCopilotPlugin;
	private activeTab: TabId = 'general';
	// 설정 창을 새로 열었을 때만 자동으로 연결을 확인하기 위한 표시입니다.
	// 내부 탭 전환(일반↔LLM)이나 언어 변경으로 화면을 다시 그릴 때는 재확인하지 않습니다.
	private autoCheckPending = true;
	// 모델을 바꿨을 때 할 일(연결 확인 표시등을 "확인 필요"로). LLM 탭을 그릴 때 채워집니다.
	private onModelSelectedInTab: () => void = () => {};
	// 마지막 확인 결과. 일반↔LLM 탭을 오가거나 언어를 바꿔 화면을 다시 그려도, 불러온 모델 목록과
	// 표시등을 그대로 다시 보여주기 위해 기억해 둡니다(서버 주소·키가 바뀌거나 설정 창을 닫으면 지움).
	private lastModelList: ModelListOutcome | null = null;
	private lastTest: CheckOutcome | null = null;

	// 글자를 칠 때마다 파일에 쓰지 않도록, 입력이 멈춘 뒤 한 번만 저장합니다.
	private readonly saveSoon = debounce(
		() => {
			void this.plugin.saveSettings();
		},
		500,
		true,
	);

	constructor(app: App, plugin: IntraCopilotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Obsidian이 설정 창을 닫거나 다른 플러그인 탭으로 옮길 때 호출합니다.
		this.saveSoon.run(); // 아직 저장되지 않은 입력이 있으면 지금 저장합니다.
		this.autoCheckPending = true;
		// 다시 열면 자동으로 새로 확인하므로, 지난 결과는 버립니다.
		this.lastModelList = null;
		this.lastTest = null;
		// 서버 주소/키가 바뀌었을 수 있으니, 열려 있는 챗봇 화면이 모델 목록을 다시 확인하게 합니다.
		this.plugin.notifySettingsChanged();
		super.hide();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const language = this.plugin.settings.general.language;
		const strings = t(language);

		const tabs: TabDefinition[] = [
			{
				id: 'general',
				label: strings.tabs.general,
				render: (el) => this.renderGeneralTab(el),
			},
			{
				id: 'llm',
				label: strings.tabs.llm,
				render: (el) => this.renderLlmTab(el),
			},
		];

		const tabBar = containerEl.createDiv({ cls: 'intra-copilot-tab-bar' });
		const content = containerEl.createDiv({ cls: 'intra-copilot-tab-content' });

		for (const tab of tabs) {
			const button = tabBar.createEl('button', {
				text: tab.label,
				cls: 'intra-copilot-tab-button',
			});
			if (tab.id === this.activeTab) {
				button.addClass('is-active');
			}
			button.onclick = () => {
				this.activeTab = tab.id;
				this.display();
			};
		}

		const activeTab = tabs.find((tab) => tab.id === this.activeTab) ?? tabs[0]!;
		activeTab.render(content);
	}

	private renderGeneralTab(containerEl: HTMLElement): void {
		const language = this.plugin.settings.general.language;
		const strings = t(language).general;
		const licenseStrings = t(language).license;

		// 라이선스/정책 요약 — 일반 탭 맨 위. 세부 내용은 [자세히 보기]에서 새 창으로 봅니다.
		new Setting(containerEl).setName(licenseStrings.summaryHeading).setHeading();
		containerEl.createEl('p', {
			cls: 'intra-copilot-license-summary',
			text: licenseStrings.summaryText,
		});

		const meta = containerEl.createEl('dl', { cls: 'intra-copilot-license-meta' });
		const addMetaRow = (label: string, value: string) => {
			meta.createEl('dt', { text: label });
			meta.createEl('dd', { text: value });
		};
		addMetaRow(licenseStrings.versionLabel, this.plugin.manifest.version);
		addMetaRow(licenseStrings.descriptionLabel, this.plugin.manifest.description ?? '');
		addMetaRow(licenseStrings.publisherLabel, this.plugin.manifest.author ?? '');

		new Setting(containerEl).addButton((button) =>
			button.setButtonText(licenseStrings.detailButton).onClick(() => {
				void openGuideWindow(this.plugin, 'license');
			}),
		);

		new Setting(containerEl).setName(strings.heading).setHeading();

		new Setting(containerEl)
			.setName(strings.languageName)
			.setDesc(strings.languageDesc)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('ko', '한국어')
					.addOption('en', 'English')
					.setValue(language)
					.onChange(async (value) => {
						this.plugin.settings.general.language = value as UiLanguage;
						await this.plugin.saveSettings();
						this.plugin.notifySettingsChanged(); // 챗봇 화면·리본 툴팁도 새 언어로
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName(strings.guideName)
			.setDesc(strings.guideDesc)
			.addButton((button) =>
				button.setButtonText(strings.guideButton).onClick(() => {
					void openGuideWindow(this.plugin, 'guide');
				}),
			);
	}

	private renderLlmTab(containerEl: HTMLElement): void {
		const language = this.plugin.settings.general.language;
		const strings = t(language).llm;

		new Setting(containerEl).setName(strings.heading).setHeading();
		containerEl.createEl('p', { text: strings.intro });

		// 서버 주소나 키를 고치면 이전 확인 결과(초록불)는 더 이상 믿을 수 없으므로 되돌립니다.
		// 상태등은 아래에서 만들어지므로, 만들어진 뒤에 실제 동작을 채워 넣습니다.
		let resetStatuses = () => {};

		new Setting(containerEl)
			.setName(strings.baseUrlName)
			.setDesc(strings.baseUrlDesc)
			.addText((text) =>
				text
					.setPlaceholder(strings.baseUrlPlaceholder)
					.setValue(this.plugin.settings.llm.baseUrl)
					.onChange((value) => {
						this.plugin.settings.llm.baseUrl = value.trim();
						resetStatuses();
						this.saveSoon();
					}),
			);

		new Setting(containerEl)
			.setName(strings.apiKeyName)
			.setDesc(strings.apiKeyDesc)
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.llm.apiKey)
					.onChange((value) => {
						this.plugin.settings.llm.apiKey = value.trim();
						resetStatuses();
						this.saveSoon();
					});
				text.inputEl.type = 'password';
			});

		// 모델 확인 + 연결 확인 + 고급 설정을 한 박스 안에 모았습니다. 위에서부터
		// [모델 확인] 버튼 → 드롭다운 → [연결 확인] 버튼 → 연결 상태 → 고급 설정(접힘) 순서입니다.
		const modelSetting = new Setting(containerEl)
			.setName(strings.modelCheckHeading)
			.setDesc(strings.modelCheckDesc);
		modelSetting.controlEl.addClass('intra-copilot-stacked-control');

		const modelActionRow = modelSetting.controlEl.createDiv({
			cls: 'intra-copilot-inline-row',
		});
		const modelCheckButton = new ButtonComponent(modelActionRow).setButtonText(
			strings.modelCheckButton,
		);
		const modelStatus = createStatusLight(modelActionRow, strings.statusIdle);

		const modelDropdown = new DropdownComponent(modelSetting.controlEl);
		const cachedList = this.lastModelList;
		if (cachedList) {
			setStatusLight(
				modelStatus.dot,
				modelStatus.text,
				cachedList.state,
				cachedList.message,
				cachedList.detail,
			);
		}
		this.fillDropdown(modelDropdown, cachedList?.models ?? [], cachedList?.state ?? 'idle');

		const checkModels = async () => {
			modelCheckButton.setButtonText(strings.loadingModels).setDisabled(true);
			await this.refreshModelList(modelDropdown, modelStatus.dot, modelStatus.text);
			modelCheckButton.setButtonText(strings.modelCheckButton).setDisabled(false);
		};
		modelCheckButton.onClick(() => void checkModels());

		const testActionRow = modelSetting.controlEl.createDiv({
			cls: 'intra-copilot-inline-row',
		});
		const testButton = new ButtonComponent(testActionRow)
			.setButtonText(strings.testButton)
			.setTooltip(strings.testDesc);
		const testStatus = createStatusLight(testActionRow, strings.statusIdle);
		if (this.lastTest) {
			const { state, message, detail } = this.lastTest;
			setStatusLight(testStatus.dot, testStatus.text, state, message, detail);
		}

		const connectionStatusText = modelSetting.controlEl.createEl('p', {
			cls: 'intra-copilot-connection-status-text',
			text: this.formatLastVerified(strings),
		});

		const checkConnection = async () => {
			testButton.setButtonText(strings.testing).setDisabled(true);
			await this.runConnectionTest(testStatus.dot, testStatus.text, connectionStatusText);
			testButton.setButtonText(strings.testButton).setDisabled(false);
		};
		testButton.onClick(() => void checkConnection());

		resetStatuses = () => {
			this.lastModelList = null;
			this.lastTest = null;
			setStatusLight(modelStatus.dot, modelStatus.text, 'idle', strings.statusIdle);
			setStatusLight(testStatus.dot, testStatus.text, 'idle', strings.statusIdle);
			// 챗봇 상단 상태등도 함께 회색(미확인)으로 되돌립니다.
			this.plugin.connectionStatus.markChanged(strings.statusConnectionChanged);
		};

		// 모델을 바꾸면 목록 확인 결과는 그대로 유효하지만, 연결 확인은 새 모델로 다시 해야 합니다.
		this.onModelSelectedInTab = () => {
			this.lastTest = { state: 'idle', message: strings.statusModelChanged };
			setStatusLight(testStatus.dot, testStatus.text, 'idle', strings.statusModelChanged);
		};

		// 고급 설정 — 다른 두 버튼과 똑같은 ButtonComponent라서 배경색·글자 크기가 자동으로 맞습니다.
		// ButtonComponent.setIcon()은 글자를 지워버려서, 아이콘과 글자를 직접 함께 넣습니다.
		const advancedRow = modelSetting.controlEl.createDiv({ cls: 'intra-copilot-inline-row' });
		const advancedButton = new ButtonComponent(advancedRow);
		advancedButton.buttonEl.empty();
		const advancedChevron = advancedButton.buttonEl.createSpan({
			cls: 'intra-copilot-advanced-icon',
		});
		setIcon(advancedChevron, 'chevron-right');
		advancedButton.buttonEl.createSpan({ text: strings.advancedName });

		const advancedSection = modelSetting.controlEl.createDiv({
			cls: 'intra-copilot-advanced-section',
		});
		advancedSection.hidden = true;

		advancedButton.onClick(() => {
			advancedSection.hidden = !advancedSection.hidden;
			setIcon(advancedChevron, advancedSection.hidden ? 'chevron-right' : 'chevron-down');
		});

		const llm = this.plugin.settings.llm;
		this.addNumberSetting(advancedSection, {
			name: strings.maxHistoryName,
			desc: strings.maxHistoryDesc,
			get: () => llm.maxHistoryMessages,
			set: (value) => (llm.maxHistoryMessages = value),
			parse: (raw) => parseLimit(raw, DEFAULT_SETTINGS.llm.maxHistoryMessages),
			min: 0,
		});
		this.addNumberSetting(advancedSection, {
			name: strings.maxResponseName,
			desc: strings.maxResponseDesc,
			get: () => llm.maxResponseTokens,
			set: (value) => (llm.maxResponseTokens = value),
			parse: (raw) => parseLimit(raw, DEFAULT_SETTINGS.llm.maxResponseTokens),
			min: 0,
		});
		this.addNumberSetting(advancedSection, {
			name: strings.chatTimeoutName,
			desc: strings.chatTimeoutDesc,
			get: () => llm.chatTimeoutSeconds,
			set: (value) => (llm.chatTimeoutSeconds = value),
			parse: parseTimeoutSeconds,
			min: MIN_CHAT_TIMEOUT_SECONDS,
			max: MAX_CHAT_TIMEOUT_SECONDS,
		});

		// 기본 지시문(시스템 프롬프트) — 서버 연결 정보가 아니라 "대화 내용"에 관한 설정이라
		// 고급 설정 박스 밖에 따로 둡니다.
		new Setting(containerEl)
			.setName(strings.systemPromptName)
			.setDesc(strings.systemPromptDesc)
			.addTextArea((text) => {
				text.setValue(llm.systemPrompt).onChange((value) => {
					llm.systemPrompt = value;
					this.saveSoon();
				});
				text.inputEl.rows = 3;
				text.inputEl.addClass('intra-copilot-system-prompt');
			});

		// 설정 창을 새로 연 뒤 이 탭을 처음 그릴 때만 자동으로 확인합니다.
		// 순서대로: 먼저 모델 확인 → 이미 선택된 모델이 있으면 이어서 연결 확인.
		if (this.autoCheckPending) {
			this.autoCheckPending = false;
			void (async () => {
				await checkModels();
				if (this.plugin.settings.llm.model) {
					await checkConnection();
				}
			})();
		}
	}

	// 고급 설정의 숫자 입력칸 하나를 만듭니다. 입력칸에서 벗어나면(blur) 실제로 저장된 값을
	// 다시 보여줘서, 비워둔 칸이 기본값으로 돌아간 것을 사용자가 바로 알 수 있게 합니다.
	private addNumberSetting(
		containerEl: HTMLElement,
		options: {
			name: string;
			desc: string;
			get: () => number;
			set: (value: number) => void;
			parse: (raw: string) => number;
			min: number;
			max?: number;
		},
	): void {
		new Setting(containerEl)
			.setName(options.name)
			.setDesc(options.desc)
			.addText((text) => {
				text.setValue(String(options.get())).onChange((value) => {
					options.set(options.parse(value));
					this.saveSoon();
				});
				text.inputEl.type = 'number';
				text.inputEl.min = String(options.min);
				if (options.max !== undefined) text.inputEl.max = String(options.max);
				text.inputEl.addEventListener('blur', () => {
					text.setValue(String(options.get()));
				});
			});
	}

	// "모델 확인" 버튼 및 탭이 열릴 때 자동으로 실행됩니다. 서버에서 모델 목록을 가져와
	// 드롭다운을 채웁니다. 연결 테스트(실제 대화 요청)는 하지 않습니다.
	private async refreshModelList(
		modelDropdown: DropdownComponent,
		statusDot: HTMLElement,
		statusText: HTMLElement,
	): Promise<void> {
		const strings = t(this.plugin.settings.general.language).llm;
		setStatusLight(statusDot, statusText, 'idle', strings.statusChecking);

		const server = this.plugin.serverSnapshot();
		const outcome = await fetchModelList(this.plugin);
		// 기다리는 사이 서버 주소·키가 바뀌었다면 옛 주소의 결과이므로 보여주지 않습니다
		// (표시등은 주소를 고칠 때 이미 "아직 확인하지 않음"으로 되돌아가 있습니다).
		if (server !== this.plugin.serverSnapshot()) return;
		this.lastModelList = outcome;
		setStatusLight(statusDot, statusText, outcome.state, outcome.message, outcome.detail);
		// 주소가 비어 있을 때(idle)는 이전처럼 저장된 모델을 그대로 보여줍니다.
		if (outcome.state !== 'idle') {
			this.fillDropdown(modelDropdown, outcome.models, outcome.state);
		}
	}

	private fillDropdown(
		dropdown: DropdownComponent,
		models: string[],
		lastState: 'idle' | 'ok' | 'error' = 'idle',
	): void {
		fillModelDropdown(this.plugin, dropdown, models, {
			lastState,
			onSelected: () => {
				this.onModelSelectedInTab();
				// 여기서 고른 모델이 열려 있는 챗봇 화면의 드롭다운에도 바로 보이게 합니다.
				this.plugin.notifySettingsChanged();
			},
		});
	}

	// "연결 확인" 버튼 및 탭이 열릴 때(모델이 이미 선택되어 있으면) 자동으로 실행됩니다.
	// 선택된 모델로 실제 대화 요청을 보내 서버가 정상 응답하는지 확인합니다.
	private async runConnectionTest(
		statusDot: HTMLElement,
		statusText: HTMLElement,
		connectionStatusEl: HTMLElement,
	): Promise<void> {
		const language = this.plugin.settings.general.language;
		const strings = t(language).llm;
		const { baseUrl, model } = this.plugin.settings.llm;

		if (!baseUrl || !model) {
			this.showTestResult(statusDot, statusText, 'idle', strings.statusMissing);
			connectionStatusEl.setText(this.formatLastVerified(strings));
			return;
		}

		setStatusLight(statusDot, statusText, 'idle', strings.statusChecking);
		// 결과는 checkSelectedModel이 챗봇 상단 상태등에도 기록합니다.
		const snapshot = this.plugin.connectionSnapshot();
		const check = await checkSelectedModel(this.plugin);
		// 기다리는 사이 서버 주소·키·모델이 바뀌었다면 옛 설정의 결과이므로 보여주지 않습니다.
		if (snapshot !== this.plugin.connectionSnapshot()) return;

		if (check.state === 'ok') {
			const reply = check.reply || t(language).chat.emptyReply;
			this.showTestResult(
				statusDot,
				statusText,
				'ok',
				`${strings.statusOk} · ${strings.statusReplyPrefix}${reply}`,
			);
			this.plugin.settings.llm.lastVerified = {
				at: new Date().toISOString(),
				baseUrl,
				model,
			};
			await this.plugin.saveSettings();
		} else {
			// 원인과 해결 방법을 표시등 옆 글자로 바로 보여주고, 서버 원문은 마우스를 올리면 보이게 합니다.
			const message =
				check.state === 'error' ? `${strings.statusError}: ${check.message}` : check.message;
			this.showTestResult(statusDot, statusText, check.state, message, check.detail);
		}
		connectionStatusEl.setText(this.formatLastVerified(strings));
	}

	// 연결 확인 표시등을 그리고, 탭을 다시 그릴 때 복원할 수 있게 기억해 둡니다.
	private showTestResult(
		statusDot: HTMLElement,
		statusText: HTMLElement,
		state: StatusState,
		message: string,
		detail?: string,
	): void {
		this.lastTest = { state, message, detail };
		setStatusLight(statusDot, statusText, state, message, detail);
	}

	private formatLastVerified(strings: ReturnType<typeof t>['llm']): string {
		const record = this.plugin.settings.llm.lastVerified;
		if (!record) {
			return strings.neverVerified;
		}
		const when = new Date(record.at).toLocaleString();
		// 연결 확인에 "성공"했을 때만 기록되는 값이라, "확인 시각"이 아니라 "마지막 연결 성공"으로 부릅니다.
		return `${strings.lastSuccessPrefix}${when} · ${record.model} (${record.baseUrl})`;
	}
}
