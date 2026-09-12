import { App, Component, ExtraButtonComponent, MarkdownRenderer } from 'obsidian';
import type { StoredMessage } from '../../chat/session-store';
import type { AttachedInfo } from '../../chat/vault-context';
import { finalizeRenderedAnswer, neutralizeRemoteContent } from '../../chat/safe-markdown';
import type { ChatStrings } from '../../i18n';
import type { Skill } from '../../skills/skill-store';
import { createSkillChip, createTargetChip } from '../picker-items';

// 챗봇 화면에서 "오간 말풍선"만 담당합니다. 무엇을 보낼지·언제 보낼지는 chat-view.ts가 정하고,
// 여기서는 받은 메시지를 그리고, 스크롤을 옮기고, 버튼이 눌리면 알려주기만 합니다.

// 맨 아래에서 이만큼(px) 안쪽을 보고 있으면 "맨 아래를 보는 중"으로 봅니다.
const NEAR_BOTTOM_PX = 80;
// 긴 답변의 시작 부분으로 옮길 때 위쪽에 남겨 둘 여백(px)
const ANSWER_TOP_MARGIN_PX = 8;

// 실패한 질문을 [다시 시도]로 다시 보낼 때 필요한 것(글 + 그때 쓴 스킬)
export interface SentMessage {
	text: string;
	skill: Skill | null;
}

export interface MessageListCallbacks {
	onEdit: (message: StoredMessage) => void;
	onRetry: (sent: SentMessage, bubbles: { user: HTMLElement; error: HTMLElement }) => void;
	onCopy: (text: string, successNotice?: string) => void;
}

interface MessageListOptions {
	app: App;
	// MarkdownRenderer가 그린 내용을 정리할 때 기준이 되는 화면(보통 ChatView)입니다.
	component: Component;
	strings: () => ChatStrings; // 언어가 바뀔 수 있어 그때그때 읽습니다.
	callbacks: MessageListCallbacks;
}

export class ChatMessageList {
	readonly el: HTMLElement;
	// 메시지 → 화면의 말풍선. 수정 중 표시(점선·흐리게)를 붙일 때 씁니다.
	private bubbleByMessage = new WeakMap<StoredMessage, HTMLElement>();

	constructor(container: HTMLElement, private readonly options: MessageListOptions) {
		this.el = container.createDiv({ cls: 'intra-copilot-chat-messages' });
	}

	private get strings(): ChatStrings {
		return this.options.strings();
	}

	clear(): void {
		this.el.empty();
	}

	showEmptyState(): void {
		this.el.empty();
		this.el.createEl('p', { cls: 'intra-copilot-chat-empty', text: this.strings.emptyState });
	}

	// 대화 전체를 다시 그립니다.
	async render(conversation: readonly StoredMessage[]): Promise<void> {
		if (conversation.length === 0) {
			this.showEmptyState();
			return;
		}
		this.el.empty();
		for (const message of conversation) {
			if (message.role === 'assistant') {
				await this.renderAssistant(this.appendPlain('assistant', ''), message);
			} else if (message.role === 'user') {
				this.appendUser(message);
			}
		}
		this.scrollToBottom();
	}

	// 글자만 있는 말풍선(답변 기다리는 중, 설정 안내 등)
	appendPlain(
		role: 'user' | 'assistant',
		text: string,
		options: { isPending?: boolean; isError?: boolean } = {},
	): HTMLElement {
		const bubble = this.el.createDiv({ cls: `intra-copilot-chat-bubble is-${role}` });
		if (options.isPending) bubble.addClass('is-pending');
		if (options.isError) bubble.addClass('is-error');
		bubble.setText(text);
		this.scrollToBottom();
		return bubble;
	}

	// 사용자 말풍선: [스킬·대상 칩 · 첨부 분량] + 질문 글 + [수정] 버튼
	appendUser(message: StoredMessage): HTMLElement {
		const strings = this.strings;
		const bubble = this.appendPlain('user', '');
		if (message.skill || message.targets?.length) {
			const row = bubble.createDiv({ cls: 'intra-copilot-bubble-targets' });
			if (message.skill) createSkillChip(row, message.skill, {});
			for (const target of message.targets ?? []) {
				createTargetChip(row, target, { wholeVaultLabel: strings.pickerWholeVault });
			}
			if (message.attached) {
				// 어떤 노트가 실제로 전송됐는지 펼쳐 볼 수 있게 합니다(경로를 저장하기 전의 옛 대화는 글자만).
				const label = describeAttached(message.attached, strings);
				const paths = message.attached.paths ?? [];
				if (paths.length > 0) {
					const details = row.createEl('details', { cls: 'intra-copilot-bubble-attached-details' });
					details.createEl('summary', { text: label });
					const list = details.createEl('ul', { cls: 'intra-copilot-bubble-attached-list' });
					for (const path of paths) list.createEl('li', { text: path });
				} else {
					row.createSpan({ cls: 'intra-copilot-bubble-attached', text: label });
				}
			}
		}
		bubble.appendText(message.content);

		// [수정] — 이 메시지를 고쳐서 이 자리부터 다시 보냅니다. 평소엔 흐리고, 마우스를 올리면 진해집니다.
		const actions = bubble.createDiv({ cls: 'intra-copilot-chat-actions' });
		new ExtraButtonComponent(actions)
			.setIcon('pencil')
			.setTooltip(strings.editTooltip)
			.onClick(() => this.options.callbacks.onEdit(message));

		this.bubbleByMessage.set(message, bubble);
		this.scrollToBottom();
		return bubble;
	}

