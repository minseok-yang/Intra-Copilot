import {
	App,
	ButtonComponent,
	debounce,
	getAllTags,
	ItemView,
	Menu,
	normalizePath,
	Notice,
	setIcon,
	setTooltip,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { t, type ReminderStrings } from '../i18n';
import { DueNote, DueReason, findDueNotes, NoteFacts } from '../reminder/due-notes';
import { today } from '../reminder/reminder-store';
import { CHAT_VIEW_TYPE, ChatView, revealChatView } from './chat-view';
import { confirmTwice } from './delete-confirm';
import { featureIcon } from './settings/features';

// 리마인더 화면(오른쪽 사이드바)입니다. 한 번 써 두고 묻힌 노트를 하루 몇 개씩 다시 보여 줍니다.
//
// 범위: 이 플러그인이 설치된 볼트 안의 노트(.md)만 살펴봅니다. Obsidian이 이미 모아 둔 정보(파일 목록,
// 링크, 태그)를 읽을 뿐 노트 내용을 따로 읽지 않으며, 어디로도 보내지 않습니다.
// 어떤 노트를 고르는지는 reminder/due-notes.ts, 기록은 reminder/reminder-store.ts에 있습니다.

export const REMINDER_VIEW_TYPE = 'intra-copilot-reminder-view';


type TodayList = { due: DueNote[]; shown: DueNote[] };

export async function revealReminderView(plugin: IntraCopilotPlugin): Promise<void> {
	await plugin.app.workspace.ensureSideLeaf(REMINDER_VIEW_TYPE, 'right', { active: true, reveal: true });
}

export function refreshReminderViews(plugin: IntraCopilotPlugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(REMINDER_VIEW_TYPE)) {
		if (leaf.view instanceof ReminderView) leaf.view.render();
	}
}

// 볼트에서 노트 이름이 바뀌거나 지워지면 기록도 따라가게 하고, 그날 처음이면 알림을 띄웁니다.
// 리마인더 화면이 닫혀 있어도 기록은 맞아야 하므로 플러그인이 켜져 있는 동안 늘 듣습니다.
export function registerReminder(plugin: IntraCopilotPlugin): void {
	const { vault, workspace } = plugin.app;
	plugin.registerView(REMINDER_VIEW_TYPE, (leaf) => new ReminderView(leaf, plugin));

	// 폴더를 옮기거나 지우면 안의 파일마다 이벤트가 옵니다. 그때마다 볼트 전체를 다시 계산하면 멈추므로,
	// 이벤트가 잠잠해진 뒤 한 번만 다시 그립니다(기록은 이벤트마다 바로 고침).
	const refreshSoon = debounce(() => refreshReminderViews(plugin), 300, true);
	plugin.registerEvent(
		vault.on('rename', (file, oldPath) => {
			plugin.reminderStore.rename(oldPath, file.path);
			refreshSoon();
		}),
	);
	plugin.registerEvent(
		vault.on('delete', (file) => {
			plugin.reminderStore.remove(file.path);
			refreshSoon();
		}),
	);

	// 알림에 쓰는 개수는 기록·만든 날짜로만 정해져서(링크·태그는 순서에만 쓰임), Obsidian이 링크 정보를
	// 다 모으기 전에 세어도 맞습니다.
	let checkedDay = today();
	workspace.onLayoutReady(() => notifyDueNotes(plugin));
	// Obsidian을 켜 둔 채 날이 바뀌는 경우(사무실에서 흔함): 10분마다, 그리고 창으로 돌아올 때 날짜를 봅니다.
	// 바뀌었으면 어제 기준으로 그려진 목록을 새로 그리고, 창을 보고 있을 때 알림을 띄웁니다
	// (자리를 비운 새벽에 떠서 아무도 못 본 채 "오늘 알림 끝"이 되지 않게).
	const checkNewDay = () => {
		if (today() === checkedDay) return;
		refreshReminderViews(plugin);
		if (!document.hasFocus()) return;
		checkedDay = today();
		notifyDueNotes(plugin);
	};
	plugin.registerInterval(window.setInterval(checkNewDay, 10 * 60 * 1000));
	plugin.registerDomEvent(window, 'focus', checkNewDay);
}

function notifyDueNotes(plugin: IntraCopilotPlugin): void {
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
}

