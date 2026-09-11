import {
	DropdownComponent,
	ExtraButtonComponent,
	ItemView,
	MarkdownRenderer,
	Notice,
	WorkspaceLeaf,
} from 'obsidian';
import IntraCopilotPlugin from '../main';
import { ChatMessage, listLlmModels, sendChatMessage } from '../llm/client';
import { t } from '../i18n';
import { createStatusDot, setStatusDot, StatusState } from './status-light';
import { populateModelDropdown } from './model-dropdown';
import {
	deriveSessionTitle,
	loadSession,
	newSessionId,
	saveSession,
} from '../chat/session-store';
import { SessionHistoryModal } from './session-history-modal';

export const CHAT_VIEW_TYPE = 'intra-copilot-chat-view';

// 리본 아이콘 클릭 등에서 호출합니다. 이미 열려 있으면 그 탭을 보여주고,
// 없으면 오른쪽 사이드바에 새로 엽니다.
export async function revealChatView(plugin: IntraCopilotPlugin): Promise<void> {
	const { workspace } = plugin.app;
	const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

	let leaf: WorkspaceLeaf | null;
	if (existing.length > 0) {
		leaf = existing[0]!;
	} else {
		leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		}
	}

	if (leaf) {
		await workspace.revealLeaf(leaf);
	}
}

export class ChatView extends ItemView {
	plugin: IntraCopilotPlugin;
	private conversation: ChatMessage[] = [];
	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButtonEl!: HTMLButtonElement;
	private modelDropdown!: DropdownComponent;
	private modelStatusDot!: HTMLElement;
	private modelStatusCheckedAt: string | null = null;
	// 지금 진행 중인 대화를 conversations/ 폴더의 어느 파일에 저장할지입니다.
	// null이면 아직 아무것도 주고받지 않은, 저장할 필요 없는 새 대화입니다.
	private currentSessionId: string | null = null;
	private currentSessionCreatedAt: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: IntraCopilotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t(this.plugin.settings.general.language).chat.title;
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		const strings = t(this.plugin.settings.general.language);

		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('intra-copilot-chat-view');

		// 우측 상단: 새 대화 + 모델 선택 드롭다운 + 새로고침 + 상태등. 모델 선택은 설정 화면과
		// 완전히 같은 값(settings.llm.model)을 공유합니다 — 여기서 바꾸면 설정에도 반영됩니다.
		const header = container.createDiv({ cls: 'intra-copilot-chat-header' });

		new ExtraButtonComponent(header)
			.setIcon('plus')
			.setTooltip(strings.chat.newChatTooltip)
			.onClick(() => {
				this.startNewConversation();
			});

		new ExtraButtonComponent(header)
			.setIcon('history')
			.setTooltip(strings.chat.historyTooltip)
			.onClick(() => {
				new SessionHistoryModal(this.plugin.app, this.plugin, (id) => {
					void this.loadSessionById(id);
				}).open();
			});

		this.modelDropdown = new DropdownComponent(header);
		this.applyModelOptions([]);

		const refreshButton = new ExtraButtonComponent(header)
			.setIcon('refresh-cw')
			.setTooltip(strings.chat.refreshModelsTooltip)
			.onClick(() => {
				void this.refreshModels(refreshButton);
			});

		this.modelStatusDot = createStatusDot(header);
		setStatusDot(this.modelStatusDot, 'idle', strings.llm.statusIdle);

		this.messagesEl = container.createDiv({ cls: 'intra-copilot-chat-messages' });
		this.showEmptyState();

		const inputRow = container.createDiv({ cls: 'intra-copilot-chat-input-row' });
		this.inputEl = inputRow.createEl('textarea', {
			cls: 'intra-copilot-chat-input',
			attr: { placeholder: strings.chat.inputPlaceholder, rows: '2' },
		});
		this.sendButtonEl = inputRow.createEl('button', {
			cls: 'intra-copilot-chat-send',
			text: strings.chat.sendButton,
		});

