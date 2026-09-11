import { ItemView, MarkdownRenderer, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import IntraCopilotPlugin from '../main';

export const GUIDE_VIEW_TYPE = 'intra-copilot-guide-view';

interface GuideViewState {
	title: string;
	markdown: string; // 코드 안에 들어있는 문서 내용(src/content/docs.ts) — 별도 파일 반입이 필요 없습니다.
	[key: string]: unknown;
}

const EMPTY_STATE: GuideViewState = { title: 'Intra Copilot', markdown: '' };

// 사용자 가이드/라이선스 상세 같은 정적 문서를, Obsidian 자체의 새 창(팝아웃)에서
// Obsidian의 마크다운 렌더러 그대로 보여줍니다. 문서 내용은 별도 파일이 아니라
// src/content/docs.ts의 문자열이라 main.js 하나에 함께 번들됩니다.
export async function openGuideWindow(
	plugin: IntraCopilotPlugin,
	state: GuideViewState,
): Promise<void> {
	const leaf = plugin.app.workspace.openPopoutLeaf();
	await leaf.setViewState({ type: GUIDE_VIEW_TYPE, active: true, state });
}

export class GuideView extends ItemView {
	plugin: IntraCopilotPlugin;
	private state: GuideViewState = EMPTY_STATE;

	constructor(leaf: WorkspaceLeaf, plugin: IntraCopilotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GUIDE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.state.title;
	}

	getIcon(): string {
		return 'file-text';
	}

	getState(): Record<string, unknown> {
		return { ...this.state };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		if (state && typeof state === 'object' && 'markdown' in state) {
			const candidate = state as Partial<GuideViewState>;
			this.state = {
				title: candidate.title ?? EMPTY_STATE.title,
				markdown: candidate.markdown ?? '',
			};
		}
		await this.render();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('intra-copilot-guide-view');

		if (!this.state.markdown) return;

		await MarkdownRenderer.render(this.plugin.app, this.state.markdown, container, '', this);
	}
}
