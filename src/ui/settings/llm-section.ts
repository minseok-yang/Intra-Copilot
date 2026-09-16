import { ButtonComponent, DropdownComponent, Notice, Setting, setIcon, TextAreaComponent } from 'obsidian';
import type IntraCopilotPlugin from '../../main';
import {
	clampChatTimeout,
	DEFAULT_SETTINGS,
	MAX_CHAT_TIMEOUT_SECONDS,
	MIN_CHAT_TIMEOUT_SECONDS,
} from '../../settings';
import type { Dictionary } from '../../i18n';
import { createStatusLight, type StatusLight, StatusState } from '../status-light';
import {
	checkSelectedModel,
	fetchModelList,
	fillModelDropdown,
	ModelListOutcome,
} from '../model-dropdown';
import type { SettingsContext } from './context';

// 숫자 입력칸 값을 정수로 바꿉니다. 비어 있거나 숫자가 아니거나 음수면 기본값으로 되돌립니다.
// (예전에는 비우면 0 = "제한 없음"이 되어, 서버 보호 설정이 실수로 풀릴 수 있었습니다.)
// 0은 사용자가 일부러 입력한 "제한 없음"이므로 그대로 허용합니다.
export function parseLimit(value: string, fallback: number): number {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseTimeoutSeconds(value: string): number {
	return clampChatTimeout(parseLimit(value, DEFAULT_SETTINGS.llm.chatTimeoutSeconds));
}

// 숫자 입력칸 하나를 만듭니다(챗봇 고급 설정, 리마인더). 입력칸에서 벗어나면(blur) 실제로 저장된 값을
// 다시 보여줘서, 비워둔 칸이 기본값으로 돌아간 것을 사용자가 바로 알 수 있게 합니다.
export function addNumberSetting(
	containerEl: HTMLElement,
	ctx: SettingsContext,
	options: {
		name: string;
		desc: string;
		get: () => number;
		set: (value: number) => void;
		parse: (raw: string) => number;
		min: number;
		max?: number;
	},
): void {
	new Setting(containerEl)
		.setName(options.name)
		.setDesc(options.desc)
		.addText((text) => {
			text.setValue(String(options.get())).onChange((value) => {
				options.set(options.parse(value));
				ctx.saveSoon();
			});
			text.inputEl.type = 'number';
			text.inputEl.min = String(options.min);
			if (options.max !== undefined) text.inputEl.max = String(options.max);
			text.inputEl.addEventListener('blur', () => {
				text.setValue(String(options.get()));
			});
		});
}

// [▸ 고급 설정] 버튼과 그 아래 접힌 영역을 만들고 영역을 돌려줍니다(챗봇 LLM 연결, 커넥터 인덱스).
// 다른 버튼과 똑같은 ButtonComponent라서 배경색·글자 크기가 자동으로 맞습니다.
// ButtonComponent.setIcon()은 글자를 지워버려서, 아이콘과 글자를 직접 함께 넣습니다.
export function addAdvancedSection(parentEl: HTMLElement, label: string): HTMLElement {
	const row = parentEl.createDiv({ cls: 'intra-copilot-inline-row' });
	const button = new ButtonComponent(row);
	button.buttonEl.empty();
	const chevron = button.buttonEl.createSpan({ cls: 'intra-copilot-advanced-icon' });
	setIcon(chevron, 'chevron-right');
	button.buttonEl.createSpan({ text: label });

	const section = parentEl.createDiv({ cls: 'intra-copilot-advanced-section' });
	section.hidden = true;
	button.onClick(() => {
		section.hidden = !section.hidden;
		setIcon(chevron, section.hidden ? 'chevron-right' : 'chevron-down');
	});
	return section;
}

// 챗봇 → 시스템 프롬프트. 서버 연결이 아니라 "대화 내용"에 관한 설정이라 LLM 연결에서 따로 떼어 둡니다.
// 잘 써 둔 글을 실수로 지워도 [취소]로 되돌릴 수 있게, 자동 저장하지 않고 [저장]을 눌러야 반영합니다.
export function renderSystemPromptSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.llm;
	const llm = ctx.plugin.settings.llm;

	containerEl.createEl('p', { text: strings.systemPromptIntro });
	const text = new TextAreaComponent(containerEl).setValue(llm.systemPrompt);
	text.inputEl.rows = 8;
	text.inputEl.addClass('intra-copilot-system-prompt');

	const buttons = containerEl.createDiv({ cls: 'intra-copilot-system-prompt-buttons' });
	const cancel = new ButtonComponent(buttons).setButtonText(strings.systemPromptCancel);
	const save = new ButtonComponent(buttons).setButtonText(strings.systemPromptSave).setCta();
	// 저장된 내용과 다를 때만 두 버튼을 누를 수 있습니다.
	const refresh = () => {
		const unchanged = text.getValue() === llm.systemPrompt;
		cancel.setDisabled(unchanged);
		save.setDisabled(unchanged);
	};
	text.onChange(refresh);
	cancel.onClick(() => {
		text.setValue(llm.systemPrompt);
		refresh();
	});
	save.onClick(async () => {
		llm.systemPrompt = text.getValue();
		refresh();
		await ctx.plugin.saveSettings();
		new Notice(strings.systemPromptSaved);
	});
	refresh();
}

