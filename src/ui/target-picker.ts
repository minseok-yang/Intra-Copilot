import { App, prepareFuzzySearch, SearchMatches, setIcon, setTooltip, TFile, TFolder } from 'obsidian';
import { ChatTarget, VAULT_ROOT_PATH } from '../chat/vault-context';

// 챗봇 입력칸에서 @를 치면 뜨는 "폴더·노트 고르기" 목록입니다.
// - @ 뒤에 한 글자씩 칠 때마다 목록이 좁혀집니다(Obsidian 빠른 전환기와 같은 퍼지 검색).
// - ↑↓로 고르고 Enter/Tab으로 선택, 또는 마우스로 클릭. Esc로 닫습니다.
// - 선택하면 입력칸의 "@검색어" 글자는 지워지고, onPick으로 알려서 입력칸 위에 칩으로 표시됩니다.
//
// Obsidian의 AbstractInputSuggest는 입력칸 전체를 검색어로 쓰고 textarea를 지원하지 않아서,
// "문장 중간의 @부터 커서까지"만 검색어로 쓰는 이 목록은 직접 만들었습니다.

export interface TargetPickerStrings {
	wholeVault: string;
	currentNote: string;
	noMatch: string;
	hint: string;
}

interface Candidate {
	target: ChatTarget;
	icon: string;
	group: 0 | 1 | 2; // 검색어가 없을 때 보여줄 순서: 0 특별 항목 → 1 폴더 → 2 노트
	name: string; // 크게 보이는 이름
	detail: string; // 흐리게 보이는 경로·설명
	searchText: string; // 검색 대상 글자
	nameOffset: number; // searchText 안에서 name이 시작하는 위치(일치 글자 강조용)
	detailOffset: number;
	mtime: number;
}

interface Result {
	candidate: Candidate;
	matches: SearchMatches | null;
}

const MAX_RESULTS = 50;
// 문장 맨 앞이나 공백 바로 뒤의 @만 알아봅니다(메일 주소 abc@회사 같은 글자에는 반응하지 않음).
// 폴더 이름에 공백이 있을 수 있어 검색어에 공백을 허용하되, 한 줄 안에서 60자까지만 봅니다.
const TRIGGER = /(?:^|\s)@([^@\n]{0,60})$/;

export class TargetPicker {
	private readonly popupEl: HTMLElement;
	private results: Result[] = [];
	private activeIndex = 0;
	// 입력칸 안에서 '@'가 있는 위치. 목록이 닫혀 있으면 -1입니다.
	private triggerStart = -1;
	// 목록을 여는 동안만 볼트의 폴더·노트 목록을 기억해 둡니다(글자마다 볼트를 다시 훑지 않도록).
	private candidates: Candidate[] | null = null;

