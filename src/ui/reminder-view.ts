import {
	App,
	ButtonComponent,
	ExtraButtonComponent,
	getAllTags,
	ItemView,
	normalizePath,
	Notice,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { t, type ReminderStrings } from '../i18n';
import { DueNote, DueReason, findDueNotes, NoteFacts } from '../reminder/due-notes';
import { CHAT_VIEW_TYPE, ChatView, revealChatView } from './chat-view';
import { confirmTwice } from './delete-confirm';
import { featureIcon } from './settings/features';

// 리마인더 화면(오른쪽 사이드바)입니다. 한 번 써 두고 묻힌 노트를 하루 몇 개씩 다시 보여 줍니다.
//
// 범위: 이 플러그인이 설치된 볼트 안의 노트(.md)만 살펴봅니다. Obsidian이 이미 모아 둔 정보(파일 목록,
// 링크, 태그)를 읽을 뿐 노트 내용을 따로 읽지 않으며, 어디로도 보내지 않습니다.
// 어떤 노트를 고르는지는 reminder/due-notes.ts, 기록은 reminder/reminder-store.ts에 있습니다.

export const REMINDER_VIEW_TYPE = 'intra-copilot-reminder-view';

export async function revealReminderView(plugin: IntraCopilotPlugin): Promise<void> {
	await plugin.app.workspace.ensureSideLeaf(REMINDER_VIEW_TYPE, 'right', { active: true, reveal: true });
}

export function refreshReminderViews(plugin: IntraCopilotPlugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(REMINDER_VIEW_TYPE)) {
		if (leaf.view instanceof ReminderView) leaf.view.render();
	}
}

// 볼트에서 노트 이름이 바뀌거나 지워지면 기록도 따라가게 하고, 그날 첫 실행이면 알림을 띄웁니다.
// 리마인더 화면이 닫혀 있어도 기록은 맞아야 하므로 플러그인이 켜져 있는 동안 늘 듣습니다.
export function registerReminder(plugin: IntraCopilotPlugin): void {
	const { vault, workspace } = plugin.app;
	plugin.registerView(REMINDER_VIEW_TYPE, (leaf) => new ReminderView(leaf, plugin));
	plugin.registerEvent(
		vault.on('rename', (file, oldPath) => {
			plugin.reminderStore.rename(oldPath, file.path);
			refreshReminderViews(plugin);
		}),
	);
	plugin.registerEvent(
		vault.on('delete', (file) => {
			plugin.reminderStore.remove(file.path);
			refreshReminderViews(plugin);
		}),
	);
	// 알림에 쓰는 개수는 기록·만든 날짜로만 정해져서(링크·태그는 순서에만 쓰임), Obsidian이 링크 정보를
	// 다 모으기 전에 세어도 맞습니다.
	workspace.onLayoutReady(() => {
		if (!plugin.settings.reminder.notifyOnStartup) return;
		const count = todayList(plugin).shown.length;
		if (count === 0 || !plugin.reminderStore.takeDailyNotice()) return;
		const text = t(plugin.settings.general.language).reminder.startupNotice.replace('{count}', String(count));
		new Notice(
			createFragment((fragment) => {
				fragment.createSpan({ text }).addEventListener('click', () => void revealReminderView(plugin));
			}),
			10000,
		);
	});
}