// 챗봇 → LLM 연결: 서버 주소·API 키, 모델 목록·연결 확인, 고급 설정.
//
// 다른 섹션과 달리 상태를 들고 있는 클래스입니다. 탭을 오가거나 언어를 바꿔 화면을 다시 그려도 불러온
// 모델 목록과 표시등을 그대로 보여주고, 자동 확인은 설정 창을 새로 열었을 때 한 번만 하기 위해서입니다.
// (설정 화면이 이 객체 하나를 계속 들고 있다가, 창을 닫을 때 reset()을 부릅니다.)
export class LlmSettingsSection {
	// 설정 창을 새로 열었을 때만 자동으로 확인하기 위한 표시입니다. 탭 전환이나 언어 변경으로
	// 화면을 다시 그릴 때는 재확인하지 않습니다.
	private autoCheckPending = true;
	// 마지막 모델 목록 확인 결과. 서버 주소·키가 바뀌거나 설정 창을 닫으면 지웁니다.
	// (연결 확인 결과는 챗봇 머리줄과 함께 plugin.connectionStatus에 있습니다.)
	private lastModelList: ModelListOutcome | null = null;
	// render()가 채웁니다. 아래 메서드들은 모두 render()가 그린 화면에서만 불립니다.
	private ctx!: SettingsContext;

	// 설정 창을 닫을 때 부릅니다. 다시 열면 자동으로 새로 확인하므로 지난 결과는 버립니다.
	reset(): void {
		this.autoCheckPending = true;
		this.lastModelList = null;
	}

	private get plugin(): IntraCopilotPlugin {
		return this.ctx.plugin;
	}

	render(containerEl: HTMLElement, ctx: SettingsContext): void {
		this.ctx = ctx;
		const strings = ctx.strings.llm;

		containerEl.createEl('p', { text: strings.intro });
		// 노트가 어디로 나가는지는 서버를 정하는 바로 이 화면에서 알아야 하므로 자물쇠 표시와 함께 둡니다.
		containerEl.createEl('p', { cls: 'intra-copilot-privacy-note', text: strings.privacyNote });

		// 서버 주소나 키를 고치면 이전 확인 결과(초록불)는 더 이상 믿을 수 없으므로 되돌립니다.
		// 상태등은 아래에서 만들어지므로, 만들어진 뒤에 실제 동작을 채워 넣습니다.
		let resetStatuses = () => {};

		new Setting(containerEl)
			.setName(strings.baseUrlName)
			.setDesc(strings.baseUrlDesc)
			.addText((text) =>
				text
					.setPlaceholder(strings.baseUrlPlaceholder)
					.setValue(this.plugin.settings.llm.baseUrl)
					.onChange((value) => {
						this.plugin.settings.llm.baseUrl = value.trim();
						resetStatuses();
						ctx.saveSoon();
					}),
			);

		new Setting(containerEl)
			.setName(strings.apiKeyName)
			.setDesc(strings.apiKeyDesc)
			.addText((text) => {
				text
					.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.llm.apiKey)
					.onChange((value) => {
						this.plugin.settings.llm.apiKey = value.trim();
						resetStatuses();
						ctx.saveSoon();
					});
				text.inputEl.type = 'password';
			});

