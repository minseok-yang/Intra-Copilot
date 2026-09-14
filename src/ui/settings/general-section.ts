import { ButtonComponent, Setting, setIcon } from 'obsidian';
import type { UiLanguage } from '../../settings';
import { openGuideWindow } from '../guide-view';
import type { SettingsContext } from './context';
import { FEATURE_ORDER, FEATURE_STATUS, featureIcon } from './features';

// esbuild.config.mjs가 빌드할 때 일시(한국 시간)를 넣어 줍니다.
declare const BUILD_TIME: string;

// 설정 처음 화면 = 이 플러그인의 첫인상입니다. 처음 쓰는 동료가 위에서부터 읽어 내려가면 되도록
//   ① 이게 뭔지(이름·설명 + 사용자 가이드·라이선스 버튼 + 버전·빌드 일시·제작자) — 한 상자에 간략하게
//   ② 기능별 설정 바로가기(기능 네 개를 가로로 — 리본과 같은 아이콘·한 줄 설명, 누르면 그 기능의 설정으로)
//   ③ 처음이면 어떻게 시작하는지(서버를 아직 설정하지 않았을 때만)
//   ④ 설정값(표시 언어)
// 순서로 둡니다.
export function renderGeneralSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const { plugin, strings } = ctx;
	const general = strings.general;

	// ① 소개 상자
	const intro = containerEl.createDiv({ cls: 'intra-copilot-intro' });
	intro.createDiv({ cls: 'intra-copilot-intro-name', text: plugin.manifest.name });
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

	// 문제를 알릴 때 필요한 정보라 한 줄로 작게 둡니다.
	const meta = intro.createDiv({ cls: 'intra-copilot-intro-meta' });
	for (const [label, value] of [
		[strings.license.versionLabel, plugin.manifest.version],
		[strings.license.buildLabel, BUILD_TIME],
		[strings.license.publisherLabel, plugin.manifest.author ?? ''],
	]) {
		const item = meta.createSpan();
		item.createSpan({ cls: 'intra-copilot-intro-meta-label', text: label });
		item.appendText(` ${value}`);
	}

	// ② 기능별 설정 바로가기. 준비 중인 기능도 눌러서 앞으로 들어갈 설정 자리를 볼 수 있습니다.
	const heading = new Setting(containerEl).setName(general.settingsHeading).setHeading();
	const gear = createSpan({ cls: 'intra-copilot-heading-icon' });
	setIcon(gear, 'settings');
	heading.nameEl.prepend(gear);

	const grid = containerEl.createDiv({ cls: 'intra-copilot-feature-grid' });
	for (const id of FEATURE_ORDER) {
		const status = FEATURE_STATUS[id];
		const card = grid.createEl('button', { cls: `intra-copilot-feature-card is-${status}` });
		setIcon(card.createSpan({ cls: 'intra-copilot-feature-card-icon' }), featureIcon(id));
		card.createSpan({ cls: 'intra-copilot-feature-card-name', text: strings.features[id].name });
		card.createSpan({ cls: `intra-copilot-feature-badge is-${status}`, text: strings.features[status] });
		// 누르기 전에 무엇을 하는 기능인지 알 수 있게 한 줄 설명을 카드에 바로 보여줍니다.
		card.createSpan({ cls: 'intra-copilot-feature-card-desc', text: strings.features[id].desc });
		card.addEventListener('click', () => ctx.openTab(id));
	}

	// ③ 시작 안내 — 설정한 뒤에는 군더더기라 서버 주소가 비어 있을 때만 보여줍니다.
	if (!plugin.settings.llm.baseUrl) {
		const setup = containerEl.createDiv({ cls: 'intra-copilot-setup-hint' });
		setup.createEl('strong', { text: general.setupHeading });
		setup.createEl('p', { text: general.setupSteps });
		new ButtonComponent(setup)
			.setButtonText(general.setupButton)
			.setCta()
			.onClick(() => ctx.openTab('chatbot', 'llm'));
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
}
