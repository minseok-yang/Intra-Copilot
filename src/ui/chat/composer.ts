import { setIcon, setTooltip } from 'obsidian';
import type IntraCopilotPlugin from '../../main';
import type { ChatStrings } from '../../i18n';
import { ChatTarget, sameTarget } from '../../chat/vault-context';
import { listSkills, Skill } from '../../skills/skill-store';
import { InlinePicker } from '../inline-picker';
import { buildSkillItems, buildTargetItems, createSkillChip, createTargetChip } from '../picker-items';

// 챗봇 화면 아래의 입력 영역입니다.
//   [메시지 수정 중 안내 줄]
//   [스킬 칩] [폴더·노트 칩…]
//   [입력칸] [보내기/중지]
// @·/ 목록(inline-picker)도 이 영역에 붙습니다. 무엇을 보낼지는 chat-view.ts가 정하고,
// 여기서는 "지금 무엇이 입력되어 있는지"만 들고 있습니다.

export interface ComposerCallbacks {
	onSend: () => void;
	onStop: () => void; // 답변을 기다리는 중 [중지]
	onCancelEdit: () => void; // 메시지 수정 중 Esc
	// 답변을 기다리는 중이면 안내를 띄우고 true를 돌려줍니다(그때는 보내지 않습니다).
	warnIfBusy: () => boolean;
}

export class ChatComposer {
	readonly el: HTMLElement;
	private readonly editBannerEl: HTMLElement;
	private readonly chipsEl: HTMLElement;
	private readonly inputEl: HTMLTextAreaElement;
	private readonly sendButtonEl: HTMLButtonElement;
	private readonly picker: InlinePicker;

	// @로 지정한 폴더·노트. 지우기 전까지 유지되어, 이어지는 질문마다 그 내용이 붙습니다.
	private targets: ChatTarget[] = [];
	// /로 고른 스킬. 대상과 달리 한 번 보내면 풀립니다.
	private skill: Skill | null = null;
	// 메시지 수정 중이면 "보내면 바뀔 메시지 개수", 아니면 null
	private editingCount: number | null = null;
	private busy = false;

	constructor(
		container: HTMLElement,
		private readonly plugin: IntraCopilotPlugin,
		private readonly strings: ChatStrings,
		private readonly callbacks: ComposerCallbacks,
	) {
		this.el = container.createDiv({ cls: 'intra-copilot-chat-composer' });
		this.editBannerEl = this.el.createDiv({ cls: 'intra-copilot-edit-banner' });
		this.chipsEl = this.el.createDiv({ cls: 'intra-copilot-target-chips' });

		const inputRow = this.el.createDiv({ cls: 'intra-copilot-chat-input-row' });
		this.inputEl = inputRow.createEl('textarea', {
			cls: 'intra-copilot-chat-input',
			attr: { placeholder: strings.inputPlaceholder, rows: '2' },
		});
		this.sendButtonEl = inputRow.createEl('button', { cls: 'intra-copilot-chat-send' });

		// @ → 폴더·노트, / → 스킬. 입력칸 하나에 목록 하나를 두고, 커서에 가까운 쪽 글자를 따릅니다.
		this.picker = new InlinePicker(
			this.inputEl,
			this.el,
			[
				{
					trigger: '@',
					noMatch: strings.pickerNoMatch,
					loadItems: () =>
						buildTargetItems(
							this.plugin.app,
							{ wholeVault: strings.pickerWholeVault, currentNote: strings.pickerCurrentNote },
							(target) => this.addTarget(target),
						),
				},
				{
					trigger: '/',
					noMatch: strings.skillPickerNoMatch,
					// 스킬 파일을 사내에서 직접 고칠 수도 있어서, 목록을 열 때마다 폴더를 새로 읽습니다.
					// 지시문이 빈 스킬은 보내도 의미가 없으므로 목록에서 뺍니다.
					loadItems: async () =>
						buildSkillItems(
							(await listSkills(this.plugin)).filter((skill) => skill.instructions),
							(skill) => {
								this.setSkill(skill);
								this.focus();
							},
						),
				},
			],
			strings.pickerHint,
		);

		// 기다리는 동안에는 같은 버튼이 [중지]가 됩니다.
		this.sendButtonEl.onclick = () => {
			if (this.busy) this.callbacks.onStop();
			else this.callbacks.onSend();
		};
		this.inputEl.addEventListener('keydown', (evt) => this.handleKeydown(evt));

		this.renderChips();
		this.renderEditBanner();
		this.setBusy(false);
	}

