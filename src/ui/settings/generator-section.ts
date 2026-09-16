import { ButtonComponent, Notice, Setting, TextAreaComponent } from 'obsidian';
import { DEFAULT_GENERATOR_INSTRUCTIONS } from '../../settings';
import { cleanVaultFolder, ensureFolder } from '../../generator/templates';
import { FolderPickerModal } from '../folder-picker';
import type { SettingsContext } from './context';
import { openFolder } from './skills-section';

// 제너레이터 → 양식 / 프롬프트.
// 양식은 볼트 안의 노트라서 사내에서도 Obsidian으로 바로 고칠 수 있고, 공통 지시문은 여기서 고칠 수
// 있습니다(둘 다 재빌드가 필요 없습니다 — 사내에서 손댈 수 있는 것을 늘리려는 선택입니다).

// 볼트 폴더를 고르는 설정 한 줄: 지금 폴더 + [찾기](폴더 고르기 창) + [폴더 열기].
// 경로를 손으로 적게 하지 않는 이유: 오타 하나로 엉뚱한 폴더가 새로 생기고, 그때는 양식이 없는 것처럼
// 보여서 원인을 찾기 어렵습니다. 고를 수 있는 것은 이 볼트 안의 폴더뿐입니다.
export function addFolderSetting(
	containerEl: HTMLElement,
	ctx: SettingsContext,
	options: {
		name: string;
		desc: string;
		get: () => string;
		set: (value: string) => void;
		openFailed: string;
		// 고른 폴더를 쓸 수 없으면 그 이유를 돌려줍니다(쓸 수 있으면 null). 이유는 알림으로 보여 주고
		// 설정은 그대로 둡니다 — 조용히 다른 폴더로 바꿔 두면 고른 것이 왜 안 먹히는지 알 수 없습니다.
		reject?: (path: string) => string | null;
	},
): void {
	const folders = ctx.strings.folders;
	const setting = new Setting(containerEl).setName(options.name).setDesc(options.desc);
	const pathEl = setting.controlEl.createSpan({ cls: 'intra-copilot-folder-path' });
	const showPath = () => pathEl.setText(options.get() || folders.root);
	showPath();

	setting.addButton((button) =>
		button
			.setButtonText(folders.browse)
			.setTooltip(folders.browseTooltip)
			.onClick(() => {
				new FolderPickerModal(ctx.plugin.app, {
					strings: folders,
					current: options.get(),
					onChoose: (path) => {
						const folder = cleanVaultFolder(path);
						const why = options.reject?.(folder);
						if (why) {
							new Notice(why);
							return;
						}
						options.set(folder);
						showPath();
						ctx.saveSoon();
					},
				}).open();
			}),
	);
	// 폴더가 아직 없으면(기본 폴더를 쓰는 경우) 만들고 나서 엽니다.
	setting.addButton((button) =>
		button.setButtonText(folders.openFolder).onClick(async () => {
			const folder = options.get();
			await ensureFolder(ctx.plugin, folder);
			await openFolder(ctx, folder, options.openFailed);
		}),
	);
}

export function renderGeneratorTemplatesSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.generator;
	const generator = ctx.plugin.settings.generator;

	containerEl.createEl('p', { text: strings.templatesIntro });
	containerEl.createEl('p', { cls: 'intra-copilot-privacy-note', text: strings.privacyNote });

	// 양식 폴더를 볼트 맨 위로 두면 볼트의 모든 노트가 양식 목록에 올라와 버리므로 받지 않습니다.
	addFolderSetting(containerEl, ctx, {
		name: strings.folderName,
		desc: strings.folderDesc,
		get: () => generator.templateFolder,
		set: (value) => {
			generator.templateFolder = value;
		},
		openFailed: strings.openFolderFailed,
		reject: (path) => (path ? null : strings.folderRootRejected),
	});

	// 저장 폴더도 같은 방식으로 고릅니다. 볼트 맨 위는 만든 노트가 볼트 맨 위에 쌓여서, 양식 폴더와
	// 같은 폴더는 만든 노트가 다음부터 양식으로 보여서 받지 않습니다.
	addFolderSetting(containerEl, ctx, {
		name: strings.outputFolderName,
		desc: strings.outputFolderDesc,
		get: () => generator.outputFolder,
		set: (value) => {
			generator.outputFolder = value;
		},
		openFailed: strings.openFolderFailed,
		reject: (path) => {
			if (!path) return strings.outputRootRejected;
			return path === cleanVaultFolder(generator.templateFolder) ? strings.outputSameRejected : null;
		},
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
