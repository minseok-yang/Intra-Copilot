import {
	App,
	ButtonComponent,
	DropdownComponent,
	PluginSettingTab,
	Setting,
} from 'obsidian';
import IntraCopilotPlugin from '../main';
import { listLlmModels, testLlmConnection } from '../llm/client';
import { UiLanguage } from '../settings';
import { t } from '../i18n';

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

	constructor(app: App, plugin: IntraCopilotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
					.onChange(async (value) => {
						this.plugin.settings.llm.baseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(strings.apiKeyName)
			.setDesc(strings.apiKeyDesc)
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.llm.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.llm.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		// "모델 이름" 항목: 위 줄은 [불러오기 버튼 + 상태등], 아래 줄은 드롭다운.
		const modelSetting = new Setting(containerEl)
			.setName(strings.modelName)
			.setDesc(strings.modelDesc);
		modelSetting.controlEl.addClass('intra-copilot-stacked-control');

		const fetchRow = modelSetting.controlEl.createDiv({
			cls: 'intra-copilot-inline-row',
		});
		const fetchButton = new ButtonComponent(fetchRow).setButtonText(
			strings.fetchModelsButton,
		);
		const fetchStatusEl = fetchRow.createDiv({ cls: 'intra-copilot-status' });
		const fetchStatusDot = fetchStatusEl.createSpan({
			cls: 'intra-copilot-status-dot',
		});
		const fetchStatusText = fetchStatusEl.createSpan({
			cls: 'intra-copilot-status-text',
			text: strings.statusIdle,
		});

		const dropdownRow = modelSetting.controlEl.createDiv();
		const modelDropdown = new DropdownComponent(dropdownRow);
		this.modelDropdown = modelDropdown;
		this.refreshModelOptions(modelDropdown, []);

		fetchButton.onClick(async () => {
			const { baseUrl } = this.plugin.settings.llm;
			if (!baseUrl) {
				this.setStatus(fetchStatusDot, fetchStatusText, 'error', strings.fillBaseUrlFirst);
				return;
			}

			fetchButton.setButtonText(strings.fetching).setDisabled(true);
			this.setStatus(fetchStatusDot, fetchStatusText, 'idle', strings.statusChecking);
			const result = await listLlmModels(this.plugin.settings.llm);
			fetchButton.setButtonText(strings.fetchModelsButton).setDisabled(false);

			if (!result.ok) {
				this.setStatus(
					fetchStatusDot,
					fetchStatusText,
					'error',
					`${strings.fetchFailPrefix}${result.error}`,
				);
				return;
			}
			if (result.models.length === 0) {
				this.setStatus(fetchStatusDot, fetchStatusText, 'error', strings.noModelsFound);
				return;
			}

			this.setStatus(fetchStatusDot, fetchStatusText, 'ok', strings.fetchOk);
			this.refreshModelOptions(modelDropdown, result.models);
		});

		// "연결 테스트" 항목: 상태등을 같은 컨트롤 영역 안에 둬서 한 블록으로 보이게 합니다.
		let testStatusDot!: HTMLElement;
		let testStatusText!: HTMLElement;

		// "마지막 연결 확인" 항목: 설정에 저장되어 계속 남아있는 기록(서버/모델/시각)입니다.
		// 두 버튼(테스트/새로고침) 모두 성공하면 이 기록을 갱신합니다.
		const lastVerifiedSetting = new Setting(containerEl)
			.setName(strings.lastVerifiedName)
			.setDesc(this.formatLastVerified(strings));

		const testSetting = new Setting(containerEl)
			.setName(strings.testName)
			.setDesc(strings.testDesc)
			.addButton((button) =>
				button.setButtonText(strings.testButton).onClick(async () => {
					button.setButtonText(strings.testing).setDisabled(true);
					await this.runConnectionTest(testStatusDot, testStatusText, lastVerifiedSetting);
					button.setButtonText(strings.testButton).setDisabled(false);
				}),
			);

		const testStatusEl = testSetting.controlEl.createDiv({ cls: 'intra-copilot-status' });
		testStatusDot = testStatusEl.createSpan({ cls: 'intra-copilot-status-dot' });
		testStatusText = testStatusEl.createSpan({
			cls: 'intra-copilot-status-text',
			text: strings.statusIdle,
		});

		lastVerifiedSetting.addExtraButton((btn) =>
			btn
				.setIcon('refresh-cw')
				.setTooltip(strings.refreshTooltip)
				.onClick(async () => {
					btn.setDisabled(true);
					await this.runConnectionTest(testStatusDot, testStatusText, lastVerifiedSetting);
					btn.setDisabled(false);
				}),
		);
	}

	// "테스트"와 "새로고침" 버튼이 공통으로 쓰는 로직입니다. 상태등을 갱신하고,
	// 성공하면 "마지막 연결 확인" 기록도 함께 저장/갱신합니다.
	private async runConnectionTest(
		statusDot: HTMLElement,
		statusText: HTMLElement,
		lastVerifiedSetting: Setting,
	): Promise<void> {
		const strings = t(this.plugin.settings.general.language).llm;
		const { baseUrl, model } = this.plugin.settings.llm;

		if (!baseUrl || !model) {
			this.setStatus(statusDot, statusText, 'idle', strings.statusMissing);
			return;
		}

		this.setStatus(statusDot, statusText, 'idle', strings.statusChecking);
		const result = await testLlmConnection(this.plugin.settings.llm);

		if (result.ok) {
			this.setStatus(
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
			lastVerifiedSetting.setDesc(this.formatLastVerified(strings));
		} else {
			this.setStatus(statusDot, statusText, 'error', strings.statusError, result.error);
		}
	}

	private formatLastVerified(strings: ReturnType<typeof t>['llm']): string {
		const record = this.plugin.settings.llm.lastVerified;
		if (!record) {
			return strings.neverVerified;
		}
		const when = new Date(record.at).toLocaleString();
		return `${strings.lastVerifiedPrefix}${when} · ${record.baseUrl} · ${record.model}`;
	}

	// dropdown을 비우고 다시 채웁니다. models가 비어 있으면 이미 저장된 모델 값만(있다면) 보여줍니다.
	private refreshModelOptions(
		dropdown: DropdownComponent,
		models: string[],
	): void {
		const strings = t(this.plugin.settings.general.language).llm;
		const savedModel = this.plugin.settings.llm.model;
		const options = models.length > 0 ? models : savedModel ? [savedModel] : [];

		dropdown.selectEl.empty();
		dropdown.addOption('', strings.modelPlaceholder);
		for (const modelId of options) {
			dropdown.addOption(modelId, modelId);
		}
		dropdown.setValue(savedModel && options.includes(savedModel) ? savedModel : '');
		dropdown.onChange(async (value) => {
			this.plugin.settings.llm.model = value;
			await this.plugin.saveSettings();
		});
	}

	// 알림(Notice) 대신 화면에 남아있는 작은 점+문구로 서버 상태를 보여줍니다.
	private setStatus(
		dot: HTMLElement,
		text: HTMLElement,
		state: 'idle' | 'ok' | 'error',
		message: string,
		detail?: string,
	): void {
		dot.classList.remove('is-ok', 'is-error');
		if (state !== 'idle') {
			dot.classList.add(state === 'ok' ? 'is-ok' : 'is-error');
		}

		text.textContent = message;
		if (detail) {
			text.setAttribute('title', detail);
		} else {
			text.removeAttribute('title');
		}
	}
}
