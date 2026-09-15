import { AbstractInputSuggest, type App, Setting } from 'obsidian';
import { listLlmModels } from '../../llm/client';
import { describeLinkError } from '../../i18n';
import { DEFAULT_SETTINGS, type LinkedNotesMode, MAX_VECTORS_PER_NOTE } from '../../settings';
import { addIndexButton, describeIndexState, indexLight } from '../link-view';
import { createStatusLight, setStatusLight } from '../status-light';
import type { SettingsContext } from './context';
import { addAdvancedSection, addNumberSetting, parseLimit } from './llm-section';
import { addListSetting, cleanFolder } from './reminder-section';
import { openFolder } from './skills-section';

// 링크 → 임베딩 서버 / 인덱스.
// 임베딩 서버는 챗봇 LLM 서버와 따로 둡니다. 사내 API든 직접 띄운 자체 서버(llama-server·Ollama 등)든
// OpenAI 호환 /embeddings만 열려 있으면 주소·키·모델만 넣으면 됩니다.

const defaults = DEFAULT_SETTINGS.link;

// 불러온 모델 이름 중 입력한 글자가 들어간 것만 보여 줍니다. 고르면 입력칸에 넣고 onChange(저장)를 부릅니다.
class ModelSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private modelInput: HTMLInputElement,
		private getModels: () => string[],
	) {
		super(app, modelInput);
		this.limit = 0; // 모델이 100개를 넘어도 전부 보여 줍니다(제안 창은 스크롤됨).
	}

	getSuggestions(query: string): string[] {
		const lower = query.toLowerCase();
		return this.getModels().filter((id) => id.toLowerCase().includes(lower));
	}

	renderSuggestion(id: string, el: HTMLElement): void {
		el.setText(id);
	}

	selectSuggestion(id: string): void {
		this.modelInput.value = id;
		this.modelInput.dispatchEvent(new Event('input'));
		this.close();
	}
}