// Obsidian이 모아 둔 정보로 노트마다 필요한 값만 뽑습니다(노트 내용은 읽지 않음).
function collectNotes(app: App): NoteFacts[] {
	const incoming = new Map<string, number>();
	for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		for (const target of Object.keys(targets)) {
			if (target !== source) incoming.set(target, (incoming.get(target) ?? 0) + 1);
		}
	}
	return app.vault.getMarkdownFiles().map((file) => {
		const cache = app.metadataCache.getFileCache(file);
		return {
			path: file.path,
			ctime: file.stat.ctime,
			mtime: file.stat.mtime,
			tags: ((cache && getAllTags(cache)) ?? []).map((tag) => tag.replace(/^#/, '')),
			incomingLinks: incoming.get(file.path) ?? 0,
		};
	});
}

// due: 지금 다시 볼 노트 전체, shown: 그중 오늘 보여 줄 만큼(하루 표시 개수 − 오늘 이미 챙긴 수)
function todayList(plugin: IntraCopilotPlugin): { due: DueNote[]; shown: DueNote[] } {
	const { reminder } = plugin.settings;
	const due = findDueNotes(collectNotes(plugin.app), plugin.reminderStore.records, reminder, Date.now());
	const remaining = Math.max(0, reminder.dailyLimit - plugin.reminderStore.handledToday());
	return { due, shown: due.slice(0, remaining) };
}

function describeReason(reason: DueReason, strings: ReminderStrings): string {
	switch (reason.kind) {
		case 'never':
			return strings.reasonNever;
		case 'stale':
			return strings.reasonStale.replace('{days}', String(reason.days));
		case 'orphan':
			return strings.reasonOrphan;
		case 'tag':
			return `#${reason.tag}`;
	}
}

export class ReminderView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: IntraCopilotPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return REMINDER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.strings().title;
	}

	getIcon(): string {
		return featureIcon('reminder');
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('intra-copilot-reminder-view');
		this.render();
		// Obsidian을 켜자마자 이 화면이 열리면 링크·태그 정보가 아직 다 모이지 않았을 수 있습니다.
		// 다 모였다는 첫 신호에 한 번만 다시 그립니다(그 뒤로도 들으면 노트를 고칠 때마다 목록이 움직임).
		const ref = this.app.metadataCache.on('resolved', () => {
			this.app.metadataCache.offref(ref);
			this.render();
		});
		this.registerEvent(ref);
		return Promise.resolve();
	}

	private strings(): ReminderStrings {
		return t(this.plugin.settings.general.language).reminder;
	}

	render(): void {
		const strings = this.strings();
		const { contentEl } = this;
		contentEl.empty();

		const { due, shown } = todayList(this.plugin);
		const header = contentEl.createDiv({ cls: 'intra-copilot-reminder-header' });
		header.createSpan({
			cls: 'intra-copilot-reminder-title',
			text: strings.todayCount.replace('{count}', String(shown.length)),
		});
		new ExtraButtonComponent(header)
			.setIcon('refresh-cw')
			.setTooltip(strings.refreshTooltip)
			.onClick(() => this.render());
		contentEl.createEl('p', { cls: 'intra-copilot-reminder-scope', text: strings.scopeNote });

		if (shown.length === 0) {
			contentEl.createEl('p', {
				cls: 'intra-copilot-chat-empty',
				text: due.length > 0 ? strings.doneToday : strings.nothingDue,
			});
			return;
		}
		for (const note of shown) {
			const file = this.app.vault.getFileByPath(note.path);
			if (file) this.renderCard(contentEl, file, note, strings);
		}
	}

	private renderCard(containerEl: HTMLElement, file: TFile, note: DueNote, strings: ReminderStrings): void {
		const { reminderStore, settings } = this.plugin;
		const card = containerEl.createDiv({ cls: 'intra-copilot-reminder-card' });

		const name = card.createEl('a', { cls: 'intra-copilot-reminder-name', text: file.basename });
		name.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.openNote(file);
		});
		if (file.parent && !file.parent.isRoot()) {
			card.createDiv({ cls: 'intra-copilot-reminder-meta', text: file.parent.path });
		}
		card.createDiv({
			cls: 'intra-copilot-reminder-meta',
			text: note.reasons.map((reason) => describeReason(reason, strings)).join(' · '),
		});

		const actions = card.createDiv({ cls: 'intra-copilot-reminder-actions' });
		new ButtonComponent(actions)
			.setButtonText(strings.reviewButton)
			.setCta()
			.setTooltip(strings.reviewTooltip.replace('{days}', String(settings.reminder.intervalDays)))
			.onClick(() => {
				reminderStore.markReviewed(file.path);
				refreshReminderViews(this.plugin);
			});
		new ButtonComponent(actions)
			.setButtonText(strings.snoozeButton)
			.setTooltip(strings.snoozeTooltip.replace('{days}', String(settings.reminder.snoozeDays)))
			.onClick(() => {
				reminderStore.snooze(file.path, settings.reminder.snoozeDays);
				refreshReminderViews(this.plugin);
			});
		new ExtraButtonComponent(actions)
			.setIcon(featureIcon('chatbot'))
			.setTooltip(strings.chatTooltip)
			.onClick(() => void this.sendToChat(file));
		new ExtraButtonComponent(actions)
			.setIcon('archive')
			.setTooltip(strings.archiveTooltip.replace('{folder}', settings.reminder.archiveFolder))
			.onClick(() => void this.archive(file));
		const trash = new ExtraButtonComponent(actions);
		trash.onClick(
			confirmTwice(
				trash.extraSettingsEl,
				{
					arm: () => {
						trash.setIcon('alert-triangle').setTooltip(strings.deleteConfirmTooltip);
					},
					reset: () => {
						trash.setIcon('trash-2').setTooltip(strings.deleteTooltip);
					},
				},
				() => this.trash(file),
			),
		);
	}

	private async openNote(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	// 노트를 열고 챗봇 입력칸에 칩으로 올립니다. 챗봇은 질문할 때 열려 있는 노트만 고칠 수 있어서
	// 노트도 함께 엽니다. 질문은 사용자가 직접 써서 보냅니다(누르는 것만으로는 아무것도 전송하지 않음).
	private async sendToChat(file: TFile): Promise<void> {
		await this.openNote(file);
		await revealChatView(this.plugin);
		for (const leaf of this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
			if (leaf.view instanceof ChatView) leaf.view.attachCurrentNote();
		}
	}

	private async archive(file: TFile): Promise<void> {
		const strings = this.strings();
		const folder = this.plugin.settings.reminder.archiveFolder;
		const dest = normalizePath(`${folder}/${file.name}`);
		if (this.app.vault.getAbstractFileByPath(dest)) {
			new Notice(strings.archiveExists.replace('{path}', dest));
			return;
		}
		try {
			if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
			// fileManager로 옮기면 이 노트를 가리키던 링크도 Obsidian이 함께 고칩니다.
			await this.app.fileManager.renameFile(file, dest);
			this.plugin.reminderStore.countHandled();
		} catch {
			new Notice(strings.archiveFailed);
		}
		refreshReminderViews(this.plugin);
	}

	// Obsidian의 "삭제한 파일" 설정(시스템 휴지통 / .trash 폴더)을 따릅니다.
	private async trash(file: TFile): Promise<void> {
		try {
			await this.app.fileManager.trashFile(file);
			this.plugin.reminderStore.countHandled();
		} catch {
			new Notice(this.strings().deleteFailed);
		}
		refreshReminderViews(this.plugin);
	}
}