	private handleKeydown(evt: KeyboardEvent): void {
		// 한글처럼 조합해서 입력하는 언어(IME)에서는 글자를 확정할 때도 Enter가 눌립니다.
		// 이때 전송해버리면 "안녕하세" 같은 미완성 문장이 날아가므로 조합 중에는 무시합니다.
		if (evt.isComposing) return;
		// @·/ 목록이 열려 있으면 ↑↓·Enter·Esc는 목록 조작에 먼저 씁니다.
		if (this.picker.handleKeydown(evt)) return;
		// 메시지를 수정하는 중이면 Esc로 수정을 취소합니다.
		if (evt.key === 'Escape' && this.editingCount !== null) {
			evt.preventDefault();
			this.callbacks.onCancelEdit();
			return;
		}
		// 입력칸이 비어 있을 때 Backspace를 누르면 마지막 칩을 지웁니다.
		if (evt.key === 'Backspace' && this.inputEl.value === '' && (this.targets.length > 0 || this.skill)) {
			evt.preventDefault();
			if (this.targets.length > 0) this.setTargets(this.targets.slice(0, -1));
			else this.setSkill(null);
			return;
		}
		if (evt.key === 'Enter' && !evt.shiftKey) {
			evt.preventDefault();
			// 기다리는 중에는 써 둔 글을 그대로 두고 안내만 합니다.
			if (this.callbacks.warnIfBusy()) return;
			this.callbacks.onSend();
		}
	}

	// ─── 입력칸 ──────────────────────────────────────────────────────

	get text(): string {
		return this.inputEl.value;
	}

	set text(value: string) {
		this.inputEl.value = value;
	}

	focus(): void {
		this.inputEl.focus();
	}

	// 수정할 글을 넣은 뒤 커서를 맨 뒤로 보냅니다.
	focusAtEnd(): void {
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		this.sendButtonEl.setText(busy ? this.strings.stopButton : this.strings.sendButton);
		this.sendButtonEl.toggleClass('mod-warning', busy);
		setTooltip(this.sendButtonEl, busy ? this.strings.stopTooltip : this.strings.sendTooltip);
	}

	// ─── 칩(스킬 · @ 대상) ────────────────────────────────────────────

	getTargets(): ChatTarget[] {
		return [...this.targets];
	}

	setTargets(targets: ChatTarget[]): void {
		this.targets = [...targets];
		this.renderChips();
	}

	private addTarget(target: ChatTarget): void {
		if (!this.targets.some((existing) => sameTarget(existing, target))) {
			this.setTargets([...this.targets, target]);
		}
		this.focus();
	}

	getSkill(): Skill | null {
		return this.skill;
	}

	setSkill(skill: Skill | null): void {
		this.skill = skill;
		this.renderChips();
	}

	private renderChips(): void {
		this.chipsEl.empty();
		this.chipsEl.hidden = this.targets.length === 0 && !this.skill;
		if (this.skill) {
			createSkillChip(this.chipsEl, this.skill, {
				removeTooltip: this.strings.skillRemoveTooltip,
				onRemove: () => {
					this.setSkill(null);
					this.focus();
				},
			});
		}
		for (const target of this.targets) {
			createTargetChip(this.chipsEl, target, {
				wholeVaultLabel: this.strings.pickerWholeVault,
				removeTooltip: this.strings.targetRemoveTooltip,
				onRemove: () => {
					this.setTargets(this.targets.filter((existing) => !sameTarget(existing, target)));
					this.focus();
				},
			});
		}
	}

	// ─── 메시지 수정 중 안내 줄 ────────────────────────────────────────

	// count는 보내면 바뀔 메시지 개수입니다. null이면 수정 중이 아닙니다.
	setEditing(count: number | null): void {
		this.editingCount = count;
		this.renderEditBanner();
	}

	private renderEditBanner(): void {
		this.editBannerEl.empty();
		this.editBannerEl.hidden = this.editingCount === null;
		if (this.editingCount === null) return;
		setIcon(this.editBannerEl.createSpan({ cls: 'intra-copilot-edit-banner-icon' }), 'pencil');
		this.editBannerEl.createSpan({
			cls: 'intra-copilot-edit-banner-text',
			text: this.strings.editBanner.replace('{count}', String(this.editingCount)),
		});
		const cancel = this.editBannerEl.createEl('button', {
			cls: 'intra-copilot-edit-banner-cancel',
			text: this.strings.editCancel,
		});
		cancel.onclick = () => this.callbacks.onCancelEdit();
	}
}
