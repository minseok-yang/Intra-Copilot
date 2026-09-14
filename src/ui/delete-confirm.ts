import { Setting } from 'obsidian';

// "두 번 눌러 확정" 버튼입니다. 되돌릴 수 없는 일(지난 대화·스킬 삭제, 수정 제안 [모두 적용], 리마인더의 노트 삭제)에 씁니다.
// 한 번 누르면 경고 모습으로 바뀌고, 이 시간 안에 다시 눌러야 실행합니다. 시간이 지나면 원래 모습으로 돌아갑니다.
const CONFIRM_MS = 4000;

export interface DeleteConfirmLabels {
	deleteTooltip: string; // 평소 상태의 툴팁
	confirmTooltip: string; // 한 번 누른 뒤의 툴팁
	confirmDesc: string; // 한 번 누른 뒤 행 설명 자리에 보여줄 경고 문구
}

// 버튼에 연결할 클릭 처리를 만듭니다. look의 arm/reset은 버튼 글자·아이콘 같은 모습만 바꿉니다
// (경고 색 클래스는 여기서 붙이고 뗍니다).
export function confirmTwice(
	buttonEl: HTMLElement,
	look: { arm: () => void; reset: () => void },
	onConfirm: () => void | Promise<void>,
): () => Promise<void> {
	let timer: number | null = null;
	const reset = () => {
		timer = null;
		buttonEl.removeClass('intra-copilot-delete-armed');
		look.reset();
	};
	reset();
	return async () => {
		if (timer === null) {
			buttonEl.addClass('intra-copilot-delete-armed');
			look.arm();
			timer = window.setTimeout(reset, CONFIRM_MS);
			return;
		}
		window.clearTimeout(timer);
		reset();
		await onConfirm();
	};
}

// 목록 행(Setting)에 붙이는 삭제 버튼입니다. 한 번 누르면 행 설명 자리에 경고 문구가 보입니다.
export function addDeleteConfirmButton(
	row: Setting,
	restoreDesc: string, // 경고를 되돌릴 때 복원할 원래 설명
	labels: DeleteConfirmLabels,
	onDelete: () => void | Promise<void>,
): void {
	row.addExtraButton((button) => {
		button.onClick(
			confirmTwice(
				button.extraSettingsEl,
				{
					arm: () => {
						button.setIcon('alert-triangle').setTooltip(labels.confirmTooltip);
						row.setDesc(labels.confirmDesc);
					},
					reset: () => {
						button.setIcon('trash-2').setTooltip(labels.deleteTooltip);
						row.setDesc(restoreDesc);
					},
				},
				onDelete,
			),
		);
	});
}