		// 모델 확인 + 연결 확인 + 고급 설정을 한 박스 안에 모았습니다. 위에서부터
		// [모델 목록 불러오기] 버튼 → 드롭다운 → [연결 확인] 버튼 → 연결 상태 → 고급 설정(접힘) 순서입니다.
		const modelSetting = new Setting(containerEl)
			.setName(strings.modelCheckHeading)
			.setDesc(strings.modelCheckDesc);
		modelSetting.controlEl.addClass('intra-copilot-stacked-control');

		const modelActionRow = modelSetting.controlEl.createDiv({
			cls: 'intra-copilot-inline-row',
		});
		const modelCheckButton = new ButtonComponent(modelActionRow).setButtonText(
			strings.modelCheckButton,
		);
		const modelStatus = createStatusLight(modelActionRow, strings.statusIdle);

		const modelDropdown = new DropdownComponent(modelSetting.controlEl);
		const cachedList = this.lastModelList;
		if (cachedList) {
			modelStatus.set(cachedList.state, cachedList.message, cachedList.detail);
		}
		this.fillDropdown(modelDropdown, cachedList?.models ?? [], cachedList?.state ?? 'idle');

		const checkModels = async () => {
			modelCheckButton.setButtonText(strings.loadingModels).setDisabled(true);
			await this.refreshModelList(modelDropdown, modelStatus);
			modelCheckButton.setButtonText(strings.modelCheckButton).setDisabled(false);
		};
		modelCheckButton.onClick(() => void checkModels());

		const testActionRow = modelSetting.controlEl.createDiv({
			cls: 'intra-copilot-inline-row',
		});
		const testButton = new ButtonComponent(testActionRow)
			.setButtonText(strings.testButton)
			.setTooltip(strings.testDesc)
			.onClick(() => void checkSelectedModel(this.plugin));
		const testStatus = createStatusLight(testActionRow, strings.statusIdle);

		const connectionStatusText = modelSetting.controlEl.createEl('p', {
			cls: 'intra-copilot-connection-status-text',
		});

		// 연결 상태등은 챗봇 머리줄과 같은 기록(plugin.connectionStatus)을 그립니다. 챗봇에서 확인했든,
		// 실제 대화 결과든, 모델을 바꿔 "확인 필요"가 됐든 두 화면이 같은 색·문구를 보여 줍니다.
		const drawTest = () => {
			const status = this.plugin.connectionStatus;
			const checking = status.isChecking();
			testButton.setButtonText(checking ? strings.testing : strings.testButton).setDisabled(checking);
			const { state, message, detail, checkedAt } = status.get();
			const time = checkedAt ? `${strings.lastVerifiedPrefix}${checkedAt.toLocaleString()}` : '';
			const tooltip = [detail, time].filter(Boolean).join('\n');
			testStatus.set(state, message || strings.statusIdle, tooltip);
			connectionStatusText.setText(this.formatLastVerified(strings));
		};
		// 설정 화면을 다시 그리면 옛 상태등은 화면에서 빠지므로, 그때 구독도 풉니다.
		const unsubscribe = this.plugin.connectionStatus.subscribe(() => {
			if (!testStatus.dot.isConnected) {
				unsubscribe();
				return;
			}
			drawTest();
		});
		drawTest();

		resetStatuses = () => {
			this.lastModelList = null;
			modelStatus.set('idle', strings.statusIdle);
			// 챗봇 상단 상태등과 위 연결 상태등이 함께 회색(미확인)으로 돌아갑니다.
			this.plugin.connectionStatus.markChanged(strings.statusConnectionChanged);
		};

		const advancedSection = addAdvancedSection(modelSetting.controlEl, strings.advancedName);

