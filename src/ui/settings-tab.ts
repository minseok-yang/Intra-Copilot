import { App, PluginSettingTab, debounce, setIcon } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { t } from '../i18n';
import type { SettingsContext } from './settings/context';
import { FEATURE_STATUS, FeatureId, featureIcon, SettingsTabId } from './settings/features';
import { renderGeneralSection } from './settings/general-section';
import { LlmSettingsSection, renderSystemPromptSection } from './settings/llm-section';
import { renderSkillsSection } from './settings/skills-section';
import { renderConnectorIndexSection, renderConnectorServerSection } from './settings/connector-section';
import {
	renderReminderPropertiesSection,
	renderReminderScheduleSection,
	renderReminderTargetsSection,
} from './settings/reminder-section';
import { renderUpcomingSection, UpcomingSectionId } from './settings/upcoming-section';

// 설정 화면의 틀입니다.
//
//   처음 화면(general-section.ts): 소개 상자 + ⚙ 설정 [챗봇] [커넥터] [제너레이터] [리마인더]
//        │ 카드를 누르면
//        ▼
//   ← Intra Copilot                                  ← 처음 화면으로 돌아가기
//   챗봇  [사용 가능]                          ← 기능 머리말
//   [LLM 연결] [시스템 프롬프트] [스킬]               ← 기능 안의 섹션(둘 이상일 때만)
//   …섹션 내용…
//
// 이미 누른 카드·탭의 글자(기능 설명, 섹션 이름)는 섹션 안에서 제목으로 되풀이하지 않습니다.
//
// 기능으로 가는 길은 처음 화면의 카드 하나뿐입니다(예전에는 맨 위 탭도 있어 같은 역할이 둘이었습니다).
// 섹션이 실제로 무엇을 그리는지는 ui/settings/ 폴더에 나눠 두었고, 여기서는 화면 전환·저장·다시 그리기만
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
		this.activeTab = 'general'; // 설정을 다시 열면 늘 처음 화면(기능별 설정 카드)부터 보이게
		// 서버 주소/키가 바뀌었을 수 있으니, 열려 있는 챗봇 화면이 모델 목록을 다시 확인하게 합니다.
		this.plugin.notifySettingsChanged();
		super.hide();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const ctx: SettingsContext = {
			plugin: this.plugin,
			strings: t(this.plugin.settings.general.language),
			saveSoon: () => this.saveSoon(),
			redraw: () => this.display(),
			openTab: (tab, section) => this.openTab(tab, section),
		};

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
		this.containerEl.scrollTop = 0; // 아래쪽 카드를 눌러도 새 화면은 맨 위부터 보이게
	}

	private renderFeature(containerEl: HTMLElement, ctx: SettingsContext, feature: FeatureId): void {
		const { strings } = ctx;
		const status = FEATURE_STATUS[feature];

		const back = containerEl.createEl('button', {
			cls: 'intra-copilot-back-button',
			text: `← ${this.plugin.manifest.name}`,
		});
		back.onclick = () => this.openTab('general');

		// 기능 머리말: 이름·상태. 지금 어느 기능의 설정을 보고 있는지 분명히 합니다(설명은 카드에서 이미 봤으므로 생략).
		const header = containerEl.createDiv({ cls: 'intra-copilot-feature-header' });
		const title = header.createDiv({ cls: 'intra-copilot-feature-header-title' });
		setIcon(title.createSpan({ cls: 'intra-copilot-feature-header-icon' }), featureIcon(feature));
		title.createSpan({ cls: 'intra-copilot-feature-header-name', text: strings.features[feature].name });
		title.createSpan({ cls: `intra-copilot-feature-badge is-${status}`, text: strings.features[status] });

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
					{ id: 'prompt', label: labels.prompt, render: renderSystemPromptSection },
					{ id: 'skills', label: labels.skills, render: renderSkillsSection },
				];
			case 'connector':
				return [
					{ id: 'embedding', label: labels.embedding, render: renderConnectorServerSection },
					{ id: 'index', label: labels.index, render: renderConnectorIndexSection },
				];
			case 'generator':
				return [upcoming('templates'), upcoming('prompts'), upcoming('mcp')];
			case 'reminder':
				return [
					{ id: 'targets', label: labels.reminderTargets, render: renderReminderTargetsSection },
					{ id: 'schedule', label: labels.schedule, render: renderReminderScheduleSection },
					{ id: 'properties', label: labels.reminderProperties, render: renderReminderPropertiesSection },
				];
		}
	}
}
