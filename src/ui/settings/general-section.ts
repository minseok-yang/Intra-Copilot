import { ButtonComponent, Setting } from 'obsidian';
import type { UiLanguage } from '../../settings';
import { openGuideWindow } from '../guide-view';
import type { SettingsContext } from './context';
import { FEATURE_ORDER, FEATURE_STATUS } from './features';

// 일반 탭 = 이 플러그인의 첫인상입니다. 처음 쓰는 동료가 위에서부터 읽어 내려가면 되도록
//   ① 이게 뭔지(소개 + 사용자 가이드·라이선스 버튼)
//   ② 처음이면 어떻게 시작하는지(서버를 아직 설정하지 않았을 때만)
//   ③ 어떤 기능이 있는지(기능 네 개 — 누르면 그 기능의 탭으로)
//   ④ 설정값(표시 언어)
//   ⑤ 부차적인 정보(버전·제작자)
// 순서로 둡니다.
export function renderGeneralSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const { plugin, strings } = ctx;
	const general = strings.general;

	// ① 소개. 플러그인 이름은 Obsidian이 설정 화면 맨 위에 이미 보여주므로 따로 넣지 않습니다.
	const intro = containerEl.createDiv({ cls: 'intra-copilot-intro' });
	intro.createEl('p', { cls: 'intra-copilot-intro-text', text: general.introText });
	// 무엇이 서버로 나가는지는 사내에서 가장 중요한 정보라, 문서 안에 묻지 않고 여기 한 줄로 둡니다.
	intro.createEl('p', { cls: 'intra-copilot-intro-privacy', text: general.privacyNote });

	const docButtons = intro.createDiv({ cls: 'intra-copilot-intro-buttons' });
	new ButtonComponent(docButtons)
		.setButtonText(general.guideButton)
		.setCta()
		.onClick(() => void openGuideWindow(plugin, 'guide'));
	new ButtonComponent(docButtons)
		.setButtonText(general.licenseButton)
		.onClick(() => void openGuideWindow(plugin, 'license'));

	// ② 시작 안내 — 설정한 뒤에는 군더더기라 서버 주소가 비어 있을 때만 보여줍니다.
	if (!plugin.settings.llm.baseUrl) {
		const setup = containerEl.createDiv({ cls: 'intra-copilot-setup-hint' });
		setup.createEl('strong', { text: general.setupHeading });
		setup.createEl('p', { text: general.setupSteps });
		new ButtonComponent(setup)
			.setButtonText(general.setupButton)
			.setCta()
			.onClick(() => ctx.openTab('chatbot', 'llm'));
	}

	// ③ 기능 네 개. 준비 중인 기능도 눌러서 앞으로 들어갈 설정 자리를 볼 수 있습니다.
	new Setting(containerEl).setName(general.featuresHeading).setHeading();
	const grid = containerEl.createDiv({ cls: 'intra-copilot-feature-grid' });
	for (const id of FEATURE_ORDER) {
		const status = FEATURE_STATUS[id];
		const card = grid.createEl('button', { cls: `intra-copilot-feature-card is-${status}` });
		const top = card.createDiv({ cls: 'intra-copilot-feature-card-top' });
		top.createSpan({ cls: 'intra-copilot-feature-card-name', text: strings.features[id].name });
		top.createSpan({ cls: `intra-copilot-feature-badge is-${status}`, text: strings.features[status] });
		card.createDiv({ cls: 'intra-copilot-feature-card-desc', text: strings.features[id].desc });
		card.addEventListener('click', () => ctx.openTab(id));
	}

	// ④ 표시
	new Setting(containerEl).setName(general.displayHeading).setHeading();
	new Setting(containerEl)
		.setName(general.languageName)
		.setDesc(general.languageDesc)
		.addDropdown((dropdown) =>
			dropdown
				.addOption('ko', '한국어')
				.addOption('en', 'English')
				.setValue(ctx.language)
				.onChange(async (value) => {
					plugin.settings.general.language = value as UiLanguage;
					await plugin.saveSettings();
					plugin.notifySettingsChanged(); // 챗봇 화면·리본 툴팁도 새 언어로
					ctx.redraw();
				}),
		);

	// ⑤ 버전·제작자. 평소에는 볼 일이 없지만 문제를 알릴 때 필요한 정보라 맨 아래에 작게 둡니다.
	new Setting(containerEl).setName(general.infoHeading).setHeading();
	const meta = containerEl.createEl('dl', { cls: 'intra-copilot-license-meta' });
	const addMetaRow = (label: string, value: string) => {
		meta.createEl('dt', { text: label });
		meta.createEl('dd', { text: value });
	};
	addMetaRow(strings.license.versionLabel, plugin.manifest.version);
	addMetaRow(strings.license.publisherLabel, plugin.manifest.author ?? '');
}
