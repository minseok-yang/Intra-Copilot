// warning: 쓸 수는 있지만 손볼 것이 있음(예: 커넥터 색인에 아직 반영되지 않은 노트)
export type StatusState = 'idle' | 'ok' | 'warning' | 'error';

// 설정 화면과 챗봇 화면이 공통으로 쓰는 작은 점+문구 상태 표시입니다.
// dot은 "이 상태등이 아직 화면에 있는지"(dot.isConnected)를 보려고 내어 줍니다 — 설정 화면을 다시
// 그리면 옛 상태등이 화면에서 빠지므로, 그때 구독을 푸는 데 씁니다.
export interface StatusLight {
	dot: HTMLElement;
	set(state: StatusState, message: string, detail?: string): void;
}

export function createStatusLight(container: HTMLElement, initialText: string): StatusLight {
	const el = container.createDiv({ cls: 'intra-copilot-status' });
	const dot = el.createSpan({ cls: 'intra-copilot-status-dot' });
	const text = el.createSpan({ cls: 'intra-copilot-status-text', text: initialText });
	return {
		dot,
		set(state, message, detail) {
			setStatusDot(dot, state);
			text.textContent = message;
			if (detail) {
				text.setAttribute('title', detail);
			} else {
				text.removeAttribute('title');
			}
		},
	};
}

// 점 색만 바꿉니다. 긴 문구를 놓을 자리가 없는 챗봇 머리줄은 이것만 씁니다.
export function setStatusDot(dot: HTMLElement, state: StatusState): void {
	dot.toggleClass('is-ok', state === 'ok');
	dot.toggleClass('is-warning', state === 'warning');
	dot.toggleClass('is-error', state === 'error');
}
