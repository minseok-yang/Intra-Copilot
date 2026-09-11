import {
	ButtonComponent,
	DropdownComponent,
	ExtraButtonComponent,
	ItemView,
	MarkdownRenderer,
	Notice,
	setIcon,
	setTooltip,
	ViewStateResult,
	WorkspaceLeaf,
} from 'obsidian';
import IntraCopilotPlugin from '../main';
import { sendChatMessage } from '../llm/client';
import { describeLlmError, t } from '../i18n';
import { UiLanguage } from '../settings';
import { createStatusDot, setStatusDot, StatusState } from './status-light';
import { checkSelectedModel, fetchModelList, fillModelDropdown } from './model-dropdown';
import {
	deleteSession,
	deriveSessionTitle,
	loadSession,
	newSessionId,
	saveSession,
	StoredMessage,
} from '../chat/session-store';
import { finalizeRenderedAnswer, neutralizeRemoteContent } from '../chat/safe-markdown';
import {
	AttachedInfo,
	buildVaultContext,
	ChatTarget,
	isRemovedBy,
	renamedTarget,
	resolveTarget,
	sameTarget,
	VaultContext,
} from '../chat/vault-context';
import { composeRequestConversation } from '../chat/request-builder';
import { listSkills, Skill } from '../skills/skill-store';
import { SessionHistoryModal } from './session-history-modal';
import { InlinePicker } from './inline-picker';
import { buildSkillItems, buildTargetItems, createSkillChip, createTargetChip } from './picker-items';

export const CHAT_VIEW_TYPE = 'intra-copilot-chat-view';

// 맨 아래에서 이만큼(px) 안쪽을 보고 있으면 "맨 아래를 보는 중"으로 봅니다.
const NEAR_BOTTOM_PX = 80;
// 긴 답변의 시작 부분으로 옮길 때 위쪽에 남겨 둘 여백(px)
const ANSWER_TOP_MARGIN_PX = 8;

// 리본 아이콘 클릭 등에서 호출합니다. 이미 열려 있으면 그 탭을 보여주고,
// 없으면 오른쪽 사이드바에 새로 엽니다.
export async function revealChatView(plugin: IntraCopilotPlugin): Promise<void> {
	const { workspace } = plugin.app;
	const existing = workspace.getLeavesOfType(CHAT_VIEW_TYPE);

	let leaf: WorkspaceLeaf | null;
	if (existing.length > 0) {
		leaf = existing[0]!;
	} else {
		leaf = workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
		}
	}

	if (leaf) {
		await workspace.revealLeaf(leaf);
	}
}

// 설정 화면에서 모델·언어·서버 주소가 바뀌었을 때 호출합니다. 열려 있는 챗봇 화면이
// 바뀐 설정을 바로 반영하게 합니다(드롭다운 선택값, 표시 언어, 모델 목록).
export function refreshChatViews(plugin: IntraCopilotPlugin): void {
	for (const leaf of plugin.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)) {
		if (leaf.view instanceof ChatView) {
			leaf.view.onSettingsChanged();
		}
	}
}

// Obsidian이 창 배치(workspace.json)에 저장해 둔 값에서 대화 id를 꺼냅니다.
function readSessionId(state: unknown): string | null {
	if (state && typeof state === 'object' && 'sessionId' in state) {
		const { sessionId } = state;
		return typeof sessionId === 'string' && sessionId ? sessionId : null;
	}
	return null;
}

export class ChatView extends ItemView {
	plugin: IntraCopilotPlugin;
	private conversation: StoredMessage[] = [];
	// 지금 진행 중인 대화를 conversations/ 폴더의 어느 파일에 저장할지입니다.
	// null이면 아직 아무것도 주고받지 않은, 저장할 필요 없는 새 대화입니다.
	// 이 값은 Obsidian 창 배치에도 기억되어서, Obsidian을 다시 켜면 보던 대화가 다시 열립니다.
	private currentSessionId: string | null = null;
	private currentSessionCreatedAt: string | null = null;
	// 화면이 아직 만들어지기 전에 복원할 대화 id가 먼저 도착하면 여기 잠시 보관합니다.
	private pendingRestoreId: string | null = null;
	private layoutBuilt = false;

	// 답변을 기다리는 중인지. 이 동안에는 새 대화/지난 대화 버튼을 잠가서,
	// 도착한 답변이 엉뚱한 대화에 섞이지 않게 합니다. 입력칸은 열어 두어 다음 질문을 미리 쓸 수 있습니다.
	private busy = false;
	// [중지]를 누르면 중단시키는 컨트롤러. 답변을 기다리는 동안에만 채워집니다.
	private abortController: AbortController | null = null;
	// 기다리는 동안 언어가 바뀌면 화면을 다시 그리는 걸 답변이 온 뒤로 미룹니다.
	private rebuildAfterReply = false;
	// 파일 저장을 순서대로 하나씩 처리합니다(나중 저장이 먼저 끝나 옛 내용으로 덮어쓰는 일 방지).
	private saveChain: Promise<void> = Promise.resolve();

