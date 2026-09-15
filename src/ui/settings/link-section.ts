import { Setting } from 'obsidian';
import { createEmbeddings, listLlmModels } from '../../llm/client';
import { describeLinkError } from '../../i18n';
import { DEFAULT_SETTINGS, MAX_VECTORS_PER_NOTE } from '../../settings';
import { addIndexButton, describeIndexState } from '../link-view';
import { createStatusLight, setStatusLight } from '../status-light';
import type { SettingsContext } from './context';
import { addAdvancedSection, addNumberSetting, parseLimit } from './llm-section';
import { addListSetting, cleanFolder } from './reminder-section';

// 링크 → 임베딩 서버 / 인덱스.
// 임베딩 서버는 챗봇 LLM 서버와 따로 둡니다. 사내 API든 직접 띄운 자체 서버(llama-server·Ollama 등)든
// OpenAI 호환 /embeddings만 열려 있으면 주소·키·모델만 넣으면 됩니다.

const defaults = DEFAULT_SETTINGS.link;
// [연결 확인] 때 보내는 고정 문장입니다. 노트 내용은 보내지 않습니다.
const TEST_TEXT = 'connection test';

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

	// 모델은 직접 입력하거나, 목록을 불러온 뒤 입력칸의 제안(datalist)에서 고릅니다. /models를 열지 않는 서버도 있어서입니다.
	const model = addServerText('model', strings.modelName, strings.modelDesc);
	const modelList = containerEl.createEl('datalist', { attr: { id: 'intra-copilot-embedding-models' } });
	model.input.setAttribute('list', modelList.id);
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
			modelList.empty();
			for (const id of [...result.models].sort((a, b) => a.localeCompare(b))) {
				modelList.createEl('option', { attr: { value: id } });
			}
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
			const result = await createEmbeddings(link, [TEST_TEXT]);
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
		const color = state.kind === 'error' ? 'error' : state.kind === 'ready' ? 'ok' : 'idle';
		setStatusLight(light.dot, light.text, color, text, detail);
		// 버튼은 상태 종류가 바뀔 때만 다시 만듭니다(진행 숫자가 바뀔 때마다 만들면 한 번 눌러 둔 확인이 풀림).
		if (state.kind === drawnKind) return;
		drawnKind = state.kind;
		buttonSlot.empty();
		if (state.kind === 'not-built') addIndexButton(buttonSlot, plugin, strings.buildButton);
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
		addNumberSetting(parentEl, ctx, {
			name,
			desc,
			get: () => link[key],
			set: (value) => (link[key] = value),
			parse: (raw) => Math.min(max ?? Infinity, Math.max(1, parseLimit(raw, defaults[key]))),
			min: 1,
			max,
		});
	addAtLeastOne(containerEl, 'resultCount', strings.resultCountName, strings.resultCountDesc);

	// 서버·모델에 맞춰 조절하는 값은 챗봇처럼 고급 설정에 접어 둡니다.
	const advanced = addAdvancedSection(containerEl, ctx.strings.llm.advancedName);
	addAtLeastOne(advanced, 'vectorsPerNote', strings.vectorsPerNoteName, strings.vectorsPerNoteDesc, MAX_VECTORS_PER_NOTE);
	addAtLeastOne(advanced, 'chunkChars', strings.chunkCharsName, strings.chunkCharsDesc);
	addAtLeastOne(advanced, 'batchSize', strings.batchSizeName, strings.batchSizeDesc);
}
