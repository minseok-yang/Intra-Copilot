import type { ReminderSettings } from '../settings';

// 리마인더가 "다시 볼 노트"를 고르는 규칙입니다. Obsidian 없이 값만 받아 계산하므로 규칙을 바꿀 때는
// 이 파일만 보면 됩니다. (볼트에서 값을 모으는 일은 ui/reminder-view.ts가 맡습니다.)
//
// 1. 대상에서 빼기: 제외 폴더·보관 폴더 안, 만든 지 유예 기간이 안 됨, [나중에]를 누른 날부터 고른 기간이 안 됨
// 2. 남은 노트는 모두 "다시 볼 노트"입니다. 들어오는 링크가 없는 노트와 미룸 태그가 붙은 노트를 앞에(둘 다면 맨 앞),
//    그다음은 오래 손대지 않은 순서(미룬 적 있으면 미룬 때, 없으면 마지막으로 고친 때)로 둡니다.
//
// 다시 보여 줄 때는 파일 수정일이 아니라 [나중에]를 누른 때로 정합니다. 수정일은 링크 자동 수정·동기화·
// 다른 플러그인 때문에 사용자가 읽지 않아도 바뀌어서 "다시 읽었다"는 뜻으로 쓸 수 없기 때문입니다.
// (수정일은 미룬 적 없는 노트끼리의 순서와 새 노트 유예 기간에만 참고합니다.)

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface NoteFacts {
	path: string;
	ctime: number;
	mtime: number;
	tags: string[]; // '#' 없이. 예: 'todo/업무'
	incomingLinks: number; // 다른 노트에서 이 노트로 들어오는 링크 수
}

export interface NoteRecord {
	postponedAt?: number; // [나중에]를 누른 때(밀리초)
	days?: number; // 그때 고른 기간(일). 없으면 설정의 나중에 기본 기간
}

// 첫 번째 이유에는 순서를 정한 날짜를 함께 담아, 카드에서 왜 이 순서인지 보이게 합니다.
export type DueReason =
	| { kind: 'neverPostponed'; modifiedAt: number } // 미룬 적 없음 — 마지막으로 고친 때(순서 기준)
	| { kind: 'postponed'; days: number; postponedAt: number } // 미룬 지 며칠 — [나중에]를 누른 때(순서 기준)
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

// 누른 시각이 아니라 누른 날의 0시(내 컴퓨터 시간대)입니다. 저녁에 미룬 노트가 7일 뒤 아침에도 뜨게 합니다.
function startOfDay(ms: number): number {
	return new Date(ms).setHours(0, 0, 0, 0);
}

export function findDueNotes(
	notes: NoteFacts[],
	records: Readonly<Record<string, NoteRecord>>,
	rules: ReminderSettings,
	now: number,
): DueNote[] {
	const skipFolders = [...rules.excludedFolders, rules.archiveFolder].map((folder) => folder.toLowerCase());
	const deferTags = rules.deferTags.map((tag) => tag.toLowerCase());
	const due: { note: DueNote; since: number }[] = [];

	for (const facts of notes) {
		const lowerPath = facts.path.toLowerCase();
		if (skipFolders.some((folder) => inFolder(lowerPath, folder))) continue;
		// 볼트를 파일 탐색기나 USB로 복사하면 만든 날짜는 복사한 날로 바뀌지만 수정일은 그대로 남습니다. 둘 중 이른 쪽을
		// 만든 날로 봐야, 복사한 뒤 유예 기간 동안 모든 노트가 "새 노트"로 빠지는 일이 없습니다.
		if (now - Math.min(facts.ctime, facts.mtime) < rules.graceDays * DAY_MS) continue;
		const { postponedAt, days = rules.snoozeDays } = records[facts.path] ?? {};
		const postponedDay = postponedAt === undefined ? undefined : startOfDay(postponedAt);
		if (postponedDay !== undefined && now - postponedDay < days * DAY_MS) continue;

		const reasons: DueReason[] = [
			postponedAt === undefined || postponedDay === undefined
				? { kind: 'neverPostponed', modifiedAt: facts.mtime }
				: { kind: 'postponed', days: Math.floor((now - postponedDay) / DAY_MS), postponedAt },
		];
		if (facts.incomingLinks === 0) reasons.push({ kind: 'orphan' });
		// 대소문자를 가리지 않고, 하위 태그(todo/업무)도 todo로 봅니다.
		const tag = facts.tags.find((candidate) => {
			const lower = candidate.toLowerCase();
			return deferTags.some((defer) => lower === defer || lower.startsWith(`${defer}/`));
		});
		if (tag) reasons.push({ kind: 'tag', tag });

		due.push({ note: { path: facts.path, reasons }, since: postponedAt ?? facts.mtime });
	}

	due.sort((a, b) => b.note.reasons.length - a.note.reasons.length || a.since - b.since);
	return due.map((item) => item.note);
}
