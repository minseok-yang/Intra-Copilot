import {
	ButtonComponent,
	debounce,
	DropdownComponent,
	ItemView,
	Notice,
	setIcon,
	setTooltip,
	TextAreaComponent,
	WorkspaceLeaf,
} from 'obsidian';
import type IntraCopilotPlugin from '../main';
import type { GeneratorStrings } from '../i18n';
import { featureIcon, renderViewHeading } from './settings/features';
import { ensureExampleTemplate, type GeneratorTemplate, listTemplates } from '../generator/templates';
import { generateNote } from '../generator/generate';
import {
	type ImportResult,
	listOpenDocuments,
	pickAndReadFile,
	SUPPORTED_EXTENSIONS,
	readOpenDocument,
} from '../generator/office-import';
import { OpenDocumentModal, SourceZoomModal } from './generator-modals';
import { confirmTwice } from './delete-confirm';
import { type GeneratorFolderKey, pickGeneratorFolder } from './settings/generator-section';

// 제너레이터 화면(오른쪽 사이드바)입니다. 받은 텍스트를 내 양식의 새 노트로 만듭니다.
//
// 화면 순서(세로 한 줄 흐름): 전송 안내 → [열린 문서에서 텍스트 가져오기]·[파일에서 텍스트 가져오기]
// → 텍스트 입력칸(사이드바가 좁아서 일부만 보이고, 큰 창에서 볼 수 있습니다) → 양식 고르기 → [만들기].
//
// 텍스트는 화면에만 있습니다(this.draft). 파일이나 설정에 저장하지 않으므로 Obsidian을 끄면 사라집니다 —
// DRM 문서의 평문 사본을 남기지 않기 위한 결정 14의 "원문 미저장" 원칙입니다.
// 서버로 나가는 것은 [만들기]를 누를 때의 입력칸 텍스트와 고른 양식뿐입니다.

export const GENERATOR_VIEW_TYPE = 'intra-copilot-generator-view';

export async function revealGeneratorView(plugin: IntraCopilotPlugin): Promise<void> {
	await plugin.app.workspace.ensureSideLeaf(GENERATOR_VIEW_TYPE, 'right', { active: true, reveal: true });
}

export function refreshGeneratorViews(plugin: IntraCopilotPlugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(GENERATOR_VIEW_TYPE)) {
		if (leaf.view instanceof GeneratorView) leaf.view.render();
	}
}

export function registerGenerator(plugin: IntraCopilotPlugin): void {
	plugin.registerView(GENERATOR_VIEW_TYPE, (leaf) => new GeneratorView(leaf, plugin));
}

