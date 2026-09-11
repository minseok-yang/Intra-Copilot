import {
	DropdownComponent,
	ExtraButtonComponent,
	ItemView,
	MarkdownRenderer,
	Notice,
	WorkspaceLeaf,
} from 'obsidian';
import IntraCopilotPlugin from '../main';
import { sendChatMessage } from '../llm/client';
import { describeLlmError, t } from '../i18n';
import { UiLanguage } from '../settings';
import { createStatusDot, setStatusDot, StatusState } from './status-light';
import { checkSelectedModel, fetchModelList, fillModelDropdown } from './model-dropdown';
import {
	deleteSession,
	deriveSessionTitle,
	loadSession,
	newSessionId,
	saveSession,
	StoredMessage,
} from '../chat/session-store';
import { neutralizeRemoteContent, removeRemoteMedia } from '../chat/safe-markdown';
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

// 설정 화면에서 모델·언어·서버 주소가 바뀌었을 때 호출합니다. 열려 있는 챗봇 화면이
// 바뀐 설정을 바로 반영하게 합니다(드롭다운 선택값, 표시 언어, 모델 목록).
export function refreshChatViews(plugin: IntraCopilotPlugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
		if (leaf.view instanceof ChatView) {
			leaf.view.onSettingsChanged();
		}
	}
}

export class ChatView extends ItemView {
	plugin: IntraCopilotPlugin;
	private conversation: StoredMessage[] = [];
	// 지금 진행 중인 대화를 conversations/ 폴더의 어느 파일에 저장할지입니다.
	// null이면 아직 아무것도 주고받지 않은, 저장할 필요 없는 새 대화입니다.
	private currentSessionId: string | null = null;
	private currentSessionCreatedAt: string | null = null;

	// 답변을 기다리는 중인지. 이 동안에는 새 대화/지난 대화 버튼을 잠가서,
	// 도착한 답변이 엉뚱한 대화에 섞이지 않게 합니다.
	private busy = false;
	private pendingBubble: HTMLElement | null = null;
	// 기다리는 동안 언어가 바뀌면 화면을 다시 그리는 걸 답변이 온 뒤로 미룹니다.
	private rebuildAfterReply = false;
	// 파일 저장을 순서대로 하나씩 처리합니다(나중 저장이 먼저 끝나 옛 내용으로 덮어쓰는 일 방지).
	private saveChain: Promise<void> = Promise.resolve();

	// 모델 목록 상태. 화면을 다시 그려도 서버에 다시 묻지 않고 이 값으로 드롭다운을 채웁니다.
	private availableModels: string[] = [];
	private lastModelState: StatusState = 'idle';
	// 마지막으로 모델 목록을 확인한 서버 주소+키. 설정에서 이게 바뀌면 목록을 다시 불러옵니다.
	private checkedConnectionKey: string | null = null;
	private renderedLanguage: UiLanguage | null = null;

