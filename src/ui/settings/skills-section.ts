import { ButtonComponent, FileSystemAdapter, Notice, Setting } from 'obsidian';
import { shell } from 'electron';
import { deleteSkill, listSkills, Skill, skillsDir } from '../../skills/skill-store';
import { SkillEditModal } from '../skill-edit-modal';
import { addDeleteConfirmButton } from '../delete-confirm';
import type { SettingsContext } from './context';

// 챗봇 → 스킬: SKILL 폴더의 스킬 목록과 [새 스킬]·[편집]·[삭제].
// 사내에서 파일을 직접 고친 경우를 위해, 섹션을 그릴 때마다 폴더를 새로 읽습니다.
export function renderSkillsSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.skills;
	const folder = skillsDir(ctx.plugin);

	containerEl.createEl('p', { text: strings.intro });

	// 메모장으로 고치거나 동료와 파일을 나눌 때 바로 찾아갈 수 있게 [폴더 열기]를 경로 옆에 둡니다.
	const folderRow = containerEl.createDiv({ cls: 'intra-copilot-inline-row' });
	folderRow.createSpan({ cls: 'intra-copilot-skill-folder', text: `${strings.folderLabel}${folder}/` });
	new ButtonComponent(folderRow)
		.setButtonText(strings.openFolderButton)
		.onClick(() => void openSkillFolder(ctx, folder));

	new Setting(containerEl)
		.addButton((button) =>
			button
				.setButtonText(strings.newButton)
				.setCta()
				.onClick(() => openSkillEditor(ctx, null)),
		)
		.addButton((button) => button.setButtonText(strings.reloadButton).onClick(() => ctx.redraw()));

	// 스킬이 많아져도 설정 화면이 길어지지 않게, 목록은 테두리 상자 안에서 따로 스크롤됩니다(styles.css).
	void fillSkillList(containerEl.createDiv({ cls: 'intra-copilot-skill-list' }), ctx);
}

// 스킬 폴더를 파일 탐색기로 엽니다. 데스크톱 전용 플러그인이라 볼트는 늘 실제 폴더에 있습니다.
// (폴더는 목록을 그릴 때 listSkills가 이미 만들어 둡니다.)
async function openSkillFolder(ctx: SettingsContext, folder: string): Promise<void> {
	const { adapter } = ctx.plugin.app.vault;
	const error =
		adapter instanceof FileSystemAdapter ? await shell.openPath(adapter.getFullPath(folder)) : 'no folder';
	if (error) new Notice(ctx.strings.skills.openFolderFailed);
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
	new SkillEditModal(ctx.plugin.app, ctx.plugin, skill, () => ctx.redraw()).open();
}
