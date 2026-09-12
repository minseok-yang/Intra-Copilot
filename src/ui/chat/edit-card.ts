import { App, ButtonComponent, setIcon, setTooltip } from 'obsidian';
import type { ChatStrings } from '../../i18n';
import { collapseUnchanged, diffLines } from '../../chat/line-diff';
import {
	checkProposal,
	EditProposal,
	ProposalProblem,
	noteName,
} from '../../chat/edit-proposal';

// 답변 속 "노트 수정 제안" 하나를 보여주는 카드입니다(승인형 Diff).
//
//   ┌ 프로젝트/회의록.md ──────────── [적용함] ┐
//   │ - 담당자 미정          ← 지울 줄(빨강)   │
//   │ + 담당자: 김영수       ← 넣을 줄(초록)   │
//   │                          [적용]/[되돌리기] │
//   └────────────────────────────────────────┘
//
// 원칙: 이 카드는 노트를 **읽기만** 합니다. 실제로 파일을 고치는 일은 onApply/onRevert로 위쪽
// (chat-view.ts)에 넘깁니다. 노트가 바뀌는 곳을 한 군데로 모아 두기 위해서입니다.
//
// 적용할 수 없는 상태(원문을 못 찾음 등)면 [적용] 버튼을 아예 잠그고 그 이유를 적습니다.
// "노트를 함부로 고치지 않는다"가 이 기능의 목적이므로, 애매하면 고치지 않는 쪽을 택합니다.

export type EditActionResult = { ok: true } | { ok: false; problem?: ProposalProblem };

export interface EditCardCallbacks {
	// [적용]/[되돌리기]를 눌렀을 때. 실제 파일 수정·백업·대화 저장은 여기서 합니다.
	onApply: (proposal: EditProposal, index: number) => Promise<EditActionResult>;
	onRevert: (proposal: EditProposal, index: number) => Promise<EditActionResult>;
	onOpenNote: (path: string) => void;
}

interface EditCardOptions {
	app: App;
	strings: () => ChatStrings; // 언어가 바뀔 수 있어 그때그때 읽습니다.
	callbacks: EditCardCallbacks;
	// 대화를 다시 불러왔을 때 "이미 적용한 제안"으로 그리기 위한 값입니다.
	applied: boolean;
	// 이 질문을 보낼 때 열려 있던 노트. 고칠 수 있는 노트는 이것 하나뿐입니다(null이면 없음).
	editableNote: string | null;
}

// 적용할 수 없는 이유를 화면 문구로 바꿉니다. 카드 안 회색 글씨와 [적용] 실패 알림이 함께 씁니다.
export function problemText(problem: ProposalProblem, strings: ChatStrings): string {
	switch (problem) {
		case 'not-current':
			return strings.editProblemNotCurrent;
		case 'note-missing':
			return strings.editProblemNoteMissing;
		case 'not-found':
			return strings.editProblemNotFound;
		case 'ambiguous':
			return strings.editProblemAmbiguous;
		case 'no-change':
			return strings.editProblemNoChange;
	}
}

export class EditCard {
	readonly el: HTMLElement;
	private readonly diffEl: HTMLElement;
	private readonly footerEl: HTMLElement;
	private readonly badgeEl: HTMLElement;
	private applied: boolean;
	private busy = false;

	constructor(
		parent: HTMLElement,
		private readonly proposal: EditProposal,
		private readonly index: number,
		private readonly options: EditCardOptions,
	) {
		this.applied = options.applied;
		this.el = parent.createDiv({ cls: 'intra-copilot-edit-card' });

		const header = this.el.createDiv({ cls: 'intra-copilot-edit-card-header' });
		setIcon(header.createSpan({ cls: 'intra-copilot-edit-card-icon' }), 'file-pen');
		// 노트 이름만 보여주고(경로가 길면 카드 머리가 넘칩니다) 전체 경로는 툴팁에 둡니다.
		const pathEl = header.createSpan({
			cls: 'intra-copilot-edit-card-path',
			text: noteName(proposal.path),
		});
		setTooltip(pathEl, `${proposal.path} — ${this.strings.editOpenNoteTooltip}`);
		pathEl.addEventListener('click', () => options.callbacks.onOpenNote(proposal.path));
		this.badgeEl = header.createSpan({ cls: 'intra-copilot-edit-card-badge' });

		// 왜 이렇게 고치려 하는지. 변경 내용보다 먼저 읽어야 승인 여부를 판단할 수 있으므로 위에 둡니다.
		if (proposal.reason) {
			const reasonEl = this.el.createDiv({ cls: 'intra-copilot-edit-card-reason' });
			setIcon(reasonEl.createSpan({ cls: 'intra-copilot-edit-card-reason-icon' }), 'message-square');
			reasonEl.createSpan({ text: proposal.reason });
		}

		this.diffEl = this.el.createDiv({ cls: 'intra-copilot-edit-card-diff' });
		this.footerEl = this.el.createDiv({ cls: 'intra-copilot-edit-card-footer' });

		this.renderDiff();
		void this.refresh();
	}

