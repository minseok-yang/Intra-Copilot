// 'obsidian' 모듈을 대신하는 최소한의 가짜입니다. connector-index.ts를 Node에서 돌리기 위해 씁니다.
export class TFile {
	stat: { mtime: number; ctime: number; size: number };
	constructor(
		public path: string,
		mtime: number,
	) {
		this.stat = { mtime, ctime: mtime, size: 0 };
	}
	get extension(): string {
		return this.path.split('.').pop() ?? '';
	}
	get basename(): string {
		return this.path.split('/').pop()!.replace(/\.md$/, '');
	}
}

// 알림은 화면이 없는 테스트에서는 할 일이 없습니다. 무엇을 알렸는지 보고 싶으면 messages를 읽으세요.
export const notices: string[] = [];
export class Notice {
	constructor(message: string) {
		notices.push(message);
	}
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/';
}

export function getFrontMatterInfo(content: string): { contentStart: number } {
	const match = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/.exec(content);
	return { contentStart: match ? match[0].length : 0 };
}

type Debounced = ((...args: unknown[]) => void) & { run: () => void; cancel: () => void };
export const debounceTimers = new Set<Debounced>();
export function debounce(fn: (...args: unknown[]) => void, ms: number): Debounced {
	let timer: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: unknown[] = [];
	const wrapped = ((...args: unknown[]) => {
		lastArgs = args;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			fn(...lastArgs);
		}, ms);
	}) as Debounced;
	wrapped.run = () => {
		if (!timer) return;
		clearTimeout(timer);
		timer = null;
		fn(...lastArgs);
	};
	wrapped.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = null;
	};
	debounceTimers.add(wrapped);
	return wrapped;
}

export async function requestUrl(): Promise<never> {
	throw new Error('requestUrl is not available in tests (use http:// servers)');
}
