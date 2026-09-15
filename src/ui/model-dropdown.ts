import { DropdownComponent } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { listLlmModels, testLlmConnection } from '../llm/client';
import { describeLlmError, t } from '../i18n';
import { StatusState } from './status-light';

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
// 확인하는 동안은 챗봇 머리줄과 설정 화면이 함께 "확인 중"을 보여 줍니다(connectionStatus.track).
export function fetchModelList(plugin: IntraCopilotPlugin): Promise<ModelListOutcome> {
	return plugin.connectionStatus.track(() => fetchModelListNow(plugin));
}

async function fetchModelListNow(plugin: IntraCopilotPlugin): Promise<ModelListOutcome> {
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

	// 챗봇 상태등에는 "연결은 첫 대화나 [연결 확인]으로 확인된다"는 안내를 덧붙입니다(목록 조회만으로는 녹색이 안 되므로).
	const statusMessage =
		outcome.state === 'ok' ? `${outcome.message} · ${strings.modelsOkHint}` : outcome.message;
	plugin.reportConnection('models', snapshot, outcome.state, statusMessage, outcome.detail);
	return outcome;
}

// 선택된 모델에 짧은 테스트 문장을 보내 "실제로 답하는지" 확인하고, 결과를 챗봇 상태등에
// 기록합니다. 설정 화면과 챗봇 머리줄의 [연결 확인] 버튼이 함께 씁니다.
// availableModels를 주면, 선택한 모델이 서버 목록에 없을 때 요청을 보내지 않고 바로 알려줍니다.
// 성공하면 어느 화면에서 눌렀든 "마지막 연결 성공"(settings.llm.lastVerified)도 적어 둡니다.
export function checkSelectedModel(
	plugin: IntraCopilotPlugin,
	availableModels?: string[],
): Promise<CheckOutcome> {
	return plugin.connectionStatus.track(() => checkSelectedModelNow(plugin, availableModels));
}

async function checkSelectedModelNow(
	plugin: IntraCopilotPlugin,
	availableModels?: string[],
): Promise<CheckOutcome> {
	const language = plugin.settings.general.language;
	const strings = t(language).llm;
	const { baseUrl, model } = plugin.settings.llm;
	const snapshot = plugin.connectionSnapshot();

	let outcome: CheckOutcome;
	if (!baseUrl) {
		outcome = { state: 'idle', message: strings.fillBaseUrlFirst };
	} else if (!model) {
		outcome = { state: 'idle', message: strings.statusMissing };
	} else if (availableModels && !availableModels.includes(model)) {
		outcome = { state: 'error', message: strings.modelNotInList };
	} else {
		const result = await testLlmConnection(plugin.settings.llm);
		if (result.ok) {
			const reply = result.reply || t(language).chat.emptyReply;
			outcome = { state: 'ok', message: `${strings.statusOk} · ${strings.statusReplyPrefix}${reply}` };
		} else {
			const { summary, detail } = describeLlmError(language, result);
			outcome = { state: 'error', message: `${strings.statusError} — ${summary}`, detail };
		}
	}

	plugin.reportConnection('chat', snapshot, outcome.state, outcome.message, outcome.detail);
	if (outcome.state === 'ok' && snapshot === plugin.connectionSnapshot()) {
		plugin.settings.llm.lastVerified = { at: new Date().toISOString(), baseUrl, model };
		await plugin.saveSettings(); // 확인이 끝나며(track) 화면들이 다시 그려 이 시각도 보입니다.
	}
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
	const strings = t(plugin.settings.general.language).llm;
	const current = plugin.settings.llm.model;
	// 이름의 영어 abc 순. 목록이 비었으면 저장된 모델이라도 보여줍니다(방금 실패한 직후는 제외).
	const sorted = [...models].sort((a, b) => a.localeCompare(b));
	const list = sorted.length > 0 ? sorted : options.lastState !== 'error' && current ? [current] : [];

	dropdown.selectEl.empty();
	dropdown.addOption('', strings.modelPlaceholder);
	for (const modelId of list) dropdown.addOption(modelId, modelId);
	dropdown.setValue(current && list.includes(current) ? current : '');
	dropdown.onChange(async (value) => {
		plugin.settings.llm.model = value;
		// 새 모델은 아직 대화해본 적이 없으므로, 이전 모델의 녹색불을 그대로 두지 않습니다.
		plugin.connectionStatus.markChanged(strings.statusModelChanged);
		await plugin.saveSettings();
		options.onSelected?.();
	});
}
