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
	dot.classList.remove('is-ok', 'is-error');
	if (state !== 'idle') {
		dot.classList.add(state === 'ok' ? 'is-ok' : 'is-error');
	}

	text.textContent = message;
	if (detail) {
		text.setAttribute('title', detail);
	} else {
		text.removeAttribute('title');
	}
}

// 긴 문구를 놓을 자리가 없을 때 쓰는 점 하나짜리 버전입니다(챗봇 머리줄).
// 상태 설명은 부르는 쪽에서 점 옆의 짧은 글자와 툴팁으로 보여줍니다.
export function createStatusDot(container: HTMLElement): HTMLElement {
	return container.createSpan({ cls: 'intra-copilot-status-dot' });
}

export function setStatusDot(dot: HTMLElement, state: StatusState): void {
	dot.classList.remove('is-ok', 'is-error');
	if (state !== 'idle') {
		dot.classList.add(state === 'ok' ? 'is-ok' : 'is-error');
	}
}
