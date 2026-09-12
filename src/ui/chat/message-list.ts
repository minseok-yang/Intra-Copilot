import { App, Component, ExtraButtonComponent, MarkdownRenderer, Notice, setTooltip } from 'obsidian';
import type { StoredMessage } from '../../chat/session-store';
import type { AttachedInfo } from '../../chat/vault-context';
import { finalizeRenderedAnswer, neutralizeRemoteContent } from '../../chat/safe-markdown';
import {
	EditProposal,
	hasUnreadableProposal,
	hideUnfinishedProposals,
	splitAnswer,
} from '../../chat/edit-proposal';
import type { ChatStrings } from '../../i18n';
import type { Skill } from '../../skills/skill-store';
import { createSkillChip, createTargetChip } from '../picker-items';
import { EditActionResult, EditCard } from './edit-card';

// 챗봇 화면에서 "오간 말풍선"만 담당합니다. 무엇을 보낼지·언제 보낼지는 chat-view.ts가 정하고,
// 여기서는 받은 메시지를 그리고, 스크롤을 옮기고, 버튼이 눌리면 알려주기만 합니다.

// 맨 아래에서 이만큼(px) 안쪽을 보고 있으면 "맨 아래를 보는 중"으로 봅니다.
const NEAR_BOTTOM_PX = 80;
// 긴 답변의 시작 부분으로 옮길 때 위쪽에 남겨 둘 여백(px)
const ANSWER_TOP_MARGIN_PX = 8;
// [모두 적용]을 한 번 누른 뒤, 다시 눌러 확정할 수 있는 시간(밀리초). 지나면 원래대로 돌아갑니다.
// (스킬·대화를 지울 때 쓰는 ui/delete-confirm.ts와 같은 방식입니다.)
const APPLY_ALL_CONFIRM_MS = 4000;

// 실패한 질문을 [다시 시도]로 다시 보낼 때 필요한 것(글 + 그때 쓴 스킬)
export interface SentMessage {
	text: string;
	skill: Skill | null;
}

export interface MessageListCallbacks {
	onEdit: (message: StoredMessage) => void;
	onRetry: (sent: SentMessage, bubbles: { user: HTMLElement; error: HTMLElement }) => void;
	onCopy: (text: string, successNotice?: string) => void;
	// 답변 속 수정 제안 카드(승인형 Diff)의 [적용]·[되돌리기]·노트 열기입니다. 어느 답변에 딸린
	// 제안인지 함께 넘겨서, 적용 여부를 그 메시지에 기록할 수 있게 합니다(session-store의 edits).
	onApplyEdit: (
		message: StoredMessage,
		proposal: EditProposal,
		index: number,
	) => Promise<EditActionResult>;
	onRevertEdit: (
		message: StoredMessage,
		proposal: EditProposal,
		index: number,
	) => Promise<EditActionResult>;
	onOpenNote: (path: string) => void;
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

		// 답변을 "보통 글"과 "노트 수정 제안"으로 나눠 그립니다(edit-proposal.ts). 글은 마크다운으로,
		// 제안은 변경 전/후를 보여주는 카드 + [적용] 버튼으로 그립니다.
		const content = message.content || strings.emptyReply;
		const parts = splitAnswer(content);
		const proposalCount = parts.filter((part) => part.kind === 'proposal').length;
		// 카드가 있으면 말풍선 폭 제한을 풀어 넓게 씁니다(좁으면 변경 내용의 줄이 계속 접힙니다).
		bubble.toggleClass('has-edit-cards', proposalCount > 0);

		// 제안이 여럿이면 몇 개인지 먼저 알려 줍니다(긴 답변에서는 카드가 흩어져 보입니다).
		const summaryEl =
			proposalCount > 1 ? bubble.createDiv({ cls: 'intra-copilot-edit-summary' }) : null;

		const answerEl = bubble.createDiv({ cls: 'intra-copilot-chat-answer' });
		const cards: EditCard[] = [];
		for (const part of parts) {
			if (part.kind === 'proposal') {
				cards.push(this.createEditCard(answerEl, message, part.proposal, part.index));
				continue;
			}
			// LLM은 보통 마크다운(목록, 굵게, 코드블록)으로 답하므로 그대로 렌더링합니다. 단, 외부 요청을
			// 만들거나 다른 플러그인이 실행할 수 있는 문법은 먼저 무력화합니다(safe-markdown.ts).
			const textEl = answerEl.createDiv({ cls: 'intra-copilot-chat-answer-text' });
			await MarkdownRenderer.render(
				this.options.app,
				neutralizeRemoteContent(part.text),
				textEl,
				'',
				this.options.component,
			);
			finalizeRenderedAnswer(textEl, {
				onBlockedLinkClick: (href) => this.options.callbacks.onCopy(href, strings.linkBlockedNotice),
			});
		}

