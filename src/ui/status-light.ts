export type StatusState = 'idle' | 'ok' | 'error';

// 설정 화면과 챗봇 화면이 공통으로 쓰는 작은 점+문구 상태 표시입니다.
export function createStatusLight(
	container: HTMLElement,
	initialText: string,
): { el: HTMLElement; dot: HTMLElement; text: HTMLElement } {
	const el = container.createDiv({ cls: 'intra-copilot-status' });
	const dot = el.createSpan({ cls: 'intra-copilot-status-dot' });
	const text = el.createSpan({ cls: 'intra-copilot-status-text', text: initialText });
	return { el, dot, text };
}

export function setStatusLight(
	dot: HTMLElement,
	text: HTMLElement,
	state: StatusState,
	message: string,
	detail?: string,
): void {
	setStatusDot(dot, state);
	text.textContent = message;
	if (detail) {
		text.setAttribute('title', detail);
	} else {
		text.removeAttribute('title');
	}
}

// 점 색만 바꿉니다. 긴 문구를 놓을 자리가 없는 챗봇 머리줄은 이것만 씁니다.
export function setStatusDot(dot: HTMLElement, state: StatusState): void {
	dot.toggleClass('is-ok', state === 'ok');
	dot.toggleClass('is-error', state === 'error');
}
