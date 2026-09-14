import { App, moment, TFile } from 'obsidian';
import type { ReminderSettings } from '../settings';

// 리마인더가 노트 속성(frontmatter)에 적는 날짜입니다. 기록을 노트 자체에 두어, 이름을 바꾸거나 옮겨도
// (Obsidian 밖에서 바꿔도) 날짜가 노트를 따라가고, 노트를 열면 언제 쓰고·읽고·고쳤는지 바로 보입니다.
//
//   created — 작성일. 속성을 적을 일이 생겼을 때 없으면 파일 날짜로 채우고, 있으면 덮어쓰지 않습니다.
//   read    — 마지막으로 읽은 날. [나중에]·[챗봇으로 열기]·챗봇 수정 [적용]
//   updated — 마지막으로 고친 날. 챗봇 수정 [적용](고쳤으면 읽은 것이므로 read도 함께 적음)
//   review  — 다시 목록에 올릴 날. [나중에]에서 고른 기간
//
// 속성 이름은 설정에서 바꿀 수 있고(다른 플러그인이 쓰는 이름에 맞추기 위해), 날짜는 YYYY-MM-DD로 씁니다.

const DATE_FORMAT = 'YYYY-MM-DD';

type PropertyKey = 'created' | 'read' | 'updated' | 'review';

// 되돌리기용: 바꾸기 전 속성 값(없던 속성은 undefined)
export type PropertySnapshot = Record<string, unknown>;

export function formatDate(ms: number): string {
	return moment(ms).format(DATE_FORMAT);
}

// 속성 값을 날짜(밀리초)로 읽습니다. YYYY-MM-DD나 날짜·시각(ISO 8601)이 아니면 없는 것으로 봅니다.
export function parseDate(value: unknown): number | undefined {
	if (typeof value !== 'string') return undefined;
	const date = moment(value, moment.ISO_8601, true);
	return date.isValid() ? date.valueOf() : undefined;
}

export function propertyNames(settings: ReminderSettings): Record<PropertyKey, string> {
	return {
		created: settings.propCreated,
		read: settings.propRead,
		updated: settings.propUpdated,
		review: settings.propReview,
	};
}

function isBlank(value: unknown): boolean {
	return value === undefined || value === null || value === '';
}

// 읽은 날(과 요청하면 수정일·다시 볼 날)에 오늘 기준 날짜를 쓰고, 작성일이 비어 있으면 채웁니다.
// 바꾸기 전 값을 돌려주므로 [되돌리기]에서 restoreProperties로 그대로 돌릴 수 있습니다.
// 속성을 쓰면 노트 파일이 바뀌어 파일 수정일도 바뀝니다(그래서 수정일은 "읽었다"는 기준으로 쓰지 않음).
export async function stampNote(
	app: App,
	file: TFile,
	settings: ReminderSettings,
	stamp: { updated?: boolean; reviewDays?: number },
): Promise<PropertySnapshot> {
	const names = propertyNames(settings);
	const now = Date.now();
	const values: Record<string, string> = { [names.read]: formatDate(now) };
	if (stamp.updated) values[names.updated] = formatDate(now);
	if (stamp.reviewDays !== undefined) {
		values[names.review] = formatDate(moment(now).add(stamp.reviewDays, 'days').valueOf());
	}
	// 볼트를 복사하면 만든 날짜가 복사한 날로 바뀌므로, 만든 날짜와 수정일 중 이른 쪽을 작성일로 봅니다.
	const createdFallback = formatDate(Math.min(file.stat.ctime, file.stat.mtime));

	const previous: PropertySnapshot = {};
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		if (isBlank(frontmatter[names.created])) {
			previous[names.created] = frontmatter[names.created];
			frontmatter[names.created] = createdFallback;
		}
		for (const [key, value] of Object.entries(values)) {
			previous[key] = frontmatter[key];
			frontmatter[key] = value;
		}
	});
	return previous;
}

// stampNote가 돌려준 값으로 속성을 되돌립니다. 없던 속성은 지웁니다.
export async function restoreProperties(app: App, file: TFile, previous: PropertySnapshot): Promise<void> {
	await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete frontmatter[key];
			else frontmatter[key] = value;
		}
	});
}
