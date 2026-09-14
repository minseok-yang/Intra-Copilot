import type { App } from 'obsidian';
import type IntraCopilotPlugin from '../../main';
import type { Dictionary } from '../../i18n';
import type { UiLanguage } from '../../settings';
import type { SettingsTabId } from './features';

// 설정 화면의 각 섹션(일반, 챗봇의 LLM 연결·스킬, 준비 중인 기능들)이 화면을 그릴 때 받는 것들입니다.
// 섹션은 기능마다 파일을 나눠 두지만, 저장·다시 그리기·다른 탭으로 옮기기는 설정 화면(settings-tab.ts)
// 한 곳이 맡습니다. 새 기능의 설정을 만들 때도 이것만 받아서 그리면 됩니다.
export interface SettingsContext {
	app: App;
	plugin: IntraCopilotPlugin;
	language: UiLanguage;
	strings: Dictionary;
	// 글자를 칠 때마다 파일에 쓰지 않도록, 입력이 멈춘 뒤 한 번만 저장합니다.
	saveSoon: () => void;
	// 지금 보고 있는 화면을 다시 그립니다(목록을 새로 읽었거나 언어를 바꿨을 때).
	redraw: () => void;
	// 다른 화면(과 그 안의 섹션)으로 옮깁니다. 예: 처음 화면에서 [챗봇] 카드를 눌렀을 때.
	openTab: (tab: SettingsTabId, section?: string) => void;
}