export function renderLinkServerSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const strings = ctx.strings.link;
	const link = ctx.plugin.settings.link;
	const language = ctx.plugin.settings.general.language;
	const serverKey = () => JSON.stringify([link.baseUrl, link.apiKey, link.model]);

	containerEl.createEl('p', { text: strings.serverIntro });
	containerEl.createEl('p', { cls: 'intra-copilot-privacy-note', text: strings.privacyNote });

	// 주소·키·모델을 고치면 이전 확인 결과는 믿을 수 없으므로 되돌립니다(아래에서 상태등을 만든 뒤 채움).
	let resetStatus = () => {};
	const addServerText = (key: 'baseUrl' | 'apiKey' | 'model', name: string, desc: string) => {
		let input!: HTMLInputElement;
		const setting = new Setting(containerEl)
			.setName(name)
			.setDesc(desc)
			.addText((text) => {
				input = text.inputEl;
				text.setValue(link[key]).onChange((value) => {
					link[key] = value.trim();
					resetStatus();
					ctx.saveSoon();
				});
			});
		return { setting, input };
	};

	addServerText('baseUrl', strings.baseUrlName, strings.baseUrlDesc).input.placeholder = strings.baseUrlPlaceholder;
	addServerText('apiKey', strings.apiKeyName, strings.apiKeyDesc).input.type = 'password';

	// 모델은 직접 입력하거나, 목록을 불러온 뒤 입력칸의 제안에서 고릅니다. /models를 열지 않는 서버도 있어서입니다.
	// datalist는 Obsidian(Electron)에서 목록이 길면 창 밖 부분을 스크롤할 수 없어 Obsidian 제안 창을 씁니다.
	const model = addServerText('model', strings.modelName, strings.modelDesc);
	let modelIds: string[] = [];
	new ModelSuggest(ctx.plugin.app, model.input, () => modelIds);
	const modelStatus = createStatusLight(model.setting.descEl, strings.statusIdle);
	model.setting.addButton((button) =>
		button.setButtonText(strings.modelListButton).onClick(async () => {
			if (!link.baseUrl) {
				setStatusLight(modelStatus.dot, modelStatus.text, 'idle', strings.fillFirst);
				return;
			}
			const key = serverKey();
			button.setButtonText(strings.loadingModels).setDisabled(true);
			const result = await listLlmModels(link);
			button.setButtonText(strings.modelListButton).setDisabled(false);
			if (key !== serverKey()) return;
			if (!result.ok) {
				const { summary, detail } = describeLinkError(language, result);
				setStatusLight(modelStatus.dot, modelStatus.text, 'error', summary, detail);
				return;
			}
			modelIds = [...result.models].sort((a, b) => a.localeCompare(b));
			if (result.models.length === 0) {
				setStatusLight(modelStatus.dot, modelStatus.text, 'error', strings.noModels);
			} else {
				setStatusLight(
					modelStatus.dot,
					modelStatus.text,
					'ok',
					strings.modelsLoaded.replace('{count}', String(result.models.length)),
				);
			}
		}),
	);

	const test = new Setting(containerEl).setName(strings.testName).setDesc(strings.testDesc);
	const testStatus = createStatusLight(test.descEl, strings.statusIdle);
	test.addButton((button) =>
		button.setButtonText(strings.testButton).onClick(async () => {
			if (!link.baseUrl || !link.model) {
				setStatusLight(testStatus.dot, testStatus.text, 'idle', strings.fillFirst);
				return;
			}
			const key = serverKey();
			button.setButtonText(strings.testing).setDisabled(true);
			// 링크 창 머리줄 상태등도 이 결과로 함께 바뀝니다.
			const result = await ctx.plugin.linkIndex.checkServer();
			button.setButtonText(strings.testButton).setDisabled(false);
			if (key !== serverKey()) return;
			if (result.ok) {
				const dims = String(result.vectors[0]?.length ?? 0);
				setStatusLight(testStatus.dot, testStatus.text, 'ok', strings.testOk.replace('{dims}', dims));
			} else {
				const { summary, detail } = describeLinkError(language, result);
				setStatusLight(testStatus.dot, testStatus.text, 'error', summary, detail);
			}
		}),
	);

	resetStatus = () => {
		setStatusLight(modelStatus.dot, modelStatus.text, 'idle', strings.statusIdle);
		setStatusLight(testStatus.dot, testStatus.text, 'idle', strings.statusIdle);
	};
}

