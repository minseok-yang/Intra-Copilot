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
import { listLlmModels, testLlmConnection } from '../llm/client';
import { UiLanguage } from '../settings';
import { t } from '../i18n';
import { createStatusLight, setStatusLight } from './status-light';
import { populateModelDropdown } from './model-dropdown';
import { openGuideWindow } from './guide-view';
import { LICENSE_MD, USER_GUIDE_MD } from '../content/docs';

// 숫자 입력칸 값을 안전하게 정수로 바꿉니다. 비어있거나 이상한 값이면 0(제한 없음)으로 취급합니다.
function parseNonNegativeInt(value: string): number {
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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
	private modelDropdown?: DropdownComponent;
	// 설정 창을 새로 열었을 때만 자동으로 연결을 확인하기 위한 표시입니다.
	// 내부 탭 전환(일반↔LLM)이나 언어 변경으로 화면을 다시 그릴 때는 재확인하지 않습니다.
	private autoCheckPending = true;

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
				void openGuideWindow(this.plugin, {
					title: licenseStrings.summaryHeading,
					markdown: LICENSE_MD,
				});
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
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName(strings.guideName)
			.setDesc(strings.guideDesc)
			.addButton((button) =>
				button.setButtonText(strings.guideButton).onClick(() => {
					void openGuideWindow(this.plugin, {
						title: strings.guideName,
						markdown: USER_GUIDE_MD,
					});
				}),
			);
	}

	private renderLlmTab(containerEl: HTMLElement): void {
		const language = this.plugin.settings.general.language;
		const strings = t(language).llm;

		new Setting(containerEl).setName(strings.heading).setHeading();
		containerEl.createEl('p', { text: strings.intro });

		new Setting(containerEl)
			.setName(strings.baseUrlName)
			.setDesc(strings.baseUrlDesc)
			.addText((text) =>
				text
					.setPlaceholder('http://localhost:1234/v1')
					.setValue(this.plugin.settings.llm.baseUrl)
					.onChange((value) => {
						this.plugin.settings.llm.baseUrl = value.trim();
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
		this.modelDropdown = modelDropdown;
		this.applyModelOptions(modelDropdown, []);

		const checkModels = async () => {
			modelCheckButton.setButtonText(strings.testing).setDisabled(true);
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

		new Setting(advancedSection)
			.setName(strings.maxHistoryName)
			.setDesc(strings.maxHistoryDesc)
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.llm.maxHistoryMessages))
					.onChange((value) => {
						this.plugin.settings.llm.maxHistoryMessages = parseNonNegativeInt(value);
						this.saveSoon();
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
			});

		new Setting(advancedSection)
			.setName(strings.maxResponseName)
			.setDesc(strings.maxResponseDesc)
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.llm.maxResponseTokens))
					.onChange((value) => {
						this.plugin.settings.llm.maxResponseTokens = parseNonNegativeInt(value);
						this.saveSoon();
					});
				text.inputEl.type = 'number';
				text.inputEl.min = '0';
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

	// "모델 확인" 버튼 및 탭이 열릴 때 자동으로 실행됩니다. 서버에서 모델 목록을 가져와
	// 드롭다운을 채웁니다. 연결 테스트(실제 대화 요청)는 하지 않습니다.
	private async refreshModelList(
		modelDropdown: DropdownComponent,
		statusDot: HTMLElement,
		statusText: HTMLElement,
	): Promise<void> {
		const strings = t(this.plugin.settings.general.language).llm;
		const { baseUrl } = this.plugin.settings.llm;

		if (!baseUrl) {
			setStatusLight(statusDot, statusText, 'idle', strings.fillBaseUrlFirst);
			return;
		}

		setStatusLight(statusDot, statusText, 'idle', strings.statusChecking);
		const result = await listLlmModels(this.plugin.settings.llm);

		if (!result.ok) {
			this.applyModelOptions(modelDropdown, [], { allowCurrentFallback: false });
			setStatusLight(statusDot, statusText, 'error', `${strings.fetchFailPrefix}${result.error}`);
			return;
		}
		if (result.models.length === 0) {
			this.applyModelOptions(modelDropdown, [], { allowCurrentFallback: false });
			setStatusLight(statusDot, statusText, 'error', strings.noModelsFound);
			return;
		}

		setStatusLight(statusDot, statusText, 'ok', strings.fetchOk);
		this.applyModelOptions(modelDropdown, result.models);
	}

	// "연결 확인" 버튼 및 탭이 열릴 때(모델이 이미 선택되어 있으면) 자동으로 실행됩니다.
	// 선택된 모델로 실제 대화 요청을 보내 서버가 정상 응답하는지 확인합니다.
	private async runConnectionTest(
		statusDot: HTMLElement,
		statusText: HTMLElement,
		connectionStatusEl: HTMLElement,
	): Promise<void> {
		const strings = t(this.plugin.settings.general.language).llm;
		const { baseUrl, model } = this.plugin.settings.llm;

		if (!baseUrl || !model) {
			setStatusLight(statusDot, statusText, 'idle', strings.statusMissing);
			connectionStatusEl.setText(this.formatLastVerified(strings));
			return;
		}

		setStatusLight(statusDot, statusText, 'idle', strings.statusChecking);
		const result = await testLlmConnection(this.plugin.settings.llm);

		if (result.ok) {
			setStatusLight(
				statusDot,
				statusText,
				'ok',
				`${strings.statusOk} · ${strings.statusReplyPrefix}${result.reply}`,
			);
			this.plugin.settings.llm.lastVerified = {
				at: new Date().toISOString(),
				baseUrl,
				model,
			};
			await this.plugin.saveSettings();
		} else {
			setStatusLight(statusDot, statusText, 'error', strings.statusError, result.error);
		}
		connectionStatusEl.setText(this.formatLastVerified(strings));
	}

	private formatLastVerified(strings: ReturnType<typeof t>['llm']): string {
		const record = this.plugin.settings.llm.lastVerified;
		if (!record) {
			return strings.neverVerified;
		}
		const when = new Date(record.at).toLocaleString();
		return `${strings.lastVerifiedPrefix}${when} · ${record.baseUrl} · ${record.model}`;
	}

	private applyModelOptions(
		dropdown: DropdownComponent,
		models: string[],
		options: { allowCurrentFallback?: boolean } = {},
	): void {
		const strings = t(this.plugin.settings.general.language).llm;
		populateModelDropdown(dropdown, models, {
			placeholderText: strings.modelPlaceholder,
			currentModel: this.plugin.settings.llm.model,
			allowCurrentFallback: options.allowCurrentFallback,
			onSelect: async (value) => {
				this.plugin.settings.llm.model = value;
				await this.plugin.saveSettings();
			},
		});
	}
}
