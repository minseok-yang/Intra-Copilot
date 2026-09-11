import { ItemView, WorkspaceLeaf } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { ChatMessage, sendChatMessage } from '../llm/client';
import { t } from '../i18n';

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
		return 'message-circle';
	}

	async onOpen(): Promise<void> {
		const strings = t(this.plugin.settings.general.language).chat;

		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('intra-copilot-chat-view');

		this.messagesEl = container.createDiv({ cls: 'intra-copilot-chat-messages' });
		this.messagesEl.createEl('p', {
			cls: 'intra-copilot-chat-empty',
			text: strings.emptyState,
		});

		const inputRow = container.createDiv({ cls: 'intra-copilot-chat-input-row' });
		this.inputEl = inputRow.createEl('textarea', {
			cls: 'intra-copilot-chat-input',
			attr: { placeholder: strings.inputPlaceholder, rows: '2' },
		});
		this.sendButtonEl = inputRow.createEl('button', {
			cls: 'intra-copilot-chat-send',
			text: strings.sendButton,
		});

		this.sendButtonEl.onclick = () => {
			void this.handleSend();
		};
		this.inputEl.addEventListener('keydown', (evt) => {
			if (evt.key === 'Enter' && !evt.shiftKey) {
				evt.preventDefault();
				void this.handleSend();
			}
		});
	}

	async onClose(): Promise<void> {
		// 정리할 리소스가 없습니다.
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

		this.conversation.push({ role: 'user', content: text });
		this.appendBubble('user', text);

		const pending = this.appendBubble('assistant', strings.thinking, { isPending: true });

		const result = await sendChatMessage(this.plugin.settings.llm, this.conversation);

		this.inputEl.disabled = false;
		this.sendButtonEl.disabled = false;
		this.inputEl.focus();

		pending.removeClass('is-pending');
		if (result.ok) {
			this.conversation.push({ role: 'assistant', content: result.reply });
			pending.setText(result.reply);
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
