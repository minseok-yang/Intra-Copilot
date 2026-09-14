import { Setting } from 'obsidian';
import type { Dictionary } from '../../i18n';
import type { SettingsContext } from './context';

// 아직 만들지 않은 기능(링크·템플레이터·리마인더)의 설정 자리입니다.
//
// 왜 빈 양식을 미리 두는가: Intra Copilot은 기능 네 개를 묶은 플러그인이라, 설정 화면의 뼈대(기능별
// 탭과 그 안의 섹션)를 먼저 잡아 두면 기능을 만들 때 이 자리에 실제 설정만 채워 넣으면 됩니다.
// 사용자에게도 앞으로 무엇이 생기는지 보여 줍니다.
//
// 모든 입력칸·버튼은 잠겨 있고 아무것도 저장하지 않습니다. 항목은 지금 계획한 것일 뿐이라 실제로
// 만들 때 달라질 수 있습니다.

type Control = 'text' | 'password' | 'dropdown' | 'textarea' | 'button';

interface PlaceholderItem {
	text: { name: string; desc: string };
	control: Control;
	button?: string; // control이 'button'일 때 버튼 글자
}

interface PlaceholderSection {
	intro: string;
	items: PlaceholderItem[];
}

export type UpcomingSectionId = 'embedding' | 'index' | 'templates' | 'prompts' | 'mcp' | 'schedule';

function placeholderSections(u: Dictionary['upcoming']): Record<UpcomingSectionId, PlaceholderSection> {
	return {
		// ─── 링크 ───
		embedding: {
			intro: u.embeddingIntro,
			items: [
				{ text: u.embeddingUrl, control: 'text' },
				{ text: u.embeddingKey, control: 'password' },
				{ text: u.embeddingModel, control: 'dropdown' },
			],
		},
		index: {
			intro: u.indexIntro,
			items: [
				{ text: u.indexFolders, control: 'text' },
				{ text: u.indexExclude, control: 'text' },
				{ text: u.indexRebuild, control: 'button', button: u.buttonStart },
			],
		},
		// ─── 템플레이터 ───
		templates: {
			intro: u.templatesIntro,
			items: [
				{ text: u.templatesFolder, control: 'text' },
				{ text: u.templatesDefault, control: 'dropdown' },
			],
		},
		prompts: {
			intro: u.promptsIntro,
			items: [{ text: u.promptsInstructions, control: 'textarea' }],
		},
		// MCP 서버는 LLM 서버 말고도 외부와 통신하는 연결이 생긴다는 뜻입니다. 이 기능을 만들 때는
		// 사용자 가이드·라이선스의 "무엇이 어디로 전송되나"도 반드시 함께 고쳐야 합니다.
		mcp: {
			intro: u.mcpIntro,
			items: [{ text: u.mcpServers, control: 'button', button: u.buttonAdd }],
		},
		// ─── 리마인더 ───
		schedule: {
			intro: u.scheduleIntro,
			items: [
				{ text: u.scheduleFolders, control: 'text' },
				{ text: u.scheduleInterval, control: 'dropdown' },
				{ text: u.scheduleNotify, control: 'dropdown' },
			],
		},
	};
}

export function renderUpcomingSection(
	containerEl: HTMLElement,
	ctx: SettingsContext,
	id: UpcomingSectionId,
): void {
	const { strings } = ctx;
	const section = placeholderSections(strings.upcoming)[id];

	// 잠긴 칸을 보고 고장이라고 여기지 않도록, 왜 바꿀 수 없는지를 맨 위에 적습니다.
	const notice = containerEl.createDiv({ cls: 'intra-copilot-upcoming-notice' });
	notice.createSpan({ cls: 'intra-copilot-feature-badge is-upcoming', text: strings.features.upcoming });
	notice.createSpan({ text: strings.upcoming.notice });

	containerEl.createEl('p', { cls: 'intra-copilot-section-intro', text: section.intro });

	const list = containerEl.createDiv({ cls: 'intra-copilot-upcoming-items' });
	for (const item of section.items) {
		const row = new Setting(list).setName(item.text.name).setDesc(item.text.desc).setDisabled(true);
		switch (item.control) {
			case 'text':
				row.addText((control) => control.setDisabled(true));
				break;
			case 'password':
				row.addText((control) => {
					control.setDisabled(true);
					control.inputEl.type = 'password';
				});
				break;
			case 'dropdown':
				row.addDropdown((control) => control.setDisabled(true));
				break;
			case 'textarea':
				row.addTextArea((control) => control.setDisabled(true));
				break;
			case 'button':
				row.addButton((control) => control.setButtonText(item.button ?? '').setDisabled(true));
				break;
		}
	}
}
