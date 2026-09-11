import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, IntraCopilotSettings } from './settings';
import { IntraCopilotSettingTab } from './ui/settings-tab';
import { CHAT_VIEW_TYPE, ChatView, revealChatView } from './ui/chat-view';
import { GUIDE_VIEW_TYPE, GuideView } from './ui/guide-view';
import { t } from './i18n';

export default class IntraCopilotPlugin extends Plugin {
	settings!: IntraCopilotSettings;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new IntraCopilotSettingTab(this.app, this));

		this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
		this.registerView(GUIDE_VIEW_TYPE, (leaf) => new GuideView(leaf, this));
		this.addRibbonIcon(
			'bot',
			t(this.settings.general.language).chat.ribbonTooltip,
			() => {
				void revealChatView(this);
			},
		);
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
