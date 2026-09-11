import IntraCopilotPlugin from '../main';
import { ChatMessage } from '../llm/client';
import { AttachedInfo, ChatTarget, isAttachedInfo, isChatTarget } from './vault-context';

// 파일에 저장되는 메시지입니다. 서버로 보내는 모양(ChatMessage)에 화면 표시용 정보를 더했습니다.
// 서버로 보낼 때는 composeRequestConversation()/buildRequestMessages()가 필요한 것만 골라냅니다.
export interface StoredMessage extends ChatMessage {
	reasoning?: string; // 추론형 모델의 생각 과정
	truncated?: boolean; // 길이 제한에 걸려 잘린 답변인지
	// 이 질문을 보낼 때 @로 지정했던 폴더·노트(경로만). 노트 내용 자체는 저장하지 않습니다.
	targets?: ChatTarget[];
	attached?: AttachedInfo; // 그때 실제로 붙여 보낸 분량
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
	title: string; // ''이면 제목이 없는 대화(화면에서 "(빈 대화)"로 표시)
	updatedAt: string; // ''이면 시각을 알 수 없음
}

// ─── 저장 구조 ─────────────────────────────────────────────────────
// conversations/
//   session-1726….json  ← 대화 하나당 파일 하나(본문 전체). [불러오기]한 대화만 읽습니다.
//   index.json          ← 목록 파일: 대화마다 id·제목·수정 시각만 한 줄씩.
//                          "지난 대화" 창은 이 파일 하나만 읽으므로 대화가 쌓여도 느려지지 않습니다.
//
// 기준은 대화 파일이고, 목록 파일은 언제든 다시 만들 수 있는 요약본입니다.
// - 목록 파일이 없거나 깨졌으면: 대화 파일을 한 번 전부 읽어 새로 만듭니다(예전 버전에서 넘어올 때도).
// - 목록에는 있는데 대화 파일이 없으면: 불러오기에 실패하는 순간 목록에서 지웁니다.
// - 대화 파일을 손으로 복사해 넣었다면: 목록 파일(index.json)을 지우면 다음에 다시 만들어집니다.
//
// manifest.dir는 볼트 기준 상대 경로입니다(예: .obsidian/plugins/intra-copilot).
// 이 폴더 안에 저장하면 노트가 아니라서 일반 파일 탐색기/검색에는 나타나지 않습니다.
// 주의: 플러그인 폴더를 통째로 지우고 다시 넣으면 대화 기록도 함께 사라집니다.
const INDEX_FILE = 'index.json';

function sessionsDir(plugin: IntraCopilotPlugin): string {
	const pluginDir =
		plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
	return `${pluginDir}/conversations`;
}

function sessionPath(plugin: IntraCopilotPlugin, id: string): string {
	return `${sessionsDir(plugin)}/${id}.json`;
}

function indexPath(plugin: IntraCopilotPlugin): string {
	return `${sessionsDir(plugin)}/${INDEX_FILE}`;
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

// 파일 속 메시지 하나를 읽습니다. 알고 있는 칸만 모양을 확인해서 옮겨 담고, 모양이 틀린 칸은 버립니다
// (손으로 고친 파일에서 targets가 이상한 값이면, 화면이나 서버 요청이 깨지지 않게 그 칸만 뺍니다).
function readMessage(value: unknown): StoredMessage | null {
	if (!value || typeof value !== 'object') return null;
	const fields = value as Record<string, unknown>;
	const { role, content } = fields;
	if ((role !== 'user' && role !== 'assistant' && role !== 'system') || typeof content !== 'string') {
		return null;
	}
	const message: StoredMessage = { role, content };
	if (typeof fields.reasoning === 'string' && fields.reasoning) message.reasoning = fields.reasoning;
	if (fields.truncated === true) message.truncated = true;
	if (Array.isArray(fields.targets)) {
		const targets = fields.targets.filter(isChatTarget);
		if (targets.length > 0) message.targets = targets;
	}
	if (isAttachedInfo(fields.attached)) message.attached = fields.attached;
	return message;
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

// 파일 내용을 대화로 읽어 들입니다. 손으로 고쳤거나 일부가 깨진 파일이라도 읽을 수 있는 만큼 읽고,
// 빠진 칸은 안전한 값으로 채웁니다.
// id는 파일 안의 값이 아니라 **파일 이름**을 씁니다. 대화 파일을 복사해 두었을 때 복사본을 이어
// 쓰다가 원본 파일을 덮어쓰는 일을 막기 위해서입니다.
function parseSession(raw: string, id: string): ChatSession | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!data || typeof data !== 'object') return null;
	const fields = data as Record<string, unknown>;
	if (!Array.isArray(fields.messages)) return null;

	const updatedAt = stringOr(fields.updatedAt, stringOr(fields.createdAt, ''));
	return {
		id,
		title: stringOr(fields.title, ''),
		// 만든 시각이 없으면 지금 시각으로 — 비어 있으면 챗봇 화면이 새 대화로 착각합니다.
		createdAt: stringOr(fields.createdAt, '') || updatedAt || new Date().toISOString(),
		updatedAt,
		messages: fields.messages
			.map(readMessage)
			.filter((message): message is StoredMessage => message !== null),
	};
}

// ─── 목록 파일(index.json) ───────────────────────────────────────────

