import { App, Modal, Setting } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { deleteSession, listSessions } from '../chat/session-store';
import { t } from '../i18n';

// 저장된 대화 목록을 보여주고, 고르면 콜백으로 그 id를 넘깁니다.
export class SessionHistoryModal extends Modal {
	private plugin: IntraCopilotPlugin;
	private onSelect: (id: string) => void;

	constructor(app: App, plugin: IntraCopilotPlugin, onSelect: (id: string) => void) {
		super(app);
		this.plugin = plugin;
		this.onSelect = onSelect;
	}

	async onOpen(): Promise<void> {
		const strings = t(this.plugin.settings.general.language).chat;
		this.setTitle(strings.historyTitle);
		await this.renderList();
	}

	private async renderList(): Promise<void> {
		const strings = t(this.plugin.settings.general.language).chat;
		this.contentEl.empty();

		const sessions = await listSessions(this.plugin);
		if (sessions.length === 0) {
			this.contentEl.createEl('p', {
				cls: 'intra-copilot-chat-empty',
				text: strings.historyEmpty,
			});
			return;
		}

		for (const session of sessions) {
			const when = new Date(session.updatedAt).toLocaleString();
			new Setting(this.contentEl)
				.setName(session.title)
				.setDesc(when)
				.addButton((button) =>
					button.setButtonText(strings.historyLoadButton).onClick(() => {
						this.onSelect(session.id);
						this.close();
					}),
				)
				.addExtraButton((button) =>
					button
						.setIcon('trash-2')
						.setTooltip(strings.historyDeleteTooltip)
						.onClick(async () => {
							await deleteSession(this.plugin, session.id);
							await this.renderList();
						}),
				);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