export class GeneratorView extends ItemView {
	// 입력칸의 글. 화면을 다시 그려도 남고, 어디에도 저장하지 않습니다.
	private draft = '';
	// 고른 양식의 파일 경로. 화면을 다시 그리거나 양식이 늘어도 고른 것을 그대로 둡니다.
	// 이름이 아니라 경로로 기억합니다 — 하위 폴더에 이름이 같은 양식이 둘 있으면 이름만으로는
	// 어느 것을 골랐는지 가릴 수 없어, 엉뚱한 양식으로 노트가 만들어집니다.
	private templatePath = '';
	// 만드는 중이면 그 요청을 끊을 수 있는 손잡이([중지] 버튼). null이면 한가한 상태입니다.
	private running: AbortController | null = null;
	// 입력칸 아래에 보여 줄 마지막 안내(만든 노트 경로, 실패 이유 등)
	private status = '';
	private statusIsError = false;
	// 마지막으로 만든 것의 열쇠(양식 + 입력칸 텍스트). 같은 것을 또 만들려 하면 한 번 더 확인합니다.
	private lastCreated = '';

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: IntraCopilotPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return GENERATOR_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.strings().title;
	}

	getIcon(): string {
		return featureIcon('generator');
	}

	onOpen(): Promise<void> {
		this.contentEl.addClass('intra-copilot-generator-view');
		this.render();
		// 양식 폴더에 .md가 하나도 없으면 예시 양식 하나를 만들어 둡니다(만들면 아래 create 이벤트로 다시 그려짐).
		void ensureExampleTemplate(this.plugin);
		// 양식을 추가·삭제·이름 변경하면 목록이 달라지므로 다시 그립니다. 만드는 중에는 건드리지 않습니다
		// (새 노트를 만드는 것 자체가 create 이벤트라서, 그때 다시 그리면 진행 표시가 사라집니다).
		const refresh = debounce(() => {
			if (!this.running) this.render();
		}, 500, true);
		this.registerEvent(this.app.vault.on('create', refresh));
		this.registerEvent(this.app.vault.on('delete', refresh));
		this.registerEvent(this.app.vault.on('rename', refresh));
		return Promise.resolve();
	}

	private strings(): GeneratorStrings {
		return this.plugin.strings().generator;
	}

	render(): void {
		const strings = this.strings();
		const { contentEl } = this;
		contentEl.empty();
		renderViewHeading(contentEl, this.plugin, 'generator');

		// ① 텍스트 가져오기
		const importRow = contentEl.createDiv({ cls: 'intra-copilot-generator-buttons' });
		const openButton = new ButtonComponent(importRow)
			.setButtonText(strings.importOpenButton)
			.setTooltip(strings.importOpenTooltip)
			.onClick(() => void this.importFromOpenDocument(openButton));
		const fileButton = new ButtonComponent(importRow)
			.setButtonText(strings.importFileButton)
			.setTooltip(strings.importFileTooltip)
			.onClick(() => void this.importFromFile(fileButton));
		if (this.running) {
			openButton.setDisabled(true);
			fileButton.setDisabled(true);
		}
		// 버튼 툴팁은 마우스를 올려야 보이므로, 받는 형식은 버튼 아래에 늘 보이게 적어 둡니다.
		contentEl.createEl('p', {
			cls: 'intra-copilot-generator-hint intra-copilot-generator-import-hint',
			text: strings.importHint.replace('{extensions}', SUPPORTED_EXTENSIONS),
		});

		// ② 텍스트 입력칸 — 사이드바가 좁아 몇 줄만 보입니다. 입력칸 위 줄 오른쪽에 [새 창에서 텍스트 보기],
		// 아래 줄에 글자 수와 [모두 지우기]를 둡니다. 두 버튼을 위아래로 떨어뜨린 이유는, 나란히 있으면
		// 크게 보려다 [모두 지우기]를 눌러 되돌릴 수 없게 텍스트를 잃을 수 있기 때문입니다.
		const header = contentEl.createDiv({ cls: 'intra-copilot-generator-source-header' });
		header.createDiv({ cls: 'intra-copilot-generator-label', text: strings.sourceLabel });

		const source = new TextAreaComponent(contentEl)
			.setValue(this.draft)
			.setPlaceholder(strings.pastePlaceholder);
		source.inputEl.rows = 8;
		source.inputEl.addClass('intra-copilot-generator-source');
		source.setDisabled(this.running !== null);

		const meta = contentEl.createDiv({ cls: 'intra-copilot-generator-meta' });
		const count = meta.createSpan({ cls: 'intra-copilot-generator-count' });
		const showCount = () => count.setText(strings.charCount.replace('{count}', this.draft.length.toLocaleString()));
		source.onChange((value) => {
			this.draft = value;
			showCount();
		});
		showCount();

		const zoom = header.createEl('button', {
			cls: 'intra-copilot-generator-link intra-copilot-generator-zoom',
			text: strings.zoomButton,
		});
		zoom.title = strings.zoomTooltip;
		zoom.onclick = () => {
			new SourceZoomModal(this.app, {
				strings,
				value: this.draft,
				onChange: (value) => {
					this.draft = value;
					source.setValue(value);
					showCount();
				},
			}).open();
		};
		// 지운 텍스트는 되돌릴 수 없어서(어디에도 저장하지 않으므로) 붉은 글자로 둡니다.
		const clear = meta.createEl('button', {
			cls: 'intra-copilot-generator-link intra-copilot-generator-clear',
			text: strings.clearButton,
		});
		clear.title = strings.clearTooltip;
		clear.onclick = () => {
			this.draft = '';
			source.setValue('');
			showCount();
		};
		// 만드는 중에는 입력칸과 함께 이 두 버튼도 잠급니다. 보낸 텍스트는 이미 떠났으므로, 그 사이
		// 지우거나 고치면 화면의 글과 실제로 만들어지는 노트가 어긋나 보입니다.
		zoom.disabled = this.running !== null;
		clear.disabled = this.running !== null;

		// ③ 양식 고르기 — 처음에는 고르지 않은 상태입니다. 아무 양식이나 자동으로 고르면 엉뚱한 모양의
		// 노트가 만들어지고도 왜 그런지 알기 어려워서, 사용자가 한 번은 직접 고르게 합니다.
		const templates = listTemplates(this.plugin);
		const selected = templates.find((template) => template.file.path === this.templatePath);
		if (!selected) this.templatePath = '';
		const block = contentEl.createDiv({ cls: 'intra-copilot-generator-template' });
		block.createDiv({ cls: 'intra-copilot-generator-label', text: strings.templateLabel });
		// 양식이 없을 때도 폴더를 바로 고칠 수 있게 폴더 줄은 늘 보여 줍니다.
		this.renderFolderRow(block, 'templateFolder', strings.templateFolderLabel);
		if (templates.length === 0) {
			block.createEl('p', { cls: 'intra-copilot-generator-empty', text: strings.templateEmpty });
		} else {

			const row = block.createDiv({ cls: 'intra-copilot-generator-template-row' });
			const dropdown = new DropdownComponent(row);
			dropdown.addOption('', strings.templatePlaceholder);
			for (const template of templates) dropdown.addOption(template.file.path, template.name);
			dropdown.setValue(this.templatePath);
			dropdown.setDisabled(this.running !== null);
			dropdown.selectEl.addClass('intra-copilot-generator-template-select');
			// 고른 양식의 개요와 [양식 노트 열기]를 바로 보여 주려면 화면을 다시 그립니다
			// (입력칸의 텍스트는 this.draft에 있어 그대로 남습니다).
			dropdown.onChange((value) => {
				this.templatePath = value;
				this.render();
			});

			if (selected) {
				// 아이콘만 두면 무엇을 하는 버튼인지(고치는 것인지 여는 것인지) 헷갈려서 글자로 적습니다.
				const open = row.createEl('button', {
					cls: 'intra-copilot-generator-template-open',
					text: strings.openTemplateButton,
				});
				setTooltip(open, strings.openTemplateTooltip);
				open.onclick = () => void this.app.workspace.getLeaf(false).openFile(selected.file);
			}

			block.createEl('p', { cls: 'intra-copilot-generator-hint', text: strings.templateDesc });
			if (selected) this.renderOutline(block, selected);
		}

		// ④ 만들기 — 만드는 중에는 [중지]로 기다리기를 멈출 수 있습니다(챗봇과 같은 방식).
		const actions = contentEl.createDiv({ cls: 'intra-copilot-generator-buttons' });
		const create = new ButtonComponent(actions).setCta();
		create.setButtonText(this.running ? strings.creating : strings.createButton);
		// 양식을 고르지 않았거나 만드는 중이면 누를 수 없습니다(무엇에 맞춰 쓸지 정해지지 않았으므로).
		create.setDisabled(this.running !== null || !selected);

		// 실수로 두 번 이상 만들지 않게 두 가지를 둡니다.
		// (1) 만드는 중에는 버튼을 잠그고, create() 맨 앞에서도 한 번 더 막습니다(아주 빠르게 두 번
		//     눌러도 서버로 요청이 두 번 나가지 않게).
		// (2) 방금 만든 것과 텍스트·양식이 똑같으면 한 번 더 눌러야 만듭니다. 같은 노트가 "제목 2"로
		//     또 생기는 것이 가장 흔한 실수이기 때문입니다.
		if (this.lastCreated !== '' && this.lastCreated === this.signature() && !this.running) {
			create.setTooltip(strings.createAgainTooltip);
			const onCreate = confirmTwice(
				create.buttonEl,
				{
					// 화살표 축약으로 setButtonText의 반환값을 돌려주면 lint가 "void 자리에 값을 준다"고
					// 막으므로, 반환값을 버리는 블록으로 씁니다(설정 화면의 blur 처리와 같은 이유).
					arm: () => {
						create.setButtonText(strings.createAgainConfirm);
					},
					reset: () => {
						create.setButtonText(strings.createButton);
					},
				},
				() => this.create(selected),
			);
			create.onClick(() => void onCreate());
		} else {
			create.setTooltip(strings.createTooltip);
			create.onClick(() => void this.create(selected));
		}
		if (this.running) {
			new ButtonComponent(actions)
				.setButtonText(strings.stopButton)
				.onClick(() => this.running?.abort());
		}
		// 만들기 전에 어디에 저장될지 보이게, 저장 위치를 [만들기] 바로 옆에 둡니다.
		this.renderFolderRow(actions, 'outputFolder', strings.outputFolderLabel);

		if (this.status) {
			contentEl.createEl('p', {
				cls: `intra-copilot-generator-status${this.statusIsError ? ' is-error' : ''}`,
				text: this.status,
			});
		}
	}

	// "양식 폴더: Generator [찾기]"처럼 지금 폴더와 [찾기]를 한 줄로 보여 줍니다. [찾기]는 설정 화면과
	// 같은 함수(pickGeneratorFolder)라서 받는 폴더 규칙도 같습니다. 만드는 중에는 잠급니다.
	private renderFolderRow(containerEl: HTMLElement, key: GeneratorFolderKey, label: string): void {
		const folders = this.plugin.strings().folders;
		const row = containerEl.createDiv({ cls: 'intra-copilot-generator-folder' });
		row.createSpan({ cls: 'intra-copilot-generator-hint', text: label });
		row.createSpan({ cls: 'intra-copilot-folder-path', text: this.plugin.settings.generator[key] || folders.root });
		new ButtonComponent(row)
			.setButtonText(folders.browse)
			.setTooltip(folders.browseTooltip)
			.setDisabled(this.running !== null)
			.onClick(() =>
				pickGeneratorFolder(this.plugin, key, () => {
					void this.plugin.saveSettings();
					this.render();
				}),
			);
	}

	// 고른 양식의 얼개를 보여 줍니다. 노트를 열지 않고도 "이 양식이 무엇을 채우게 하는지" 알 수 있게 합니다.
	//
	// 마크업은 Obsidian 개요 보기와 같은 것(outline · tree-item · tree-item-self · tree-item-children)을
	// 씁니다. 그래서 들여쓰기·글자색·마우스 올렸을 때 모습·접기 화살표가 쓰는 테마와 똑같이 보입니다
	// (직접 만든 버튼 목록은 테마와 따로 놀아서 어색했습니다).
	// 제목 목록은 Obsidian이 이미 모아 둔 것(metadataCache)이라 노트를 따로 읽지 않습니다.
	private renderOutline(containerEl: HTMLElement, template: GeneratorTemplate): void {
		const strings = this.strings();
		const box = containerEl.createDiv({ cls: 'intra-copilot-generator-outline' });
		box.createDiv({ cls: 'intra-copilot-generator-outline-title', text: strings.outlineHeading });

		const headings = this.app.metadataCache.getFileCache(template.file)?.headings ?? [];
		if (headings.length === 0) {
			box.createDiv({ cls: 'intra-copilot-generator-hint', text: strings.outlineEmpty });
			return;
		}

		const tree = box.createDiv({ cls: 'outline' });
		// 제목 단계(#의 개수)로 부모·자식을 만듭니다. 단계를 건너뛴 양식(# 다음에 ###)도 가장 가까운
		// 위 제목의 자식이 됩니다. level 0인 맨 처음 칸은 트리 전체를 담는 자리입니다.
		const stack: Array<{ level: number; item: HTMLElement | null; self: HTMLElement | null; children: HTMLElement }> = [
			{ level: 0, item: null, self: null, children: tree },
		];

		for (const heading of headings) {
			while (stack.length > 1 && heading.level <= stack[stack.length - 1]!.level) stack.pop();
			const parent = stack[stack.length - 1]!;

			// 자식이 처음 생길 때 부모에 접기 화살표를 붙입니다(Obsidian도 접을 것이 없으면 화살표가 없습니다).
			if (parent.self && parent.item && !parent.self.hasClass('mod-collapsible')) {
				parent.self.addClass('mod-collapsible');
				const collapse = parent.self.createDiv({ cls: 'tree-item-icon collapse-icon' });
				setIcon(collapse, 'right-triangle');
				parent.self.prepend(collapse);
				const { item: parentItem } = parent;
				collapse.addEventListener('click', (evt) => {
					evt.stopPropagation(); // 화살표는 접기만, 제목 클릭은 노트 열기만
					parentItem.toggleClass('is-collapsed', !parentItem.hasClass('is-collapsed'));
				});
			}

			const item = parent.children.createDiv({ cls: 'tree-item' });
			const self = item.createDiv({ cls: 'tree-item-self is-clickable' });
			self.createDiv({ cls: 'tree-item-inner', text: heading.heading });
			self.addEventListener('click', () => {
				// 방금 누른 제목을 표시해 둡니다(파일 탐색기·개요에서 열려 있는 항목을 표시하는 것과 같게).
				for (const other of Array.from(tree.querySelectorAll<HTMLElement>('.tree-item-self.is-active'))) {
					other.removeClass('is-active');
				}
				self.addClass('is-active');
				void this.app.workspace.openLinkText(`${template.file.path}#${heading.heading}`, '', false);
			});
			stack.push({ level: heading.level, item, self, children: item.createDiv({ cls: 'tree-item-children' }) });
		}
	}

	// ─── 텍스트 가져오기 ───────────────────────────────────────────
	// 가져온 텍스트는 곧바로 보내지 않고 입력칸에 채웁니다. 사용자가 보고 [만들기]를 눌러야 전송됩니다.

	private async importFromOpenDocument(button: ButtonComponent): Promise<void> {
		const strings = this.strings();
		button.setButtonText(strings.importing).setDisabled(true);
		const list = await listOpenDocuments();
		button.setButtonText(strings.importOpenButton).setDisabled(false);
		if (!list.ok) {
			this.showStatus(strings.importErrors[list.kind], true, list.detail);
			return;
		}
		new OpenDocumentModal(this.app, {
			strings,
			items: list.items,
			onPick: (document) => void this.runImport(() => readOpenDocument(document)),
		}).open();
	}

	private async importFromFile(button: ButtonComponent): Promise<void> {
		const strings = this.strings();
		// 파일 선택 창은 PowerShell이 띄우므로, 사람이 고르는 동안 버튼을 잠가 두 번 열리지 않게 합니다.
		button.setButtonText(strings.importing).setDisabled(true);
		await this.runImport(() => pickAndReadFile());
		button.setButtonText(strings.importFileButton).setDisabled(false);
	}

	private async runImport(read: () => Promise<ImportResult>): Promise<void> {
		const strings = this.strings();
		let result: ImportResult;
		try {
			result = await read();
		} catch (error) {
			// 받아온 바이트를 푸는 중에 예외가 나도 버튼이 '가져오는 중...'에 멈추지 않게 실패로 바꿉니다.
			result = { ok: false, kind: 'failed', detail: error instanceof Error ? error.message : String(error) };
		}
		if (!result.ok) {
			// 취소는 사용자가 한 일이라 오류로 보여주지 않습니다.
			this.showStatus(strings.importErrors[result.kind], result.kind !== 'cancelled', result.detail);
			return;
		}
		// 이미 넣어 둔 텍스트가 있으면 덮어쓰지 않고 뒤에 잇습니다(문서 여러 개를 모아 한 노트로 만들 수 있게).
		this.draft = this.draft.trim() ? `${this.draft.trim()}\n\n${result.text}` : result.text;
		this.showStatus(
			strings.imported
				.replace('{name}', result.name)
				.replace('{count}', result.text.length.toLocaleString()),
			false,
		);
	}

	private showStatus(message: string, isError: boolean, detail?: string): void {
		this.status = message;
		this.statusIsError = isError;
		// 원문(서버·COM 오류 메시지)은 화면을 어지럽히지 않게 알림으로만 잠깐 보여 줍니다.
		if (isError && detail) new Notice(`${message}\n${detail}`, 10000);
		this.render();
	}

	// ─── 만들기 ───────────────────────────────────────────────────

	// "같은 것을 또 만들려는지" 판단하는 열쇠입니다(고른 양식 + 입력칸 텍스트).
	private signature(): string {
		return `${this.templatePath}\n${this.draft.trim()}`;
	}

	private async create(template: GeneratorTemplate | undefined): Promise<void> {
		const strings = this.strings();
		const { llm } = this.plugin.settings;
		if (this.running) return; // 이미 만드는 중이면 아무것도 하지 않습니다.
		if (!this.draft.trim()) {
			new Notice(strings.needText);
			return;
		}
		if (!template) {
			new Notice(strings.needTemplate);
			return;
		}
		if (!llm.baseUrl || !llm.model) {
			new Notice(strings.notConfigured);
			return;
		}

		const signature = this.signature();
		this.running = new AbortController();
		this.status = strings.creating;
		this.statusIsError = false;
		this.render();

		const outcome = await generateNote(this.plugin, {
			source: this.draft,
			template,
			cancelSignal: this.running.signal,
		});
		this.running = null;

		if (!outcome.ok) {
			// [중지]는 사용자가 한 일이라 실패로 보여주지 않습니다(붉은 글자·알림 없이 안내만).
			// 챗봇도 중지한 질문을 오류로 표시하지 않습니다 — 고칠 것이 없기 때문입니다.
			if (outcome.kind === 'cancelled') {
				this.showStatus(outcome.message, false);
				return;
			}
			this.showStatus(strings.createFailed.replace('{reason}', outcome.message), true, outcome.detail);
			return;
		}
		// 잘 안 됐을 때 같은 텍스트로 다른 양식을 다시 써 볼 수 있게 입력칸은 비우지 않습니다(비우기는 버튼으로).
		if (outcome.droppedKeys.length > 0) {
			new Notice(strings.droppedKeys.replace('{keys}', outcome.droppedKeys.join(', ')));
		}
		if (!outcome.titleFromModel) new Notice(strings.titleGuessed);
		// 모델이 지은 제목이 이미 있는 노트와 겹쳐 다른 이름으로 저장됐으면 알립니다(덮어쓰지는 않습니다).
		if (outcome.renamed) new Notice(strings.renamedNotice.replace('{name}', outcome.file.basename));
		// 같은 텍스트·양식으로 또 누르면 한 번 더 확인하게 기억해 둡니다.
		this.lastCreated = signature;
		this.showStatus(strings.created.replace('{path}', outcome.file.path), false);
		if (this.plugin.settings.generator.openAfterCreate) {
			await this.app.workspace.getLeaf(false).openFile(outcome.file);
		}
	}
}
