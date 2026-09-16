import { App, Modal, Setting, TextAreaComponent } from 'obsidian';
import type { GeneratorStrings } from '../i18n';
import type { OfficeApp, OpenDocument } from '../generator/office-import';

// 제너레이터의 두 팝업 창입니다.
// - SourceZoomModal: 좁은 사이드바에서 텍스트를 크게 보고 고치는 창([새 창에서 텍스트 보기])
// - OpenDocumentModal: 지금 열려 있는 Office 문서·Outlook 메일 중에서 텍스트를 가져올 하나를 고르는 창

export class SourceZoomModal extends Modal {
	constructor(
		app: App,
		private readonly options: {
			strings: GeneratorStrings;
			value: string;
			// 큰 창에서 글을 고치는 즉시 사이드바 입력칸에도 그대로 반영합니다([닫기]를 눌러야 반영되는
			// 방식이면, 창 밖을 눌러 닫았을 때 고친 내용이 사라져 버립니다).
			onChange: (value: string) => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const { strings } = this.options;
		this.modalEl.addClass('intra-copilot-generator-zoom-modal');
		this.setTitle(strings.zoomTitle);

		const text = new TextAreaComponent(this.contentEl).setValue(this.options.value);
		text.inputEl.rows = 24;
		text.inputEl.addClass('intra-copilot-generator-zoom-text');
		text.onChange((value) => this.options.onChange(value));
		text.inputEl.focus();

		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText(strings.zoomClose).setCta().onClick(() => this.close()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class OpenDocumentModal extends Modal {
	constructor(
		app: App,
		private readonly options: {
			strings: GeneratorStrings;
			items: OpenDocument[];
			onPick: (document: OpenDocument) => void;
		},
	) {
		super(app);
	}

	onOpen(): void {
		const { strings, items } = this.options;
		this.modalEl.addClass('intra-copilot-generator-picker-modal');
		this.setTitle(strings.pickerTitle);

		if (items.length === 0) {
			this.contentEl.createEl('p', { text: strings.pickerEmpty });
			return;
		}

		this.contentEl.createEl('p', { cls: 'intra-copilot-section-intro', text: strings.pickerIntro });
		const labels: Record<OfficeApp, string> = {
			word: strings.appWord,
			excel: strings.appExcel,
			powerpoint: strings.appPowerpoint,
			outlook: strings.appOutlook,
		};
		const list = this.contentEl.createDiv({ cls: 'intra-copilot-generator-picker-list' });
		for (const item of items) {
			const row = list.createEl('button', { cls: 'intra-copilot-generator-picker-row' });
			row.createSpan({ cls: 'intra-copilot-generator-picker-app', text: labels[item.app] ?? item.app });
			row.createSpan({ cls: 'intra-copilot-generator-picker-name', text: item.name });
			row.onclick = () => {
				this.close();
				this.options.onPick(item);
			};
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