// 방금 한 일을 알리고 [되돌리기]를 설정한 시간 동안 보여 줍니다. 목록에서 사라진 노트를 다시 찾을 방법이
// 따로 없기 때문입니다. 언제 사라지는지 알 수 있게 남은 초를 1초마다 줄여 보여 줍니다.
function showUndoNotice(plugin: IntraCopilotPlugin, message: string, undo: () => void): void {
	const strings = t(plugin.settings.general.language).reminder;
	let secondsLeft = plugin.settings.reminder.undoSeconds;
	const countdownText = () => strings.undoCountdown.replace('{seconds}', String(secondsLeft));
	const countdown = createSpan({ cls: 'intra-copilot-undo-countdown', text: countdownText() });
	new Notice(
		createFragment((fragment) => {
			fragment.appendText(`${message} `);
			fragment.createEl('a', { text: strings.undoButton, href: '#' }).addEventListener('click', (evt) => {
				evt.preventDefault();
				undo();
			});
			fragment.append(countdown);
		}),
		secondsLeft * 1000,
	);
	// 시간이 다 됐거나, 알림을 눌러 먼저 닫혀 화면에서 빠졌으면 멈춥니다.
	const timer = window.setInterval(() => {
		secondsLeft -= 1;
		if (secondsLeft <= 0 || !countdown.isConnected) {
			window.clearInterval(timer);
			return;
		}
		countdown.setText(countdownText());
	}, 1000);
}

// 폴더 설정값을 볼트 기준 경로로 맞춥니다. 비었거나 볼트 맨 위('/')면 ''(뺄 폴더 없음)입니다.
function folderPath(value: unknown): string {
	if (typeof value !== 'string' || !value.trim()) return '';
	const path = normalizePath(value);
	return path === '/' ? '' : path;
}

// 템플릿을 모아 둔 폴더(코어 "템플릿" 플러그인, Templater). 템플릿은 다시 읽을 지식 노트가 아니라서 자동으로 뺍니다.
// 두 플러그인 모두 설정을 읽는 공개 API가 없어 내부 값을 읽으며, 구조가 바뀌어 못 읽으면 조용히 건너뜁니다.
function templateFolders(app: App): string[] {
	const internal = app as unknown as {
		internalPlugins?: {
			getPluginById?: (id: string) => { enabled?: boolean; instance?: { options?: { folder?: unknown } } } | null;
		};
		plugins?: { getPlugin?: (id: string) => { settings?: { templates_folder?: unknown } } | null };
	};
	const core = internal.internalPlugins?.getPluginById?.('templates');
	const templater = internal.plugins?.getPlugin?.('templater-obsidian');
	return [core?.enabled ? core.instance?.options?.folder : undefined, templater?.settings?.templates_folder]
		.map(folderPath)
		.filter((folder) => folder !== '');
}

