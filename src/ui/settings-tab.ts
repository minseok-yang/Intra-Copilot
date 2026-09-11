import {
	App,
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

		const statusEl = containerEl.createDiv({ cls: 'intra-copilot-status' });
		const statusDot = statusEl.createSpan({ cls: 'intra-copilot-status-dot' });
		const statusText = statusEl.createSpan({
			cls: 'intra-copilot-status-text',
			text: strings.statusIdle,
		});
		// 위치는 코드 순서가 아니라 DOM에 넣는 순서를 따르므로, 이 div는 실제로는
		// 아래 "연결 테스트" 버튼 바로 아래에 두기 위해 그 항목을 만든 다음에 옮깁니다.

		new Setting(containerEl)
			.setName(strings.modelName)
			.setDesc(strings.modelDesc)
			.addDropdown((dropdown) => {
				this.modelDropdown = dropdown;
				this.refreshModelOptions(dropdown, []);
			})
			.addButton((button) =>
				button.setButtonText(strings.fetchModelsButton).onClick(async () => {
					const { baseUrl } = this.plugin.settings.llm;
					if (!baseUrl) {
						this.setStatus(statusDot, statusText, 'error', strings.fillBaseUrlFirst);
						return;
					}

					button.setButtonText(strings.fetching).setDisabled(true);
					const result = await listLlmModels(this.plugin.settings.llm);
					button.setButtonText(strings.fetchModelsButton).setDisabled(false);

					if (!result.ok) {
						this.setStatus(
							statusDot,
							statusText,
							'error',
							`${strings.fetchFailPrefix}${result.error}`,
						);
						return;
					}
					if (result.models.length === 0) {
						this.setStatus(statusDot, statusText, 'error', strings.noModelsFound);
						return;
					}
					if (this.modelDropdown) {
						this.refreshModelOptions(this.modelDropdown, result.models);
					}
				}),
			);

		new Setting(containerEl)
			.setName(strings.testName)
			.setDesc(strings.testDesc)
			.addButton((button) =>
				button.setButtonText(strings.testButton).onClick(async () => {
					const { baseUrl, model } = this.plugin.settings.llm;
					if (!baseUrl || !model) {
						this.setStatus(statusDot, statusText, 'idle', strings.statusMissing);
						return;
					}

					button.setButtonText(strings.testing).setDisabled(true);
					this.setStatus(statusDot, statusText, 'idle', strings.statusChecking);
					const result = await testLlmConnection(this.plugin.settings.llm);
					button.setButtonText(strings.testButton).setDisabled(false);

					if (result.ok) {
						this.setStatus(
							statusDot,
							statusText,
							'ok',
							`${strings.statusOk} · ${strings.statusReplyPrefix}${result.reply}`,
						);
					} else {
						this.setStatus(
							statusDot,
							statusText,
							'error',
							strings.statusError,
							result.error,
						);
					}
				}),
			);

		containerEl.appendChild(statusEl);
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