		this.sendButtonEl.onclick = () => {
			void this.handleSend();
		};
		this.inputEl.addEventListener('keydown', (evt) => {
			// 한글처럼 조합해서 입력하는 언어(IME)에서는 글자를 확정할 때도 Enter가 눌립니다.
			// 이때 전송해버리면 "안녕하세" 같은 미완성 문장이 날아가므로 조합 중에는 무시합니다.
			if (evt.isComposing) return;
			if (evt.key === 'Enter' && !evt.shiftKey) {
				evt.preventDefault();
				void this.handleSend();
			}
		});

		// 패널을 열면 바로 한 번 모델 목록을 불러와 봅니다(설정이 안 돼 있으면 조용히 실패).
		void this.refreshModels(refreshButton);
	}

	async onClose(): Promise<void> {
		// 정리할 리소스가 없습니다.
	}

	// 대화 기록을 지우고 빈 상태로 되돌립니다. 오간 대화가 있었다면 이미 conversations/
	// 폴더에 저장되어 있으므로(handleSend에서 매번 저장) 지난 대화 목록에서 다시 찾을 수 있습니다.
	private startNewConversation(): void {
		this.conversation = [];
		this.currentSessionId = null;
		this.currentSessionCreatedAt = null;
		this.showEmptyState();
	}

	private showEmptyState(): void {
		this.messagesEl.empty();
		this.messagesEl.createEl('p', {
			cls: 'intra-copilot-chat-empty',
			text: t(this.plugin.settings.general.language).chat.emptyState,
		});
	}

	// "지난 대화" 목록에서 하나를 골랐을 때 그 내용을 불러와 이어서 볼 수 있게 합니다.
	private async loadSessionById(id: string): Promise<void> {
		const session = await loadSession(this.plugin, id);
		if (!session) {
			new Notice(t(this.plugin.settings.general.language).chat.historyLoadFailed);
			return;
		}

		this.currentSessionId = session.id;
		this.currentSessionCreatedAt = session.createdAt;
		this.conversation = session.messages;

		this.messagesEl.empty();
		if (this.conversation.length === 0) {
			this.showEmptyState();
			return;
		}
		for (const message of this.conversation) {
			if (message.role === 'assistant') {
				const bubble = this.appendBubble('assistant', '');
				bubble.addClass('is-markdown');
				await MarkdownRenderer.render(this.plugin.app, message.content, bubble, '', this);
			} else if (message.role === 'user') {
				this.appendBubble('user', message.content);
			}
		}
	}

	// 사용자 메시지를 보낼 때, 그리고 답이 도착했을 때 각각 저장해서, 응답을 못 받고
	// Obsidian이 닫히는 경우에도 최소한 사용자가 물어본 내용은 남게 합니다.
	private async persistCurrentSession(): Promise<void> {
		if (!this.currentSessionId || !this.currentSessionCreatedAt) return;
		await saveSession(this.plugin, {
			id: this.currentSessionId,
			title: deriveSessionTitle(this.conversation),
			createdAt: this.currentSessionCreatedAt,
			updatedAt: new Date().toISOString(),
			messages: this.conversation,
		});
	}

	private async refreshModels(button: ExtraButtonComponent): Promise<void> {
		const strings = t(this.plugin.settings.general.language).llm;
		const { baseUrl } = this.plugin.settings.llm;

		if (!baseUrl) {
			this.setModelStatus('error', strings.fillBaseUrlFirst);
			return;
		}

		button.setDisabled(true);
		setStatusDot(this.modelStatusDot, 'idle', strings.statusChecking);
		const result = await listLlmModels(this.plugin.settings.llm);
		button.setDisabled(false);

		if (!result.ok) {
			this.applyModelOptions([], { allowCurrentFallback: false });
			this.setModelStatus('error', `${strings.fetchFailPrefix}${result.error}`);
			return;
		}
		if (result.models.length === 0) {
			this.applyModelOptions([], { allowCurrentFallback: false });
			this.setModelStatus('error', strings.noModelsFound);
			return;
		}

		this.setModelStatus('ok', strings.fetchOk);
		this.applyModelOptions(result.models);
	}

	// 점 위에 마우스를 올리면 상태 문구와 마지막으로 확인된 시각을 함께 보여줍니다.
	// 확인 중(idle)일 때는 아직 결과가 없으니 시각을 갱신하지 않습니다.
	private setModelStatus(state: StatusState, message: string): void {
		const strings = t(this.plugin.settings.general.language).llm;
		if (state !== 'idle') {
			this.modelStatusCheckedAt = new Date().toLocaleString();
		}
		const tooltip = this.modelStatusCheckedAt
			? `${message} · ${strings.lastVerifiedPrefix}${this.modelStatusCheckedAt}`
			: message;
		setStatusDot(this.modelStatusDot, state, tooltip);
	}

	private applyModelOptions(
		models: string[],
		options: { allowCurrentFallback?: boolean } = {},
	): void {
		const strings = t(this.plugin.settings.general.language).llm;
		populateModelDropdown(this.modelDropdown, models, {
			placeholderText: strings.modelPlaceholder,
			currentModel: this.plugin.settings.llm.model,
			allowCurrentFallback: options.allowCurrentFallback,
			onSelect: async (value) => {
				this.plugin.settings.llm.model = value;
				await this.plugin.saveSettings();
			},
		});
	}

	private async handleSend(): Promise<void> {
		const strings = t(this.plugin.settings.general.language).chat;
		const text = this.inputEl.value.trim();
		if (!text) return;

		const { baseUrl, model } = this.plugin.settings.llm;
		if (!baseUrl || !model) {
			this.appendBubble('assistant', strings.notConfigured, { isError: true });
			return;
		}

		if (this.conversation.length === 0) {
			this.messagesEl.empty();
		}

		this.inputEl.value = '';
		this.inputEl.disabled = true;
		this.sendButtonEl.disabled = true;

		if (!this.currentSessionId) {
			this.currentSessionId = newSessionId();
			this.currentSessionCreatedAt = new Date().toISOString();
		}

		this.conversation.push({ role: 'user', content: text });
		this.appendBubble('user', text);
		// 답을 받기 전에 한 번 저장해둡니다 — 응답이 오기 전에 Obsidian이 닫혀도
		// 최소한 사용자가 물어본 내용은 지난 대화 목록에 남습니다.
		void this.persistCurrentSession();

		const pending = this.appendBubble('assistant', strings.thinking, { isPending: true });

		const result = await sendChatMessage(this.plugin.settings.llm, this.conversation);

		this.inputEl.disabled = false;
		this.sendButtonEl.disabled = false;
		this.inputEl.focus();

		pending.removeClass('is-pending');
		if (result.ok) {
			this.conversation.push({ role: 'assistant', content: result.reply });
			// LLM은 보통 마크다운(목록, 굵게, 코드블록)으로 답하므로 그대로 렌더링합니다.
			// 순수 텍스트로 넣으면 `**굵게**` 같은 기호가 그대로 보입니다.
			pending.empty();
			pending.addClass('is-markdown');
			await MarkdownRenderer.render(this.plugin.app, result.reply, pending, '', this);
			void this.persistCurrentSession();
		} else {
			pending.setText(`${strings.errorPrefix}${result.error}`);
			pending.addClass('is-error');
		}
	}

	private appendBubble(
		role: 'user' | 'assistant',
		text: string,
		options: { isPending?: boolean; isError?: boolean } = {},
	): HTMLElement {
		const bubble = this.messagesEl.createDiv({
			cls: `intra-copilot-chat-bubble is-${role}`,
		});
		if (options.isPending) bubble.addClass('is-pending');
		if (options.isError) bubble.addClass('is-error');
		bubble.setText(text);
		this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
		return bubble;
	}
}
