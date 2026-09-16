import { ButtonComponent, Notice, Setting, TextAreaComponent } from 'obsidian';
import { DEFAULT_GENERATOR_INSTRUCTIONS, DEFAULT_SETTINGS } from '../../settings';
import { cleanVaultFolder } from '../../generator/templates';
import type { SettingsContext } from './context';

// 제너레이터 → 양식 / 프롬프트.
// 양식은 볼트 안의 노트라서 사내에서도 Obsidian으로 바로 고칠 수 있고, 공통 지시문은 여기서 고칠 수
// 있습니다(둘 다 재빌드가 필요 없습니다 — 사내에서 손댈 수 있는 것을 늘리려는 선택입니다).

const defaults = DEFAULT_SETTINGS.generator;

export function renderGeneratorTemplatesSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.generator;
	const generator = ctx.plugin.settings.generator;

	containerEl.createEl('p', { text: strings.templatesIntro });
	containerEl.createEl('p', { cls: 'intra-copilot-privacy-note', text: strings.privacyNote });

	// 양식 폴더를 비우면 볼트의 모든 노트가 양식 목록에 올라와 버리므로 처음 폴더로 되돌립니다.
	new Setting(containerEl)
		.setName(strings.folderName)
		.setDesc(strings.folderDesc)
		.addText((text) => {
			text.setValue(generator.templateFolder).onChange((value) => {
				generator.templateFolder = cleanVaultFolder(value) || defaults.templateFolder;
				ctx.saveSoon();
			});
			text.inputEl.addEventListener('blur', () => {
				text.setValue(generator.templateFolder);
			});
		});

	// 저장 폴더는 비워 둘 수 있습니다(비우면 볼트 맨 위에 만듭니다).
	new Setting(containerEl)
		.setName(strings.outputFolderName)
		.setDesc(strings.outputFolderDesc)
		.addText((text) => {
			text.setValue(generator.outputFolder).onChange((value) => {
				generator.outputFolder = cleanVaultFolder(value);
				ctx.saveSoon();
			});
			text.inputEl.addEventListener('blur', () => {
				text.setValue(generator.outputFolder);
			});
		});

	new Setting(containerEl)
		.setName(strings.openAfterName)
		.setDesc(strings.openAfterDesc)
		.addToggle((toggle) =>
			toggle.setValue(generator.openAfterCreate).onChange((value) => {
				generator.openAfterCreate = value;
				ctx.saveSoon();
			}),
		);
}

// 공통 지시문: 모든 생성 요청에 양식과 함께 보내는 규칙입니다. 잘 써 둔 글을 실수로 지워도 [취소]로
// 되돌릴 수 있게, 챗봇의 시스템 프롬프트와 같이 [저장]을 눌러야 반영합니다.
export function renderGeneratorPromptSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.generator;
	const generator = ctx.plugin.settings.generator;

	containerEl.createEl('p', { text: strings.instructionsIntro });
	const text = new TextAreaComponent(containerEl).setValue(generator.instructions);
	text.inputEl.rows = 12;
	text.inputEl.addClass('intra-copilot-system-prompt');

	const buttons = containerEl.createDiv({ cls: 'intra-copilot-system-prompt-buttons' });
	const cancel = new ButtonComponent(buttons).setButtonText(strings.instructionsCancel);
	const save = new ButtonComponent(buttons).setButtonText(strings.instructionsSave).setCta();
	const refresh = () => {
		const unchanged = text.getValue() === generator.instructions;
		cancel.setDisabled(unchanged);
		save.setDisabled(unchanged);
	};
	text.onChange(refresh);
	cancel.onClick(() => {
		text.setValue(generator.instructions);
		refresh();
	});
	save.onClick(async () => {
		// 비워 두고 저장하면 처음 지시문으로 돌아갑니다(지시문이 없으면 양식만 보내게 되어 결과가 크게 나빠집니다).
		generator.instructions = text.getValue().trim() || DEFAULT_GENERATOR_INSTRUCTIONS;
		text.setValue(generator.instructions);
		refresh();
		await ctx.plugin.saveSettings();
		new Notice(strings.instructionsSaved);
	});
	refresh();
}
