import { App, Modal, Notice, Setting } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { t } from '../i18n';
import { newSkillId, saveSkill, Skill } from '../skills/skill-store';

// 스킬 하나를 새로 만들거나 고치는 창입니다(설정 → 챗봇 → 스킬의 [새 스킬]·[편집]).
// 저장하면 SKILL 폴더의 .md 파일에 씁니다. 파일 이름은 처음 만들 때 정해지고, 이름을 바꿔도 그대로입니다.
export class SkillEditModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: IntraCopilotPlugin,
		private readonly skill: Skill | null, // null이면 새 스킬
		private readonly onSaved: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const strings = t(this.plugin.settings.general.language).skills;
		const { contentEl } = this;
		this.modalEl.addClass('intra-copilot-skill-modal');
		this.setTitle(this.skill ? strings.editTitle : strings.newTitle);

		let name = this.skill?.name ?? '';
		let description = this.skill?.description ?? '';
		let instructions = this.skill?.instructions ?? '';

		new Setting(contentEl)
			.setName(strings.nameField)
			.setDesc(strings.nameDesc)
			.addText((text) => text.setValue(name).onChange((value) => (name = value)));

		new Setting(contentEl)
			.setName(strings.descriptionField)
			.setDesc(strings.descriptionDesc)
			.addText((text) => text.setValue(description).onChange((value) => (description = value)));

		new Setting(contentEl)
			.setName(strings.instructionsField)
			.setDesc(strings.instructionsDesc)
			.addTextArea((text) => {
				text.setValue(instructions).onChange((value) => (instructions = value));
				text.inputEl.rows = 12;
				text.inputEl.addClass('intra-copilot-skill-instructions');
			});

		const errorEl = contentEl.createEl('p', { cls: 'intra-copilot-skill-error' });
		errorEl.hidden = true;
		const showError = (message: string) => {
			errorEl.setText(message);
			errorEl.hidden = false;
		};

		new Setting(contentEl)
			.addButton((button) => button.setButtonText(strings.cancelButton).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(strings.saveButton)
					.setCta()
					.onClick(async () => {
						const trimmedName = name.trim();
						if (!trimmedName) return showError(strings.nameRequired);
						if (!instructions.trim()) return showError(strings.instructionsRequired);
						button.setDisabled(true);
						try {
							await saveSkill(this.plugin, {
								id: this.skill?.id ?? (await newSkillId(this.plugin, trimmedName)),
								name: trimmedName,
								description: description.trim(),
								instructions,
							});
							new Notice(strings.saved);
							this.onSaved();
							this.close();
						} catch {
							button.setDisabled(false);
							showError(strings.saveFailed);
						}
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
