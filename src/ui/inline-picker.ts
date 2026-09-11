import { prepareFuzzySearch, SearchMatches, setIcon } from 'obsidian';

// 챗봇 입력칸에서 특정 글자(@, /)를 치면 뜨는 고르기 목록입니다.
// - 트리거 글자 뒤에 한 글자씩 칠 때마다 목록이 좁혀집니다(Obsidian 빠른 전환기와 같은 퍼지 검색).
// - ↑↓로 고르고 Enter/Tab으로 선택, 또는 마우스로 클릭. Esc로 닫습니다.
// - 선택하면 입력칸의 "트리거+검색어" 글자는 지워지고, 그 항목의 onPick이 불립니다.
//
// 목록은 하나이고, 무엇을 보여줄지는 트리거 글자마다 등록한 "공급자(PickerSource)"가 정합니다.
// 목록을 두 개 따로 붙이면 "@폴더 /링크"처럼 두 트리거가 다 걸리는 입력에서 팝업이 겹치므로,
// 하나의 목록이 커서에 가장 가까운 트리거를 골라 그 공급자의 항목을 보여줍니다.
//
// Obsidian의 AbstractInputSuggest는 입력칸 전체를 검색어로 쓰고 textarea를 지원하지 않아서
// 직접 만들었습니다.

export interface PickerItem {
	icon: string;
	name: string; // 크게 보이는 이름
	detail: string; // 흐리게 보이는 경로·설명('' 이면 줄을 그리지 않음)
	searchText: string; // 검색 대상 글자
	nameOffset: number; // searchText 안에서 name이 시작하는 위치(일치 글자 강조용)
	detailOffset: number;
	onPick: () => void;
}

export interface PickerSource {
	trigger: string; // 한 글자. 예: '@', '/'
	noMatch: string; // 보여줄 항목이 없을 때의 안내
	// 목록을 열 때 한 번 부릅니다. 검색어가 없을 때는 돌려준 순서 그대로 보여줍니다.
	loadItems: () => PickerItem[] | Promise<PickerItem[]>;
}

interface Result {
	item: PickerItem;
	matches: SearchMatches | null;
}

interface CompiledSource {
	source: PickerSource;
	pattern: RegExp;
}

