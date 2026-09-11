import { DropdownComponent, ExtraButtonComponent, ItemView, WorkspaceLeaf } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { ChatMessage, listLlmModels, sendChatMessage } from '../llm/client';
import { t } from '../i18n';
import { createStatusDot, setStatusDot } from './status-light';
import { populateModelDropdown } from './model-dropdown';

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

		// 우측 상단: 모델 선택 드롭다운 + 새로고침 + 상태등. 설정 화면의 모델 선택과
		// 완전히 같은 값(settings.llm.model)을 공유합니다 — 여기서 바꾸면 설정에도 반영됩니다.
		const header = container.createDiv({ cls: 'intra-copilot-chat-header' });
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
		this.messagesEl.createEl('p', {
			cls: 'intra-copilot-chat-empty',
			text: strings.chat.emptyState,
		});

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

	private async refreshModels(button: ExtraButtonComponent): Promise<void> {
		const strings = t(this.plugin.settings.general.language).llm;
		const { baseUrl } = this.plugin.settings.llm;

		if (!baseUrl) {
			setStatusDot(this.modelStatusDot, 'error', strings.fillBaseUrlFirst);
			return;
		}

		button.setDisabled(true);
		setStatusDot(this.modelStatusDot, 'idle', strings.statusChecking);
		const result = await listLlmModels(this.plugin.settings.llm);
		button.setDisabled(false);

		if (!result.ok) {
			this.applyModelOptions([], { allowCurrentFallback: false });
			setStatusDot(this.modelStatusDot, 'error', `${strings.fetchFailPrefix}${result.error}`);
			return;
		}
		if (result.models.length === 0) {
			this.applyModelOptions([], { allowCurrentFallback: false });
			setStatusDot(this.modelStatusDot, 'error', strings.noModelsFound);
			return;
		}

		setStatusDot(this.modelStatusDot, 'ok', strings.fetchOk);
		this.applyModelOptions(result.models);
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
