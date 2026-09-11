import { DropdownComponent } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { listLlmModels, testLlmConnection } from '../llm/client';
import { describeLlmError, t } from '../i18n';
import { StatusState } from './status-light';

interface PopulateModelDropdownOptions {
	placeholderText: string;
	currentModel: string;
	// false로 주면 목록이 비었을 때 저장된 모델도 보여주지 않습니다.
	// 방금 연결에 실패한 직후처럼, 예전 결과가 아직 유효한 것처럼 보이면 안 될 때 씁니다.
	allowCurrentFallback?: boolean;
	onSelect: (value: string) => void | Promise<void>;
}

// dropdown을 비우고 모델 목록으로 다시 채웁니다. 이름의 영어 abc 순으로 정렬합니다.
export function populateModelDropdown(
	dropdown: DropdownComponent,
	models: string[],
	options: PopulateModelDropdownOptions,
): void {
	const sorted = [...models].sort((a, b) => a.localeCompare(b));
	const list =
		sorted.length > 0
			? sorted
			: options.allowCurrentFallback !== false && options.currentModel
				? [options.currentModel]
				: [];

	dropdown.selectEl.empty();
	dropdown.addOption('', options.placeholderText);
	for (const modelId of list) {
		dropdown.addOption(modelId, modelId);
	}
	dropdown.setValue(
		options.currentModel && list.includes(options.currentModel) ? options.currentModel : '',
	);
	dropdown.onChange((value) => options.onSelect(value));
}

// 챗봇 화면과 설정 화면이 함께 쓰는 확인 결과입니다.
// 상태등 색(state), 상태 문구(message), 서버 원문(detail — 툴팁/자세한 내용용)을 담습니다.
export interface CheckOutcome {
	state: StatusState;
	message: string;
	detail?: string;
}

export interface ModelListOutcome extends CheckOutcome {
	models: string[];
}

// 모델 목록을 가져오고, 실패하면 챗봇 상태등에도 빨간색으로 기록합니다.
// (성공만으로는 녹색을 켜지 않습니다 — connection-status.ts 참고)
export async function fetchModelList(plugin: IntraCopilotPlugin): Promise<ModelListOutcome> {
	const language = plugin.settings.general.language;
	const strings = t(language).llm;
	const llm = plugin.settings.llm;
	const snapshot = plugin.connectionSnapshot();

	let outcome: ModelListOutcome;
	if (!llm.baseUrl) {
		outcome = { state: 'idle', message: strings.fillBaseUrlFirst, models: [] };
	} else {
		const result = await listLlmModels(llm);
		if (!result.ok) {
			const { summary, detail } = describeLlmError(language, result);
			outcome = {
				state: 'error',
				message: `${strings.fetchFailPrefix}${summary}`,
				detail,
				models: [],
			};
		} else if (result.models.length === 0) {
			outcome = { state: 'error', message: strings.noModelsFound, models: [] };
		} else {
			outcome = {
				state: 'ok',
				message: strings.fetchOk.replace('{count}', String(result.models.length)),
				models: result.models,
			};
		}
	}

	plugin.reportConnection('models', snapshot, outcome.state, outcome.message);
	return outcome;
}

// 선택된 모델에 짧은 테스트 문장을 보내 "실제로 답하는지" 확인하고, 결과를 챗봇 상태등에
// 기록합니다. 설정 화면의 [연결 확인]과 챗봇의 새로고침(↻)이 함께 씁니다.
// availableModels를 주면, 선택한 모델이 서버 목록에 없을 때 요청을 보내지 않고 바로 알려줍니다.
export async function checkSelectedModel(
	plugin: IntraCopilotPlugin,
	availableModels?: string[],
): Promise<CheckOutcome & { reply?: string }> {
	const language = plugin.settings.general.language;
	const strings = t(language).llm;
	const { baseUrl, model } = plugin.settings.llm;
	const snapshot = plugin.connectionSnapshot();

	let outcome: CheckOutcome & { reply?: string };
	if (!baseUrl) {
		outcome = { state: 'idle', message: strings.fillBaseUrlFirst };
	} else if (!model) {
		outcome = { state: 'idle', message: strings.statusMissing };
	} else if (availableModels && !availableModels.includes(model)) {
		outcome = { state: 'error', message: strings.modelNotInList };
	} else {
		const result = await testLlmConnection(plugin.settings.llm);
		if (result.ok) {
			outcome = { state: 'ok', message: strings.statusOk, reply: result.reply };
		} else {
			const { summary, detail } = describeLlmError(language, result);
			outcome = { state: 'error', message: summary, detail };
		}
	}

	plugin.reportConnection(
		'chat',
		snapshot,
		outcome.state,
		outcome.state === 'error' ? `${strings.statusError} — ${outcome.message}` : outcome.message,
	);
	return outcome;
}

// 드롭다운을 채우고, 사용자가 모델을 고르면 설정에 저장합니다.
// 방금 실패한 직후(state가 'error')에는 예전 모델을 유효한 것처럼 보여주지 않습니다.
export function fillModelDropdown(
	plugin: IntraCopilotPlugin,
	dropdown: DropdownComponent,
	models: string[],
	options: { lastState?: StatusState; onSelected?: () => void } = {},
): void {
	populateModelDropdown(dropdown, models, {
		placeholderText: t(plugin.settings.general.language).llm.modelPlaceholder,
		currentModel: plugin.settings.llm.model,
		allowCurrentFallback: options.lastState !== 'error',
		onSelect: async (value) => {
			plugin.settings.llm.model = value;
			// 새 모델은 아직 대화해본 적이 없으므로, 이전 모델의 녹색불을 그대로 두지 않습니다.
			plugin.connectionStatus.markChanged(
				t(plugin.settings.general.language).llm.statusModelChanged,
			);
			await plugin.saveSettings();
			options.onSelected?.();
		},
	});
}