	// 답변 말풍선: [생각 과정(접힘)] → 답변(마크다운) → [잘림 안내] → [복사 버튼]
	async renderAssistant(bubble: HTMLElement, message: StoredMessage): Promise<void> {
		const strings = this.strings;
		this.bubbleByMessage.set(message, bubble);
		bubble.empty();
		bubble.removeClass('is-pending', 'is-error');
		bubble.addClass('is-markdown');

		if (message.reasoning) {
			const details = bubble.createEl('details', { cls: 'intra-copilot-chat-reasoning' });
			details.createEl('summary', { text: strings.reasoningSummary });
			details.createDiv({ cls: 'intra-copilot-chat-reasoning-body', text: message.reasoning });
		}

		// LLM은 보통 마크다운(목록, 굵게, 코드블록)으로 답하므로 그대로 렌더링합니다.
		// 단, 외부 요청을 만들거나 다른 플러그인이 실행할 수 있는 문법은 먼저 무력화합니다(safe-markdown.ts).
		const answerEl = bubble.createDiv({ cls: 'intra-copilot-chat-answer' });
		const content = message.content || strings.emptyReply;
		await MarkdownRenderer.render(
			this.options.app,
			neutralizeRemoteContent(content),
			answerEl,
			'',
			this.options.component,
		);
		finalizeRenderedAnswer(answerEl, {
			onBlockedLinkClick: (href) => this.options.callbacks.onCopy(href, strings.linkBlockedNotice),
		});

		if (message.truncated) {
			bubble.createDiv({ cls: 'intra-copilot-chat-notice', text: strings.truncatedNotice });
		}

		if (message.content) {
			const actions = bubble.createDiv({ cls: 'intra-copilot-chat-actions' });
			new ExtraButtonComponent(actions)
				.setIcon('copy')
				.setTooltip(strings.copyTooltip)
				.onClick(() => this.options.callbacks.onCopy(message.content));
		}
	}

	// 스트리밍 중: 지금까지 받은 답변을 글자 그대로 보여줍니다(마크다운은 다 받은 뒤에 그립니다).
	// 아직 답변이 없고 생각 과정만 오는 중이면 그렇게 알려 줍니다.
	updateStreaming(bubble: HTMLElement, progress: { answer: string; reasoning: string }): void {
		const strings = this.strings;
		bubble.toggleClass('is-pending', !progress.answer);
		bubble.setText(
			progress.answer || (progress.reasoning ? strings.streamingReasoning : strings.thinking),
		);
	}

	// 실패 표시: 보낸 질문은 흐리게, 오류 말풍선에는 원인·서버 원문·[다시 시도].
	showFailure(
		userBubble: HTMLElement,
		errorBubble: HTMLElement,
		sent: SentMessage,
		summary: string,
		detail: string,
	): void {
		const strings = this.strings;
		// 대화 기록에서 빠진 질문이라 [수정] 대상이 아닙니다(대신 아래 [다시 시도]를 씁니다).
		userBubble.querySelector('.intra-copilot-chat-actions')?.remove();
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
		retryButton.onclick = () =>
			this.options.callbacks.onRetry(sent, { user: userBubble, error: errorBubble });
	}

	// 고치는 메시지는 점선 테두리, 그 아래(보내면 사라질) 대화는 흐리게 표시합니다.
	setEditHighlight(conversation: readonly StoredMessage[], editingIndex: number | null): void {
		conversation.forEach((message, index) => {
			const bubble = this.bubbleByMessage.get(message);
			bubble?.toggleClass('is-editing', index === editingIndex);
			bubble?.toggleClass('is-superseded', editingIndex !== null && index > editingIndex);
		});
	}

	scrollToBottom(): void {
		this.el.scrollTo({ top: this.el.scrollHeight });
	}

	// 맨 아래 근처를 보고 있는지. 위로 올려 예전 대화를 읽는 중이면 답변이 와도 끌어내리지 않습니다.
	isNearBottom(): boolean {
		return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < NEAR_BOTTOM_PX;
	}

	// 도착한 답변(또는 오류)을 보여줍니다. 화면보다 짧으면 맨 아래로, 길면 답변의 시작 부분이
	// 보이게 옮깁니다(맨 끝으로 가면 다시 위로 올려 읽어야 하므로).
	revealAnswer(bubble: HTMLElement): void {
		const fitsOnScreen = bubble.offsetHeight <= this.el.clientHeight - ANSWER_TOP_MARGIN_PX;
		const answerTop =
			this.el.scrollTop +
			bubble.getBoundingClientRect().top -
			this.el.getBoundingClientRect().top -
			ANSWER_TOP_MARGIN_PX;
		this.el.scrollTo({ top: fitsOnScreen ? this.el.scrollHeight : answerTop, behavior: 'smooth' });
	}
}

// "노트 3개 · 5,200자 첨부 · 글자 수 제한으로 일부 생략"
function describeAttached(info: AttachedInfo, strings: ChatStrings): string {
	const text = strings.attachedInfo
		.replace('{count}', info.notes.toLocaleString())
		.replace('{chars}', info.chars.toLocaleString());
	return info.truncated ? `${text}${strings.attachedTruncated}` : text;
}
