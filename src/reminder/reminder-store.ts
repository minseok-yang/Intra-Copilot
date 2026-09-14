import { moment, normalizePath } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { pluginDir } from '../plugin-paths';
import type { NoteRecord } from './due-notes';

// 리마인더 기록입니다. 플러그인 폴더의 reminder.json에 저장하고, 노트 파일에는 아무것도 쓰지 않습니다.
// 노트에 날짜를 적으면 [나중에]만 눌러도 노트가 "수정"되어 수정일·동기화·백업에 흔적이 남기 때문입니다.
// 대신 플러그인 폴더를 통째로 지우면 기록도 사라집니다(모든 노트가 "처음 올라온 노트"로 돌아감).

interface ReminderData {
	notes: Record<string, NoteRecord>; // 노트 경로 → [나중에]를 누른 때·고른 기간
	day: string; // 아래 두 수를 센 날(YYYY-MM-DD). 날짜가 바뀌면 0부터 다시 셉니다.
	handled: number; // 그날 챙긴 노트 수([나중에]·보관·삭제)
	extra: number; // 그날 [더 보기]로 늘린 개수
	notifiedDay: string; // 켤 때 알림을 마지막으로 띄운 날
}

export function today(): string {
	return moment().format('YYYY-MM-DD');
}

// 손으로 고친 파일이라도 모양이 맞는 값만 받아들입니다.
function readData(raw: unknown): ReminderData {
	const data: ReminderData = { notes: {}, day: '', handled: 0, extra: 0, notifiedDay: '' };
	if (!raw || typeof raw !== 'object') return data;
	const { notes, day, handled, extra, notifiedDay } = raw as Record<string, unknown>;
	if (notes && typeof notes === 'object') {
		for (const [path, value] of Object.entries(notes)) {
			if (!value || typeof value !== 'object') continue;
			const { postponedAt, days } = value as Record<string, unknown>;
			if (typeof postponedAt !== 'number') continue;
			data.notes[path] = typeof days === 'number' && days >= 1 ? { postponedAt, days } : { postponedAt };
		}
	}
	if (typeof day === 'string') data.day = day;
	if (typeof handled === 'number') data.handled = handled;
	if (typeof extra === 'number') data.extra = extra;
	if (typeof notifiedDay === 'string') data.notifiedDay = notifiedDay;
	return data;
}

function dataPath(plugin: IntraCopilotPlugin): string {
	return normalizePath(`${pluginDir(plugin)}/reminder.json`);
}

export class ReminderStore {
	// 파일 쓰기를 순서대로 하나씩 처리합니다(나중 저장이 먼저 끝나 옛 내용으로 덮어쓰는 일 방지).
	private saveChain: Promise<void> = Promise.resolve();

	private constructor(
		private readonly plugin: IntraCopilotPlugin,
		private data: ReminderData,
	) {}

	static async load(plugin: IntraCopilotPlugin): Promise<ReminderStore> {
		const { adapter } = plugin.app.vault;
		const path = dataPath(plugin);
		let raw: unknown = null;
		try {
			if (await adapter.exists(path)) raw = JSON.parse(await adapter.read(path));
		} catch (error) {
			// 깨진 파일이면 빈 기록으로 시작합니다.
			console.error('Intra Copilot: could not read reminder.json', error);
		}
		return new ReminderStore(plugin, readData(raw));
	}

	get records(): Readonly<Record<string, NoteRecord>> {
		return this.data.notes;
	}

	// 오늘 더 보여 줄 수 있는 개수: 하루 표시 개수 + [더 보기]로 늘린 수 − 오늘 챙긴 수
	remainingToday(dailyLimit: number): number {
		const { day, extra, handled } = this.data;
		return Math.max(0, day === today() ? dailyLimit + extra - handled : dailyLimit);
	}

	// [나중에]를 기록하고, 알림의 [되돌리기]가 부를 함수를 돌려줍니다.
	postpone(path: string, days: number): () => void {
		const previous = this.data.notes[path];
		this.data.notes[path] = { postponedAt: Date.now(), days };
		this.countHandled();
		return () => {
			if (previous) this.data.notes[path] = previous;
			else delete this.data.notes[path];
			this.uncountHandled();
		};
	}

	// 보관·삭제처럼 기록 없이 목록에서 사라지는 일도 오늘 챙긴 수에 넣습니다.
	countHandled(): void {
		this.startToday().handled += 1;
		this.save();
	}

	// 되돌리기: 오늘 챙긴 수에서 하나 뺍니다(날짜가 이미 바뀌었으면 셀 것이 없음).
	uncountHandled(): void {
		if (this.data.day === today() && this.data.handled > 0) this.data.handled -= 1;
		this.save();
	}

	showMore(count: number): void {
		this.startToday().extra += count;
		this.save();
	}

	// 오늘 아직 켤 때 알림을 띄우지 않았으면 true를 돌려주고, 띄운 것으로 기록합니다.
	takeDailyNotice(): boolean {
		const day = today();
		if (this.data.notifiedDay === day) return false;
		this.data.notifiedDay = day;
		this.save();
		return true;
	}

	// Obsidian 안에서 노트·폴더 이름을 바꾸거나 지우면 그 아래 노트의 기록도 따라 바꾸거나 지웁니다.
	// (Obsidian 밖에서 바꾸면 기록이 끊겨 "처음 올라온 노트"로 다시 올라옵니다.)
	rename(oldPath: string, newPath: string): void {
		this.move(oldPath, newPath);
	}

	remove(path: string): void {
		this.move(path, null);
	}

	// 날짜가 바뀌었으면 그날의 수를 0부터 다시 셉니다.
	private startToday(): ReminderData {
		const day = today();
		if (this.data.day !== day) {
			this.data.day = day;
			this.data.handled = 0;
			this.data.extra = 0;
		}
		return this.data;
	}

	private move(oldPath: string, newPath: string | null): void {
		const next: Record<string, NoteRecord> = {};
		let changed = false;
		for (const [path, record] of Object.entries(this.data.notes)) {
			if (path !== oldPath && !path.startsWith(`${oldPath}/`)) {
				next[path] = record;
				continue;
			}
			changed = true;
			if (newPath !== null) next[newPath + path.slice(oldPath.length)] = record;
		}
		if (!changed) return;
		this.data.notes = next;
		this.save();
	}

	private save(): void {
		const path = dataPath(this.plugin);
		const text = JSON.stringify(this.data);
		this.saveChain = this.saveChain
			.then(() => this.plugin.app.vault.adapter.write(path, text))
			.catch((error) => console.error('Intra Copilot: could not save reminder.json', error));
	}
}
