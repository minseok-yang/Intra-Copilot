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
	// 지금 열려 있는 마크다운 노트. 칩에 있든 없든 "어느 노트를 보고 있는지"만 나타냅니다.
	private currentNotePath: string | null = null;
	// 그중 "지금 열려 있는 노트"라서 자동으로 넣어 둔 칩의 경로(syncCurrentNote 참고).
	private autoTargetPath: string | null = null;
	// 사용자가 지운 자동 칩. 다른 노트로 옮기기 전까지는 다시 넣지 않습니다.
	private dismissedAutoPath: string | null = null;
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
		// 자동으로 넣어 둔 현재 노트가 목록에서 빠졌다면 사용자가 지운 것입니다(칩의 × 또는 Backspace).
		// 다른 노트로 옮기기 전까지는 다시 넣지 않습니다.
		if (this.autoTargetPath && !this.hasNote(this.autoTargetPath)) {
			this.dismissedAutoPath = this.autoTargetPath;
			this.autoTargetPath = null;
		}
		this.renderChips();
	}

	private hasNote(path: string): boolean {
		return this.targets.some((target) => target.kind === 'note' && target.path === path);
	}

	// 지금 고칠 수 있는 노트입니다. "지금 열려 있는 노트"가 칩에 올라와 있을 때만 값이 있습니다.
	//
	// 왜 칩에 있을 때만인가: 칩에서 뺐다는 것은 그 노트를 모델에게 보내지 않겠다는 뜻이고, 내용을
	// 보내지 않으면 모델이 고칠 곳을 짚을 수도 없습니다. "칩에 올라온 것만 전송되고, 그중 지금 보고
	// 있는 노트만 고칠 수 있다"로 규칙이 하나로 모입니다.
	// (@로 직접 고른 칩이어도 그것이 지금 보고 있는 노트라면 고칠 수 있습니다.)
	getEditableNote(): string | null {
		return this.currentNotePath && this.hasNote(this.currentNotePath) ? this.currentNotePath : null;
	}

	// 자동으로 넣어 둔 현재 노트의 이름이 바뀌거나(newPath) 지워졌을 때(null) 추적 중인 경로도
	// 함께 고칩니다. 이걸 빠뜨리면 뒤이은 setTargets가 "사용자가 칩을 지웠다"로 오해해서, 그 뒤로
	// 노트를 옮겨도 칩이 자동으로 들어오지 않습니다.
	retargetAuto(oldPath: string, newPath: string | null): void {
		if (this.currentNotePath === oldPath) this.currentNotePath = newPath;
		if (this.autoTargetPath === oldPath) this.autoTargetPath = newPath;
		if (this.dismissedAutoPath === oldPath) this.dismissedAutoPath = newPath;
	}

	// 지금 열려 있는 노트를 칩에 반영합니다. 챗봇을 열 때와 노트를 옮길 때마다 호출합니다.
	//
	// 왜 자동으로 넣는가: 수정할 수 있는 노트는 "지금 열려 있는 노트" 하나뿐인데, 모델이 그 내용을
	// 봐야 고칠 곳을 짚을 수 있습니다. 칩으로 넣어 두면 무엇이 전송되는지 눈에 보이고, 원치 않으면
	// ×로 지울 수 있습니다("무엇이 나가는지 보인다"는 원칙을 지키면서 손이 덜 가게 한 절충입니다).
	//
	// force이면 사용자가 지웠던 기억을 잊고 다시 넣습니다(새 대화를 시작하거나 지난 대화를 불러올 때).
	syncCurrentNote(force = false): void {
		const active = this.plugin.app.workspace.getActiveFile();
		// 노트가 아닌 파일(PDF·이미지 등)을 열었을 때는 지금 대상을 그대로 둡니다. 노트를 보다가
		// 참고 자료를 잠깐 열어 본 것뿐인데 대화 대상과 고칠 노트가 사라지면 곤란하기 때문입니다.
		if (active && active.extension !== 'md') return;

		const path = active?.path ?? null;
		this.currentNotePath = path;
		if (force) this.dismissedAutoPath = null;
		if (path === this.autoTargetPath && !force) return;

		// 다른 노트로 옮겼으면 "지웠다"는 기억도 잊습니다 — 새 노트는 다시 자동으로 넣습니다.
		if (path !== this.dismissedAutoPath) this.dismissedAutoPath = null;

		const previous = this.autoTargetPath;
		// 아래 setTargets가 "사용자가 지웠다"로 오해하지 않도록 먼저 비웁니다.
		this.autoTargetPath = null;

		let next = this.targets;
		if (previous) next = next.filter((t) => !(t.kind === 'note' && t.path === previous));
		if (path && path !== this.dismissedAutoPath && !next.some((t) => t.kind === 'note' && t.path === path)) {
			next = [...next, { kind: 'note', path }];
			this.setTargets(next);
			this.autoTargetPath = path; // setTargets 뒤에 기록해야 위 정리 로직에 걸리지 않습니다.
			return;
		}
		this.setTargets(next);
	}

	private addTarget(target: ChatTarget): void {
		// 자동으로 들어와 있던 현재 노트를 사용자가 @로 다시 골랐다면, 이제 사용자가 고른 것으로 보고
		// 노트를 옮겨도 칩을 그대로 둡니다.
		if (target.kind === 'note' && target.path === this.autoTargetPath) this.autoTargetPath = null;
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
			const chip = createTargetChip(this.chipsEl, target, {
				wholeVaultLabel: this.strings.pickerWholeVault,
				removeTooltip: this.strings.targetRemoveTooltip,
				onRemove: () => {
					this.setTargets(this.targets.filter((existing) => !sameTarget(existing, target)));
					this.focus();
				},
			});
			// 자동으로 들어온 "지금 열려 있는 노트"는 따로 표시합니다 — 이 대화에서 고칠 수 있는
			// 노트가 그것뿐이라서, 어느 칩이 그 노트인지 한눈에 보여야 합니다.
			if (target.kind === 'note' && target.path === this.autoTargetPath) {
				chip.addClass('is-current-note');
				setTooltip(chip, `${target.path} — ${this.strings.currentNoteChip}`);
			}
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
