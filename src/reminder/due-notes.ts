import type { ReminderSettings } from '../settings';

// 리마인더가 "다시 볼 노트"를 고르는 규칙입니다. Obsidian 없이 값만 받아 계산하므로 규칙을 바꿀 때는
// 이 파일만 보면 됩니다. (볼트에서 값을 모으는 일은 ui/reminder-view.ts, 날짜 속성은 note-properties.ts가 맡습니다.)
//
// 1. 대상에서 빼기: 제외 폴더·보관 폴더 안 / 작성일부터 유예 기간이 안 됨 / 다시 볼 날이 아직 안 옴
//    - 마지막으로 읽은 날 = read·updated 중 늦은 날(고쳤으면 읽은 것으로 봅니다)
//    - 다시 볼 날 = review와 "마지막으로 읽은 날 + 나중에 기본 기간" 중 늦은 날
//      (30일 뒤로 미뤘다가 챗봇으로 읽어도 30일은 지키고, review가 지났어도 오늘 읽었으면 바로 다시 띄우지 않음)
// 2. 남은 노트는 모두 "다시 볼 노트"입니다. 들어오는 링크가 없는 노트와 미룸 태그가 붙은 노트를 앞에(둘 다면 맨 앞),
//    그다음은 오래 손대지 않은 순서(읽은 기록이 있으면 마지막으로 읽은 날, 없으면 파일 수정일)로 둡니다.
//
// 파일 수정일은 링크 자동 수정·동기화·속성 쓰기로도 바뀌어서 "읽었다"는 뜻으로 쓰지 않습니다
// (읽은 기록이 없는 노트끼리의 순서와, 작성일 속성이 없을 때의 유예 기간에만 참고합니다).

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface NoteFacts {
	path: string;
	ctime: number;
	mtime: number;
	tags: string[]; // '#' 없이. 예: 'todo/업무'
	incomingLinks: number; // 다른 노트에서 이 노트로 들어오는 링크 수
	// 노트 속성의 날짜(밀리초). 속성이 없거나 날짜로 읽을 수 없으면 undefined
	created: number | undefined;
	read: number | undefined;
	updated: number | undefined;
	review: number | undefined;
}

// 첫 번째 이유에는 순서를 정한 날짜를 함께 담아, 카드에서 왜 이 순서인지 보이게 합니다.
export type DueReason =
	| { kind: 'neverRead'; modifiedAt: number } // 읽은 기록 없음 — 파일 수정일(순서 기준)
	| { kind: 'read'; days: number; readAt: number } // 마지막으로 읽은 지 며칠 — 마지막으로 읽은 날(순서 기준)
	| { kind: 'orphan' }
	| { kind: 'tag'; tag: string };

export interface DueNote {
	path: string;
	reasons: DueReason[];
}

// path와 folder는 소문자로 받습니다. Windows는 폴더 이름의 대소문자를 구분하지 않아서, 설정에
// "templates"라고 적어도 "Templates" 폴더가 빠지도록 대소문자를 무시하고 비교합니다.
function inFolder(path: string, folder: string): boolean {
	return folder !== '' && path.startsWith(`${folder}/`);
}

// 그날의 0시(내 컴퓨터 시간대)입니다. 기간을 시각이 아니라 날짜로 셉니다(저녁에 읽은 노트도 7일 뒤 아침에 뜨게).
function startOfDay(ms: number): number {
	return new Date(ms).setHours(0, 0, 0, 0);
}

function latest(a: number | undefined, b: number | undefined): number | undefined {
	if (a === undefined) return b;
	if (b === undefined) return a;
	return Math.max(a, b);
}

export function findDueNotes(notes: NoteFacts[], rules: ReminderSettings, now: number): DueNote[] {
	const skipFolders = [...rules.excludedFolders, rules.archiveFolder].map((folder) => folder.toLowerCase());
	const deferTags = rules.deferTags.map((tag) => tag.toLowerCase());
	const due: { note: DueNote; since: number }[] = [];

	for (const facts of notes) {
		const lowerPath = facts.path.toLowerCase();
		if (skipFolders.some((folder) => inFolder(lowerPath, folder))) continue;
		// 작성일 속성이 없으면 파일 날짜로 봅니다. 볼트를 복사하면 만든 날짜는 복사한 날로 바뀌지만 수정일은
		// 그대로 남으므로, 둘 중 이른 쪽을 써야 복사한 뒤 모든 노트가 "새 노트"로 빠지지 않습니다.
		const created = facts.created ?? Math.min(facts.ctime, facts.mtime);
		if (now - created < rules.graceDays * DAY_MS) continue;

		const readAt = latest(facts.read, facts.updated);
		const reviewAt = latest(
			facts.review === undefined ? undefined : startOfDay(facts.review),
			readAt === undefined ? undefined : startOfDay(readAt) + rules.snoozeDays * DAY_MS,
		);
		if (reviewAt !== undefined && now < reviewAt) continue;

		const reasons: DueReason[] = [
			readAt === undefined
				? { kind: 'neverRead', modifiedAt: facts.mtime }
				: { kind: 'read', days: Math.floor((now - startOfDay(readAt)) / DAY_MS), readAt },
		];
		if (facts.incomingLinks === 0) reasons.push({ kind: 'orphan' });
		// 대소문자를 가리지 않고, 하위 태그(todo/업무)도 todo로 봅니다.
		const tag = facts.tags.find((candidate) => {
			const lower = candidate.toLowerCase();
			return deferTags.some((defer) => lower === defer || lower.startsWith(`${defer}/`));
		});
		if (tag) reasons.push({ kind: 'tag', tag });

		due.push({ note: { path: facts.path, reasons }, since: readAt ?? facts.mtime });
	}

	due.sort((a, b) => b.note.reasons.length - a.note.reasons.length || a.since - b.since);
	return due.map((item) => item.note);
}
