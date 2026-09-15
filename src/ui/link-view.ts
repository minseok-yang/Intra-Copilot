import {
	ButtonComponent,
	Component,
	debounce,
	ItemView,
	Modal,
	Keymap,
	MarkdownRenderer,
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
import { CHAT_VIEW_TYPE, ChatView, revealChatView } from './chat-view';
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
	// 이름을 눌러 펼친 카드(노트 경로). 목록을 다시 그려도 펼친 채로 두고, 다른 노트로 옮기면 접습니다.
	private expanded = new Set<string>();
	private listedPath = '';
	// 펼친 노트를 그릴 때 생기는 자원(임베드 등)을 모아 두었다가 목록을 다시 그릴 때 한꺼번에 풉니다.
	private previews = new Component();

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
		this.removeChild(this.previews);
		this.previews = this.addChild(new Component());

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
		if (source.path !== this.listedPath) {
			this.listedPath = source.path;
			this.expanded.clear();
		}
		const { resultCount, linkedNotes } = this.plugin.settings.link;
		// 이미 링크된 노트를 빼거나 뒤로 보낸 뒤 개수를 자르므로, 먼저 전체를 비슷한 순서로 받습니다.
		const all = index.search(source.path, Infinity);
		if (!all) {
			empty(index.isExcluded(source.path) ? strings.excludedNote : strings.notIndexedNote);
			return;
		}
		const linked = this.app.metadataCache.resolvedLinks[source.path] ?? {};
		const fresh = all.filter((result) => !(result.path in linked));
		const arranged =
			linkedNotes === 'show' ? all : linkedNotes === 'bottom' ? [...fresh, ...all.filter((r) => r.path in linked)] : fresh;
		const results = arranged.slice(0, resultCount);
		if (results.length === 0) empty(strings.noResults);
		else {
			new ButtonComponent(contentEl)
				.setButtonText(strings.chatAllButton.replace('{count}', String(results.length)))
				.setTooltip(strings.chatAllTooltip)
				.onClick(() => void this.addToChat(results.map((result) => result.path)));
		}

		let dividerDrawn = false;
		for (const result of results) {
			const target = this.app.vault.getFileByPath(result.path);
			if (!target) continue;
			const isLinked = result.path in linked;
			// "맨 아래로"면 새 노트와 링크된 노트 사이에 구분 제목을 한 번 둡니다.
			if (isLinked && linkedNotes === 'bottom' && !dividerDrawn) {
				contentEl.createDiv({ cls: 'intra-copilot-link-divider', text: strings.linkedNotesName });
				dividerDrawn = true;
			}
			this.renderCard(contentEl, source, target, result.score, isLinked, result.section);
		}
	}

	// 카드 모양은 리마인더 카드와 같게 맞춰 두 사이드바가 한 플러그인으로 보이게 합니다(같은 CSS 클래스).
	private renderCard(
		containerEl: HTMLElement,
		source: TFile,
		target: TFile,
		score: number,
		isLinked: boolean,
		section: string,
	): void {
		const strings = this.strings();
		const card = containerEl.createDiv({ cls: 'intra-copilot-reminder-card intra-copilot-link-card' });
		// 이미 링크된 노트는 흐리게 그리고 이름 옆에 배지를 달아, 새로 연결할 노트와 한눈에 구분되게 합니다.
		card.toggleClass('is-linked', isLinked);
		// 카드를 편집기에 끌어다 놓으면 링크 글자가 들어갑니다(Obsidian 편집기가 글자 놓기를 받아 줌).
		card.draggable = true;
		card.addEventListener('dragstart', (evt) => {
			evt.dataTransfer?.setData('text/plain', this.app.fileManager.generateMarkdownLink(target, source.path));
		});

		const titleRow = card.createDiv({ cls: 'intra-copilot-link-title' });
		const name = titleRow.createEl('a', { cls: 'intra-copilot-reminder-name', text: target.basename });
		setTooltip(name, strings.previewTooltip);
		if (isLinked) {
			const badge = titleRow.createSpan({ cls: 'intra-copilot-link-badge' });
			setIcon(badge.createSpan({ cls: 'intra-copilot-reminder-action-icon' }), 'link');
			badge.createSpan({ text: strings.linked });
			setTooltip(badge, strings.linkedTooltip);
		}

		const meta = [strings.score.replace('{score}', String(Math.round(Math.max(0, score) * 100)))];
		if (target.parent && !target.parent.isRoot()) meta.unshift(target.parent.path);
		card.createDiv({ cls: 'intra-copilot-reminder-meta', text: meta.join(' · ') });
		if (section) card.createDiv({ cls: 'intra-copilot-reminder-meta', text: strings.section.replace('{section}', section) });

		// 이름을 누르면 노트로 옮겨 가지 않고 카드 안에 내용을 펼칩니다. 옮겨 가면 링크 창이 그 노트 기준으로 바뀌어
		// 보던 목록으로 돌아올 수 없기 때문입니다. Ctrl/Cmd를 누른 채 누르면 예전처럼 새 탭에서 엽니다.
		const preview = card.createDiv({ cls: 'intra-copilot-link-preview' });
		const showPreview = (open: boolean) => {
			card.toggleClass('is-open', open);
			preview.empty();
			if (!open) return;
			// 읽는 동안 접었다 펼치면 옛 body는 이미 화면에서 빠져 있어, 늦게 온 결과가 두 번 그려지지 않습니다.
			const body = preview.createDiv({ cls: 'markdown-rendered' });
			void this.app.vault.cachedRead(target).then((text) => {
				const frontmatterEnd = this.app.metadataCache.getFileCache(target)?.frontmatterPosition?.end.offset ?? 0;
				return MarkdownRenderer.render(this.app, text.slice(frontmatterEnd), body, target.path, this.previews);
			});
		};
		name.addEventListener('click', (evt) => {
			evt.preventDefault();
			if (Keymap.isModEvent(evt)) {
				void this.app.workspace.getLeaf(true).openFile(target);
				return;
			}
			const open = !this.expanded.has(target.path);
			if (open) this.expanded.add(target.path);
			else this.expanded.delete(target.path);
			showPreview(open);
		});
		showPreview(this.expanded.has(target.path));

		const actions = card.createDiv({ cls: 'intra-copilot-reminder-actions' });
		const addButton = (icon: string, label: string, tooltip: string, onClick: () => void) => {
			const button = actions.createEl('button', { cls: 'intra-copilot-reminder-action' });
			setIcon(button.createSpan({ cls: 'intra-copilot-reminder-action-icon' }), icon);
			button.createSpan({ text: label });
			setTooltip(button, tooltip);
			button.addEventListener('click', onClick);
		};
		// 이미 링크된 노트에 [링크 넣기]를 누르면 같은 링크가 또 들어가므로 뺍니다. 섹션 링크는 다른 링크라 둡니다.
		if (!isLinked) addButton('link', strings.insertButton, strings.insertTooltip, () => void this.insertLink(source, target));
		addButton(featureIcon('chatbot'), strings.chatButton, strings.chatTooltip, () => void this.addToChat([target.path]));
		if (section) {
			addButton(
				'heading',
				strings.insertSectionButton,
				strings.insertSectionTooltip.replace('{section}', section),
				() => void this.insertLink(source, target, section),
			);
		}
	}

	// [챗봇에 올리기]: 챗봇을 열고 지금 대화의 입력칸 위에 노트 칩을 더합니다. 누르는 것만으로는 아무것도 보내지 않고,
	// 사용자가 질문을 보낼 때 칩의 노트가 함께 LLM 서버로 전송됩니다(보낼 양은 챗봇의 "노트 자료 최대 글자 수"까지).
	// 여러 챗봇 창이 열려 있으면 챗봇 리본을 눌렀을 때 보이는 첫 창에 올립니다.
	private async addToChat(paths: string[]): Promise<void> {
		await revealChatView(this.plugin);
		const view = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0]?.view;
		if (!(view instanceof ChatView)) return;
		for (const path of paths) view.addNoteTarget(path);
		new Notice(this.strings().chatAdded.replace('{count}', String(paths.length)));
	}

	// 링크 모양(위키링크/마크다운)은 Obsidian 설정(파일 및 링크)을 따릅니다. 편집 모드로 열려 있으면 커서 자리에,
	// 아니면(읽기 모드·닫힘) 노트 끝에 넣습니다. section을 주면 그 제목으로 바로 가는 [[노트#제목]] 링크입니다.
	private async insertLink(source: TFile, target: TFile, section?: string): Promise<void> {
		const strings = this.strings();
		// 제목 링크에 쓸 수 없는 글자(#^[]|)는 Obsidian처럼 빈칸으로 바꿉니다.
		const subpath = section ? `#${section.replace(/[#^[\]|]/g, ' ').replace(/\s+/g, ' ').trim()}` : undefined;
		const link = this.app.fileManager.generateMarkdownLink(target, source.path, subpath);
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
