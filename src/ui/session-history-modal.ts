import { App, Modal, Setting } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { deleteSession, listSessions } from '../chat/session-store';
import { t } from '../i18n';

interface SessionHistoryCallbacks {
	onSelect: (id: string) => void; // [불러오기]를 눌렀을 때
	onDelete: (id: string) => void; // 삭제가 끝났을 때(지금 열린 대화인지 챗봇 화면이 판단)
}

// 휴지통을 한 번 누른 뒤 이 시간 안에 다시 눌러야 삭제됩니다. 지나면 원래대로 돌아갑니다.
const DELETE_CONFIRM_MS = 4000;

// 저장된 대화 목록을 보여주고, 고르면 콜백으로 그 id를 넘깁니다.
export class SessionHistoryModal extends Modal {
	private plugin: IntraCopilotPlugin;
	private callbacks: SessionHistoryCallbacks;

	constructor(app: App, plugin: IntraCopilotPlugin, callbacks: SessionHistoryCallbacks) {
		super(app);
		this.plugin = plugin;
		this.callbacks = callbacks;
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
			const updated = new Date(session.updatedAt);
			const when = Number.isNaN(updated.getTime()) ? '' : updated.toLocaleString();
			const row = new Setting(this.contentEl)
				.setName(session.title || strings.emptyTitle)
				.setDesc(when)
				.addButton((button) =>
					button.setButtonText(strings.historyLoadButton).onClick(() => {
						this.callbacks.onSelect(session.id);
						this.close();
					}),
				);

			// 삭제는 되돌릴 수 없으므로 두 번 눌러야 합니다. 첫 번째 누름에서는 경고 문구만 보여줍니다.
			let confirmTimer: number | null = null;
			row.addExtraButton((button) => {
				const reset = () => {
					confirmTimer = null;
					button.setIcon('trash-2').setTooltip(strings.historyDeleteTooltip);
					button.extraSettingsEl.removeClass('intra-copilot-delete-armed');
					row.setDesc(when);
				};
				reset();
				button.onClick(async () => {
					if (confirmTimer === null) {
						button.setIcon('alert-triangle').setTooltip(strings.historyDeleteConfirmTooltip);
						button.extraSettingsEl.addClass('intra-copilot-delete-armed');
						row.setDesc(strings.historyDeleteConfirm);
						confirmTimer = window.setTimeout(reset, DELETE_CONFIRM_MS);
						return;
					}
					window.clearTimeout(confirmTimer);
					confirmTimer = null;
					await deleteSession(this.plugin, session.id);
					this.callbacks.onDelete(session.id);
					await this.renderList();
				});
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
