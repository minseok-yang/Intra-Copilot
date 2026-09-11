import { Setting } from 'obsidian';

// 목록 행(Setting)에 붙이는 "두 번 눌러 삭제" 버튼입니다. 지난 대화 목록과 스킬 목록이 함께 씁니다.
// 삭제는 되돌릴 수 없으므로, 한 번 누르면 경고 문구·아이콘으로 바뀌고 이 시간 안에 다시 눌러야 지웁니다.
// 시간이 지나면 원래 모습(설명 글 포함)으로 돌아갑니다.
const DELETE_CONFIRM_MS = 4000;

export interface DeleteConfirmLabels {
	deleteTooltip: string; // 평소 상태의 툴팁
	confirmTooltip: string; // 한 번 누른 뒤의 툴팁
	confirmDesc: string; // 한 번 누른 뒤 행 설명 자리에 보여줄 경고 문구
}

export function addDeleteConfirmButton(
	row: Setting,
	restoreDesc: string, // 경고를 되돌릴 때 복원할 원래 설명
	labels: DeleteConfirmLabels,
	onDelete: () => void | Promise<void>,
): void {
	let confirmTimer: number | null = null;
	row.addExtraButton((button) => {
		const reset = () => {
			confirmTimer = null;
			button.setIcon('trash-2').setTooltip(labels.deleteTooltip);
			button.extraSettingsEl.removeClass('intra-copilot-delete-armed');
			row.setDesc(restoreDesc);
		};
		reset();
		button.onClick(async () => {
			if (confirmTimer === null) {
				button.setIcon('alert-triangle').setTooltip(labels.confirmTooltip);
				button.extraSettingsEl.addClass('intra-copilot-delete-armed');
				row.setDesc(labels.confirmDesc);
				confirmTimer = window.setTimeout(reset, DELETE_CONFIRM_MS);
				return;
			}
			window.clearTimeout(confirmTimer);
			confirmTimer = null;
			await onDelete();
		});
	});
}
