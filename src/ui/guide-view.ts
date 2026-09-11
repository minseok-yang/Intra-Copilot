import { ItemView, MarkdownRenderer, ViewStateResult, WorkspaceLeaf } from 'obsidian';
import IntraCopilotPlugin from '../main';
import { t } from '../i18n';
import { LICENSE_MD, USER_GUIDE_MD } from '../content/docs';

export const GUIDE_VIEW_TYPE = 'intra-copilot-guide-view';

// 어떤 문서를 보여줄지 이름표만 저장합니다. 예전에는 문서 내용 전체를 창 상태에 넣었는데,
// 그러면 Obsidian이 창 배치를 기억하면서(workspace.json) 내용까지 저장해버려서,
// 플러그인을 업데이트한 뒤에도 옛날 문서가 다시 열릴 수 있었습니다.
// 새 문서(FAQ 등)를 추가할 때는 여기 id와 아래 resolveDoc()에 한 줄씩 추가합니다.
export type GuideDocId = 'guide' | 'license';

interface GuideViewState {
	docId: GuideDocId;
	[key: string]: unknown;
}

function isGuideDocId(value: unknown): value is GuideDocId {
	return value === 'guide' || value === 'license';
}

// 문서 내용은 src/content/docs.ts의 문자열(main.js에 함께 번들)이고, 제목은 현재 표시 언어를 따릅니다.
function resolveDoc(plugin: IntraCopilotPlugin, docId: GuideDocId): { title: string; markdown: string } {
	const strings = t(plugin.settings.general.language);
	switch (docId) {
		case 'license':
			return { title: strings.license.summaryHeading, markdown: LICENSE_MD };
		case 'guide':
			return { title: strings.general.guideName, markdown: USER_GUIDE_MD };
	}
}

// 사용자 가이드/라이선스 상세 같은 정적 문서를, Obsidian 자체의 새 창(팝아웃)에서
// Obsidian의 마크다운 렌더러 그대로 보여줍니다.
export async function openGuideWindow(plugin: IntraCopilotPlugin, docId: GuideDocId): Promise<void> {
	const leaf = plugin.app.workspace.openPopoutLeaf();
	const state: GuideViewState = { docId };
	await leaf.setViewState({ type: GUIDE_VIEW_TYPE, active: true, state });
}

export class GuideView extends ItemView {
	plugin: IntraCopilotPlugin;
	private docId: GuideDocId = 'guide';

	constructor(leaf: WorkspaceLeaf, plugin: IntraCopilotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return GUIDE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return resolveDoc(this.plugin, this.docId).title;
	}

	getIcon(): string {
		return 'file-text';
	}

	getState(): Record<string, unknown> {
		return { docId: this.docId };
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		// 예전 형식(title/markdown)으로 저장된 창이 복원되면 docId가 없으므로 사용자 가이드를 보여줍니다.
		if (state && typeof state === 'object' && 'docId' in state && isGuideDocId(state.docId)) {
			this.docId = state.docId;
		}
		await this.render();
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	private async render(): Promise<void> {
		const container = this.contentEl;
		container.empty();
		container.addClass('intra-copilot-guide-view');

		const { markdown } = resolveDoc(this.plugin, this.docId);
		await MarkdownRenderer.render(this.plugin.app, markdown, container, '', this);
	}
}