	constructor(
		private readonly app: App,
		private readonly inputEl: HTMLTextAreaElement,
		anchorEl: HTMLElement,
		private readonly strings: TargetPickerStrings,
		private readonly onPick: (target: ChatTarget) => void,
	) {
		this.popupEl = anchorEl.createDiv({ cls: 'intra-copilot-picker' });
		this.popupEl.hidden = true;
		// 목록을 누르는 순간 입력칸의 포커스가 빠지면(blur) 목록이 먼저 닫혀서 클릭이 안 먹힙니다.
		this.popupEl.addEventListener('mousedown', (evt) => evt.preventDefault());

		inputEl.addEventListener('input', () => this.update());
		inputEl.addEventListener('click', () => this.update());
		inputEl.addEventListener('keyup', (evt) => {
			if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evt.key)) this.update();
		});
		inputEl.addEventListener('blur', () => this.close());
	}

	isOpen(): boolean {
		return !this.popupEl.hidden;
	}

	// 입력칸의 keydown에서 먼저 호출합니다. 목록이 이 키를 썼으면 true — 그때는 보내기 등을 하지 않습니다.
	handleKeydown(evt: KeyboardEvent): boolean {
		if (!this.isOpen()) return false;
		switch (evt.key) {
			case 'ArrowDown':
			case 'ArrowUp':
				evt.preventDefault();
				this.moveActive(evt.key === 'ArrowDown' ? 1 : -1);
				return true;
			case 'Enter':
			case 'Tab':
				// 일치하는 항목이 없으면 목록만 닫고, Enter는 원래대로(보내기) 처리되게 둡니다.
				// "@홍길동"처럼 대상 지정이 아닌 글자일 수 있기 때문입니다.
				if (this.results.length === 0) {
					this.close();
					return false;
				}
				evt.preventDefault();
				this.pick(this.activeIndex);
				return true;
			case 'Escape':
				evt.preventDefault();
				evt.stopPropagation();
				this.close();
				return true;
			default:
				return false;
		}
	}

	close(): void {
		this.popupEl.hidden = true;
		this.popupEl.empty();
		this.results = [];
		this.triggerStart = -1;
		this.candidates = null;
	}

	// 커서 앞 글자를 보고 목록을 열거나, 좁히거나, 닫습니다.
	private update(): void {
		const { value, selectionStart, selectionEnd } = this.inputEl;
		if (selectionStart !== selectionEnd) {
			this.close();
			return;
		}
		const match = TRIGGER.exec(value.slice(0, selectionStart));
		if (!match) {
			this.close();
			return;
		}
		const query = match[1] ?? '';
		const results = this.search(query);
		// 공백을 넣었는데 일치하는 것이 없으면, 대상을 고르려던 게 아니라 문장을 쓰는 중으로 봅니다.
		if (results.length === 0 && /\s/.test(query)) {
			this.close();
			return;
		}
		this.triggerStart = selectionStart - query.length - 1;
		this.results = results;
		this.activeIndex = 0;
		this.render();
	}

	private search(query: string): Result[] {
		this.candidates ??= this.buildCandidates();
		const trimmed = query.trim();
		if (!trimmed) {
			return [...this.candidates]
				.sort((a, b) => a.group - b.group || compareInGroup(a, b))
				.slice(0, MAX_RESULTS)
				.map((candidate) => ({ candidate, matches: null }));
		}
		const fuzzy = prepareFuzzySearch(trimmed);
		const scored: Array<Result & { score: number }> = [];
		for (const candidate of this.candidates) {
			const found = fuzzy(candidate.searchText);
			if (found) scored.push({ candidate, matches: found.matches, score: found.score });
		}
		return scored
			.sort((a, b) => b.score - a.score || a.candidate.group - b.candidate.group)
			.slice(0, MAX_RESULTS);
	}

	private buildCandidates(): Candidate[] {
		const { vault, workspace } = this.app;
		const { wholeVault, currentNote } = this.strings;
		const list: Candidate[] = [];

		// 볼트 전체. 영어 별칭(vault, all)으로도 찾을 수 있게 검색 글자 뒤에 덧붙입니다(화면엔 안 보임).
		const vaultName = vault.getName();
		list.push({
			target: { kind: 'folder', path: VAULT_ROOT_PATH },
			icon: 'library',
			group: 0,
			name: wholeVault,
			detail: vaultName,
			searchText: `${wholeVault} ${vaultName} vault all`,
			nameOffset: 0,
			detailOffset: wholeVault.length + 1,
			mtime: 0,
		});

		// 지금 편집 중인 노트(챗봇 패널을 눌러도 마지막으로 보던 노트를 돌려줍니다).
		const active = workspace.getActiveFile();
		if (active && active.extension === 'md') {
			list.push({
				target: { kind: 'note', path: active.path },
				icon: 'file-check',
				group: 0,
				name: currentNote,
				detail: active.path,
				searchText: `${currentNote} ${active.path} current`,
				nameOffset: 0,
				detailOffset: currentNote.length + 1,
				mtime: 0,
			});
		}

		for (const file of vault.getAllLoadedFiles()) {
			const parentPath = file.parent && !file.parent.isRoot() ? file.parent.path : '';
			if (file instanceof TFolder) {
				if (file.isRoot()) continue;
				list.push({
					target: { kind: 'folder', path: file.path },
					icon: 'folder',
					group: 1,
					name: file.name,
					detail: parentPath,
					searchText: file.path,
					nameOffset: file.path.length - file.name.length,
					detailOffset: 0,
					mtime: 0,
				});
			} else if (file instanceof TFile && file.extension === 'md') {
				list.push({
					target: { kind: 'note', path: file.path },
					icon: 'file-text',
					group: 2,
					name: file.basename,
					detail: parentPath,
					searchText: file.path,
					nameOffset: file.path.length - file.name.length,
					detailOffset: 0,
					mtime: file.stat.mtime,
				});
			}
		}
		return list;
	}

	private render(): void {
		this.popupEl.empty();
		this.popupEl.hidden = false;

		if (this.results.length === 0) {
			this.popupEl.createDiv({ cls: 'intra-copilot-picker-empty', text: this.strings.noMatch });
		}

		this.results.forEach((result, index) => {
			const { candidate, matches } = result;
			const row = this.popupEl.createDiv({ cls: 'intra-copilot-picker-item' });
			row.toggleClass('is-active', index === this.activeIndex);
			setIcon(row.createSpan({ cls: 'intra-copilot-picker-item-icon' }), candidate.icon);
			const text = row.createDiv({ cls: 'intra-copilot-picker-item-text' });
			appendHighlighted(
				text.createDiv({ cls: 'intra-copilot-picker-item-name' }),
				candidate.name,
				matches,
				candidate.nameOffset,
			);
			if (candidate.detail) {
				appendHighlighted(
					text.createDiv({ cls: 'intra-copilot-picker-item-detail' }),
					candidate.detail,
					matches,
					candidate.detailOffset,
				);
			}
			row.addEventListener('mousemove', () => {
				if (this.activeIndex !== index) this.setActive(index);
			});
			row.addEventListener('click', () => this.pick(index));
		});

		this.popupEl.createDiv({ cls: 'intra-copilot-picker-hint', text: this.strings.hint });
	}

	private moveActive(step: number): void {
		const count = this.results.length;
		if (count === 0) return;
		this.setActive((this.activeIndex + step + count) % count);
	}

	private setActive(index: number): void {
		const rows = this.popupEl.querySelectorAll('.intra-copilot-picker-item');
		rows[this.activeIndex]?.removeClass('is-active');
		this.activeIndex = index;
		const row = rows[index];
		row?.addClass('is-active');
		row?.scrollIntoView({ block: 'nearest' });
	}

	// 고른 대상을 알리고, 입력칸에서 "@검색어" 부분을 지웁니다.
	private pick(index: number): void {
		const result = this.results[index];
		if (!result || this.triggerStart < 0) return;
		const { value, selectionStart } = this.inputEl;
		const start = this.triggerStart;
		this.inputEl.value = value.slice(0, start) + value.slice(selectionStart);
		this.inputEl.setSelectionRange(start, start);
		this.close();
		this.onPick(result.candidate.target);
	}
}

