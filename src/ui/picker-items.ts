import { App, setIcon, setTooltip, TFile, TFolder } from 'obsidian';
import { ChatTarget, VAULT_ROOT_PATH } from '../chat/vault-context';
import { noteName } from '../chat/edit-proposal';
import type { Skill } from '../skills/skill-store';
import type { PickerItem } from './inline-picker';

// 챗봇 입력칸 목록(inline-picker.ts)에 넣을 항목과, 고른 것을 보여주는 칩입니다.
// - @ → 볼트의 폴더·노트(buildTargetItems)
// - / → 저장한 스킬(buildSkillItems)

// ─── @ 폴더·노트 ─────────────────────────────────────────────────

// 검색어가 없을 때의 순서: 볼트 전체·현재 노트 → 폴더(경로 순) → 노트(최근 수정 순)
export function buildTargetItems(
	app: App,
	labels: { wholeVault: string; currentNote: string },
	onPick: (target: ChatTarget) => void,
): PickerItem[] {
	const { vault, workspace } = app;
	const { wholeVault, currentNote } = labels;
	const specials: PickerItem[] = [];
	const folders: PickerItem[] = [];
	const notes: Array<PickerItem & { mtime: number }> = [];

	// 볼트 전체. 영어 별칭(vault, all)으로도 찾을 수 있게 검색 글자 뒤에 덧붙입니다(화면엔 안 보임).
	const vaultName = vault.getName();
	specials.push({
		icon: 'library',
		name: wholeVault,
		detail: vaultName,
		searchText: `${wholeVault} ${vaultName} vault all`,
		nameOffset: 0,
		detailOffset: wholeVault.length + 1,
		onPick: () => onPick({ kind: 'folder', path: VAULT_ROOT_PATH }),
	});

	// 지금 편집 중인 노트(챗봇 패널을 눌러도 마지막으로 보던 노트를 돌려줍니다).
	const active = workspace.getActiveFile();
	if (active && active.extension === 'md') {
		specials.push({
			icon: 'file-check',
			name: currentNote,
			detail: active.path,
			searchText: `${currentNote} ${active.path} current`,
			nameOffset: 0,
			detailOffset: currentNote.length + 1,
			onPick: () => onPick({ kind: 'note', path: active.path }),
		});
	}

	for (const file of vault.getAllLoadedFiles()) {
		const parentPath = file.parent && !file.parent.isRoot() ? file.parent.path : '';
		if (file instanceof TFolder) {
			if (file.isRoot()) continue;
			folders.push({
				icon: 'folder',
				name: file.name,
				detail: parentPath,
				searchText: file.path,
				nameOffset: file.path.length - file.name.length,
				detailOffset: 0,
				onPick: () => onPick({ kind: 'folder', path: file.path }),
			});
		} else if (file instanceof TFile && file.extension === 'md') {
			notes.push({
				icon: 'file-text',
				name: file.basename,
				detail: parentPath,
				searchText: file.path,
				nameOffset: file.path.length - file.name.length,
				detailOffset: 0,
				onPick: () => onPick({ kind: 'note', path: file.path }),
				mtime: file.stat.mtime,
			});
		}
	}

	folders.sort((a, b) => a.searchText.localeCompare(b.searchText));
	notes.sort((a, b) => b.mtime - a.mtime);
	return [...specials, ...folders, ...notes];
}

// ─── / 스킬 ──────────────────────────────────────────────────────

export function buildSkillItems(skills: Skill[], onPick: (skill: Skill) => void): PickerItem[] {
	return skills.map((skill) => ({
		icon: 'sparkles',
		name: skill.name,
		detail: skill.description,
		searchText: `${skill.name} ${skill.description}`,
		nameOffset: 0,
		detailOffset: skill.name.length + 1,
		onPick: () => onPick(skill),
	}));
}

// ─── 칩 ──────────────────────────────────────────────────────────

function describeTarget(
	target: ChatTarget,
	wholeVaultLabel: string,
): { icon: string; label: string } {
	if (target.kind === 'folder') {
		return target.path === VAULT_ROOT_PATH
			? { icon: 'library', label: wholeVaultLabel }
			: { icon: 'folder', label: noteName(target.path) };
	}
	return { icon: 'file-text', label: noteName(target.path).replace(/\.md$/i, '') };
}

interface ChipOptions {
	removeTooltip?: string;
	onRemove?: () => void; // 주면 오른쪽에 [×]가 붙습니다(입력칸 위의 칩). 말풍선 안의 칩은 기록용이라 없음.
}

function createChip(
	parent: HTMLElement,
	chip: { cls: string; icon: string; label: string; tooltip: string },
	options: ChipOptions,
): HTMLElement {
	const el = parent.createSpan({ cls: `intra-copilot-target-chip ${chip.cls}` });
	setTooltip(el, chip.tooltip);
	setIcon(el.createSpan({ cls: 'intra-copilot-target-chip-icon' }), chip.icon);
	el.createSpan({ cls: 'intra-copilot-target-chip-label', text: chip.label });
	const { onRemove } = options;
	if (onRemove) {
		const remove = el.createSpan({ cls: 'intra-copilot-target-chip-remove' });
		setIcon(remove, 'x');
		if (options.removeTooltip) setTooltip(remove, options.removeTooltip);
		remove.addEventListener('click', (evt) => {
			evt.stopPropagation();
			onRemove();
		});
	}
	return el;
}

// @로 지정한 폴더·노트 칩(강조색)
export function createTargetChip(
	parent: HTMLElement,
	target: ChatTarget,
	options: ChipOptions & { wholeVaultLabel: string },
): HTMLElement {
	const { icon, label } = describeTarget(target, options.wholeVaultLabel);
	return createChip(
		parent,
		{
			cls: `is-${target.kind}`,
			icon,
			label,
			tooltip: target.path === VAULT_ROOT_PATH ? label : target.path,
		},
		options,
	);
}

// /로 고른 스킬 칩(보라색)
export function createSkillChip(
	parent: HTMLElement,
	skill: { name: string; description?: string },
	options: ChipOptions,
): HTMLElement {
	return createChip(
		parent,
		{
			cls: 'is-skill',
			icon: 'sparkles',
			label: skill.name,
			tooltip: skill.description || skill.name,
		},
		options,
	);
}