	// 모델 목록 상태. 화면을 다시 그려도 서버에 다시 묻지 않고 이 값으로 드롭다운을 채웁니다.
	private availableModels: string[] = [];
	private lastModelState: StatusState = 'idle';
	// 마지막으로 모델 목록을 확인한 서버 주소+키. 설정에서 이게 바뀌면 목록을 다시 불러옵니다.
	private checkedConnectionKey: string | null = null;
	// 모델 목록 확인의 번호표. 확인이 겹쳤을 때(예: 옛 주소 확인이 30초 매달린 사이 주소를 고침)
	// 늦게 도착한 옛 결과가 새 결과를 덮어쓰지 않도록, 가장 최근 번호의 결과만 반영합니다.
	private modelCheckSeq = 0;
	private renderedLanguage: UiLanguage | null = null;
	// 입력칸에서 @로 지정한 폴더·노트. 지우기 전까지 계속 유지되어, 이어지는 질문마다 그 내용이 붙습니다.
	private targets: ChatTarget[] = [];
	// 입력칸에서 /로 고른 스킬. 대상과 달리 한 번 보내면 풀립니다.
	private selectedSkill: Skill | null = null;
	// 보낸 메시지를 수정하는 중이면 그 메시지의 위치(conversation 안의 번호). 보내는 순간 이 위치부터
	// 아래 대화를 버리고 새 메시지로 바꿉니다. [취소]하면 아무것도 지우지 않습니다.
	private editingIndex: number | null = null;
	// 수정을 시작하기 전 입력칸 상태. [취소]하면 되돌립니다.
	private editBackup: { text: string; skill: Skill | null; targets: ChatTarget[] } | null = null;
	// 메시지 → 화면의 말풍선. 수정 중 표시(점선·흐리게)를 붙일 때 씁니다.
	private bubbleByMessage = new WeakMap<StoredMessage, HTMLElement>();
	private editBannerEl!: HTMLElement;

	private messagesEl!: HTMLElement;
	private targetChipsEl!: HTMLElement;
	private picker!: InlinePicker;
	private inputEl!: HTMLTextAreaElement;
	private sendButtonEl!: HTMLButtonElement;
	private newChatButton!: ButtonComponent;
	private historyButton!: ButtonComponent;
	private checkButton!: ButtonComponent;
	private modelDropdown!: DropdownComponent;
	private modelStatusEl!: HTMLElement; // 상태등 + 상태 글자 묶음(마우스를 올리면 자세한 설명)
	private modelStatusDot!: HTMLElement;
	private modelStatusLabel!: HTMLElement;
	// 모델 목록·연결을 확인하는 중인지. 이 동안 상태 글자를 "확인 중"으로 보여줍니다.
	private checking = false;

	constructor(leaf: WorkspaceLeaf, plugin: IntraCopilotPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CHAT_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.strings().title;
	}

	getIcon(): string {
		return 'bot';
	}

	getState(): Record<string, unknown> {
		const state = super.getState();
		if (this.currentSessionId) state.sessionId = this.currentSessionId;
		return state;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const id = readSessionId(state);
		if (id && id !== this.currentSessionId) {
			if (!this.layoutBuilt) {
				this.pendingRestoreId = id;
			} else if (!this.busy) {
				await this.loadSessionById(id, { silent: true });
			}
		}
		await super.setState(state, result);
	}

