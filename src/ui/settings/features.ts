import { addIcon } from 'obsidian';

// Intra Copilot이 묶고 있는 기능 네 가지와, 각 기능을 지금 쓸 수 있는지입니다.
// 설정 처음 화면의 기능별 설정 카드가 이 목록을 따릅니다.
//
// 기능을 완성하면: FEATURE_STATUS에서 그 기능을 'available'로 바꾸고, settings-tab.ts의 그 기능
// 섹션을 준비 중 양식(upcoming-section.ts) 대신 실제 설정 화면으로 바꾸면 됩니다.
// (기능 이름은 아직 가칭이라 i18n.ts의 features에만 적어 두었습니다 — 이름이 바뀌면 그곳만 고치면 됩니다.)

export type FeatureId = 'chatbot' | 'link' | 'templater' | 'reminder';

// 설정 화면: 처음 화면(general) + 기능 네 개의 설정
export type SettingsTabId = 'general' | FeatureId;

export const FEATURE_ORDER: readonly FeatureId[] = ['chatbot', 'link', 'templater', 'reminder'];

export type FeatureStatus = 'available' | 'upcoming';

export const FEATURE_STATUS: Record<FeatureId, FeatureStatus> = {
	chatbot: 'available',
	link: 'upcoming',
	templater: 'upcoming',
	reminder: 'available',
};

// ─── 기능 아이콘 ────────────────────────────────────────────────────
// 리본·챗봇 창 탭·설정 카드·기능 설정 머리말이 같은 아이콘을 씁니다. 네 개가 한 세트로 보이도록 모두 위아래 가로줄
// ('=') 사이에 그림을 넣습니다. 좌표는 Obsidian 기본 아이콘(Lucide)과 같은 24칸 기준이고, 선 굵기도
// Obsidian 설정을 따르도록 굵기를 따로 정하지 않습니다.
const FRAME = '<path d="M3 3h18M3 21h18"/>';
const GLYPHS: Record<FeatureId, string> = {
	// 말풍선
	chatbot: '<path d="M7 7h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6l-3 2.5V15H7a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/>',
	// 사슬 고리
	link: '<path d="M9 16H8a4 4 0 0 1 0-8h1M15 8h1a4 4 0 0 1 0 8h-1M9 12h6"/>',
	// 칸이 나뉜 양식
	templater:
		'<rect x="5" y="7" width="14" height="4" rx="1"/><rect x="5" y="13" width="6" height="4" rx="1"/><rect x="13" y="13" width="6" height="4" rx="1"/>',
	// 시계
	reminder: '<circle cx="12" cy="12" r="5"/><path d="M12 9.5V12l1.5 1.5"/>',
};

export function featureIcon(id: FeatureId): string {
	return `intra-copilot-${id}`;
}

// addIcon은 100칸 기준이라, 24칸 그림을 100/24배로 키워 넣습니다.
export function registerFeatureIcons(): void {
	for (const id of FEATURE_ORDER) {
		addIcon(
			featureIcon(id),
			`<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${FRAME}${GLYPHS[id]}</g>`,
		);
	}
}