		const llm = this.plugin.settings.llm;
		addNumberSetting(advancedSection, ctx, {
			name: strings.maxHistoryName,
			desc: strings.maxHistoryDesc,
			get: () => llm.maxHistoryMessages,
			set: (value) => (llm.maxHistoryMessages = value),
			parse: (raw) => parseLimit(raw, DEFAULT_SETTINGS.llm.maxHistoryMessages),
			min: 0,
		});
		addNumberSetting(advancedSection, ctx, {
			name: strings.maxResponseName,
			desc: strings.maxResponseDesc,
			get: () => llm.maxResponseTokens,
			set: (value) => (llm.maxResponseTokens = value),
			parse: (raw) => parseLimit(raw, DEFAULT_SETTINGS.llm.maxResponseTokens),
			min: 0,
		});
		addNumberSetting(advancedSection, ctx, {
			name: strings.maxContextName,
			desc: strings.maxContextDesc,
			get: () => llm.maxContextChars,
			set: (value) => (llm.maxContextChars = value),
			parse: (raw) => parseLimit(raw, DEFAULT_SETTINGS.llm.maxContextChars),
			min: 0,
		});
		new Setting(advancedSection)
			.setName(strings.streamingName)
			.setDesc(strings.streamingDesc)
			.addToggle((toggle) =>
				toggle.setValue(llm.streaming).onChange((value) => {
					llm.streaming = value;
					ctx.saveSoon();
				}),
			);
		addNumberSetting(advancedSection, ctx, {
			name: strings.chatTimeoutName,
			desc: strings.chatTimeoutDesc,
			get: () => llm.chatTimeoutSeconds,
			set: (value) => (llm.chatTimeoutSeconds = value),
			parse: parseTimeoutSeconds,
			min: MIN_CHAT_TIMEOUT_SECONDS,
			max: MAX_CHAT_TIMEOUT_SECONDS,
		});

		// 설정 창을 새로 연 뒤 이 섹션을 처음 그릴 때만 자동으로 확인합니다.
		// 가벼운 모델 목록 조회만 하고, 테스트 대화(연결 확인)는 버튼을 눌렀을 때만 보냅니다.
		// 설정 창을 열 때마다 공용 서버 GPU를 쓰지 않기 위해서입니다.
		if (this.autoCheckPending) {
			this.autoCheckPending = false;
			void checkModels();
		}
	}


	// [모델 목록 불러오기] 버튼 및 섹션이 열릴 때 자동으로 실행됩니다. 서버에서 모델 목록을 가져와
	// 드롭다운을 채웁니다. 연결 테스트(실제 대화 요청)는 하지 않습니다.
	private async refreshModelList(
		modelDropdown: DropdownComponent,
		status: StatusLight,
	): Promise<void> {
		const strings = this.ctx.strings.llm;
		status.set('idle', strings.statusChecking);

		const server = this.plugin.serverSnapshot();
		const outcome = await fetchModelList(this.plugin);
		// 기다리는 사이 서버 주소·키가 바뀌었다면 옛 주소의 결과이므로 보여주지 않습니다
		// (표시등은 주소를 고칠 때 이미 "아직 확인하지 않음"으로 되돌아가 있습니다).
		if (server !== this.plugin.serverSnapshot()) return;
		this.lastModelList = outcome;
		status.set(outcome.state, outcome.message, outcome.detail);
		// 주소가 비어 있을 때(idle)는 이전처럼 저장된 모델을 그대로 보여줍니다.
		if (outcome.state !== 'idle') {
			this.fillDropdown(modelDropdown, outcome.models, outcome.state);
		}
	}

	private fillDropdown(
		dropdown: DropdownComponent,
		models: string[],
		lastState: StatusState = 'idle',
	): void {
		fillModelDropdown(this.plugin, dropdown, models, {
			lastState,
			onSelected: () => {
				// 연결 상태등은 fillModelDropdown이 "확인 필요"로 바꿉니다. 여기서 고른 모델이 열려 있는 챗봇 화면의 드롭다운에도 바로 보이게 합니다.
				this.plugin.notifySettingsChanged();
			},
		});
	}

	private formatLastVerified(strings: Dictionary['llm']): string {
		const record = this.plugin.settings.llm.lastVerified;
		if (!record) {
			return strings.neverVerified;
		}
		const when = new Date(record.at).toLocaleString();
		// 연결 확인에 "성공"했을 때만 기록되는 값이라, "확인 시각"이 아니라 "마지막 연결 성공"으로 부릅니다.
		return `${strings.lastSuccessPrefix}${when} · ${record.model} (${record.baseUrl})`;
	}
}
