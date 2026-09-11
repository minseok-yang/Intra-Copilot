import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, IntraCopilotSettings } from './settings';
import { IntraCopilotSettingTab } from './ui/settings-tab';

export default class IntraCopilotPlugin extends Plugin {
	settings!: IntraCopilotSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new IntraCopilotSettingTab(this.app, this));
	}

	onunload() {}

	async loadSettings() {
		const loaded = (await this.loadData()) as
			| Partial<IntraCopilotSettings>
			| null;
		this.settings = {
			general: { ...DEFAULT_SETTINGS.general, ...loaded?.general },
			llm: { ...DEFAULT_SETTINGS.llm, ...loaded?.llm },
		};
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
