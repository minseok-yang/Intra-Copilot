import type { ReminderSettings } from '../settings';

// 리마인더가 "다시 볼 노트"를 고르는 규칙입니다. Obsidian 없이 값만 받아 계산하므로 규칙을 바꿀 때는
// 이 파일만 보면 됩니다. (볼트에서 값을 모으는 일은 ui/reminder-view.ts가 맡습니다.)
//
// 1. 대상에서 빼기: 제외 폴더·보관 폴더 안, 만든 지 유예 기간이 안 됨, [나중에] 기한 전, [확인함] 뒤 간격 전
// 2. 남은 노트는 모두 "다시 볼 노트"입니다. 들어오는 링크가 없거나 미룸 태그가 붙은 노트를 앞에,
//    그다음은 오래 손대지 않은 순서로 둡니다.
//
// 기준은 파일 수정일이 아니라 [확인함]을 누른 날입니다. 노트를 USB로 옮기거나 동기화하면 수정일이
// 복사한 날로 바뀌어, 오래 묻힌 노트가 "방금 고친 노트"처럼 보일 수 있기 때문입니다.
// (한 번도 확인하지 않은 노트끼리의 순서를 정할 때만 수정일을 참고합니다.)

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface NoteFacts {
	path: string;
	ctime: number;
	mtime: number;
	tags: string[]; // '#' 없이. 예: 'todo/업무'
	incomingLinks: number; // 다른 노트에서 이 노트로 들어오는 링크 수
}

export interface NoteRecord {
	reviewedAt?: number; // [확인함]을 누른 때(밀리초)
	snoozedUntil?: number; // [나중에]로 미룬 기한(밀리초)
}

export type DueReason =
	| { kind: 'never' }
	| { kind: 'stale'; days: number }
	| { kind: 'orphan' }
	| { kind: 'tag'; tag: string };

export interface DueNote {
	path: string;
	reasons: DueReason[];
}

function inFolder(path: string, folder: string): boolean {
	return folder !== '' && path.startsWith(`${folder}/`);
}

export function findDueNotes(
	notes: NoteFacts[],
	records: Readonly<Record<string, NoteRecord>>,
	rules: ReminderSettings,
	now: number,
): DueNote[] {
	const skipFolders = [...rules.excludedFolders, rules.archiveFolder];
	const deferTags = rules.deferTags.map((tag) => tag.toLowerCase());
	const due: { note: DueNote; since: number }[] = [];

	for (const facts of notes) {
		if (skipFolders.some((folder) => inFolder(facts.path, folder))) continue;
		if (now - facts.ctime < rules.graceDays * DAY_MS) continue;
		const record = records[facts.path] ?? {};
		if (record.snoozedUntil !== undefined && now < record.snoozedUntil) continue;
		if (record.reviewedAt !== undefined && now - record.reviewedAt < rules.intervalDays * DAY_MS) continue;

		const reasons: DueReason[] = [
			record.reviewedAt === undefined
				? { kind: 'never' }
				: { kind: 'stale', days: Math.floor((now - record.reviewedAt) / DAY_MS) },
		];
		if (facts.incomingLinks === 0) reasons.push({ kind: 'orphan' });
		// 하위 태그(todo/업무)도 todo로 봅니다.
		const tag = facts.tags.find((candidate) => {
			const lower = candidate.toLowerCase();
			return deferTags.some((defer) => lower === defer || lower.startsWith(`${defer}/`));
		});
		if (tag) reasons.push({ kind: 'tag', tag });

		due.push({ note: { path: facts.path, reasons }, since: record.reviewedAt ?? facts.mtime });
	}

	due.sort((a, b) => b.note.reasons.length - a.note.reasons.length || a.since - b.since);
	return due.map((item) => item.note);
}