		if (summaryEl) this.renderEditSummary(summaryEl, cards);

		// 모델이 수정 형식을 크게 벗어나게 답해서 카드를 만들지 못했다면, 마커 글자만 남아 영문을
		// 모르게 되므로 그 사실을 알려 줍니다.
		if (hasUnreadableProposal(parts)) {
			bubble.createDiv({ cls: 'intra-copilot-chat-notice', text: strings.editFormatBroken });
		}

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

	// 답변 맨 위의 "수정 제안 N개 · [모두 적용]" 줄입니다.
	//
	// [모두 적용]은 카드를 하나씩 확인한다는 이 기능의 취지와 어긋나는 지름길이라, 노트를 지울 때와
	// 같은 안전장치를 둡니다 — 한 번 누르면 경고로 바뀌고, 그 안에 다시 눌러야 실제로 적용됩니다.
	// 적용할 수 없는 카드(원문 못 찾음 등)는 건너뜁니다.
	private renderEditSummary(summaryEl: HTMLElement, cards: readonly EditCard[]): void {
		const strings = this.strings;
		summaryEl.createSpan({
			cls: 'intra-copilot-edit-summary-count',
			text: strings.editSummaryCount.replace('{count}', String(cards.length)),
		});

		let armed: number | null = null;
		const button = summaryEl.createEl('button', {
			cls: 'intra-copilot-edit-summary-apply',
			text: strings.editApplyAllButton,
		});
		setTooltip(button, strings.editApplyAllTooltip);

		const reset = () => {
			armed = null;
			button.setText(strings.editApplyAllButton);
			button.removeClass('intra-copilot-delete-armed');
		};
		button.onclick = () => {
			if (armed === null) {
				armed = window.setTimeout(reset, APPLY_ALL_CONFIRM_MS);
				button.setText(strings.editApplyAllConfirm);
				button.addClass('intra-copilot-delete-armed');
				return;
			}
			window.clearTimeout(armed);
			reset();
			void this.applyAll(cards);
		};
	}

	// 적용할 수 있는 카드를 위에서부터 하나씩 적용합니다. 한꺼번에 보내지 않고 순서대로 하는 이유는,
	// 앞 수정이 뒤 수정의 원문을 바꿔 놓았을 수 있어서입니다(그런 카드는 스스로 적용 불가가 됩니다).
	private async applyAll(cards: readonly EditCard[]): Promise<void> {
		let applied = 0;
		for (const card of cards) {
			if (!card.canApply()) continue;
			await card.applyNow();
			applied++;
		}
		if (applied === 0) new Notice(this.strings.editApplyAllNone);
	}

	// 수정 제안 카드 하나를 만듭니다. 카드는 노트를 읽어 스스로 대조하고(읽기만 함), 실제로 노트를
	// 고치는 일은 콜백으로 chat-view.ts에 넘깁니다.
	private createEditCard(
		parent: HTMLElement,
		message: StoredMessage,
		proposal: EditProposal,
		index: number,
	): EditCard {
		const { callbacks } = this.options;
		return new EditCard(parent, proposal, index, {
			app: this.options.app,
			strings: this.options.strings,
			// 대화를 다시 불러왔을 때 이미 적용한 제안은 [되돌리기] 상태로 그립니다.
			applied: message.edits?.some((edit) => edit.index === index) ?? false,
			// 고칠 수 있는 노트는 이 질문을 보낼 때 열려 있던 것 하나뿐입니다.
			editableNote: message.editableNote ?? null,
			callbacks: {
				onApply: (target, at) => callbacks.onApplyEdit(message, target, at),
				onRevert: (target, at) => callbacks.onRevertEdit(message, target, at),
				onOpenNote: (path) => callbacks.onOpenNote(path),
			},
		});
	}

	// 스트리밍 중: 지금까지 받은 답변을 글자 그대로 보여줍니다(마크다운은 다 받은 뒤에 그립니다).
	// 아직 답변이 없고 생각 과정만 오는 중이면 그렇게 알려 줍니다.
	updateStreaming(bubble: HTMLElement, progress: { answer: string; reasoning: string }): void {
		const strings = this.strings;
		bubble.toggleClass('is-pending', !progress.answer);
		// 수정 제안이 시작되면 그 뒤는 감춥니다. 아직 완성되지 않은 마커(<<<수정: …)가 글자 그대로
		// 보이면 고장처럼 보이는데, 다 받으면 어차피 카드로 다시 그려집니다.
		const answer = progress.answer
			? hideUnfinishedProposals(progress.answer, strings.editStreaming)
			: '';
		bubble.setText(
			answer || (progress.reasoning ? strings.streamingReasoning : strings.thinking),
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
