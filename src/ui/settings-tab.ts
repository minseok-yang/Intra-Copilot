import { App, PluginSettingTab, debounce } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { t } from '../i18n';
import type { SettingsContext } from './settings/context';
import { FEATURE_ORDER, FEATURE_STATUS, FeatureId, SettingsTabId } from './settings/features';
import { renderGeneralSection } from './settings/general-section';
import { LlmSettingsSection } from './settings/llm-section';
import { renderSkillsSection } from './settings/skills-section';
import { renderUpcomingSection, UpcomingSectionId } from './settings/upcoming-section';

// 설정 화면의 틀입니다.
//
//   [일반] [챗봇] [링크] [템플레이터] [리마인더]     ← 맨 위 탭: 공통 + 기능 네 개
//   ──────────────────────────────────────
//   인트라 챗봇  [사용 가능]                          ← 기능 머리말(기능 탭에서만)
//   사내 LLM과 대화하고…
//   [LLM 연결] [스킬]                                 ← 기능 안의 섹션(둘 이상일 때만)
//   …섹션 내용…
//
// 섹션이 실제로 무엇을 그리는지는 ui/settings/ 폴더에 나눠 두었고, 여기서는 탭 전환·저장·다시 그리기만
// 맡습니다. 기능을 만들면 sectionsFor()에서 그 기능의 준비 중 양식을 실제 설정으로 바꾸고,
// features.ts에서 상태를 'available'로 바꿉니다.

interface SectionDefinition {
	id: string;
	label: string;
	render: (containerEl: HTMLElement, ctx: SettingsContext) => void;
}

export class IntraCopilotSettingTab extends PluginSettingTab {
	plugin: IntraCopilotPlugin;
	private activeTab: SettingsTabId = 'general';
	// 기능 탭마다 마지막으로 보던 섹션. 탭을 오가도 보던 섹션으로 돌아옵니다.
	private activeSection: Partial<Record<FeatureId, string>> = {};
	// LLM 연결 섹션은 불러온 모델 목록 같은 상태를 기억해야 해서 하나를 계속 들고 있습니다.
	private readonly llmSection = new LlmSettingsSection();

	// 글자를 칠 때마다 파일에 쓰지 않도록, 입력이 멈춘 뒤 한 번만 저장합니다.
	private readonly saveSoon = debounce(
		() => {
			void this.plugin.saveSettings();
		},
		500,
		true,
	);

	constructor(app: App, plugin: IntraCopilotPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		// Obsidian이 설정 창을 닫거나 다른 플러그인 탭으로 옮길 때 호출합니다.
		this.saveSoon.run(); // 아직 저장되지 않은 입력이 있으면 지금 저장합니다.
		this.llmSection.reset();
		// 서버 주소/키가 바뀌었을 수 있으니, 열려 있는 챗봇 화면이 모델 목록을 다시 확인하게 합니다.
		this.plugin.notifySettingsChanged();
		super.hide();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const language = this.plugin.settings.general.language;
		const strings = t(language);
		const ctx: SettingsContext = {
			app: this.app,
			plugin: this.plugin,
			language,
			strings,
			saveSoon: () => this.saveSoon(),
			redraw: () => this.display(),
			openTab: (tab, section) => this.openTab(tab, section),
		};

		const tabBar = containerEl.createDiv({ cls: 'intra-copilot-tab-bar' });
		const tabIds: SettingsTabId[] = ['general', ...FEATURE_ORDER];
		for (const id of tabIds) {
			const button = tabBar.createEl('button', {
				cls: 'intra-copilot-tab-button',
				text: strings.tabs[id],
			});
			button.toggleClass('is-active', id === this.activeTab);
			// 준비 중인 기능은 탭 글자를 흐리게 합니다(눌러서 앞으로 들어갈 설정 자리를 볼 수는 있습니다).
			if (id !== 'general') button.toggleClass('is-upcoming', FEATURE_STATUS[id] === 'upcoming');
			button.onclick = () => this.openTab(id);
		}

		const content = containerEl.createDiv({ cls: 'intra-copilot-tab-content' });
		if (this.activeTab === 'general') {
			renderGeneralSection(content, ctx);
		} else {
			this.renderFeature(content, ctx, this.activeTab);
		}
	}

	private openTab(tab: SettingsTabId, section?: string): void {
		this.activeTab = tab;
		if (tab !== 'general' && section) this.activeSection[tab] = section;
		this.display();
	}

	private renderFeature(containerEl: HTMLElement, ctx: SettingsContext, feature: FeatureId): void {
		const { strings } = ctx;
		const status = FEATURE_STATUS[feature];

		// 기능 머리말: 이름·상태·한 줄 설명. 지금 어느 기능의 설정을 보고 있는지 분명히 합니다.
		const header = containerEl.createDiv({ cls: 'intra-copilot-feature-header' });
		const title = header.createDiv({ cls: 'intra-copilot-feature-header-title' });
		title.createSpan({ cls: 'intra-copilot-feature-header-name', text: strings.features[feature].name });
		title.createSpan({ cls: `intra-copilot-feature-badge is-${status}`, text: strings.features[status] });
		header.createDiv({ cls: 'intra-copilot-feature-header-desc', text: strings.features[feature].desc });

		const sections = this.sectionsFor(feature, ctx);
		const active =
			sections.find((section) => section.id === this.activeSection[feature]) ?? sections[0]!;

		if (sections.length > 1) {
			const subBar = containerEl.createDiv({ cls: 'intra-copilot-subtab-bar' });
			for (const section of sections) {
				const button = subBar.createEl('button', {
					cls: 'intra-copilot-subtab-button',
					text: section.label,
				});
				button.toggleClass('is-active', section === active);
				button.onclick = () => this.openTab(feature, section.id);
			}
		}

		active.render(containerEl.createDiv({ cls: 'intra-copilot-section-content' }), ctx);
	}

	// 기능마다 어떤 섹션이 있는지입니다. 기능을 만들면 upcoming(...) 자리를 실제 설정 섹션으로 바꿉니다.
	private sectionsFor(feature: FeatureId, ctx: SettingsContext): SectionDefinition[] {
		const labels = ctx.strings.sections;
		const upcoming = (id: UpcomingSectionId): SectionDefinition => ({
			id,
			label: labels[id],
			render: (el, sectionCtx) => renderUpcomingSection(el, sectionCtx, id),
		});

		switch (feature) {
			case 'chatbot':
				return [
					{
						id: 'llm',
						label: labels.llm,
						render: (el, sectionCtx) => this.llmSection.render(el, sectionCtx),
					},
					{ id: 'skills', label: labels.skills, render: renderSkillsSection },
				];
			case 'link':
				return [upcoming('embedding'), upcoming('index')];
			case 'templater':
				return [upcoming('templates'), upcoming('prompts'), upcoming('mcp')];
			case 'reminder':
				return [upcoming('schedule')];
		}
	}
}
