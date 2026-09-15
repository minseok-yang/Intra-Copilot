import {
	ButtonComponent,
	debounce,
	ItemView,
	Modal,
	Keymap,
	MarkdownView,
	Notice,
	setIcon,
	Setting,
	setTooltip,
	TFile,
	WorkspaceLeaf,
} from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { describeLinkError, t, type LinkStrings } from '../i18n';
import type { IndexState } from '../link/link-index';
import { featureIcon } from './settings/features';

// 링크 화면(오른쪽 사이드바)입니다. 지금 보고 있는 노트와 뜻이 비슷한 노트를 보여 주고, 링크를 넣게 합니다.
// 색인과 검색은 link/link-index.ts, 서버 요청은 llm/client.ts의 createEmbeddings가 맡습니다.
// 비슷한 노트를 찾는 계산은 이 PC 안에서 하며, 이 화면을 여는 것만으로는 아무것도 보내지 않습니다.

export const LINK_VIEW_TYPE = 'intra-copilot-link-view';
// 노트를 고친 뒤 이만큼 조용하면 바뀐 노트를 색인합니다. 쓰는 동안 Obsidian이 몇 초마다 저장해도 매번 보내지 않게 합니다.
const SYNC_DELAY_MS = 15000;

export async function revealLinkView(plugin: IntraCopilotPlugin): Promise<void> {
	await plugin.app.workspace.ensureSideLeaf(LINK_VIEW_TYPE, 'right', { active: true, reveal: true });
}

export function refreshLinkViews(plugin: IntraCopilotPlugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(LINK_VIEW_TYPE)) {
		if (leaf.view instanceof LinkView) leaf.view.render();
	}
}

export function registerLink(plugin: IntraCopilotPlugin): void {
	const { vault, workspace } = plugin.app;
	const index = plugin.linkIndex;
	plugin.registerView(LINK_VIEW_TYPE, (leaf) => new LinkView(leaf, plugin));

	const syncSoon = debounce(() => void index.sync(), SYNC_DELAY_MS, true);
	// 켤 때 Obsidian이 파일을 불러오며 보내는 이벤트는 무시하고, 다 불러온 뒤 색인을 읽고 바뀐 노트를 맞춥니다.
	workspace.onLayoutReady(() => {
		void index.load().then(() => index.sync());
		plugin.registerEvent(
			vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md') syncSoon();
			}),
		);
	});
	plugin.registerEvent(vault.on('rename', (file, oldPath) => index.rename(oldPath, file.path)));
	plugin.registerEvent(vault.on('delete', (file) => index.remove(file.path)));
	plugin.register(() => index.stop());
}

// 색인 상태 한 줄(링크 화면과 설정의 색인 상태가 함께 씁니다). detail은 서버 원문(툴팁용)입니다.
export function describeIndexState(plugin: IntraCopilotPlugin, state: IndexState): { text: string; detail?: string } {
	const language = plugin.settings.general.language;
	const strings = t(language).link;
	switch (state.kind) {
		case 'not-configured':
			return { text: strings.stateNotConfigured };
		case 'not-built':
			return { text: state.builtWith ? strings.stateOtherModel.replace('{model}', state.builtWith) : strings.stateNotBuilt };
		case 'indexing':
			return {
				text: (state.waiting ? strings.stateWaiting : strings.stateIndexing)
					.replace('{done}', String(state.done))
					.replace('{total}', String(state.total)),
			};
		case 'error': {
			const { summary, detail } = describeLinkError(language, state.failure);
			return { text: strings.stateError.replace('{reason}', summary), detail };
		}
		case 'ready':
			return { text: strings.stateReady.replace('{count}', String(state.count)) };
	}
}

