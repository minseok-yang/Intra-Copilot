import { DropdownComponent } from 'obsidian';

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