// Obsidian이 모아 둔 정보로 노트마다 필요한 값만 뽑습니다(노트 내용은 읽지 않음).
function collectNotes(app: App): NoteFacts[] {
	const incoming = new Map<string, number>();
	for (const [source, targets] of Object.entries(app.metadataCache.resolvedLinks)) {
		for (const target of Object.keys(targets)) {
			if (target !== source) incoming.set(target, (incoming.get(target) ?? 0) + 1);
		}
	}
	return app.vault.getMarkdownFiles().flatMap((file) => {
		const cache = app.metadataCache.getFileCache(file);
		// Excalidraw 그림은 .md로 저장되지만 노트가 아니므로 뺍니다.
		if (file.path.endsWith('.excalidraw.md') || cache?.frontmatter?.['excalidraw-plugin'] !== undefined) return [];
		return [
			{
				path: file.path,
				ctime: file.stat.ctime,
				mtime: file.stat.mtime,
				tags: ((cache && getAllTags(cache)) ?? []).map((tag) => tag.replace(/^#/, '')),
				incomingLinks: incoming.get(file.path) ?? 0,
			},
		];
	});
}

// due: 지금 다시 볼 노트 전체, shown: 그중 오늘 보여 줄 만큼
function todayList(plugin: IntraCopilotPlugin): TodayList {
	const { reminder } = plugin.settings;
	const rules = { ...reminder, excludedFolders: [...reminder.excludedFolders, ...templateFolders(plugin.app)] };
	const due = findDueNotes(collectNotes(plugin.app), plugin.reminderStore.records, rules, Date.now());
	return { due, shown: due.slice(0, plugin.reminderStore.remainingToday(reminder.dailyLimit)) };
}

// 화면에 보이는 것(오늘 보여 줄 노트와 그 이유, 더 보기 개수)이 달라졌는지 비교하는 열쇠
function listKey(list: TodayList): string {
	return JSON.stringify([list.shown, list.due.length]);
}

function describeReason(reason: DueReason, strings: ReminderStrings): string {
	switch (reason.kind) {
		case 'new':
			return strings.reasonNew;
		case 'postponed':
			return strings.reasonPostponed.replace('{days}', String(reason.days));
		case 'orphan':
			return strings.reasonOrphan;
		case 'tag':
			return `#${reason.tag}`;
	}
}

// 아이콘과 글자가 함께 보이는 카드 버튼입니다. 좁은 사이드바에서도 무엇을 하는 버튼인지 바로 알 수 있게 합니다.
function addAction(
	parent: HTMLElement,
	icon: string,
	text: string,
	tooltip: string,
): { button: HTMLButtonElement; label: HTMLSpanElement } {
	const button = parent.createEl('button', { cls: 'intra-copilot-reminder-action' });
	setIcon(button.createSpan({ cls: 'intra-copilot-reminder-action-icon' }), icon);
	const label = button.createSpan({ text });
	setTooltip(button, tooltip);
	return { button, label };
}

export class ReminderView extends ItemView {
	// 마지막으로 그린 목록의 열쇠(listKey). 노트가 바뀔 때 다시 계산해서 달라졌을 때만 다시 그립니다.
	// 그대로인데 다시 그리면 누르려던 버튼이 사라지거나, 한 번 눌러 둔 [삭제]가 풀리기 때문입니다.
	private renderedKey = '';

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
		// 노트에 태그·링크를 더하거나 새 노트를 만들면 목록이 바뀔 수 있습니다. Obsidian이 링크 정보를 다시 모으면
		// 잠잠해진 뒤 한 번 계산합니다(켜자마자 열려 링크 정보가 덜 모였던 목록도 이걸로 바로잡힙니다).
		const refresh = debounce(() => this.refreshIfChanged(), 1000, true);
		this.registerEvent(this.app.metadataCache.on('resolved', refresh));
		return Promise.resolve();
	}

	private strings(): ReminderStrings {
		return t(this.plugin.settings.general.language).reminder;
	}

	// 버튼을 누르거나 노트 이름이 바뀌거나 설정이 바뀔 때 목록을 새로 계산해 그립니다.
	render(): void {
		this.draw(todayList(this.plugin));
	}

	private refreshIfChanged(): void {
		const list = todayList(this.plugin);
		if (listKey(list) !== this.renderedKey) this.draw(list);
	}

	private draw(list: TodayList): void {
		this.renderedKey = listKey(list);
		const strings = this.strings();
		const { reminder } = this.plugin.settings;
		const { contentEl } = this;
		const { due, shown } = list;
		contentEl.empty();

		contentEl.createDiv({
			cls: 'intra-copilot-reminder-title',
			text: strings.todayCount.replace('{count}', String(shown.length)),
		});
		contentEl.createEl('p', { cls: 'intra-copilot-reminder-scope', text: strings.scopeNote });

		if (shown.length === 0) {
			contentEl.createEl('p', {
				cls: 'intra-copilot-chat-empty',
				text: due.length > 0 ? strings.doneToday : strings.nothingDue,
			});
		}
		for (const note of shown) {
			const file = this.app.vault.getFileByPath(note.path);
			if (file) this.renderCard(contentEl, file, note, strings);
		}

		// 오늘 몫을 넘어 더 읽고 싶을 때: 남은 노트를 하루 표시 개수만큼 더 보여 줍니다(그날 동안 유지).
		const more = Math.min(reminder.dailyLimit, due.length - shown.length);
		if (more > 0) {
			new ButtonComponent(contentEl)
				.setButtonText(strings.moreButton.replace('{count}', String(more)))
				.onClick(() => {
					this.plugin.reminderStore.showMore(more);
					refreshReminderViews(this.plugin);
				});
		}
	}

	private renderCard(containerEl: HTMLElement, file: TFile, note: DueNote, strings: ReminderStrings): void {
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
		const later = addAction(actions, 'clock', strings.laterButton, strings.laterTooltip);
		setIcon(later.button.createSpan({ cls: 'intra-copilot-reminder-action-icon' }), 'chevron-down');
		later.button.addEventListener('click', () => this.showLaterMenu(later.button, file));

		addAction(actions, featureIcon('chatbot'), strings.chatButton, strings.chatTooltip).button.addEventListener(
			'click',
			() => void this.openInNewChat(file),
		);

		// 보관·삭제는 파일을 옮기는 동안 시간이 걸립니다. 그사이 한 번 더 눌려 같은 일을 두 번 하지 않게 버튼을 잠급니다
		// (끝나면 목록을 새로 그리므로 다시 풀 필요가 없습니다).
		const archive = addAction(
			actions,
			'archive',
			strings.archiveButton,
			strings.archiveTooltip.replace('{folder}', this.plugin.settings.reminder.archiveFolder),
		);
		archive.button.addEventListener('click', () => {
			archive.button.disabled = true;
			void this.archive(file);
		});

		const trash = addAction(actions, 'trash-2', strings.deleteButton, strings.deleteTooltip);
		trash.button.addClass('mod-warning');
		const onTrash = confirmTwice(
			trash.button,
			{
				arm: () => trash.label.setText(strings.deleteConfirmButton),
				reset: () => trash.label.setText(strings.deleteButton),
			},
			() => {
				trash.button.disabled = true;
				return this.trash(file);
			},
		);
		trash.button.addEventListener('click', () => void onTrash());
	}

	// [나중에 ▾]: 다 읽은 노트는 길게, 지금만 넘기는 노트는 짧게 미룰 수 있게 기간을 고릅니다.
	private showLaterMenu(button: HTMLElement, file: TFile): void {
		const strings = this.strings();
		const menu = new Menu();
		// 설정의 세 기간을 순서대로 보여 줍니다. 같은 값을 두 번 적었으면 한 번만 보입니다.
		const { snoozeDays, snoozeDays2, snoozeDays3 } = this.plugin.settings.reminder;
		for (const days of new Set([snoozeDays, snoozeDays2, snoozeDays3])) {
			menu.addItem((item) =>
				item.setTitle(strings.laterChoice.replace('{days}', String(days))).onClick(() => this.postpone(file, days)),
			);
		}
		const rect = button.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom });
	}

	private postpone(file: TFile, days: number): void {
		const strings = this.strings();
		const undo = this.plugin.reminderStore.postpone(file.path, days);
		refreshReminderViews(this.plugin);
		showUndoNotice(
			this.plugin,
			strings.postponedNotice.replace('{name}', file.basename).replace('{days}', String(days)),
			() => {
				undo();
				refreshReminderViews(this.plugin);
			},
		);
	}

	private async openNote(file: TFile): Promise<void> {
		await this.app.workspace.getLeaf(false).openFile(file);
	}

	// 노트를 열고 새 대화를 시작해 그 노트를 칩으로 올립니다. 챗봇은 질문할 때 열려 있는 노트만 고칠 수 있어서
	// 노트도 함께 엽니다. 질문은 사용자가 직접 써서 보냅니다(누르는 것만으로는 아무것도 전송하지 않음).
	private async openInNewChat(file: TFile): Promise<void> {
		await this.openNote(file);
		await revealChatView(this.plugin);
		// revealChatView가 보여 주는 창(첫 번째 챗봇 창)에서만 새 대화를 시작합니다. 챗봇 창을 여러 개
		// 열어 둔 경우 나머지 창에서 진행 중인 대화까지 비우면 안 되기 때문입니다.
		const view = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]?.view;
		if (view instanceof ChatView) view.startConversationWithCurrentNote();
	}

	private async archive(file: TFile): Promise<void> {
		const strings = this.strings();
		const folder = this.plugin.settings.reminder.archiveFolder;
		const dest = normalizePath(`${folder}/${file.name}`);
		if (this.app.vault.getAbstractFileByPath(dest)) {
			new Notice(strings.archiveExists.replace('{path}', dest));
		} else {
			const originalPath = file.path;
			try {
				if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
				// fileManager로 옮기면 이 노트를 가리키던 링크도 Obsidian이 함께 고칩니다.
				await this.app.fileManager.renameFile(file, dest);
				this.plugin.reminderStore.countHandled();
				showUndoNotice(
					this.plugin,
					strings.archivedNotice.replace('{name}', file.basename).replace('{folder}', folder),
					() => void this.unarchive(file, originalPath),
				);
			} catch {
				new Notice(strings.archiveFailed);
			}
		}
		// 실패했을 때도 다시 그려야 잠가 둔 버튼이 풀립니다.
		refreshReminderViews(this.plugin);
	}

	// [보관함] 되돌리기: 원래 자리로 옮기고 오늘 챙긴 수에서 뺍니다. 그사이 원래 자리에 같은 이름의 노트가
	// 생겼으면 덮어쓰지 않고 실패로 알립니다. (기록은 이름 바뀜 이벤트로 함께 따라옵니다.)
	private async unarchive(file: TFile, originalPath: string): Promise<void> {
		const { vault, fileManager } = this.app;
		const originalFolder = originalPath.includes('/') ? originalPath.slice(0, originalPath.lastIndexOf('/')) : '';
		try {
			if (vault.getAbstractFileByPath(originalPath)) throw new Error('A note already exists at the original path');
			if (originalFolder && !vault.getAbstractFileByPath(originalFolder)) await vault.createFolder(originalFolder);
			await fileManager.renameFile(file, originalPath);
			this.plugin.reminderStore.uncountHandled();
		} catch {
			new Notice(this.strings().undoFailed);
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
