import { moment } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import type { ReminderDaily } from '../settings';

// 리마인더의 하루 단위 값(오늘 챙긴 수, [더 보기]로 늘린 수, 하루 한 번 알림을 띄운 날)입니다.
// 노트와 상관없는 값이라 노트 속성이 아니라 설정 파일(data.json의 reminderDaily)에 함께 저장합니다.

export function today(): string {
	return moment().format('YYYY-MM-DD');
}

export class DailyCount {
	constructor(private readonly plugin: IntraCopilotPlugin) {}

	private get state(): ReminderDaily {
		return this.plugin.settings.reminderDaily;
	}

	// 오늘 더 보여 줄 수 있는 개수: 하루 표시 개수 + [더 보기]로 늘린 수 − 오늘 챙긴 수
	remainingToday(dailyLimit: number): number {
		const { day, extra, handled } = this.state;
		return Math.max(0, day === today() ? dailyLimit + extra - handled : dailyLimit);
	}

	// [나중에]·[챗봇으로 열기]·[보관함]·[삭제]로 목록에서 빠진 노트를 오늘 챙긴 수에 넣습니다.
	countHandled(): void {
		this.startToday().handled += 1;
		this.save();
	}

	// [되돌리기]나 삭제 실패 때: 오늘 챙긴 수에서 하나 뺍니다(날짜가 이미 바뀌었으면 뺄 것이 없음).
	uncountHandled(): void {
		if (this.state.day === today() && this.state.handled > 0) this.state.handled -= 1;
		this.save();
	}

	showMore(count: number): void {
		this.startToday().extra += count;
		this.save();
	}

	// 오늘 아직 하루 한 번 알림을 띄우지 않았으면 true를 돌려주고, 띄운 것으로 기록합니다.
	takeDailyNotice(): boolean {
		const day = today();
		if (this.state.notifiedDay === day) return false;
		this.state.notifiedDay = day;
		this.save();
		return true;
	}

	// 날짜가 바뀌었으면 그날의 수를 0부터 다시 셉니다.
	private startToday(): ReminderDaily {
		const day = today();
		if (this.state.day !== day) {
			this.state.day = day;
			this.state.handled = 0;
			this.state.extra = 0;
		}
		return this.state;
	}

	private save(): void {
		void this.plugin.saveSettings();
	}
}
