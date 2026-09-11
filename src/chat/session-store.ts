import IntraCopilotPlugin from '../main';
import { ChatMessage } from '../llm/client';

// 파일에 저장되는 메시지입니다. 서버로 보내는 모양(ChatMessage)에 화면 표시용 정보를 더했습니다.
// 서버로 보낼 때는 buildRequestMessages()가 role/content만 골라내므로 이 추가 정보는 전송되지 않습니다.
export interface StoredMessage extends ChatMessage {
	reasoning?: string; // 추론형 모델의 생각 과정
	truncated?: boolean; // 길이 제한에 걸려 잘린 답변인지
}

export interface ChatSession {
	id: string;
	title: string;
	createdAt: string; // ISO 날짜 문자열
	updatedAt: string;
	messages: StoredMessage[];
}

export interface ChatSessionSummary {
	id: string;
	title: string;
	updatedAt: string;
}

// manifest.dir는 볼트 기준 상대 경로입니다(예: .obsidian/plugins/intra-copilot).
// 이 폴더 안에 저장하면 노트가 아니라서 일반 파일 탐색기/검색에는 나타나지 않습니다.
// 주의: 플러그인 폴더를 통째로 지우고 다시 넣으면 대화 기록도 함께 사라집니다.
function sessionsDir(plugin: IntraCopilotPlugin): string {
	const pluginDir =
		plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
	return `${pluginDir}/conversations`;
}

function sessionPath(plugin: IntraCopilotPlugin, id: string): string {
	return `${sessionsDir(plugin)}/${id}.json`;
}

async function ensureSessionsDir(plugin: IntraCopilotPlugin): Promise<void> {
	const dir = sessionsDir(plugin);
	if (!(await plugin.app.vault.adapter.exists(dir))) {
		await plugin.app.vault.adapter.mkdir(dir);
	}
}

export function newSessionId(): string {
	return `session-${Date.now()}`;
}

// 첫 사용자 메시지를 짧게 잘라 목록에 보일 제목으로 씁니다.
export function deriveSessionTitle(messages: ChatMessage[], emptyTitle: string): string {
	const firstUser = messages.find((message) => message.role === 'user');
	if (!firstUser) return emptyTitle;
	const oneLine = firstUser.content.replace(/\s+/g, ' ').trim();
	return oneLine.length > 40 ? `${oneLine.slice(0, 40)}…` : oneLine;
}

export async function saveSession(
	plugin: IntraCopilotPlugin,
	session: ChatSession,
): Promise<void> {
	await ensureSessionsDir(plugin);
	await plugin.app.vault.adapter.write(
		sessionPath(plugin, session.id),
		JSON.stringify(session, null, 2),
	);
}

export async function loadSession(
	plugin: IntraCopilotPlugin,
	id: string,
): Promise<ChatSession | null> {
	try {
		const raw = await plugin.app.vault.adapter.read(sessionPath(plugin, id));
		const session = JSON.parse(raw) as ChatSession;
		return Array.isArray(session.messages) ? session : null;
	} catch {
		return null;
	}
}

// 최근 수정 순으로 정렬해서 돌려줍니다.
export async function listSessions(plugin: IntraCopilotPlugin): Promise<ChatSessionSummary[]> {
	const dir = sessionsDir(plugin);
	if (!(await plugin.app.vault.adapter.exists(dir))) return [];

	const { files } = await plugin.app.vault.adapter.list(dir);
	const summaries: ChatSessionSummary[] = [];
	for (const file of files) {
		if (!file.endsWith('.json')) continue;
		try {
			const raw = await plugin.app.vault.adapter.read(file);
			const session = JSON.parse(raw) as ChatSession;
			summaries.push({ id: session.id, title: session.title, updatedAt: session.updatedAt });
		} catch {
			// 손상된 파일은 목록에서 조용히 건너뜁니다.
		}
	}
	summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return summaries;
}

export async function deleteSession(plugin: IntraCopilotPlugin, id: string): Promise<void> {
	const path = sessionPath(plugin, id);
	if (await plugin.app.vault.adapter.exists(path)) {
		await plugin.app.vault.adapter.remove(path);
	}
}
