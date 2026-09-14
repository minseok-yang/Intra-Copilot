// Intra Copilot이 묶고 있는 기능 네 가지와, 각 기능을 지금 쓸 수 있는지입니다.
// 설정 화면 맨 위의 탭과 일반 탭의 기능 목록이 모두 이 목록을 따릅니다.
//
// 기능을 완성하면: FEATURE_STATUS에서 그 기능을 'available'로 바꾸고, settings-tab.ts의 그 기능
// 섹션을 준비 중 양식(upcoming-section.ts) 대신 실제 설정 화면으로 바꾸면 됩니다.
// (기능 이름은 아직 가칭이라 i18n.ts의 features에만 적어 두었습니다 — 이름이 바뀌면 그곳만 고치면 됩니다.)

export type FeatureId = 'chatbot' | 'link' | 'templater' | 'reminder';

// 설정 화면 맨 위 탭: 일반(모든 기능에 공통) + 기능 네 개
export type SettingsTabId = 'general' | FeatureId;

export const FEATURE_ORDER: readonly FeatureId[] = ['chatbot', 'link', 'templater', 'reminder'];

export type FeatureStatus = 'available' | 'upcoming';

export const FEATURE_STATUS: Record<FeatureId, FeatureStatus> = {
	chatbot: 'available',
	link: 'upcoming',
	templater: 'upcoming',
	reminder: 'upcoming',
};