// [색인 만들기]·[다시 만들기]. 볼트 전체 본문을 서버로 보내는 일이라, 무엇을 얼마나 어디로 보내는지 확인 창에서
// 보여 주고 [색인 시작]을 눌러야 시작합니다(사내 서버 부담·보안을 누르기 전에 판단할 수 있게).
export function addIndexButton(containerEl: HTMLElement, plugin: IntraCopilotPlugin, label: string): void {
	new ButtonComponent(containerEl).setButtonText(label).onClick(() => new IndexConfirmModal(plugin).open());
}

class IndexConfirmModal extends Modal {
	constructor(private readonly plugin: IntraCopilotPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		const strings = t(this.plugin.settings.general.language).link;
		const { baseUrl, model } = this.plugin.settings.link;
		const { contentEl } = this;
		this.titleEl.setText(strings.confirmTitle);
		const summary = contentEl.createEl('p', { text: strings.confirmCounting });
		contentEl.createEl('p', { text: strings.confirmTarget.replace('{url}', baseUrl).replace('{model}', model) });
		contentEl.createEl('p', { cls: 'intra-copilot-privacy-note', text: strings.confirmWarning });

		let start: ButtonComponent | null = null;
		new Setting(contentEl)
			.addButton((button) => button.setButtonText(strings.confirmCancel).onClick(() => this.close()))
			.addButton((button) => {
				// 전송량을 다 세기 전에는 누를 수 없습니다.
				start = button
					.setButtonText(strings.confirmStart)
					.setCta()
					.setDisabled(true)
					.onClick(() => {
						this.close();
						void this.plugin.linkIndex.rebuild();
					});
			});
		void this.plugin.linkIndex.estimate().then(({ notes, chunks, requests }) => {
			summary.setText(
				strings.confirmSummary
					.replace('{notes}', String(notes))
					.replace('{chunks}', String(chunks))
					.replace('{requests}', String(requests)),
			);
			start?.setDisabled(false);
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class LinkView extends ItemView {
	// 마지막으로 본 노트. 사이드바를 누르면 활성 창이 이 화면으로 바뀌어도, 보던 노트의 목록을 그대로 둡니다.
	private file: TFile | null = null;
	private statusEl: HTMLElement | null = null;
	private renderedKind = '';

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: IntraCopilotPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return LINK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.strings().title;
	}

	getIcon(): string {
		return featureIcon('link');
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('intra-copilot-link-view');
		this.register(this.plugin.linkIndex.subscribe(() => this.onIndexChanged()));
		this.registerEvent(this.app.workspace.on('file-open', () => this.render()));
		// 링크를 넣으면 "링크됨" 표시가 바뀌므로, 보고 있는 노트의 링크 정보가 바뀌면 잠잠해진 뒤 다시 그립니다.
		const refresh = debounce(() => this.render(), 1000, true);
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file === this.file) refresh();
			}),
		);
		this.render();
		return Promise.resolve();
	}

	private strings(): LinkStrings {
		return t(this.plugin.settings.general.language).link;
	}

	// 색인하는 동안은 진행 숫자만 바꿉니다. 목록을 매번 다시 그리면 끌던 카드나 누르려던 버튼이 사라지기 때문입니다.
	private onIndexChanged(): void {
		const state = this.plugin.linkIndex.state();
		if (state.kind === 'indexing' && this.renderedKind === 'indexing' && this.statusEl) {
			this.statusEl.setText(describeIndexState(this.plugin, state).text);
			return;
		}
		this.render();
	}

	render(): void {
		const strings = this.strings();
		const index = this.plugin.linkIndex;
		const active = this.app.workspace.getActiveFile();
		if (active?.extension === 'md') this.file = active;
		if (this.file && !this.app.vault.getFileByPath(this.file.path)) this.file = null;

		const state = index.state();
		this.renderedKind = state.kind;
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createDiv({ cls: 'intra-copilot-reminder-title', text: this.file?.basename ?? strings.title });
		const statusRow = contentEl.createDiv({ cls: 'intra-copilot-link-status' });
		const { text, detail } = describeIndexState(this.plugin, state);
		this.statusEl = statusRow.createSpan({ text });
		if (detail) setTooltip(this.statusEl, detail);
		if (state.kind === 'not-built') addIndexButton(statusRow, this.plugin, strings.buildButton);
		if (state.kind === 'error') {
			new ButtonComponent(statusRow).setButtonText(strings.retryButton).onClick(() => void index.sync());
		}

		if (state.kind === 'not-configured' || state.kind === 'not-built') return;
		const empty = (message: string) => contentEl.createEl('p', { cls: 'intra-copilot-chat-empty', text: message });
		const source = this.file;
		if (!source) {
			empty(strings.noNote);
			return;
		}
		const results = index.search(source.path, this.plugin.settings.link.resultCount);
		if (!results) {
			empty(index.isExcluded(source.path) ? strings.excludedNote : strings.notIndexedNote);
			return;
		}
		if (results.length === 0) empty(strings.noResults);

		const linked = this.app.metadataCache.resolvedLinks[source.path] ?? {};
		for (const result of results) {
			const target = this.app.vault.getFileByPath(result.path);
			if (target) this.renderCard(contentEl, source, target, result.score, result.path in linked);
		}
	}

	// 카드 모양은 리마인더 카드와 같게 맞춰 두 사이드바가 한 플러그인으로 보이게 합니다(같은 CSS 클래스).
	private renderCard(containerEl: HTMLElement, source: TFile, target: TFile, score: number, isLinked: boolean): void {
		const strings = this.strings();
		const card = containerEl.createDiv({ cls: 'intra-copilot-reminder-card intra-copilot-link-card' });
		// 카드를 편집기에 끌어다 놓으면 링크 글자가 들어갑니다(Obsidian 편집기가 글자 놓기를 받아 줌).
		card.draggable = true;
		card.addEventListener('dragstart', (evt) => {
			evt.dataTransfer?.setData('text/plain', this.app.fileManager.generateMarkdownLink(target, source.path));
		});

		const name = card.createEl('a', { cls: 'intra-copilot-reminder-name', text: target.basename });
		name.addEventListener('click', (evt) => {
			evt.preventDefault();
			void this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(target);
		});

		const meta = [strings.score.replace('{score}', String(Math.round(Math.max(0, score) * 100)))];
		if (target.parent && !target.parent.isRoot()) meta.unshift(target.parent.path);
		if (isLinked) meta.push(strings.linked);
		card.createDiv({ cls: 'intra-copilot-reminder-meta', text: meta.join(' · ') });

		const actions = card.createDiv({ cls: 'intra-copilot-reminder-actions' });
		const insert = actions.createEl('button', { cls: 'intra-copilot-reminder-action' });
		setIcon(insert.createSpan({ cls: 'intra-copilot-reminder-action-icon' }), 'link');
		insert.createSpan({ text: strings.insertButton });
		setTooltip(insert, strings.insertTooltip);
		insert.addEventListener('click', () => void this.insertLink(source, target));
	}

	// 링크 모양(위키링크/마크다운)은 Obsidian 설정(파일 및 링크)을 따릅니다. 편집 모드로 열려 있으면 커서 자리에,
	// 아니면(읽기 모드·닫힘) 노트 끝에 넣습니다.
	private async insertLink(source: TFile, target: TFile): Promise<void> {
		const strings = this.strings();
		const link = this.app.fileManager.generateMarkdownLink(target, source.path);
		try {
			const editorView = this.app.workspace
				.getLeavesOfType('markdown')
				.map((leaf) => leaf.view)
				.find((view): view is MarkdownView => view instanceof MarkdownView && view.file === source);
			if (editorView?.getMode() === 'source') {
				editorView.editor.replaceSelection(link);
			} else {
				await this.app.vault.process(source, (text) => `${text.trimEnd()}\n\n${link}\n`);
			}
			new Notice(strings.inserted.replace('{name}', target.basename));
		} catch {
			new Notice(strings.insertFailed);
		}
	}
}
