import {
	ButtonComponent,
	debounce,
	DropdownComponent,
	ItemView,
	Notice,
	Setting,
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
	readOpenDocument,
} from '../generator/office-import';
import { OpenDocumentModal, SourceZoomModal } from './generator-modals';

// 제너레이터 화면(오른쪽 사이드바)입니다. 받은 자료를 내 양식의 새 노트로 만듭니다.
//
// 화면 순서(세로 한 줄 흐름): 전송 안내 → [열린 문서 가져오기]·[파일 선택해서 가져오기] → 자료 입력칸
// (사이드바가 좁아서 일부만 보이고, [크게 보기]로 큰 창에서 봅니다) → 양식 고르기 → [만들기].
//
// 자료는 화면에만 있습니다(this.draft). 파일이나 설정에 저장하지 않으므로 Obsidian을 끄면 사라집니다 —
// DRM 문서의 평문 사본을 남기지 않기 위한 결정 14의 "원문 미저장" 원칙입니다.
// 서버로 나가는 것은 [만들기]를 누를 때의 입력칸 글과 고른 양식뿐입니다.

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
	// 고른 양식 이름. 화면을 다시 그리거나 양식이 늘어도 고른 것을 그대로 둡니다.
	private templateName = '';
	// 만드는 중이면 그 요청을 끊을 수 있는 손잡이([중지] 버튼). null이면 한가한 상태입니다.
	private running: AbortController | null = null;
	// 입력칸 아래에 보여 줄 마지막 안내(만든 노트 경로, 실패 이유 등)
	private status = '';
	private statusIsError = false;

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

		// 무엇이 언제 서버로 나가는지를 버튼 위에 먼저 적어 둡니다(챗봇·커넥터 화면과 같은 원칙).
		contentEl.createEl('p', { cls: 'intra-copilot-privacy-note', text: strings.privacyNote });

		// ① 자료 가져오기
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

		// ② 자료 입력칸 — 사이드바가 좁아 몇 줄만 보이고, [크게 보기]로 큰 창에서 봅니다.
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

		const zoom = meta.createEl('button', { cls: 'intra-copilot-generator-link', text: strings.zoomButton });
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
		const clear = meta.createEl('button', { cls: 'intra-copilot-generator-link', text: strings.clearButton });
		clear.title = strings.clearTooltip;
		clear.onclick = () => {
			this.draft = '';
			source.setValue('');
			showCount();
		};

		// ③ 양식 고르기
		const templates = listTemplates(this.plugin);
		const selected = templates.find((template) => template.name === this.templateName) ?? templates[0];
		this.templateName = selected?.name ?? '';
		if (templates.length === 0) {
			contentEl.createEl('p', { cls: 'intra-copilot-generator-empty', text: strings.templateEmpty });
		} else {
			const setting = new Setting(contentEl).setName(strings.templateLabel).setDesc(strings.templateDesc);
			setting.addDropdown((dropdown: DropdownComponent) => {
				for (const template of templates) dropdown.addOption(template.name, template.name);
				dropdown.setValue(this.templateName).onChange((value) => (this.templateName = value));
				dropdown.setDisabled(this.running !== null);
			});
		}

		// ④ 만들기 — 만드는 중에는 [중지]로 기다리기를 멈출 수 있습니다(챗봇과 같은 방식).
		const actions = contentEl.createDiv({ cls: 'intra-copilot-generator-buttons' });
		const create = new ButtonComponent(actions)
			.setButtonText(this.running ? strings.creating : strings.createButton)
			.setTooltip(strings.createTooltip)
			.setCta();
		create.setDisabled(this.running !== null || templates.length === 0);
		create.onClick(() => void this.create(selected));
		if (this.running) {
			new ButtonComponent(actions)
				.setButtonText(strings.stopButton)
				.onClick(() => this.running?.abort());
		}

		if (this.status) {
			contentEl.createEl('p', {
				cls: `intra-copilot-generator-status${this.statusIsError ? ' is-error' : ''}`,
				text: this.status,
			});
		}
	}

	// ─── 자료 가져오기 ─────────────────────────────────────────────
	// 가져온 글은 곧바로 보내지 않고 입력칸에 채웁니다. 사용자가 보고 [만들기]를 눌러야 전송됩니다.

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
		const result = await read();
		if (!result.ok) {
			// 취소는 사용자가 한 일이라 오류로 보여주지 않습니다.
			this.showStatus(strings.importErrors[result.kind], result.kind !== 'cancelled', result.detail);
			return;
		}
		// 이미 붙여넣은 글이 있으면 덮어쓰지 않고 뒤에 잇습니다(문서 여러 개를 모아 한 노트로 만들 수 있게).
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
	private async create(template: GeneratorTemplate | undefined): Promise<void> {
		const strings = this.strings();
		const { llm } = this.plugin.settings;
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
			this.showStatus(strings.createFailed.replace('{reason}', outcome.message), true, outcome.detail);
			return;
		}
		// 잘 안 됐을 때 같은 자료로 다른 양식을 다시 써 볼 수 있게 입력칸은 비우지 않습니다([지우기]로 비웁니다).
		if (outcome.droppedKeys.length > 0) {
			new Notice(strings.droppedKeys.replace('{keys}', outcome.droppedKeys.join(', ')));
		}
		if (!outcome.titleFromModel) new Notice(strings.titleGuessed);
		this.showStatus(strings.created.replace('{path}', outcome.file.path), false);
		if (this.plugin.settings.generator.openAfterCreate) {
			await this.app.workspace.getLeaf(false).openFile(outcome.file);
		}
	}
}
