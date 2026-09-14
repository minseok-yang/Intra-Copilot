import { normalizePath, Setting } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../settings';
import type { SettingsContext } from './context';
import { addNumberSetting, parseLimit } from './llm-section';

// 리마인더 → 대상 노트 / 주기·알림.
// 볼트 전체를 살펴보는 기능이라, 무엇을 보고 무엇을 보내지 않는지를 대상 노트 섹션 맨 위에 적어 둡니다.

const defaults = DEFAULT_SETTINGS.reminder;

// "Templates, /Daily/" 같은 폴더 입력을 볼트 기준 경로로 맞춥니다. 볼트 맨 위('/')는 뺍니다.
function cleanFolder(item: string): string {
	const path = item ? normalizePath(item) : '';
	return path === '/' ? '' : path;
}

// 쉼표로 구분한 목록 입력칸. 입력칸에서 벗어나면 실제로 저장된 목록을 다시 보여 줍니다.
function addListSetting(
	containerEl: HTMLElement,
	ctx: SettingsContext,
	options: {
		name: string;
		desc: string;
		get: () => string[];
		set: (value: string[]) => void;
		clean: (item: string) => string;
	},
): void {
	new Setting(containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addText((text) => {
			text.setValue(options.get().join(', ')).onChange((value) => {
				options.set(
					value
						.split(',')
						.map((item) => options.clean(item.trim()))
						.filter((item) => item !== ''),
				);
				ctx.saveSoon();
			});
			text.inputEl.addEventListener('blur', () => {
				text.setValue(options.get().join(', '));
			});
		});
}

export function renderReminderTargetsSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.reminder;
	const reminder = ctx.plugin.settings.reminder;

	containerEl.createEl('p', { text: strings.targetsIntro });

	addListSetting(containerEl, ctx, {
		name: strings.excludedFoldersName,
		desc: strings.excludedFoldersDesc,
		get: () => reminder.excludedFolders,
		set: (value) => (reminder.excludedFolders = value),
		clean: cleanFolder,
	});
	addNumberSetting(containerEl, ctx, {
		name: strings.graceDaysName,
		desc: strings.graceDaysDesc,
		get: () => reminder.graceDays,
		set: (value) => (reminder.graceDays = value),
		parse: (raw) => parseLimit(raw, defaults.graceDays),
		min: 0,
	});
	addListSetting(containerEl, ctx, {
		name: strings.deferTagsName,
		desc: strings.deferTagsDesc,
		get: () => reminder.deferTags,
		set: (value) => (reminder.deferTags = value),
		clean: (item) => item.replace(/^#/, ''),
	});
	new Setting(containerEl)
		.setName(strings.archiveFolderName)
		.setDesc(strings.archiveFolderDesc)
		.addText((text) => {
			text.setValue(reminder.archiveFolder).onChange((value) => {
				reminder.archiveFolder = cleanFolder(value.trim()) || defaults.archiveFolder;
				ctx.saveSoon();
			});
			text.inputEl.addEventListener('blur', () => {
				text.setValue(reminder.archiveFolder);
			});
		});
}

export function renderReminderScheduleSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.reminder;
	const reminder = ctx.plugin.settings.reminder;

	containerEl.createEl('p', { text: strings.scheduleIntro });

	// 0일·0개·0초는 뜻이 없으므로 1 이상으로 맞춥니다.
	const addAtLeastOne = (
		key: 'snoozeDays' | 'snoozeDays2' | 'snoozeDays3' | 'dailyLimit' | 'undoSeconds',
		name: string,
		desc: string,
	) =>
		addNumberSetting(containerEl, ctx, {
			name,
			desc,
			get: () => reminder[key],
			set: (value) => (reminder[key] = value),
			parse: (raw) => Math.max(1, parseLimit(raw, defaults[key])),
			min: 1,
		});
	addAtLeastOne('snoozeDays', strings.snoozeName, strings.snoozeDesc);
	addAtLeastOne('snoozeDays2', strings.snooze2Name, strings.snooze2Desc);
	addAtLeastOne('snoozeDays3', strings.snooze3Name, strings.snooze3Desc);
	addAtLeastOne('dailyLimit', strings.dailyLimitName, strings.dailyLimitDesc);
	addAtLeastOne('undoSeconds', strings.undoSecondsName, strings.undoSecondsDesc);

	new Setting(containerEl)
		.setName(strings.notifyName)
		.setDesc(strings.notifyDesc)
		.addToggle((toggle) =>
			toggle.setValue(reminder.dailyNotice).onChange((value) => {
				reminder.dailyNotice = value;
				ctx.saveSoon();
			}),
		);
}

// 리마인더 → 노트 속성: 날짜를 적는 속성 이름. 비우면 처음 이름으로 돌아갑니다.
// 이름을 바꾸면 그 뒤로 새 이름에 적고 새 이름에서 읽습니다(예전 이름으로 적힌 날짜는 옮기지 않음).
export function renderReminderPropertiesSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.reminder;
	const reminder = ctx.plugin.settings.reminder;

	containerEl.createEl('p', { text: strings.propertiesIntro });

	const rows = [
		['propCreated', strings.propCreatedName, strings.propCreatedDesc],
		['propRead', strings.propReadName, strings.propReadDesc],
		['propUpdated', strings.propUpdatedName, strings.propUpdatedDesc],
		['propReview', strings.propReviewName, strings.propReviewDesc],
	] as const;
	for (const [key, name, desc] of rows) {
		new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				text.setValue(reminder[key]).onChange((value) => {
					reminder[key] = value.trim() || defaults[key];
					ctx.saveSoon();
				});
				text.inputEl.addEventListener('blur', () => {
					text.setValue(reminder[key]);
				});
			});
	}
}