export function renderLinkIndexSection(containerEl: HTMLElement, ctx: SettingsContext): void {
	const { plugin } = ctx;
	const strings = ctx.strings.link;
	const link = plugin.settings.link;

	containerEl.createEl('p', { text: strings.indexIntro });

	const status = new Setting(containerEl).setName(strings.statusName).setDesc(strings.statusDesc);
	const light = createStatusLight(status.descEl, '');
	const buttonSlot = status.controlEl.createDiv();
	let drawnKind = '';
	const draw = () => {
		const state = plugin.linkIndex.state();
		const { text, detail } = describeIndexState(plugin, state);
		const color = indexLight(plugin, state).state;
		setStatusLight(light.dot, light.text, color, text, detail);
		// 버튼은 상태 종류가 바뀔 때만 다시 만듭니다(진행 숫자가 바뀔 때마다 만들면 한 번 눌러 둔 확인이 풀림).
		if (state.kind === drawnKind) return;
		drawnKind = state.kind;
		buttonSlot.empty();
		if (state.kind === 'not-built') {
			addIndexButton(buttonSlot, plugin, state.optionsChanged ? strings.rebuildButton : strings.buildButton);
		}
		if (state.kind === 'ready' || state.kind === 'error') addIndexButton(buttonSlot, plugin, strings.rebuildButton);
	};
	// 설정 화면을 다시 그리면 옛 상태등은 화면에서 빠지므로, 그때 구독도 풉니다.
	const unsubscribe = plugin.linkIndex.subscribe(() => {
		if (!light.dot.isConnected) {
			unsubscribe();
			return;
		}
		draw();
	});
	draw();
	// 고급 설정을 바꾸면 색인이 "다시 만들기 필요"로 바뀌므로, 저장과 함께 색인 상태도 바로 다시 그립니다.
	const indexCtx: SettingsContext = {
		...ctx,
		saveSoon: () => {
			ctx.saveSoon();
			draw();
		},
	};

	// 색인 파일을 지우거나 동기화에서 뺄 때 바로 찾아가도록 위치와 [폴더 열기]를 둡니다.
	const indexPath = plugin.linkIndex.path;
	const indexFolder = indexPath.slice(0, indexPath.lastIndexOf('/'));
	new Setting(containerEl)
		.setName(strings.indexFileName)
		.setDesc(strings.indexFileDesc.replace('{path}', indexPath))
		.addButton((button) =>
			button
				.setButtonText(ctx.strings.skills.openFolderButton)
				.onClick(() => void openFolder(ctx, indexFolder, strings.openFolderFailed)),
		);

	addListSetting(containerEl, ctx, {
		name: strings.excludedFoldersName,
		desc: strings.excludedFoldersDesc,
		get: () => link.excludedFolders,
		set: (value) => (link.excludedFolders = value),
		clean: cleanFolder,
	});
	const addAtLeastOne = (
		parentEl: HTMLElement,
		key: 'batchSize' | 'chunkChars' | 'resultCount' | 'vectorsPerNote',
		name: string,
		desc: string,
		max?: number,
	) =>
		addNumberSetting(parentEl, indexCtx, {
			name,
			desc,
			get: () => link[key],
			set: (value) => (link[key] = value),
			parse: (raw) => Math.min(max ?? Infinity, Math.max(1, parseLimit(raw, defaults[key]))),
			min: 1,
			max,
		});
	addAtLeastOne(containerEl, 'resultCount', strings.resultCountName, strings.resultCountDesc);
	new Setting(containerEl)
		.setName(strings.linkedNotesName)
		.setDesc(strings.linkedNotesDesc)
		.addDropdown((dropdown) =>
			dropdown
				.addOptions({
					show: strings.linkedNotesShow,
					bottom: strings.linkedNotesBottom,
					hide: strings.linkedNotesHide,
				} satisfies Record<LinkedNotesMode, string>)
				.setValue(link.linkedNotes)
				.onChange((value) => {
					link.linkedNotes = value as LinkedNotesMode;
					ctx.saveSoon();
				}),
		);

	// 서버·모델에 맞춰 조절하는 값은 챗봇처럼 고급 설정에 접어 둡니다.
	const advanced = addAdvancedSection(containerEl, ctx.strings.llm.advancedName);
	// 고급 설정을 연 사람이 값을 고치기 전에 보도록 맨 위에 붉은 글씨로 둡니다.
	advanced.createEl('p', { cls: 'intra-copilot-rebuild-warning', text: strings.advancedWarning });
	addAtLeastOne(advanced, 'vectorsPerNote', strings.vectorsPerNoteName, strings.vectorsPerNoteDesc, MAX_VECTORS_PER_NOTE);
	new Setting(advanced)
		.setName(strings.documentFormatName)
		.setDesc(strings.documentFormatDesc)
		.addTextArea((text) => {
			text.setValue(link.documentFormat).onChange((value) => {
				link.documentFormat = value.includes('{text}') ? value : defaults.documentFormat;
				indexCtx.saveSoon();
			});
			text.inputEl.rows = 2;
			// 입력칸에서 벗어나면 실제로 저장된 형식을 보여 줍니다({text}를 지워 기본값으로 돌아간 경우 등).
			text.inputEl.addEventListener('blur', () => {
				text.setValue(link.documentFormat);
			});
		});
	addAtLeastOne(advanced, 'chunkChars', strings.chunkCharsName, strings.chunkCharsDesc);
	addAtLeastOne(advanced, 'batchSize', strings.batchSizeName, strings.batchSizeDesc);
	addNumberSetting(advanced, indexCtx, {
		name: strings.dimensionsName,
		desc: strings.dimensionsDesc,
		get: () => link.dimensions,
		set: (value) => (link.dimensions = value),
		parse: (raw) => parseLimit(raw, defaults.dimensions),
		min: 0,
	});
}
