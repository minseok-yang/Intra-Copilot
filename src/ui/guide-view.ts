import { ItemView, MarkdownRenderer, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { t } from '../i18n';
import { DocBook, DocPage, LICENSE_BOOK, USER_GUIDE_BOOK } from '../content/docs';

export const GUIDE_VIEW_TYPE = 'intra-copilot-guide-view';

// 사용자 가이드·라이선스를 "목차 → 필요한 쪽만 펼쳐 보기"로 보여주는 창입니다.
//
// 왜 쪽으로 나누는가: 한 문서에 모든 내용을 이어 붙이면 스크롤이 길어져 읽기도 전에 질립니다.
// 목차에서 필요한 항목만 눌러 보고, 쪽 안에서는 [이전]/[다음]과 본문 속 링크로 옮겨 다닙니다.
//
// 본문 속 링크: 문서(content/docs.ts)에 [노트 고치기](guide:edit)처럼 쓰면 같은 문서의 그 쪽으로 이동합니다.
//
// 창 상태에는 어떤 문서의 어느 쪽인지(이름표)만 저장합니다. 예전에는 문서 내용 전체를 창 상태에 넣었는데,
// 그러면 Obsidian이 창 배치를 기억하면서(workspace.json) 내용까지 저장해버려서, 플러그인을 업데이트한
// 뒤에도 옛날 문서가 다시 열릴 수 있었습니다.

export type GuideDocId = 'guide' | 'license';

interface GuideViewState {
	docId: GuideDocId;
	page?: string; // 없으면 목차
	[key: string]: unknown;
}

function isGuideDocId(value: unknown): value is GuideDocId {
	return value === 'guide' || value === 'license';
}

// 문서 내용은 content/docs.ts의 문자열(main.js에 함께 번들)이고, 창 제목은 현재 표시 언어를 따릅니다.
function resolveBook(plugin: IntraCopilotPlugin, docId: GuideDocId): { title: string; book: DocBook } {
	const strings = t(plugin.settings.general.language);
	switch (docId) {
		case 'license':
			return { title: strings.license.summaryHeading, book: LICENSE_BOOK };
		case 'guide':
			return { title: strings.general.guideButton, book: USER_GUIDE_BOOK };
	}
}

// 모든 쪽(목차 순서). [이전]/[다음]이 이 순서를 따릅니다.
function readablePages(book: DocBook): DocPage[] {
	return book.groups.flatMap((group) => group.pages);
}

const PAGE_LINK_PREFIX = 'guide:';

// 문서 창을 엽니다. page를 주면 그 쪽을 바로 펼칩니다.
// 같은 문서가 이미 열려 있으면 새 창을 만들지 않고 그 창을 앞으로 가져옵니다.
export async function openGuideWindow(
	plugin: IntraCopilotPlugin,
	docId: GuideDocId,
	page?: string,
): Promise<void> {
	const opened = plugin.app.workspace
		.getLeavesOfType(GUIDE_VIEW_TYPE)
		.find((leaf) => leaf.view instanceof GuideView && leaf.view.getState().docId === docId);
	if (opened) {
		if (page && opened.view instanceof GuideView) await opened.view.showPage(page);
		await plugin.app.workspace.revealLeaf(opened);
		return;
	}

	const leaf = plugin.app.workspace.openPopoutLeaf();
	const state: GuideViewState = { docId, ...(page ? { page } : {}) };
	await leaf.setViewState({ type: GUIDE_VIEW_TYPE, active: true, state });
}

export class GuideView extends ItemView {
	plugin: IntraCopilotPlugin;
	private docId: GuideDocId = 'guide';
	private page: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: IntraCopilotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GUIDE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return resolveBook(this.plugin, this.docId).title;
	}

	getIcon(): string {
		return 'file-text';
	}

	getState(): Record<string, unknown> {
		return { docId: this.docId, ...(this.page ? { page: this.page } : {}) };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// 예전 형식(title/markdown)으로 저장된 창이 복원되면 docId가 없으므로 사용자 가이드 목차를 보여줍니다.
		if (state && typeof state === 'object') {
			const fields = state as Record<string, unknown>;
			if (isGuideDocId(fields.docId)) this.docId = fields.docId;
			this.page = typeof fields.page === 'string' ? fields.page : null;
		}
		await this.render();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	// 다른 쪽으로 옮깁니다. null이거나 없는 쪽이면 목차를 보여줍니다.
	async showPage(page: string | null): Promise<void> {
		this.page = page;
		await this.render();
		this.contentEl.scrollTop = 0;
		// 창을 닫았다 열거나 Obsidian을 다시 켜도 보던 쪽이 이어지게, 창 상태 저장을 요청합니다.
		this.app.workspace.requestSaveLayout();
	}

	private get docStrings() {
		return t(this.plugin.settings.general.language).docs;
	}

	private async render(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('intra-copilot-guide-view');

		const { book } = resolveBook(this.plugin, this.docId);
		const page = this.page ? readablePages(book).find((candidate) => candidate.id === this.page) : undefined;
		if (page) {
			await this.renderPage(container, book, page);
		} else {
			await this.renderOverview(container, book);
		}
	}

	// 목차: 짧은 소개 + 묶음별 쪽 카드(제목과 한 줄 요약). 누르면 그 쪽이 펼쳐집니다.
	private async renderOverview(container: HTMLElement, book: DocBook): Promise<void> {
		await this.renderMarkdown(container.createDiv({ cls: 'intra-copilot-doc-intro' }), book.intro, book);

		for (const group of book.groups) {
			const groupEl = container.createDiv({ cls: 'intra-copilot-doc-group' });
			groupEl.createDiv({ cls: 'intra-copilot-doc-group-label', text: group.label });
			const cards = groupEl.createDiv({ cls: 'intra-copilot-doc-cards' });

			for (const page of group.pages) {
				const card = cards.createEl('button', { cls: 'intra-copilot-doc-card' });
				card.createDiv({ cls: 'intra-copilot-doc-card-title', text: page.title });
				card.createDiv({ cls: 'intra-copilot-doc-card-summary', text: page.summary });
				card.addEventListener('click', () => void this.showPage(page.id));
			}
		}
	}

	// 쪽 하나: [← 목차] → 본문 → [이전]/[다음]
	private async renderPage(container: HTMLElement, book: DocBook, page: DocPage): Promise<void> {
		const strings = this.docStrings;
		const pages = readablePages(book);
		const index = pages.indexOf(page);

		const top = container.createDiv({ cls: 'intra-copilot-doc-nav' });
		this.addNavButton(top, `← ${strings.toc}`, () => this.showPage(null));

		await this.renderMarkdown(container.createDiv({ cls: 'intra-copilot-doc-body' }), page.markdown, book);

		const bottom = container.createDiv({ cls: 'intra-copilot-doc-nav is-bottom' });
		const previous = pages[index - 1];
		const next = pages[index + 1];
		if (previous) {
			this.addNavButton(bottom, `← ${strings.prev}: ${previous.title}`, () =>
				this.showPage(previous.id),
			);
		}
		bottom.createDiv({ cls: 'intra-copilot-doc-nav-spacer' });
		if (next) {
			this.addNavButton(bottom, `${strings.next}: ${next.title} →`, () => this.showPage(next.id));
		}
	}

	private addNavButton(parent: HTMLElement, text: string, onClick: () => Promise<void>): void {
		const button = parent.createEl('button', { cls: 'intra-copilot-doc-nav-button', text });
		button.addEventListener('click', () => void onClick());
	}

	// 마크다운을 그린 뒤, 본문 속 [글자](guide:쪽id) 링크를 같은 창 안에서 옮겨 가는 글자로 바꿉니다.
	// 링크를 그대로 두면 Obsidian이 guide:를 외부 주소로 여겨 열려고 하므로, 주소가 없는 글자로 바꿔 둡니다.
	// (없는 쪽을 가리키면 누를 수 없는 보통 글자로 남깁니다.)
	private async renderMarkdown(el: HTMLElement, markdown: string, book: DocBook): Promise<void> {
		await MarkdownRenderer.render(this.app, markdown, el, '', this);

		const pageIds = new Set(readablePages(book).map((page) => page.id));
		el.querySelectorAll('a').forEach((link) => {
			const href = link.getAttribute('href') ?? link.getAttribute('data-href') ?? '';
			if (!href.startsWith(PAGE_LINK_PREFIX)) return;

			const target = href.slice(PAGE_LINK_PREFIX.length);
			// 팝아웃 창이라 그 창의 document로 만듭니다(link.doc).
			const replacement = link.doc.createElement('span');
			replacement.setText(link.textContent ?? '');
			if (pageIds.has(target)) {
				replacement.addClass('intra-copilot-doc-link');
				replacement.setAttr('role', 'link');
				replacement.tabIndex = 0;
				replacement.addEventListener('click', () => void this.showPage(target));
				replacement.addEventListener('keydown', (evt) => {
					if (evt.key === 'Enter') void this.showPage(target);
				});
			}
			link.replaceWith(replacement);
		});
	}
}
