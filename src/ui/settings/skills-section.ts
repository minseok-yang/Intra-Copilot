import { Notice, Setting } from 'obsidian';
import { deleteSkill, listSkills, Skill, skillsDir } from '../../skills/skill-store';
import { SkillEditModal } from '../skill-edit-modal';
import { addDeleteConfirmButton } from '../delete-confirm';
import type { SettingsContext } from './context';

// 인트라 챗봇 → 스킬: SKILL 폴더의 스킬 목록과 [새 스킬]·[편집]·[삭제].
// 사내에서 파일을 직접 고친 경우를 위해, 섹션을 그릴 때마다 폴더를 새로 읽습니다.
export function renderSkillsSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.skills;

	new Setting(containerEl).setName(strings.heading).setHeading();
	containerEl.createEl('p', { text: strings.intro });
	containerEl.createEl('p', {
		cls: 'intra-copilot-skill-folder',
		text: `${strings.folderLabel}${skillsDir(ctx.plugin)}/`,
	});

	new Setting(containerEl)
		.addButton((button) =>
			button
				.setButtonText(strings.newButton)
				.setCta()
				.onClick(() => openSkillEditor(ctx, null)),
		)
		.addButton((button) => button.setButtonText(strings.reloadButton).onClick(() => ctx.redraw()));

	void fillSkillList(containerEl.createDiv({ cls: 'intra-copilot-skill-list' }), ctx);
}

async function fillSkillList(listEl: HTMLElement, ctx: SettingsContext): Promise<void> {
	const strings = ctx.strings.skills;
	let skills: Skill[];
	try {
		skills = await listSkills(ctx.plugin);
	} catch {
		listEl.createEl('p', { cls: 'intra-copilot-skill-error', text: strings.loadFailed });
		return;
	}
	// 읽는 사이 다른 탭으로 옮겼거나 화면을 다시 그렸으면, 이 목록 자리는 이미 화면에 없습니다.
	if (!listEl.isConnected) return;

	if (skills.length === 0) {
		listEl.createEl('p', { cls: 'intra-copilot-chat-empty', text: strings.empty });
		return;
	}

	for (const skill of skills) {
		const file = `${strings.fileLabel}${skill.id}.md`;
		const desc = skill.instructions
			? `${skill.description || strings.noDescription} · ${file}`
			: `${strings.emptyInstructions} · ${file}`;
		const row = new Setting(listEl).setName(`/${skill.name}`).setDesc(desc);

		row.addExtraButton((button) =>
			button
				.setIcon('pencil')
				.setTooltip(strings.editTooltip)
				.onClick(() => openSkillEditor(ctx, skill)),
		);

		// 삭제는 되돌릴 수 없으므로 두 번 눌러야 합니다(delete-confirm.ts).
		addDeleteConfirmButton(
			row,
			desc,
			{
				deleteTooltip: strings.deleteTooltip,
				confirmTooltip: strings.deleteConfirmTooltip,
				confirmDesc: strings.deleteConfirm,
			},
			async () => {
				try {
					await deleteSkill(ctx.plugin, skill.id);
				} catch {
					new Notice(strings.deleteFailed);
				}
				ctx.redraw();
			},
		);
	}
}

function openSkillEditor(ctx: SettingsContext, skill: Skill | null): void {
	new SkillEditModal(ctx.app, ctx.plugin, skill, () => ctx.redraw()).open();
}
