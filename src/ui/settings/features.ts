import { addIcon, setIcon } from 'obsidian';
import type IntraCopilotPlugin from '../../main';
import { t } from '../../i18n';

// Intra Copilot이 묶고 있는 기능 네 가지와, 각 기능을 지금 쓸 수 있는지입니다.
// 설정 처음 화면의 기능별 설정 카드가 이 목록을 따릅니다.
//
// 기능을 완성하면: FEATURE_STATUS에서 그 기능을 'available'로 바꾸고, settings-tab.ts의 그 기능
// 섹션을 준비 중 양식(upcoming-section.ts) 대신 실제 설정 화면으로 바꾸면 됩니다.
// (화면에 보이는 기능 이름은 i18n.ts의 features에 있고, 코드 id·설정 키·파일 이름도 같은 이름을 씁니다.)

export type FeatureId = 'chatbot' | 'connector' | 'generator' | 'reminder';

// 설정 화면: 처음 화면(general) + 기능 네 개의 설정
export type SettingsTabId = 'general' | FeatureId;

export const FEATURE_ORDER: readonly FeatureId[] = ['chatbot', 'connector', 'generator', 'reminder'];

export type FeatureStatus = 'available' | 'upcoming';

export const FEATURE_STATUS: Record<FeatureId, FeatureStatus> = {
	chatbot: 'available',
	connector: 'available',
	generator: 'upcoming',
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
	connector: '<path d="M9 16H8a4 4 0 0 1 0-8h1M15 8h1a4 4 0 0 1 0 8h-1M9 12h6"/>',
	// 칸이 나뉜 양식
	generator:
		'<rect x="5" y="7" width="14" height="4" rx="1"/><rect x="5" y="13" width="6" height="4" rx="1"/><rect x="13" y="13" width="6" height="4" rx="1"/>',
	// 시계
	reminder: '<circle cx="12" cy="12" r="5"/><path d="M12 9.5V12l1.5 1.5"/>',
};

export function featureIcon(id: FeatureId): string {
	return `intra-copilot-${id}`;
}

// 오른쪽 사이드바 창(챗봇·커넥터·리마인더) 맨 위의 "Intra Copilot: 기능" 제목과 한 줄 소개.
// 내용과 버튼만 있으면 처음 연 사람이 무슨 창인지 알기 어려워서 둡니다.
export function renderViewHeading(containerEl: HTMLElement, plugin: IntraCopilotPlugin, id: FeatureId): void {
	const feature = t(plugin.settings.general.language).features[id];
	const heading = containerEl.createDiv({ cls: 'intra-copilot-view-heading' });
	const title = heading.createDiv({ cls: 'intra-copilot-view-heading-title' });
	setIcon(title.createSpan({ cls: 'intra-copilot-feature-header-icon' }), featureIcon(id));
	title.createSpan({ text: `${plugin.manifest.name}: ${feature.name}` });
	heading.createDiv({ cls: 'intra-copilot-view-heading-tagline', text: feature.tagline });
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