const MAX_RESULTS = 50;

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export class InlinePicker {
	private readonly popupEl: HTMLElement;
	private readonly sources: CompiledSource[];
	private results: Result[] = [];
	private activeIndex = 0;
	private noMatchText = '';
	// 입력칸 안에서 트리거 글자가 있는 위치. 목록이 닫혀 있으면 -1입니다.
	private triggerStart = -1;
	// 목록을 여는 동안만 항목을 기억해 둡니다(글자마다 볼트·스킬 폴더를 다시 읽지 않도록).
	private loaded: { trigger: string; items: Promise<PickerItem[]> } | null = null;
	// 항목을 기다리는 사이 글자가 더 입력되면, 늦게 끝난 옛 갱신은 버립니다.
	private updateSeq = 0;

	constructor(
		private readonly inputEl: HTMLTextAreaElement,
		anchorEl: HTMLElement,
		sources: PickerSource[],
		private readonly hint: string,
	) {
		// 문장 맨 앞이나 공백 바로 뒤의 트리거만 알아봅니다(메일 주소 abc@회사, 경로 a/b에는 반응하지 않음).
		// 이름에 공백이 있을 수 있어 검색어에 공백을 허용하되, 한 줄 안에서 60자까지만 봅니다.
		this.sources = sources.map((source) => {
			const trigger = escapeRegExp(source.trigger);
			return { source, pattern: new RegExp(`(?:^|\\s)${trigger}([^${trigger}\\n]{0,60})$`) };
		});

		this.popupEl = anchorEl.createDiv({ cls: 'intra-copilot-picker' });
		this.popupEl.hidden = true;
		// 목록을 누르는 순간 입력칸의 포커스가 빠지면(blur) 목록이 먼저 닫혀서 클릭이 안 먹힙니다.
		this.popupEl.addEventListener('mousedown', (evt) => evt.preventDefault());

		inputEl.addEventListener('input', () => void this.update());
		inputEl.addEventListener('click', () => void this.update());
		inputEl.addEventListener('keyup', (evt) => {
			if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(evt.key)) void this.update();
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
				// "@홍길동"처럼 고르려던 게 아닌 글자일 수 있기 때문입니다.
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
		this.updateSeq++;
		this.popupEl.hidden = true;
		this.popupEl.empty();
		this.results = [];
		this.triggerStart = -1;
		this.loaded = null;
	}

	// 커서 앞 글자를 보고 목록을 열거나, 좁히거나, 닫습니다.
	private async update(): Promise<void> {
		const seq = ++this.updateSeq;
		const { value, selectionStart, selectionEnd } = this.inputEl;
		const found = selectionStart === selectionEnd ? this.findTrigger(value.slice(0, selectionStart)) : null;
		if (!found) {
			this.close();
			return;
		}
		const { source, query } = found;

		if (this.loaded?.trigger !== source.trigger) {
			this.loaded = {
				trigger: source.trigger,
				// 항목을 읽다 실패하면(스킬 폴더를 못 읽는 등) 빈 목록으로 보여줍니다.
				items: Promise.resolve()
					.then(() => source.loadItems())
					.catch(() => []),
			};
		}
		const items = await this.loaded.items;
		if (seq !== this.updateSeq) return;

		const results = search(items, query);
		// 공백을 넣었는데 일치하는 것이 없으면, 고르려던 게 아니라 문장을 쓰는 중으로 봅니다.
		if (results.length === 0 && /\s/.test(query)) {
			this.close();
			return;
		}
		this.triggerStart = selectionStart - query.length - source.trigger.length;
		this.results = results;
		this.noMatchText = source.noMatch;
		this.activeIndex = 0;
		this.render();
	}

	// 커서 앞에서 걸리는 트리거 중, 커서에 가장 가까운 것(검색어가 가장 짧은 것)을 고릅니다.
	private findTrigger(before: string): { source: PickerSource; query: string } | null {
		let best: { source: PickerSource; query: string } | null = null;
		for (const { source, pattern } of this.sources) {
			const match = pattern.exec(before);
			if (!match) continue;
			const query = match[1] ?? '';
			if (!best || query.length < best.query.length) best = { source, query };
		}
		return best;
	}

	private render(): void {
		this.popupEl.empty();
		this.popupEl.hidden = false;

		if (this.results.length === 0) {
			this.popupEl.createDiv({ cls: 'intra-copilot-picker-empty', text: this.noMatchText });
		}

		this.results.forEach(({ item, matches }, index) => {
			const row = this.popupEl.createDiv({ cls: 'intra-copilot-picker-item' });
			row.toggleClass('is-active', index === this.activeIndex);
			setIcon(row.createSpan({ cls: 'intra-copilot-picker-item-icon' }), item.icon);
			const text = row.createDiv({ cls: 'intra-copilot-picker-item-text' });
			appendHighlighted(
				text.createDiv({ cls: 'intra-copilot-picker-item-name' }),
				item.name,
				matches,
				item.nameOffset,
			);
			if (item.detail) {
				appendHighlighted(
					text.createDiv({ cls: 'intra-copilot-picker-item-detail' }),
					item.detail,
					matches,
					item.detailOffset,
				);
			}
			row.addEventListener('mousemove', () => {
				if (this.activeIndex !== index) this.setActive(index);
			});
			row.addEventListener('click', () => this.pick(index));
		});

		this.popupEl.createDiv({ cls: 'intra-copilot-picker-hint', text: this.hint });
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

	// 입력칸에서 "트리거+검색어" 부분을 지우고, 고른 항목에 알립니다.
	private pick(index: number): void {
		const result = this.results[index];
		if (!result || this.triggerStart < 0) return;
		const { value, selectionStart } = this.inputEl;
		const start = this.triggerStart;
		this.inputEl.value = value.slice(0, start) + value.slice(selectionStart);
		this.inputEl.setSelectionRange(start, start);
		this.close();
		result.item.onPick();
	}
}

function search(items: PickerItem[], query: string): Result[] {
	const trimmed = query.trim();
	if (!trimmed) {
		return items.slice(0, MAX_RESULTS).map((item) => ({ item, matches: null }));
	}
	const fuzzy = prepareFuzzySearch(trimmed);
	const scored: Array<Result & { score: number }> = [];
	for (const item of items) {
		const found = fuzzy(item.searchText);
		if (found) scored.push({ item, matches: found.matches, score: found.score });
	}
	// 점수가 같으면 공급자가 준 순서를 지킵니다(sort는 순서를 유지하는 정렬).
	return scored.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
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
