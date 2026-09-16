import { moment } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import type { ReminderDaily } from '../settings';

// 리마인더의 하루 단위 값(오늘 챙긴 수, [더 보기]로 늘린 수, 하루 한 번 알림을 띄운 날)입니다.
// 노트와 상관없는 값이라 노트 속성이 아니라 설정 파일(data.json의 reminderDaily)에 함께 저장합니다.

export function today(): string {
	return moment().format('YYYY-MM-DD');
}

// 날짜가 바뀌었으면 그날의 수를 0부터 다시 셉니다.
function startToday(state: ReminderDaily): ReminderDaily {
	const day = today();
	if (state.day !== day) {
		state.day = day;
		state.handled = 0;
		state.extra = 0;
	}
	return state;
}

// 오늘 더 보여 줄 수 있는 개수: 하루 표시 개수 + [더 보기]로 늘린 수 − 오늘 챙긴 수
export function remainingToday(plugin: IntraCopilotPlugin, dailyLimit: number): number {
	const { day, extra, handled } = plugin.settings.reminderDaily;
	return Math.max(0, day === today() ? dailyLimit + extra - handled : dailyLimit);
}

// [나중에]·[챗봇으로 열기]·[보관함]·[삭제]로 목록에서 빠진 노트를 오늘 챙긴 수에 넣습니다.
export function countHandled(plugin: IntraCopilotPlugin): void {
	startToday(plugin.settings.reminderDaily).handled += 1;
	void plugin.saveSettings();
}

// [되돌리기]나 삭제 실패 때: 오늘 챙긴 수에서 하나 뺍니다(날짜가 이미 바뀌었으면 뺄 것이 없음).
export function uncountHandled(plugin: IntraCopilotPlugin): void {
	const state = plugin.settings.reminderDaily;
	if (state.day === today() && state.handled > 0) state.handled -= 1;
	void plugin.saveSettings();
}

export function showMore(plugin: IntraCopilotPlugin, count: number): void {
	startToday(plugin.settings.reminderDaily).extra += count;
	void plugin.saveSettings();
}

// 오늘 아직 하루 한 번 알림을 띄우지 않았으면 true를 돌려주고, 띄운 것으로 기록합니다.
export function takeDailyNotice(plugin: IntraCopilotPlugin): boolean {
	const state = plugin.settings.reminderDaily;
	const day = today();
	if (state.notifiedDay === day) return false;
	state.notifiedDay = day;
	void plugin.saveSettings();
	return true;
}