	async onOpen(): Promise<void> {
		this.buildLayout();
		this.layoutBuilt = true;
		this.showEmptyState();
		if (this.pendingRestoreId) {
			const id = this.pendingRestoreId;
			this.pendingRestoreId = null;
			// 파일이 지워졌다면 조용히 빈 대화로 시작합니다.
			await this.loadSessionById(id, { silent: true });
		}
		// 설정 화면의 연결 확인 등 어디서든 연결 상태가 바뀌면 상태등을 다시 그립니다.
		// register()에 넣어두면 패널이 닫힐 때 자동으로 등록이 풀립니다.
		this.register(this.plugin.connectionStatus.subscribe(() => this.renderStatusDot()));
		// @로 지정한 폴더·노트의 이름이 바뀌거나 지워지면 칩도 따라 바꿉니다.
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => this.handleVaultRename(oldPath, file.path)),
		);
		this.registerEvent(this.app.vault.on('delete', (file) => this.handleVaultDelete(file.path)));
		// 패널을 열면(= Obsidian을 켤 때마다) 가벼운 모델 목록 조회만 한 번 합니다.
		// 테스트 대화는 보내지 않습니다 — 사용자 수 × 실행 횟수만큼 공용 서버 GPU를 쓰기 때문입니다.
		void this.refreshModels({ testModel: false });
	}

	async onClose(): Promise<void> {
		// 답변을 기다리는 중에 패널을 닫아도 요청은 계속 진행되고,
		// 답이 오면 handleSend가 파일에는 저장합니다(화면만 없을 뿐).
	}

	onSettingsChanged(): void {
		if (this.plugin.settings.general.language !== this.renderedLanguage) {
			if (this.busy) {
				this.rebuildAfterReply = true;
			} else {
				void this.rebuild();
			}
			// 언어만 바뀐 경우 서버에는 다시 묻지 않습니다(상태 문구는 다음 확인 때 새 언어로 바뀜).
			return;
		}
		if (this.plugin.serverSnapshot() !== this.checkedConnectionKey) {
			void this.refreshModels({ testModel: false });
			return;
		}
		// 모델 선택만 바뀐 경우: 서버에 묻지 않고 드롭다운 선택값만 맞춥니다.
		this.fillDropdown();
	}

	private strings() {
		return t(this.plugin.settings.general.language).chat;
	}

	// 머리줄(버튼들) + 메시지 영역 + 입력줄을 새로 만듭니다. 언어가 바뀌면 다시 호출됩니다.
	private buildLayout(): void {
		const strings = this.strings();
		const draft = this.inputEl?.value ?? '';
		this.renderedLanguage = this.plugin.settings.general.language;

		const container = this.contentEl;
		container.empty();
		container.addClass('intra-copilot-chat-view');

		// 머리줄: 왼쪽은 대화에 관한 버튼([새 대화] [지난 대화]), 오른쪽은 서버 연결에 관한 것
		// (모델 선택 · [연결 확인] · 상태등). 모델 선택은 설정 화면과 완전히 같은 값(settings.llm.model)을
		// 공유합니다 — 여기서 바꾸면 설정에도 반영됩니다. 사이드바가 좁으면 오른쪽 묶음이 아래 줄로 내려갑니다.
		const header = container.createDiv({ cls: 'intra-copilot-chat-header' });
		const conversationGroup = header.createDiv({ cls: 'intra-copilot-chat-header-group' });
		const connectionGroup = header.createDiv({
			cls: 'intra-copilot-chat-header-group is-connection',
		});

		this.newChatButton = this.createHeaderButton(
			conversationGroup,
			'plus',
			strings.newChatButton,
			strings.newChatTooltip,
			() => {
				if (this.warnIfBusy()) return;
				this.startNewConversation();
			},
		);

		this.historyButton = this.createHeaderButton(
			conversationGroup,
			'history',
			strings.historyButton,
			strings.historyTooltip,
			() => {
				if (this.warnIfBusy()) return;
				new SessionHistoryModal(this.plugin.app, this.plugin, {
					onSelect: (id) => void this.loadSessionById(id),
					onDelete: (id) => this.handleSessionDeleted(id),
				}).open();
			},
		);

		this.modelDropdown = new DropdownComponent(connectionGroup);
		this.fillDropdown();

		this.checkButton = this.createHeaderButton(
			connectionGroup,
			'refresh-cw',
			strings.checkConnectionButton,
			strings.checkConnectionTooltip,
			() => void this.refreshModels({ testModel: true }),
		);

		// 상태등만 있으면 무슨 뜻인지 알기 어려워서, 옆에 지금 상태를 짧은 글자로 함께 보여줍니다.
		this.modelStatusEl = connectionGroup.createSpan({ cls: 'intra-copilot-chat-status' });
		this.modelStatusDot = createStatusDot(this.modelStatusEl);
		this.modelStatusLabel = this.modelStatusEl.createSpan({ cls: 'intra-copilot-chat-status-label' });
		this.renderStatusDot();

		this.messagesEl = container.createDiv({ cls: 'intra-copilot-chat-messages' });

		// 입력 영역: [지정한 대상 칩] 줄 + [입력칸·보내기] 줄. @ 목록은 이 영역 위에 뜹니다.
		const composer = container.createDiv({ cls: 'intra-copilot-chat-composer' });
		this.editBannerEl = composer.createDiv({ cls: 'intra-copilot-edit-banner' });
		this.renderEditBanner();
		this.targetChipsEl = composer.createDiv({ cls: 'intra-copilot-target-chips' });
		const inputRow = composer.createDiv({ cls: 'intra-copilot-chat-input-row' });
		this.inputEl = inputRow.createEl('textarea', {
			cls: 'intra-copilot-chat-input',
			attr: { placeholder: strings.inputPlaceholder, rows: '2' },
		});
		this.inputEl.value = draft;
		this.sendButtonEl = inputRow.createEl('button', { cls: 'intra-copilot-chat-send' });
		// @ → 폴더·노트, / → 스킬. 입력칸 하나에 목록 하나를 두고, 커서에 가까운 쪽 글자를 따릅니다.
		this.picker = new InlinePicker(
			this.inputEl,
			composer,
			[
				{
					trigger: '@',
					noMatch: strings.pickerNoMatch,
					loadItems: () =>
						buildTargetItems(
							this.app,
							{ wholeVault: strings.pickerWholeVault, currentNote: strings.pickerCurrentNote },
							(target) => this.addTarget(target),
						),
				},
				{
					trigger: '/',
					noMatch: strings.skillPickerNoMatch,
					// 스킬 파일을 사내에서 직접 고칠 수도 있어서, 목록을 열 때마다 폴더를 새로 읽습니다.
					// 지시문이 빈 스킬은 보내도 의미가 없으므로 목록에서 뺍니다.
					loadItems: async () =>
						buildSkillItems(
							(await listSkills(this.plugin)).filter((skill) => skill.instructions),
							(skill) => {
								this.setSkill(skill);
								this.inputEl.focus();
							},
						),
				},
			],
			strings.pickerHint,
		);
		this.renderComposerChips();

		// 기다리는 동안에는 같은 버튼이 [중지]가 됩니다.
		this.sendButtonEl.onclick = () => {
			if (this.busy) {
				this.abortController?.abort();
			} else {
				void this.handleSend();
			}
		};
		this.inputEl.addEventListener('keydown', (evt) => {
			// 한글처럼 조합해서 입력하는 언어(IME)에서는 글자를 확정할 때도 Enter가 눌립니다.
			// 이때 전송해버리면 "안녕하세" 같은 미완성 문장이 날아가므로 조합 중에는 무시합니다.
			if (evt.isComposing) return;
			// @ 목록이 열려 있으면 ↑↓·Enter·Esc는 목록 조작에 먼저 씁니다.
			if (this.picker.handleKeydown(evt)) return;
			// 메시지를 수정하는 중이면 Esc로 수정을 취소합니다.
			if (evt.key === 'Escape' && this.editingIndex !== null) {
				evt.preventDefault();
				this.cancelEditing();
				return;
			}
			// 입력칸이 비어 있을 때 Backspace를 누르면 마지막 칩을 지웁니다.
			if (
				evt.key === 'Backspace' &&
				this.inputEl.value === '' &&
				(this.targets.length > 0 || this.selectedSkill)
			) {
				evt.preventDefault();
				if (this.targets.length > 0) this.setTargets(this.targets.slice(0, -1));
				else this.setSkill(null);
				return;
			}
			if (evt.key === 'Enter' && !evt.shiftKey) {
				evt.preventDefault();
				// 기다리는 중에는 써 둔 글을 그대로 두고 안내만 합니다.
				if (this.warnIfBusy()) return;
				void this.handleSend();
			}
		});

		this.applyBusyState();
	}

	// 머리줄 버튼: 아이콘 + 글자. ButtonComponent.setIcon()은 글자를 지워버려서 둘을 직접 넣습니다
	// (설정 화면의 [고급 설정] 버튼과 같은 방식).
	private createHeaderButton(
		parent: HTMLElement,
		icon: string,
		label: string,
		tooltip: string,
		onClick: () => void,
	): ButtonComponent {
		const button = new ButtonComponent(parent).setTooltip(tooltip).onClick(onClick);
		button.buttonEl.empty();
		button.buttonEl.addClass('intra-copilot-header-button');
		setIcon(button.buttonEl.createSpan({ cls: 'intra-copilot-header-button-icon' }), icon);
		button.buttonEl.createSpan({ text: label });
		return button;
	}

	// 언어가 바뀌었을 때: 틀을 새로 만들고 지금 대화를 다시 그립니다.
	private async rebuild(): Promise<void> {
		this.buildLayout();
		await this.renderConversation();
	}

	private warnIfBusy(): boolean {
		if (this.busy) new Notice(this.strings().busyNotice);
		return this.busy;
	}

	private isConfigured(): boolean {
		const { baseUrl, model } = this.plugin.settings.llm;
		return Boolean(baseUrl && model);
	}

	private setBusy(busy: boolean): void {
		this.busy = busy;
		this.applyBusyState();
	}

	private applyBusyState(): void {
		const strings = this.strings();
		this.sendButtonEl.setText(this.busy ? strings.stopButton : strings.sendButton);
		this.sendButtonEl.toggleClass('mod-warning', this.busy);
		setTooltip(this.sendButtonEl, this.busy ? strings.stopTooltip : strings.sendTooltip);
		this.newChatButton.setDisabled(this.busy);
		this.historyButton.setDisabled(this.busy);
		// 잠긴 버튼이 눈에 띄게 흐려지도록 전용 클래스를 붙입니다(styles.css).
		this.newChatButton.buttonEl.toggleClass('intra-copilot-is-busy', this.busy);
		this.historyButton.buttonEl.toggleClass('intra-copilot-is-busy', this.busy);
	}

	// 지금 대화가 어느 파일인지 바꿀 때는 항상 여기를 거칩니다. Obsidian이 창 배치를 저장할 때
	// 이 값도 함께 기억하도록 알려서, 다시 켰을 때 같은 대화가 열리게 합니다.
	private setCurrentSession(id: string | null, createdAt: string | null): void {
		this.currentSessionId = id;
		this.currentSessionCreatedAt = createdAt;
		this.app.workspace.requestSaveLayout();
	}

	// 대화 기록을 지우고 빈 상태로 되돌립니다. 오간 대화가 있었다면 이미 conversations/
	// 폴더에 저장되어 있으므로(handleSend에서 매번 저장) 지난 대화 목록에서 다시 찾을 수 있습니다.
	private startNewConversation(): void {
		this.conversation = [];
		this.setCurrentSession(null, null);
		this.discardEditing();
		this.selectedSkill = null;
		this.setTargets([]);
		this.showEmptyState();
	}

	private showEmptyState(): void {
		this.messagesEl.empty();
		this.messagesEl.createEl('p', {
			cls: 'intra-copilot-chat-empty',
			text: this.strings().emptyState,
		});
	}

	// 지난 대화 목록에서 지금 열려 있는 대화를 지웠다면, 다음 메시지 때 같은 파일이 다시
	// 생기지 않도록 새 대화로 전환합니다.
	private handleSessionDeleted(id: string): void {
		if (id !== this.currentSessionId) return;
		this.startNewConversation();
		new Notice(this.strings().historyCurrentDeleted);
	}

	// "지난 대화" 목록에서 하나를 골랐을 때(또는 Obsidian을 다시 켜서 복원할 때) 그 내용을 불러옵니다.
	// silent이면 불러오지 못해도 알림을 띄우지 않습니다(복원할 파일이 지워진 경우 등).
	private async loadSessionById(id: string, options: { silent?: boolean } = {}): Promise<void> {
		if (options.silent ? this.busy : this.warnIfBusy()) return;
		const session = await loadSession(this.plugin, id);
		if (!session) {
			if (!options.silent) new Notice(this.strings().historyLoadFailed);
			return;
		}

		this.setCurrentSession(session.id, session.createdAt);
		this.discardEditing();
		this.conversation = session.messages;
		// 그 대화에서 마지막으로 지정했던 대상을 칩으로 되살립니다. Obsidian을 막 켰을 때는 볼트 파일 목록이
		// 아직 다 준비되지 않았을 수 있어서 여기서 걸러내지 않고, 보낼 때 있는지 확인합니다(dropMissingTargets).
		const lastUser = [...session.messages].reverse().find((message) => message.role === 'user');
		this.setTargets(lastUser?.targets ?? []);
		await this.renderConversation();
	}

	// this.conversation 전체를 메시지 영역에 다시 그립니다.
	private async renderConversation(): Promise<void> {
		if (this.conversation.length === 0) {
			this.showEmptyState();
			return;
		}
		this.messagesEl.empty();
		for (const message of this.conversation) {
			if (message.role === 'assistant') {
				await this.renderAssistantBubble(this.appendBubble('assistant', ''), message);
			} else if (message.role === 'user') {
				this.appendUserBubble(message);
			}
		}
		this.applyEditHighlight();
		this.scrollToBottom();
	}

	// 답변 말풍선: [생각 과정(접힘)] → 답변(마크다운) → [잘림 안내] → [복사 버튼]
	private async renderAssistantBubble(bubble: HTMLElement, message: StoredMessage): Promise<void> {
		const strings = this.strings();
		this.bubbleByMessage.set(message, bubble);
		bubble.empty();
		bubble.removeClass('is-pending', 'is-error');
		bubble.addClass('is-markdown');

		if (message.reasoning) {
			const details = bubble.createEl('details', { cls: 'intra-copilot-chat-reasoning' });
			details.createEl('summary', { text: strings.reasoningSummary });
			details.createDiv({ cls: 'intra-copilot-chat-reasoning-body', text: message.reasoning });
		}

		// LLM은 보통 마크다운(목록, 굵게, 코드블록)으로 답하므로 그대로 렌더링합니다.
		// 단, 외부 요청을 만들거나 다른 플러그인이 실행할 수 있는 문법은 먼저 무력화합니다(safe-markdown.ts).
		const answerEl = bubble.createDiv({ cls: 'intra-copilot-chat-answer' });
		const content = message.content || strings.emptyReply;
		await MarkdownRenderer.render(
			this.plugin.app,
			neutralizeRemoteContent(content),
			answerEl,
			'',
			this,
		);
		finalizeRenderedAnswer(answerEl, {
			onBlockedLinkClick: (href) => void this.copyToClipboard(href, strings.linkBlockedNotice),
		});

		if (message.truncated) {
			bubble.createDiv({ cls: 'intra-copilot-chat-notice', text: strings.truncatedNotice });
		}

		if (message.content) {
			const actions = bubble.createDiv({ cls: 'intra-copilot-chat-actions' });
			new ExtraButtonComponent(actions)
				.setIcon('copy')
				.setTooltip(strings.copyTooltip)
				.onClick(() => void this.copyToClipboard(message.content));
		}
	}

	private async copyToClipboard(text: string, successNotice?: string): Promise<void> {
		const strings = this.strings();
		try {
			await navigator.clipboard.writeText(text);
			new Notice(successNotice ?? strings.copied);
		} catch {
			new Notice(strings.copyFailed);
		}
	}

	// 파일 저장. 사용자 메시지를 보낼 때, 그리고 답이 도착했을 때 각각 저장해서, 응답을 못 받고
	// Obsidian이 닫히는 경우에도 최소한 사용자가 물어본 내용은 남게 합니다.
	// 어느 대화의 저장인지를 인자로 받으므로, 도중에 화면의 대화가 바뀌어도 원래 파일에 저장됩니다.
	private persistSession(id: string, createdAt: string, messages: StoredMessage[]): void {
		const snapshot = [...messages];
		const emptyTitle = this.strings().emptyTitle;
		this.saveChain = this.saveChain
			.then(async () => {
				if (snapshot.length === 0) {
					// 첫 질문이 실패해서 되돌린 경우 — 빈 대화 파일은 남기지 않습니다.
					await deleteSession(this.plugin, id);
					return;
				}
				await saveSession(this.plugin, {
					id,
					title: deriveSessionTitle(snapshot, emptyTitle),
					createdAt,
					updatedAt: new Date().toISOString(),
					messages: snapshot,
				});
			})
			.catch(() => {
				new Notice(this.strings().saveFailed);
			});
	}

	// ① 모델 목록을 다시 불러오고, testModel이면([연결 확인] 버튼) ② 선택한 모델에 짧은 테스트 문장을 보내
	// 실제로 답하는지까지 확인합니다. 목록에 이름이 있어도 대화가 안 되는 모델(음성·임베딩 등)이 있어서,
	// ②나 실제 대화가 성공해야 상태등이 녹색이 됩니다. 확인하는 동안에는 [연결 확인] 버튼의 아이콘이 돕니다.
	// (두 결과 모두 fetchModelList/checkSelectedModel이 상태등에 직접 기록합니다.)
	private async refreshModels(options: { testModel: boolean }): Promise<void> {
		const seq = ++this.modelCheckSeq;
		this.checkedConnectionKey = this.plugin.serverSnapshot();
		this.setChecking(true);
		try {
			const outcome = await fetchModelList(this.plugin);
			if (seq !== this.modelCheckSeq) return; // 그 사이 더 새로운 확인이 시작됨
			this.availableModels = outcome.models;
			this.lastModelState = outcome.state;
			this.fillDropdown();
			if (options.testModel && outcome.state === 'ok') {
				await checkSelectedModel(this.plugin, outcome.models);
			}
		} finally {
			// 옛 확인이 끝났다고 아이콘을 멈추면, 아직 진행 중인 새 확인이 끝난 것처럼 보입니다.
			if (seq === this.modelCheckSeq) this.setChecking(false);
		}
	}

	private setChecking(checking: boolean): void {
		this.checking = checking;
		this.checkButton.setDisabled(checking);
		this.checkButton.buttonEl.toggleClass('intra-copilot-is-checking', checking);
		this.renderStatusDot();
	}

	private fillDropdown(): void {
		fillModelDropdown(this.plugin, this.modelDropdown, this.availableModels, {
			lastState: this.lastModelState,
		});
	}

	// 상태등과 옆의 상태 글자를 plugin.connectionStatus 값대로 그립니다. 마우스를 올리면
	// 자세한 상태 문구와 마지막으로 확인된 시각을 함께 보여줍니다.
	private renderStatusDot(): void {
		const strings = this.strings();
		const llmStrings = t(this.plugin.settings.general.language).llm;
		const { state, message, checkedAt } = this.plugin.connectionStatus.get();
		const text = message || llmStrings.statusIdle;
		const tooltip = checkedAt
			? `${text} · ${llmStrings.lastVerifiedPrefix}${checkedAt.toLocaleString()}`
			: text;
		setStatusDot(this.modelStatusDot, state, tooltip);
		this.modelStatusEl.setAttribute('title', tooltip);

		// 확인하는 동안에는 이전 결과 대신 "확인 중"을 보여줍니다(상태등 색은 이전 결과 그대로).
		const label = this.checking
			? strings.statusLabelChecking
			: state === 'ok'
				? strings.statusLabelOk
				: state === 'error'
					? strings.statusLabelError
					: strings.statusLabelIdle;
		this.modelStatusLabel.setText(label);
		this.modelStatusLabel.toggleClass('is-error', !this.checking && state === 'error');
	}

	// retry를 주면 입력칸·선택한 스킬 대신 그 내용을 보냅니다([다시 시도] 버튼).
	// 입력칸에 새로 써 둔 글은 건드리지 않습니다.
	private async handleSend(retry?: { text: string; skill: Skill | null }): Promise<void> {
		if (this.busy) return;
		const strings = this.strings();
		const text = (retry ? retry.text : this.inputEl.value).trim();
		const skill = retry ? retry.skill : this.selectedSkill;
		// 메시지 수정 중이었다면 이 위치부터 아래 대화를 버리고 보냅니다([다시 시도]는 해당 없음).
		const editIndex = retry ? null : this.editingIndex;
		// 스킬만 고르고 입력칸은 비운 채 보낼 수도 있습니다.
		if (!text && !skill) return;

		// @로 지정한 대상이 그 사이 지워졌다면, 자료 없이 답하게 두지 않고 먼저 알립니다(입력한 글은 그대로).
		if (!this.dropMissingTargets()) return;

		if (this.conversation.length === 0) {
			this.messagesEl.empty(); // "아직 대화가 없습니다" 문구를 지웁니다.
		}

		if (!this.isConfigured()) {
			this.appendBubble('assistant', strings.notConfigured, { isError: true });
			return;
		}

		this.setBusy(true);

		// 지정한 폴더·노트를 지금 읽습니다. 읽기에 실패하면 입력칸을 비우기 전에 멈춰서 글이 사라지지 않게 합니다.
		const targets = [...this.targets];
		let vaultContext: VaultContext | null = null;
		if (targets.length > 0) {
			try {
				vaultContext = await buildVaultContext(
					this.app,
					targets,
					this.plugin.settings.llm.maxContextChars,
				);
			} catch {
				this.setBusy(false);
				new Notice(strings.contextReadFailed);
				return;
			}
		}

		if (!retry) {
			this.inputEl.value = '';
			this.setSkill(null); // 스킬은 한 번 보내면 풀립니다(@ 대상은 계속 유지).
		}

		if (editIndex !== null) {
			// 수정한 메시지부터 아래 대화를 지우고 화면을 다시 그립니다. 이 뒤로 이어지는 저장에서
			// 대화 파일에서도 지워지고, 서버에는 수정 지점 이전 대화만 갑니다.
			this.discardEditing();
			this.conversation.splice(editIndex);
			await this.renderConversation();
			if (this.conversation.length === 0) this.messagesEl.empty();
		}

		if (!this.currentSessionId || !this.currentSessionCreatedAt) {
			this.setCurrentSession(newSessionId(), new Date().toISOString());
		}

		// 이 요청이 어느 대화에 속하는지 기억해 둡니다. 답이 올 때까지 무슨 일이 있어도
		// 답은 이 대화(이 배열, 이 파일)에만 들어갑니다.
		const conversation = this.conversation;
		const sessionId = this.currentSessionId!;
		const createdAt = this.currentSessionCreatedAt!;

		const userMessage: StoredMessage = {
			role: 'user',
			content: text,
			...(vaultContext ? { targets, attached: vaultContext.info } : {}),
			...(skill ? { skill: { id: skill.id, name: skill.name } } : {}),
		};
		conversation.push(userMessage);
		const userBubble = this.appendUserBubble(userMessage);
		this.persistSession(sessionId, createdAt, conversation);

		const pending = this.appendBubble('assistant', strings.thinking, { isPending: true });

		const snapshot = this.plugin.connectionSnapshot();
		// [중지]를 누르면 이 컨트롤러를 중단합니다. http 서버라면 연결이 실제로 끊기고,
		// https 서버라면 기다리는 것만 그만둡니다(client.ts의 sendHttp 참고).
		const controller = new AbortController();
		this.abortController = controller;
		// 이번에 읽은 노트 내용과 스킬 지시문은 마지막 질문에만 붙여 보냅니다(저장되는 대화에는 넣지 않음).
		const result = await sendChatMessage(
			this.plugin.settings.llm,
			composeRequestConversation(conversation, { context: vaultContext?.text ?? null, skill }),
			controller.signal,
		);
		this.abortController = null;
		const llmStrings = t(this.plugin.settings.general.language).llm;

		this.setBusy(false);
		// 버튼을 잠가두므로 보통은 항상 true지만, 만약을 위해 화면 갱신 여부만 이걸로 판단합니다.
		const stillOnScreen = this.conversation === conversation;

		if (result.ok) {
			const reply: StoredMessage = {
				role: 'assistant',
				content: result.reply,
				...(result.reasoning ? { reasoning: result.reasoning } : {}),
				...(result.truncated ? { truncated: true } : {}),
			};
			conversation.push(reply);
			this.persistSession(sessionId, createdAt, conversation);
			this.plugin.reportConnection('chat', snapshot, 'ok', llmStrings.chatOk);
			if (stillOnScreen) {
				// 그리기 전에 재야 합니다 — 그린 뒤엔 말풍선이 길어져 항상 "위를 보는 중"으로 보입니다.
				const follow = this.isNearBottom();
				await this.renderAssistantBubble(pending, reply);
				if (follow) this.revealAnswer(pending);
			}
		} else {
			// 실패하거나 중지한 질문은 대화에서 되돌립니다. 남겨두면 다음 요청에 user 메시지가 두 번
			// 연속으로 들어가서, 역할 교대 규칙이 엄격한 모델에서는 이후 요청이 전부 실패합니다.
			if (conversation[conversation.length - 1] === userMessage) {
				conversation.pop();
			}
			this.persistSession(sessionId, createdAt, conversation);

			let summary: string;
			let detail = '';
			if (result.kind === 'cancelled') {
				// 사용자가 멈춘 것이라 서버 상태는 알 수 없으므로 상태등은 건드리지 않습니다.
				summary = describeLlmError(this.plugin.settings.general.language, result).summary;
			} else {
				const described = describeLlmError(this.plugin.settings.general.language, result);
				// "답변 대기 시간" 설정은 챗봇 답변에만 적용되므로, 그 안내는 여기서만 덧붙입니다.
				summary =
					result.kind === 'timeout' ? `${described.summary} ${strings.timeoutHint}` : described.summary;
				detail = described.detail;
				// 실패하면 상태등도 빨간색으로 — 말풍선만 빨갛고 상태등은 녹색이면 헷갈립니다.
				this.plugin.reportConnection('chat', snapshot, 'error', `${llmStrings.chatFailPrefix}${summary}`);
			}
			if (stillOnScreen) {
				const follow = this.isNearBottom();
				this.showFailure(userBubble, pending, { text, skill }, summary, detail);
				if (follow) this.revealAnswer(pending);
			}
		}

		if (this.rebuildAfterReply) {
			this.rebuildAfterReply = false;
			await this.rebuild();
		}
		this.inputEl.focus();
	}

	// 실패 표시: 보낸 질문은 흐리게, 오류 말풍선에는 [다시 시도] 버튼.
	// 입력칸이 비어 있으면 질문을 되돌려 놓아서, 고쳐서 다시 보낼 수도 있게 합니다.
	private showFailure(
		userBubble: HTMLElement,
		errorBubble: HTMLElement,
		sent: { text: string; skill: Skill | null },
		summary: string,
		detail: string,
	): void {
		const strings = this.strings();
		const { text, skill } = sent;
		// 대화 기록에서 빠진 질문이라 [수정] 대상이 아닙니다(대신 아래 [다시 시도]를 씁니다).
		userBubble.querySelector('.intra-copilot-chat-actions')?.remove();
		userBubble.addClass('is-failed');
		userBubble.createDiv({ cls: 'intra-copilot-chat-failed-label', text: strings.failedLabel });
		errorBubble.removeClass('is-pending');
		errorBubble.addClass('is-error');
		errorBubble.empty();
		// 원인과 해결 방법을 먼저 보여주고, 서버 원문은 접어둡니다(관리자에게 전달할 때 필요).
		errorBubble.createDiv({ text: `${strings.errorPrefix}${summary}` });
		if (detail) {
			const details = errorBubble.createEl('details', { cls: 'intra-copilot-chat-error-detail' });
			details.createEl('summary', { text: strings.errorDetails });
			details.createDiv({ cls: 'intra-copilot-chat-error-detail-body', text: detail });
		}

		const retryButton = errorBubble.createEl('button', {
			cls: 'intra-copilot-chat-retry',
			text: strings.retryButton,
		});
		retryButton.onclick = () => {
			if (this.warnIfBusy()) return;
			// 그 사이 서버 설정을 지웠다면, 말풍선을 지우기 전에 알려서 질문 글이 사라지지 않게 합니다.
			if (!this.isConfigured()) {
				new Notice(strings.notConfigured);
				return;
			}
			userBubble.remove();
			errorBubble.remove();
			// 실패할 때 입력칸에 되돌려 둔 같은 글이 그대로 있으면 비웁니다(두 번 보내는 것처럼 보이지 않게).
			if (this.inputEl.value.trim() === text) this.inputEl.value = '';
			if (skill && this.selectedSkill?.id === skill.id) this.setSkill(null);
			void this.handleSend({ text, skill });
		};

		if (!this.inputEl.value) {
			this.inputEl.value = text;
		}
		// 스킬도 되돌려 놓아서, 고쳐 보낼 때 다시 고르지 않아도 되게 합니다.
		if (skill && !this.selectedSkill) this.setSkill(skill);
	}

	// 사용자 말풍선: [지정했던 대상 칩 · 첨부 분량] + 질문 글
	private appendUserBubble(message: StoredMessage): HTMLElement {
		const strings = this.strings();
		const bubble = this.appendBubble('user', '');
		if (message.skill || message.targets?.length) {
			const row = bubble.createDiv({ cls: 'intra-copilot-bubble-targets' });
			if (message.skill) createSkillChip(row, message.skill, {});
			for (const target of message.targets ?? []) {
				createTargetChip(row, target, { wholeVaultLabel: strings.pickerWholeVault });
			}
			if (message.attached) {
				row.createSpan({
					cls: 'intra-copilot-bubble-attached',
					text: this.describeAttached(message.attached),
				});
			}
		}
		bubble.appendText(message.content);

		// [수정] — 이 메시지를 고쳐서 이 자리부터 다시 보냅니다. 평소엔 흐리고, 마우스를 올리면 진해집니다.
		const actions = bubble.createDiv({ cls: 'intra-copilot-chat-actions' });
		new ExtraButtonComponent(actions)
			.setIcon('pencil')
			.setTooltip(strings.editTooltip)
			.onClick(() => void this.startEditing(message));

		this.bubbleByMessage.set(message, bubble);
		this.scrollToBottom();
		return bubble;
	}

	// ─── 보낸 메시지 수정 ─────────────────────────────────────────────

	// 수정 시작: 그 메시지의 글·스킬·@ 대상을 입력칸으로 가져옵니다. 대화는 아직 지우지 않습니다.
	private async startEditing(message: StoredMessage): Promise<void> {
		if (this.warnIfBusy()) return;
		const index = this.conversation.indexOf(message);
		if (index < 0 || message.role !== 'user') return;

		if (this.editingIndex === null) {
			this.editBackup = {
				text: this.inputEl.value,
				skill: this.selectedSkill,
				targets: this.targets,
			};
		}
		this.editingIndex = index;
		this.inputEl.value = message.content;
		this.setTargets(message.targets ?? []);

		// 대화 파일에는 스킬 이름만 있으므로, 지금 스킬 폴더에서 같은 스킬을 다시 찾습니다.
		let skill: Skill | null = null;
		if (message.skill) {
			const wanted = message.skill.id;
			try {
				skill = (await listSkills(this.plugin)).find((s) => s.id === wanted && s.instructions) ?? null;
			} catch {
				skill = null;
			}
			if (!skill) new Notice(this.strings().editSkillMissing);
		}
		// 스킬을 찾는 사이 수정을 취소했거나 다른 메시지를 골랐으면 여기서 멈춥니다.
		if (this.editingIndex !== index) return;
		this.setSkill(skill);

		this.renderEditBanner();
		this.applyEditHighlight();
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.inputEl.value.length, this.inputEl.value.length);
	}

	// 수정 취소: 대화는 그대로 두고, 입력칸을 수정 시작 전으로 되돌립니다.
	private cancelEditing(): void {
		if (this.editingIndex === null) return;
		const backup = this.editBackup;
		this.discardEditing();
		if (backup) {
			this.inputEl.value = backup.text;
			this.selectedSkill = backup.skill;
			this.setTargets(backup.targets);
		}
		this.inputEl.focus();
	}

	// 수정 상태만 끝냅니다(입력칸은 건드리지 않음). 보냈을 때, 새 대화·지난 대화로 바꿀 때 씁니다.
	private discardEditing(): void {
		this.editingIndex = null;
		this.editBackup = null;
		this.renderEditBanner();
		this.applyEditHighlight();
	}

	private renderEditBanner(): void {
		const strings = this.strings();
		this.editBannerEl.empty();
		this.editBannerEl.hidden = this.editingIndex === null;
		if (this.editingIndex === null) return;
		const count = this.conversation.length - this.editingIndex;
		setIcon(this.editBannerEl.createSpan({ cls: 'intra-copilot-edit-banner-icon' }), 'pencil');
		this.editBannerEl.createSpan({
			cls: 'intra-copilot-edit-banner-text',
			text: strings.editBanner.replace('{count}', String(count)),
		});
		const cancel = this.editBannerEl.createEl('button', {
			cls: 'intra-copilot-edit-banner-cancel',
			text: strings.editCancel,
		});
		cancel.onclick = () => this.cancelEditing();
	}

	// 고치는 메시지는 점선 테두리, 그 아래(보내면 사라질) 대화는 흐리게 표시합니다.
	private applyEditHighlight(): void {
		const editing = this.editingIndex;
		this.conversation.forEach((message, index) => {
			const bubble = this.bubbleByMessage.get(message);
			bubble?.toggleClass('is-editing', index === editing);
			bubble?.toggleClass('is-superseded', editing !== null && index > editing);
		});
	}

	private describeAttached(info: AttachedInfo): string {
		const strings = this.strings();
		const text = strings.attachedInfo
			.replace('{count}', info.notes.toLocaleString())
			.replace('{chars}', info.chars.toLocaleString());
		return info.truncated ? `${text}${strings.attachedTruncated}` : text;
	}

	// ─── @로 지정한 대상(칩) ───────────────────────────────────────────

	private addTarget(target: ChatTarget): void {
		if (!this.targets.some((existing) => sameTarget(existing, target))) {
			this.setTargets([...this.targets, target]);
		}
		this.inputEl.focus();
	}

	private setTargets(targets: ChatTarget[]): void {
		this.targets = targets;
		this.renderComposerChips();
	}

	private setSkill(skill: Skill | null): void {
		this.selectedSkill = skill;
		this.renderComposerChips();
	}

	// 입력칸 위의 칩 줄: [스킬(보라색)] [폴더·노트(강조색)…]
	private renderComposerChips(): void {
		const strings = this.strings();
		this.targetChipsEl.empty();
		this.targetChipsEl.hidden = this.targets.length === 0 && !this.selectedSkill;
		if (this.selectedSkill) {
			createSkillChip(this.targetChipsEl, this.selectedSkill, {
				removeTooltip: strings.targetRemoveTooltip,
				onRemove: () => {
					this.setSkill(null);
					this.inputEl.focus();
				},
			});
		}
		for (const target of this.targets) {
			createTargetChip(this.targetChipsEl, target, {
				wholeVaultLabel: strings.pickerWholeVault,
				removeTooltip: strings.targetRemoveTooltip,
				onRemove: () => {
					this.setTargets(this.targets.filter((existing) => !sameTarget(existing, target)));
					this.inputEl.focus();
				},
			});
		}
	}

	// 볼트에서 사라진 대상이 있으면 칩에서 빼고 알린 뒤 false(보내지 않음)를 돌려줍니다.
	private dropMissingTargets(): boolean {
		const missing = this.targets.filter((target) => !resolveTarget(this.app, target));
		if (missing.length === 0) return true;
		this.setTargets(this.targets.filter((target) => !missing.includes(target)));
		new Notice(
			this.strings().targetMissing.replace('{names}', missing.map((target) => target.path).join(', ')),
		);
		return false;
	}

	private handleVaultRename(oldPath: string, newPath: string): void {
		let changed = false;
		const next = this.targets.map((target) => {
			const renamed = renamedTarget(target, oldPath, newPath);
			if (!renamed) return target;
			changed = true;
			return renamed;
		});
		if (changed) this.setTargets(next);
	}

	private handleVaultDelete(path: string): void {
		const next = this.targets.filter((target) => !isRemovedBy(target, path));
		if (next.length !== this.targets.length) this.setTargets(next);
	}

	private appendBubble(
		role: 'user' | 'assistant',
		text: string,
		options: { isPending?: boolean; isError?: boolean } = {},
	): HTMLElement {
		const bubble = this.messagesEl.createDiv({
			cls: `intra-copilot-chat-bubble is-${role}`,
		});
		if (options.isPending) bubble.addClass('is-pending');
		if (options.isError) bubble.addClass('is-error');
		bubble.setText(text);
		this.scrollToBottom();
		return bubble;
	}

	private scrollToBottom(): void {
		this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
	}

	// 맨 아래 근처를 보고 있는지. 위로 올려 예전 대화를 읽는 중이면 답변이 와도 끌어내리지 않습니다.
	private isNearBottom(): boolean {
		const el = this.messagesEl;
		return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
	}

	// 도착한 답변(또는 오류)을 보여줍니다. 화면보다 짧으면 맨 아래로, 길면 답변의 시작 부분이
	// 보이게 옮깁니다(맨 끝으로 가면 다시 위로 올려 읽어야 하므로).
	private revealAnswer(bubble: HTMLElement): void {
		const el = this.messagesEl;
		const fitsOnScreen = bubble.offsetHeight <= el.clientHeight - ANSWER_TOP_MARGIN_PX;
		const answerTop =
			el.scrollTop +
			bubble.getBoundingClientRect().top -
			el.getBoundingClientRect().top -
			ANSWER_TOP_MARGIN_PX;
		el.scrollTo({ top: fitsOnScreen ? el.scrollHeight : answerTop, behavior: 'smooth' });
	}
}