// 검색어가 없을 때의 순서: 폴더는 경로 순, 노트는 최근 수정 순
function compareInGroup(a: Candidate, b: Candidate): number {
	return a.group === 2 ? b.mtime - a.mtime : a.searchText.localeCompare(b.searchText);
}

// matches는 searchText 전체 기준 위치라서, 화면 글자가 searchText의 offset부터 시작한다고 보고
// 그 구간에 걸친 부분만 강조합니다.
function appendHighlighted(
	el: HTMLElement,
	text: string,
	matches: SearchMatches | null,
	offset: number,
): void {
	let cursor = 0;
	for (const [start, end] of matches ?? []) {
		const from = Math.max(start - offset, cursor);
		const to = Math.min(end - offset, text.length);
		if (to <= from) continue;
		if (from > cursor) el.appendText(text.slice(cursor, from));
		el.createSpan({ cls: 'intra-copilot-picker-match', text: text.slice(from, to) });
		cursor = to;
	}
	if (cursor < text.length) el.appendText(text.slice(cursor));
}

// ─── 칩(선택한 대상 표시) ─────────────────────────────────────────────

function lastSegment(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

export function describeTarget(
	target: ChatTarget,
	wholeVaultLabel: string,
): { icon: string; label: string } {
	if (target.kind === 'folder') {
		return target.path === VAULT_ROOT_PATH
			? { icon: 'library', label: wholeVaultLabel }
			: { icon: 'folder', label: lastSegment(target.path) };
	}
	return { icon: 'file-text', label: lastSegment(target.path).replace(/\.md$/i, '') };
}

// 선택한 대상을 색 칩으로 그립니다. onRemove를 주면 오른쪽에 [×]가 붙습니다(입력칸 위의 칩).
// 말풍선 안의 칩은 기록용이라 [×] 없이 그립니다.
export function createTargetChip(
	parent: HTMLElement,
	target: ChatTarget,
	options: { wholeVaultLabel: string; removeTooltip?: string; onRemove?: () => void },
): HTMLElement {
	const { icon, label } = describeTarget(target, options.wholeVaultLabel);
	const chip = parent.createSpan({ cls: `intra-copilot-target-chip is-${target.kind}` });
	setTooltip(chip, target.path === VAULT_ROOT_PATH ? label : target.path);
	setIcon(chip.createSpan({ cls: 'intra-copilot-target-chip-icon' }), icon);
	chip.createSpan({ cls: 'intra-copilot-target-chip-label', text: label });
	if (options.onRemove) {
		const remove = chip.createSpan({ cls: 'intra-copilot-target-chip-remove' });
		setIcon(remove, 'x');
		if (options.removeTooltip) setTooltip(remove, options.removeTooltip);
		const onRemove = options.onRemove;
		remove.addEventListener('click', (evt) => {
			evt.stopPropagation();
			onRemove();
		});
	}
	return chip;
}