// 목록 파일은 "읽고 → 고치고 → 쓰는" 파일이라, 저장과 삭제가 동시에 일어나면 한쪽 변경이
// 사라질 수 있습니다. 그래서 목록 파일을 다루는 작업은 전부 이 대기열에서 하나씩 처리합니다.
let indexQueue: Promise<unknown> = Promise.resolve();

function withIndex<T>(task: () => Promise<T>): Promise<T> {
	const run = indexQueue.then(task, task);
	indexQueue = run.catch(() => undefined); // 한 작업이 실패해도 다음 작업은 진행
	return run;
}

function isSummary(value: unknown): value is ChatSessionSummary {
	if (!value || typeof value !== 'object') return false;
	const { id, title, updatedAt } = value as Record<string, unknown>;
	return typeof id === 'string' && typeof title === 'string' && typeof updatedAt === 'string';
}

// 목록 파일을 읽습니다. 없거나 깨졌으면 null — 호출한 쪽이 대화 파일로 다시 만듭니다.
async function readIndex(plugin: IntraCopilotPlugin): Promise<ChatSessionSummary[] | null> {
	try {
		const data = JSON.parse(await plugin.app.vault.adapter.read(indexPath(plugin))) as {
			sessions?: unknown;
		};
		return Array.isArray(data.sessions) ? data.sessions.filter(isSummary) : null;
	} catch {
		return null;
	}
}

async function writeIndex(
	plugin: IntraCopilotPlugin,
	sessions: ChatSessionSummary[],
): Promise<void> {
	await ensureSessionsDir(plugin);
	await plugin.app.vault.adapter.write(
		indexPath(plugin),
		JSON.stringify({ version: 1, sessions }),
	);
}

// 대화 파일을 전부 읽어 목록을 새로 만듭니다. 목록 파일이 없을 때만 쓰는 느린 방법입니다.
async function scanSessionFiles(plugin: IntraCopilotPlugin): Promise<ChatSessionSummary[]> {
	const dir = sessionsDir(plugin);
	if (!(await plugin.app.vault.adapter.exists(dir))) return [];

	const { files } = await plugin.app.vault.adapter.list(dir);
	const results = await Promise.all(
		files
			.filter((file) => file.endsWith('.json') && !file.endsWith(`/${INDEX_FILE}`))
			.map(async (file): Promise<ChatSessionSummary | null> => {
				const id = file.slice(file.lastIndexOf('/') + 1, -'.json'.length);
				try {
					const session = parseSession(await plugin.app.vault.adapter.read(file), id);
					return session ? { id, title: session.title, updatedAt: session.updatedAt } : null;
				} catch {
					return null; // 읽을 수 없는 파일은 목록에서 조용히 건너뜁니다.
				}
			}),
	);
	return results.filter((summary): summary is ChatSessionSummary => summary !== null);
}

// 목록 파일을 읽어서(없으면 새로 만들어서) 고친 뒤 다시 씁니다.
function updateIndex(
	plugin: IntraCopilotPlugin,
	change: (sessions: ChatSessionSummary[]) => ChatSessionSummary[],
): Promise<void> {
	return withIndex(async () => {
		const current = (await readIndex(plugin)) ?? (await scanSessionFiles(plugin));
		await writeIndex(plugin, change(current));
	});
}

// ─── 바깥에서 쓰는 함수들 ────────────────────────────────────────────

export async function saveSession(
	plugin: IntraCopilotPlugin,
	session: ChatSession,
): Promise<void> {
	await ensureSessionsDir(plugin);
	await plugin.app.vault.adapter.write(
		sessionPath(plugin, session.id),
		JSON.stringify(session, null, 2),
	);
	const summary: ChatSessionSummary = {
		id: session.id,
		title: session.title,
		updatedAt: session.updatedAt,
	};
	await updateIndex(plugin, (sessions) => [
		summary,
		...sessions.filter((entry) => entry.id !== session.id),
	]);
}

export async function loadSession(
	plugin: IntraCopilotPlugin,
	id: string,
): Promise<ChatSession | null> {
	const path = sessionPath(plugin, id);
	try {
		return parseSession(await plugin.app.vault.adapter.read(path), id);
	} catch {
		// 목록에는 있는데 파일이 사라졌다면(손으로 지운 경우 등) 목록에서도 지웁니다.
		if (!(await plugin.app.vault.adapter.exists(path))) {
			await updateIndex(plugin, (sessions) => sessions.filter((entry) => entry.id !== id));
		}
		return null;
	}
}

// 최근 수정 순으로 정렬해서 돌려줍니다. 목록 파일 하나만 읽습니다.
export function listSessions(plugin: IntraCopilotPlugin): Promise<ChatSessionSummary[]> {
	return withIndex(async () => {
		let sessions = await readIndex(plugin);
		if (!sessions) {
			sessions = await scanSessionFiles(plugin);
			if (sessions.length > 0) await writeIndex(plugin, sessions);
		}
		return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	});
}

export async function deleteSession(plugin: IntraCopilotPlugin, id: string): Promise<void> {
	const path = sessionPath(plugin, id);
	if (await plugin.app.vault.adapter.exists(path)) {
		await plugin.app.vault.adapter.remove(path);
	}
	await updateIndex(plugin, (sessions) => sessions.filter((entry) => entry.id !== id));
}