	private messagesEl!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButtonEl!: HTMLButtonElement;
	private newChatButton!: ExtraButtonComponent;
	private historyButton!: ExtraButtonComponent;
	private refreshButton!: ExtraButtonComponent;
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
		return this.strings().title;
	}

	getIcon(): string {
		return 'bot';
	}

	async onOpen(): Promise<void> {
		this.buildLayout();
		this.showEmptyState();
		// 설정 화면의 연결 확인 등 어디서든 연결 상태가 바뀌면 상태등을 다시 그립니다.
		// register()에 넣어두면 패널이 닫힐 때 자동으로 등록이 풀립니다.
		this.register(this.plugin.connectionStatus.subscribe(() => this.renderStatusDot()));
		// 패널을 열면 바로 한 번 모델 목록을 불러와 봅니다(설정이 안 돼 있으면 조용히 실패).
		void this.refreshModels();
	}

	async onClose(): Promise<void> {
		// 답변을 기다리는 중에 패널을 닫아도 요청은 계속 진행되고,
		// 답이 오면 handleSend가 파일에는 저장합니다(화면만 없을 뿐).
	}

	onSettingsChanged(): void {
		if (this.plugin.settings.general.language !== this.renderedLanguage) {
			if (this.busy) {
				this.rebuildAfterReply = true;
			} else {
				void this.rebuild();
			}
			// 언어만 바뀐 경우 서버에는 다시 묻지 않습니다(상태 문구는 다음 확인 때 새 언어로 바뀜).
			return;
		}
		if (this.connectionKey() !== this.checkedConnectionKey) {
			void this.refreshModels();
			return;
		}
		// 모델 선택만 바뀐 경우: 서버에 묻지 않고 드롭다운 선택값만 맞춥니다.
		this.fillDropdown();
	}

	private strings() {
		return t(this.plugin.settings.general.language).chat;
	}

	private connectionKey(): string {
		const { baseUrl, apiKey } = this.plugin.settings.llm;
		return `${baseUrl}\n${apiKey}`;
	}

	// 머리줄(버튼들) + 메시지 영역 + 입력줄을 새로 만듭니다. 언어가 바뀌면 다시 호출됩니다.
	private buildLayout(): void {
		const strings = this.strings();
		const draft = this.inputEl?.value ?? '';
		this.renderedLanguage = this.plugin.settings.general.language;

		const container = this.contentEl;
		container.empty();
		container.addClass('intra-copilot-chat-view');

		// 우측 상단: 새 대화 + 지난 대화 + 모델 선택 드롭다운 + 새로고침 + 상태등. 모델 선택은 설정 화면과
		// 완전히 같은 값(settings.llm.model)을 공유합니다 — 여기서 바꾸면 설정에도 반영됩니다.
		const header = container.createDiv({ cls: 'intra-copilot-chat-header' });

		this.newChatButton = new ExtraButtonComponent(header)
			.setIcon('plus')
			.setTooltip(strings.newChatTooltip)
			.onClick(() => {
				if (this.warnIfBusy()) return;
				this.startNewConversation();
			});

		this.historyButton = new ExtraButtonComponent(header)
			.setIcon('history')
			.setTooltip(strings.historyTooltip)
			.onClick(() => {
				if (this.warnIfBusy()) return;
				new SessionHistoryModal(this.plugin.app, this.plugin, {
					onSelect: (id) => void this.loadSessionById(id),
					onDelete: (id) => this.handleSessionDeleted(id),
				}).open();
			});

		this.modelDropdown = new DropdownComponent(header);
		this.fillDropdown();

		this.refreshButton = new ExtraButtonComponent(header)
			.setIcon('refresh-cw')
			.setTooltip(strings.refreshModelsTooltip)
			.onClick(() => {
				void this.refreshModels();
			});

		this.modelStatusDot = createStatusDot(header);
		this.renderStatusDot();

		this.messagesEl = container.createDiv({ cls: 'intra-copilot-chat-messages' });

		const inputRow = container.createDiv({ cls: 'intra-copilot-chat-input-row' });
		this.inputEl = inputRow.createEl('textarea', {
			cls: 'intra-copilot-chat-input',
			attr: { placeholder: strings.inputPlaceholder, rows: '2' },
		});
		this.inputEl.value = draft;
		this.sendButtonEl = inputRow.createEl('button', {
			cls: 'intra-copilot-chat-send',
			text: strings.sendButton,
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

		this.applyBusyState();
	}

	// 언어가 바뀌었을 때: 틀을 새로 만들고 지금 대화를 다시 그립니다.
	private async rebuild(): Promise<void> {
		this.buildLayout();
		await this.renderConversation();
	}

	private warnIfBusy(): boolean {
		if (this.busy) new Notice(this.strings().busyNotice);
		return this.busy;
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.applyBusyState();
	}

	private applyBusyState(): void {
		this.inputEl.disabled = this.busy;
		this.sendButtonEl.disabled = this.busy;
		this.newChatButton.setDisabled(this.busy);
		this.historyButton.setDisabled(this.busy);
		// 잠긴 버튼이 눈에 띄게 흐려지도록 전용 클래스를 붙입니다(styles.css).
		this.newChatButton.extraSettingsEl.toggleClass('intra-copilot-is-busy', this.busy);
		this.historyButton.extraSettingsEl.toggleClass('intra-copilot-is-busy', this.busy);
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
			text: this.strings().emptyState,
		});
	}

	// 지난 대화 목록에서 지금 열려 있는 대화를 지웠다면, 다음 메시지 때 같은 파일이 다시
	// 생기지 않도록 새 대화로 전환합니다.
	private handleSessionDeleted(id: string): void {
		if (id !== this.currentSessionId) return;
		this.startNewConversation();
		new Notice(this.strings().historyCurrentDeleted);
	}

	// "지난 대화" 목록에서 하나를 골랐을 때 그 내용을 불러와 이어서 볼 수 있게 합니다.
	private async loadSessionById(id: string): Promise<void> {
		if (this.warnIfBusy()) return;
		const session = await loadSession(this.plugin, id);
		if (!session) {
			new Notice(this.strings().historyLoadFailed);
			return;
		}

		this.currentSessionId = session.id;
		this.currentSessionCreatedAt = session.createdAt;
		this.conversation = session.messages;
		await this.renderConversation();
	}

	// this.conversation 전체를 메시지 영역에 다시 그립니다.
	private async renderConversation(): Promise<void> {
		if (this.conversation.length === 0) {
			this.showEmptyState();
			return;
		}
		this.messagesEl.empty();
		for (const message of this.conversation) {
			if (message.role === 'assistant') {
				await this.renderAssistantBubble(this.appendBubble('assistant', ''), message);
			} else if (message.role === 'user') {
				this.appendBubble('user', message.content);
			}
		}
		this.scrollToBottom();
	}

	// 답변 말풍선: [생각 과정(접힘)] → 답변(마크다운) → [잘림 안내] → [복사 버튼]
	private async renderAssistantBubble(bubble: HTMLElement, message: StoredMessage): Promise<void> {
		const strings = this.strings();
		bubble.empty();
		bubble.removeClass('is-pending', 'is-error');
		bubble.addClass('is-markdown');

		if (message.reasoning) {
			const details = bubble.createEl('details', { cls: 'intra-copilot-chat-reasoning' });
			details.createEl('summary', { text: strings.reasoningSummary });
			details.createDiv({ cls: 'intra-copilot-chat-reasoning-body', text: message.reasoning });
		}

		// LLM은 보통 마크다운(목록, 굵게, 코드블록)으로 답하므로 그대로 렌더링합니다.
		// 단, 외부 이미지처럼 저절로 외부 요청을 보내는 요소는 먼저 링크로 바꿉니다(safe-markdown.ts).
		const answerEl = bubble.createDiv({ cls: 'intra-copilot-chat-answer' });
		const content = message.content || strings.emptyReply;
		await MarkdownRenderer.render(
			this.plugin.app,
			neutralizeRemoteContent(content),
			answerEl,
			'',
			this,
		);
		removeRemoteMedia(answerEl);

		if (message.truncated) {
			bubble.createDiv({ cls: 'intra-copilot-chat-notice', text: strings.truncatedNotice });
		}

		if (message.content) {
			const actions = bubble.createDiv({ cls: 'intra-copilot-chat-actions' });
			new ExtraButtonComponent(actions)
				.setIcon('copy')
				.setTooltip(strings.copyTooltip)
				.onClick(() => void this.copyToClipboard(message.content));
		}
	}

	private async copyToClipboard(text: string): Promise<void> {
		const strings = this.strings();
		try {
			await navigator.clipboard.writeText(text);
			new Notice(strings.copied);
		} catch {
			new Notice(strings.copyFailed);
		}
	}

	// 파일 저장. 사용자 메시지를 보낼 때, 그리고 답이 도착했을 때 각각 저장해서, 응답을 못 받고
	// Obsidian이 닫히는 경우에도 최소한 사용자가 물어본 내용은 남게 합니다.
	// 어느 대화의 저장인지를 인자로 받으므로, 도중에 화면의 대화가 바뀌어도 원래 파일에 저장됩니다.
	private persistSession(id: string, createdAt: string, messages: StoredMessage[]): void {
		const snapshot = [...messages];
		const emptyTitle = this.strings().emptyTitle;
		this.saveChain = this.saveChain
			.then(async () => {
				if (snapshot.length === 0) {
					// 첫 질문이 실패해서 되돌린 경우 — 빈 대화 파일은 남기지 않습니다.
					await deleteSession(this.plugin, id);
					return;
				}
				await saveSession(this.plugin, {
					id,
					title: deriveSessionTitle(snapshot, emptyTitle),
					createdAt,
					updatedAt: new Date().toISOString(),
					messages: snapshot,
				});
			})
			.catch(() => {
				new Notice(this.strings().saveFailed);
			});
	}

	// 새로고침(↻): ① 모델 목록을 다시 불러오고 ② 선택한 모델에 짧은 테스트 문장을 보내
	// 실제로 답하는지 확인합니다. 목록에 이름이 있어도 대화가 안 되는 모델(음성·임베딩 등)이 있어서,
	// ②까지 성공해야 상태등이 녹색이 됩니다. 확인하는 동안에는 새로고침 아이콘이 돕니다.
	// (두 결과 모두 fetchModelList/checkSelectedModel이 상태등에 직접 기록합니다.)
	private async refreshModels(): Promise<void> {
		this.checkedConnectionKey = this.connectionKey();
		this.setChecking(true);
		try {
			const outcome = await fetchModelList(this.plugin);
			this.availableModels = outcome.models;
			this.lastModelState = outcome.state;
			this.fillDropdown();
			if (outcome.state === 'ok') {
				await checkSelectedModel(this.plugin, outcome.models);
			}
		} finally {
			this.setChecking(false);
		}
	}

	private setChecking(checking: boolean): void {
		this.refreshButton.setDisabled(checking);
		this.refreshButton.extraSettingsEl.toggleClass('intra-copilot-is-checking', checking);
	}

	private fillDropdown(): void {
		fillModelDropdown(this.plugin, this.modelDropdown, this.availableModels, {
			lastState: this.lastModelState,
		});
	}

	// 상태등을 plugin.connectionStatus 값대로 그립니다. 점 위에 마우스를 올리면
	// 상태 문구와 마지막으로 확인된 시각을 함께 보여줍니다.
	private renderStatusDot(): void {
		const llmStrings = t(this.plugin.settings.general.language).llm;
		const { state, message, checkedAt } = this.plugin.connectionStatus.get();
		const text = message || llmStrings.statusIdle;
		const tooltip = checkedAt
			? `${text} · ${llmStrings.lastVerifiedPrefix}${checkedAt.toLocaleString()}`
			: text;
		setStatusDot(this.modelStatusDot, state, tooltip);
	}

	private async handleSend(): Promise<void> {
		if (this.busy) return;
		const strings = this.strings();
		const text = this.inputEl.value.trim();
		if (!text) return;

		if (this.conversation.length === 0) {
			this.messagesEl.empty(); // "아직 대화가 없습니다" 문구를 지웁니다.
		}

		const { baseUrl, model } = this.plugin.settings.llm;
		if (!baseUrl || !model) {
			this.appendBubble('assistant', strings.notConfigured, { isError: true });
			return;
		}

		this.inputEl.value = '';
		this.setBusy(true);

		if (!this.currentSessionId || !this.currentSessionCreatedAt) {
			this.currentSessionId = newSessionId();
			this.currentSessionCreatedAt = new Date().toISOString();
		}

		// 이 요청이 어느 대화에 속하는지 기억해 둡니다. 답이 올 때까지 무슨 일이 있어도
		// 답은 이 대화(이 배열, 이 파일)에만 들어갑니다.
		const conversation = this.conversation;
		const sessionId = this.currentSessionId;
		const createdAt = this.currentSessionCreatedAt;

		const userMessage: StoredMessage = { role: 'user', content: text };
		conversation.push(userMessage);
		const userBubble = this.appendBubble('user', text);
		this.persistSession(sessionId, createdAt, conversation);

		const pending = this.appendBubble('assistant', strings.thinking, { isPending: true });
		this.pendingBubble = pending;

		const snapshot = this.plugin.connectionSnapshot();
		const result = await sendChatMessage(this.plugin.settings.llm, conversation);
		const llmStrings = t(this.plugin.settings.general.language).llm;

		this.pendingBubble = null;
		this.setBusy(false);
		// 버튼을 잠가두므로 보통은 항상 true지만, 만약을 위해 화면 갱신 여부만 이걸로 판단합니다.
		const stillOnScreen = this.conversation === conversation;

		if (result.ok) {
			const reply: StoredMessage = {
				role: 'assistant',
				content: result.reply,
				...(result.reasoning ? { reasoning: result.reasoning } : {}),
				...(result.truncated ? { truncated: true } : {}),
			};
			conversation.push(reply);
			this.persistSession(sessionId, createdAt, conversation);
			this.plugin.reportConnection('chat', snapshot, 'ok', llmStrings.chatOk);
			if (stillOnScreen) {
				await this.renderAssistantBubble(pending, reply);
			}
		} else {
			// 실패한 질문은 대화에서 되돌립니다. 남겨두면 다음 요청에 user 메시지가 두 번 연속으로
			// 들어가서, 역할 교대 규칙이 엄격한 모델에서는 이후 요청이 전부 실패합니다.
			if (conversation[conversation.length - 1] === userMessage) {
				conversation.pop();
			}
			this.persistSession(sessionId, createdAt, conversation);
			const described = describeLlmError(this.plugin.settings.general.language, result);
			// "답변 대기 시간" 설정은 챗봇 답변에만 적용되므로, 그 안내는 여기서만 덧붙입니다.
			const summary =
				result.kind === 'timeout' ? `${described.summary} ${strings.timeoutHint}` : described.summary;
			const { detail } = described;
			// 실패하면 상태등도 빨간색으로 — 말풍선만 빨갛고 상태등은 녹색이면 헷갈립니다.
			this.plugin.reportConnection('chat', snapshot, 'error', `${llmStrings.chatFailPrefix}${summary}`);
			if (stillOnScreen) {
				this.showFailure(userBubble, pending, text, summary, detail);
			}
		}

		if (this.rebuildAfterReply) {
			this.rebuildAfterReply = false;
			await this.rebuild();
		}
		this.inputEl.focus();
	}

	// 실패 표시: 보낸 질문은 흐리게, 오류 말풍선에는 [다시 시도] 버튼.
	// 입력칸에도 질문을 되돌려 놓아서, 고쳐서 다시 보낼 수도 있게 합니다.
	private showFailure(
		userBubble: HTMLElement,
		errorBubble: HTMLElement,
		text: string,
		summary: string,
		detail: string,
	): void {
		const strings = this.strings();
		userBubble.addClass('is-failed');
		userBubble.createDiv({ cls: 'intra-copilot-chat-failed-label', text: strings.failedLabel });
		errorBubble.removeClass('is-pending');
		errorBubble.addClass('is-error');
		errorBubble.empty();
		// 원인과 해결 방법을 먼저 보여주고, 서버 원문은 접어둡니다(관리자에게 전달할 때 필요).
		errorBubble.createDiv({ text: `${strings.errorPrefix}${summary}` });
		if (detail) {
			const details = errorBubble.createEl('details', { cls: 'intra-copilot-chat-error-detail' });
			details.createEl('summary', { text: strings.errorDetails });
			details.createDiv({ cls: 'intra-copilot-chat-error-detail-body', text: detail });
		}

		const retryButton = errorBubble.createEl('button', {
			cls: 'intra-copilot-chat-retry',
			text: strings.retryButton,
		});
		retryButton.onclick = () => {
			if (this.busy) return;
			userBubble.remove();
			errorBubble.remove();
			this.inputEl.value = text;
			void this.handleSend();
		};

		if (!this.inputEl.value) {
			this.inputEl.value = text;
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
		this.scrollToBottom();
		return bubble;
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
	}
}