	private get strings(): ChatStrings {
		return this.options.strings();
	}

	// 변경 전/후를 위아래 +/- 줄로 그립니다. 바뀐 줄에서 멀리 떨어진 줄은 접습니다.
	private renderDiff(): void {
		const strings = this.strings;
		this.diffEl.empty();

		// 이전이나 이후가 비어 있는 경우(끝에 덧붙이기·지우기)는 무엇을 하는 제안인지 한 줄로 알려 줍니다.
		if (this.proposal.before === '') {
			this.diffEl.createDiv({ cls: 'intra-copilot-edit-card-note', text: strings.editAppendLabel });
		} else if (this.proposal.after === '') {
			this.diffEl.createDiv({ cls: 'intra-copilot-edit-card-note', text: strings.editDeleteLabel });
		}

		for (const block of collapseUnchanged(diffLines(this.proposal.before, this.proposal.after))) {
			if (block.skippedBefore > 0) {
				this.diffEl.createDiv({
					cls: 'intra-copilot-edit-card-skipped',
					text: strings.editDiffSkipped.replace('{count}', String(block.skippedBefore)),
				});
			}
			for (const line of block.lines) {
				const row = this.diffEl.createDiv({
					cls: `intra-copilot-edit-card-line is-${line.kind}`,
				});
				row.createSpan({
					cls: 'intra-copilot-edit-card-marker',
					text: line.kind === 'removed' ? '-' : line.kind === 'added' ? '+' : ' ',
				});
				// 답변 속 글이므로 마크다운으로 그리지 않고 글자 그대로 보여줍니다. 노트에 들어갈 원문을
				// 있는 그대로 확인해야 승인하는 의미가 있고, 서식으로 그리면 공백·기호 차이가 가려집니다.
				row.createSpan({ cls: 'intra-copilot-edit-card-text', text: line.text || ' ' });
			}
		}
	}

	// 지금 노트와 대조해서 버튼·상태를 다시 그립니다.
	async refresh(): Promise<void> {
		const strings = this.strings;
		this.footerEl.empty();
		this.footerEl.createSpan({
			cls: 'intra-copilot-edit-card-status',
			text: strings.editChecking,
		});

		if (this.applied) {
			this.showApplied();
			return;
		}

		const { problem } = await checkProposal(
			this.options.app,
			this.proposal,
			this.options.editableNote,
		);
		this.footerEl.empty();
		this.badgeEl.setText('');
		this.el.removeClass('is-applied');

		if (problem) {
			this.el.addClass('is-blocked');
			this.footerEl.createSpan({
				cls: 'intra-copilot-edit-card-status is-problem',
				text: problemText(problem, strings),
			});
			return;
		}

		this.el.removeClass('is-blocked');
		new ButtonComponent(this.footerEl)
			.setButtonText(strings.editApplyButton)
			.setTooltip(strings.editApplyTooltip)
			.setCta()
			.onClick(() => void this.run('apply'));
	}

	private showApplied(): void {
		const strings = this.strings;
		this.footerEl.empty();
		this.el.removeClass('is-blocked');
		this.el.addClass('is-applied');
		this.badgeEl.setText(strings.editAppliedLabel);
		new ButtonComponent(this.footerEl)
			.setButtonText(strings.editRevertButton)
			.setTooltip(strings.editRevertTooltip)
			.onClick(() => void this.run('revert'));
	}

	// [적용]/[되돌리기]를 누른 뒤의 처리입니다. 누르는 동안 버튼을 잠가 두 번 눌리지 않게 합니다.
	private async run(direction: 'apply' | 'revert'): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		this.footerEl.empty();
		this.footerEl.createSpan({
			cls: 'intra-copilot-edit-card-status',
			text: this.strings.editChecking,
		});

		const { onApply, onRevert } = this.options.callbacks;
		const result =
			direction === 'apply'
				? await onApply(this.proposal, this.index)
				: await onRevert(this.proposal, this.index);
		this.busy = false;

		// 성공했으면 상태를 뒤집고, 실패했으면 지금 노트와 다시 대조해서 왜 안 되는지 보여줍니다
		// (알림은 chat-view.ts가 띄웁니다).
		if (result.ok) this.applied = direction === 'apply';
		await this.refresh();
	}
}
