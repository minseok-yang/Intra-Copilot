import { createHash } from 'crypto';
import { debounce, getFrontMatterInfo, type TFile } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { createEmbeddings, type EmbeddingResult, type LlmFailure } from '../llm/client';
import { pluginDir } from '../plugin-paths';
import { DEFAULT_DOCUMENT_FORMAT } from '../settings';
import { inFolder } from '../reminder/due-notes';
import { templateFolders } from '../template-folders';
import { type Chunk, noteSimilarity, noteVectors, splitChunks } from './vectors';

// 커넥터 색인입니다. 노트마다 벡터를(설정한 수만큼) 플러그인 폴더의 connector-index.bin에 저장하고, 비슷한 노트를 찾아 줍니다.
//
// 언제 서버로 보내나
// - 처음 색인은 사용자가 [색인 만들기] 확인 창에서 [색인 시작]을 눌러야만 시작합니다(볼트 전체 본문이 임베딩 서버로 가기 때문).
// - 그 뒤로는 자동 갱신 주기(requestSync)에 따라, 또는 [업데이트]·[다시 시도]를 누르거나 오류로 멈춘 뒤 [연결 확인]이 성공할 때
//   새로 만들었거나 바뀐 노트만 보냅니다.
// - 보내기 직전에 제외 대상인지 다시 확인합니다. 색인하는 사이 제외 폴더를 넣거나 노트를 옮기거나 지워도 남은 조각은 보내지 않습니다.
// - 색인 파일에 만든 서버 주소·모델·고급 설정을 적어 두고, 설정과 다르면 자동으로 보내지 않습니다. 모델이 다르면 벡터끼리
//   비교할 수 없어 다시 만들어야 하는데, 주소나 모델을 바꾸는 순간 볼트 전체가 새 서버로 조용히 나가지 않게 하려는 것입니다.
//
// 무엇이 바뀌었나: 파일 수정 시각이 달라진 노트만 다시 읽고, 보낼 글(제목 + 속성을 뺀 본문)이 그대로면 보내지 않습니다.
// 리마인더가 속성에 날짜만 적은 노트가 다시 전송되지 않는 이유입니다.

// 색인 파일 모양: [머리말 길이 4바이트][머리말 JSON(형식 버전·서버·모델·고급 설정·노트별 수정 시각·해시·섹션·벡터 위치)][4바이트 정렬][float32 벡터들]
// 벡터를 글자(base64)로 바꾸지 않아 파일이 약 25% 작고, 불러올 때 벡터를 복사·변환하지 않고 파일 버퍼를 그대로 씁니다.
// (숫자는 이 PC의 바이트 순서로 적습니다. Windows·Mac·Linux 데스크톱은 모두 같은 순서라 볼트를 옮겨도 읽힙니다.)
const INDEX_FILE = 'connector-index.bin';
// 3: 이진 파일. 이전 형식(link-index.json)은 읽지 않으며 [색인 만들기]로 다시 만듭니다.
const INDEX_VERSION = 3;
// ponytail: 아주 긴 노트는 앞부분 조각만 씁니다(공용 서버 보호). 뒷부분까지 필요하면 이 값을 설정으로 빼세요.
const MAX_CHUNKS_PER_NOTE = 20;
// 색인하는 동안 받은 벡터를 파일에 적는 간격. 파일은 노트가 많으면 수십 MB라 요청마다 쓰면 디스크가 바빠지고,
// 너무 드물면 도중에 끄면 받은 벡터를 잃어 다시 보내야 합니다.
const SAVE_INTERVAL_MS = 30_000;
// 사용량 제한(429)에 걸리면 기다렸다 다시 보냅니다. 무료 API는 분당 요청 수가 적어 첫 색인 도중 자주 걸리는데,
// 그때마다 멈추면 사용자가 [다시 시도]를 여러 번 눌러야 합니다. 기다리는 시간은 횟수마다 늘립니다(20초·40초·60초).
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 20_000;
// 자동 갱신 주기가 이보다 짧으면 노트를 고칠 때마다 다시 기다리고(쓰는 동안 보내지 않음), 길면 첫 변경부터 셉니다.
const QUIET_LIMIT_SECONDS = 60;
// [[위키링크]]·![[임베드]]·[글자](주소) 모양의 링크 문법
const LINK_SYNTAX = /!?\[\[[^\]\n]*\]\]|!?\[[^\]\n]*\]\([^)\n]*\)/g;
// [연결 확인] 때 보내는 고정 문장입니다. 노트 내용은 보내지 않습니다.
const TEST_TEXT = 'connection test';

interface StoredNote {
	mtime: number;
	hash: string;
	offset: number; // 벡터 덩어리에서 이 노트 벡터가 시작하는 숫자 위치
	count: number; // 벡터 개수
	dims: number; // 벡터 하나의 숫자 개수
	sections: string[]; // 벡터마다 대표 조각의 제목(벡터와 같은 순서, 벡터가 하나면 '')
}

interface StoredIndex {
	version: number;
	baseUrl: string;
	model: string;
	// 색인을 만든 고급 설정(currentOptions). 이 값이 생기기 전에 만든 파일에는 없고, 그때는 지금 설정으로 만든 것으로 봅니다.
	options?: string;
	notes: Record<string, StoredNote>;
}

type Owner = { baseUrl: string; model: string; options: string };
// dims는 성공했을 때 받은 벡터 크기입니다(설정 화면 "연결됨 · 벡터 N차원").
export type ServerStatus = { key: string; failure: LlmFailure | null; dims: number; checkedAt: Date };

interface NoteEntry {
	mtime: number;
	hash: string;
	vectors: Float32Array[];
	sections: string[];
}

export type IndexState =
	| { kind: 'not-configured' } // 서버 주소나 모델이 비어 있음
	// 색인이 없거나(builtWith '') 다른 서버·모델로 만든 색인. optionsChanged: 같은 서버·모델이지만 고급 설정이 바뀜
	| { kind: 'not-built'; builtWith: string; optionsChanged: boolean }
	| { kind: 'indexing'; done: number; total: number; waiting: boolean } // waiting: 사용량 제한으로 기다리는 중
	| { kind: 'error'; failure: LlmFailure }
	| { kind: 'ready'; count: number };

export interface SimilarNote {
	path: string;
	score: number; // -1~1, 클수록 비슷함
	section: string; // 상대 노트에서 가장 비슷한 섹션(제목). 모르면 ''
}

class Stopped extends Error {}

// "http://서버/v1"과 "http://서버/v1/"은 같은 서버입니다. 끝의 /만 달라 색인을 다시 만들게 되지 않게 맞춥니다.
function sameServerUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

// oldPath(노트 또는 폴더)를 newPath로 옮겼을 때 path의 새 경로. 옮긴 대상이 아니면 null입니다.
function movedPath(path: string, oldPath: string, newPath: string): string | null {
	if (path === oldPath) return newPath;
	return path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : null;
}

// 서버 실패가 아닌 문제(색인 파일 쓰기 실패 등)도 화면에 이유가 보이게 합니다.
function unknownFailure(error: unknown): LlmFailure {
	return { ok: false, kind: 'unknown', detail: error instanceof Error ? error.message : String(error) };
}

export class ConnectorIndex {
	private owner: Owner | null = null;
	private notes = new Map<string, NoteEntry>();
	private running: Promise<void> | null = null;
	private runAgain = false;
	private progress = { done: 0, total: 0, waiting: false };
	private failure: LlmFailure | null = null;
	private stopped = false;
	private listeners = new Set<() => void>();
	// 색인하는 중 서버로 보냈지만 벡터를 아직 다 받지 못한 노트. 그사이 이름을 바꾸거나 지우면 여기서 함께 고쳐,
	// 받은 벡터가 옛 경로로 저장되지 않게 합니다(옛 경로로 저장되면 다음 맞추기에서 새 경로로 다시 전송됨).
	private inFlight = new Set<{ path: string }>();
	// 파일 쓰기를 한 줄로 세웁니다. 두 저장이 겹치면 같은 파일을 동시에 써서 내용이 깨질 수 있습니다.
	private saving: Promise<void> = Promise.resolve();
	// 임베딩 서버 상태등(커넥터 창 머리줄). 상태를 알려고 서버에 따로 묻지 않고, 색인하며 보낸 요청과 [연결 확인]의
	// 결과만 적어 둡니다(자주 물으면 공용 서버·무료 API 사용량을 씁니다). key는 그때의 주소·키·모델입니다.
	// 커넥터 창과 설정 화면이 같은 기록·같은 "확인 중"을 보여 주도록 둘 다 여기만 읽습니다.
	private lastServer: ServerStatus | null = null;
	private checking: Promise<EmbeddingResult> | null = null;
	private syncTimer: number | null = null;
	// 예약을 처음 건 시각(1분 이상 주기는 여기서부터 셈)과 맞출 시각. 주기를 줄였을 때 예약을 앞당기는 데 씁니다.
	private syncSince = 0;
	private syncDueAt = 0;
	// 지금 예약이 1분 이상 주기로 잡은 것인지. 1분 미만 주기로 바꿔도 이런 예약이 더 이르면 미루지 않습니다.
	private syncLong = false;

	// rateLimitWaitMs는 테스트에서 기다림을 줄이려고만 바꿉니다.
	constructor(
		private readonly plugin: IntraCopilotPlugin,
		private readonly rateLimitWaitMs = RATE_LIMIT_WAIT_MS,
	) {}

	// 설정 화면의 [폴더 열기]가 위치를 보여 주려고 씁니다.
	get path(): string {
		return `${pluginDir(this.plugin)}/${INDEX_FILE}`;
	}

	// 벡터를 만드는 방식(고급 설정). 바뀌면 저장해 둔 벡터와 새로 받을 벡터가 다른 방식으로 만든 것이라, 서버·모델이 바뀔 때처럼
	// 다시 만들어야 합니다. 한 번에 보낼 조각 수(batchSize)는 요청을 나누는 방법일 뿐 벡터가 같아 넣지 않습니다.
	private currentOptions(): string {
		const { chunkChars, vectorsPerNote, dimensions, documentFormat } = this.plugin.settings.connector;
		const format = documentFormat.includes('{text}') ? documentFormat : DEFAULT_DOCUMENT_FORMAT;
		return JSON.stringify([chunkChars, vectorsPerNote, dimensions, format]);
	}

	private sameServer(): boolean {
		const { baseUrl, model } = this.plugin.settings.connector;
		return this.owner !== null && this.owner.baseUrl === sameServerUrl(baseUrl) && this.owner.model === model;
	}

	private matchesSettings(): boolean {
		return this.sameServer() && this.owner?.options === this.currentOptions();
	}

	state(): IndexState {
		const { baseUrl, model } = this.plugin.settings.connector;
		if (!baseUrl || !model) return { kind: 'not-configured' };
		if (!this.matchesSettings()) {
			const optionsChanged = this.sameServer();
			return { kind: 'not-built', builtWith: optionsChanged ? '' : (this.owner?.model ?? ''), optionsChanged };
		}
		if (this.running) return { kind: 'indexing', ...this.progress };
		if (this.failure) return { kind: 'error', failure: this.failure };
		return { kind: 'ready', count: this.notes.size };
	}

	private serverKey(): string {
		const { baseUrl, apiKey, model } = this.plugin.settings.connector;
		return JSON.stringify([sameServerUrl(baseUrl), apiKey, model]);
	}

	// 켠 뒤 지금 설정의 서버로 보낸 요청이 없으면 null(확인 필요)입니다. 주소·키·모델을 바꾸면 옛 결과는 버립니다.
	serverStatus(): ServerStatus | null {
		return this.lastServer?.key === this.serverKey() ? this.lastServer : null;
	}

	isCheckingServer(): boolean {
		return this.checking !== null;
	}

	private recordServer(key: string, result: EmbeddingResult): void {
		const dims = result.ok ? (result.vectors[0]?.length ?? 0) : 0;
		this.lastServer = { key, failure: result.ok ? null : result, dims, checkedAt: new Date() };
	}

	// [연결 확인](커넥터 창 머리줄·설정): 고정 문장 하나만 보내 서버를 확인합니다. 이미 확인 중이면 그 결과를 같이 기다립니다.
	// 서버가 다시 답하면 실패로 멈춰 있던 색인을 이어서 맞춥니다(어느 화면에서 눌렀든 같게).
	checkServer(): Promise<EmbeddingResult> {
		if (this.checking) return this.checking;
		const key = this.serverKey();
		this.checking = createEmbeddings(this.plugin.settings.connector, [TEST_TEXT])
			.then((result) => {
				this.recordServer(key, result);
				return result;
			})
			.finally(() => {
				this.checking = null;
				this.emit();
				if (this.lastServer?.key === key && !this.lastServer.failure && this.state().kind === 'error') void this.sync();
			});
		this.emit();
		return this.checking;
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private emit(): void {
		for (const listener of this.listeners) listener();
	}

	// 파일이 없거나 깨졌으면 색인이 없는 것으로 봅니다(다시 만들면 됩니다).
	// 저장 도중 꺼져 임시 파일만 남았으면 그것을 읽습니다(아래 writeFile 참고).
	async load(): Promise<void> {
		const { adapter } = this.plugin.app.vault;
		const ownerBefore = this.owner;
		try {
			const path = (await adapter.exists(this.path)) ? this.path : `${this.path}.tmp`;
			if (!(await adapter.exists(path))) return;
			const buffer = await adapter.readBinary(path);
			// 읽는 사이 [색인 만들기]를 눌렀다면 새 색인을 옛 파일로 덮지 않습니다.
			if (this.owner !== ownerBefore) return;
			// 길이가 맞지 않는 깨진 파일이면 아래 배열 만들기에서 오류가 나 catch로 갑니다.
			const headerLength = new DataView(buffer).getUint32(0, true);
			const data = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength))) as Partial<StoredIndex>;
			if (data.version !== INDEX_VERSION || typeof data.baseUrl !== 'string' || typeof data.model !== 'string') return;
			const start = Math.ceil((4 + headerLength) / 4) * 4;
			const floats = new Float32Array(buffer, start, (buffer.byteLength - start) / 4);
			const notes = new Map<string, NoteEntry>();
			for (const [notePath, note] of Object.entries(data.notes ?? {})) {
				const { mtime, hash, offset, count, dims, sections } = note ?? {};
				const valid =
					typeof mtime === 'number' &&
					typeof hash === 'string' &&
					[offset, count, dims].every((n) => Number.isInteger(n) && n >= 0) &&
					offset + count * dims <= floats.length;
				if (!valid) continue;
				const vectors = Array.from({ length: count }, (_, i) => floats.subarray(offset + i * dims, offset + (i + 1) * dims));
				notes.set(notePath, {
					mtime,
					hash,
					vectors,
					sections: vectors.map((_, i) => (typeof sections?.[i] === 'string' ? sections[i] : '')),
				});
			}
			this.owner = {
				baseUrl: sameServerUrl(data.baseUrl),
				model: data.model,
				options: typeof data.options === 'string' ? data.options : this.currentOptions(),
			};
			this.notes = notes;
		} catch {
			// 깨진 파일: 색인 없음으로 둡니다.
		} finally {
			this.emit();
		}
	}

	private save(): Promise<void> {
		const next = this.saving.then(() => this.writeFile());
		this.saving = next.catch(() => {});
		return next;
	}

	// 임시 파일에 다 쓴 뒤 바꿔 끼웁니다. 쓰는 도중 꺼져도 원래 파일이 반쯤 쓰인 채로 남지 않게 하려는 것입니다
	// (색인 파일이 깨지면 볼트 전체를 서버로 다시 보내야 합니다).
	private async writeFile(): Promise<void> {
		if (!this.owner) return;
		const notes: Record<string, StoredNote> = {};
		let total = 0;
		for (const [path, note] of this.notes) {
			const dims = note.vectors[0]?.length ?? 0;
			notes[path] = { mtime: note.mtime, hash: note.hash, offset: total, count: note.vectors.length, dims, sections: note.sections };
			total += note.vectors.length * dims;
		}
		const data: StoredIndex = { version: INDEX_VERSION, ...this.owner, notes };
		const header = new TextEncoder().encode(JSON.stringify(data));
		const start = Math.ceil((4 + header.length) / 4) * 4;
		const buffer = new ArrayBuffer(start + total * 4);
		new DataView(buffer).setUint32(0, header.length, true);
		new Uint8Array(buffer, 4).set(header);
		const floats = new Float32Array(buffer, start);
		for (const [path, note] of this.notes) {
			let offset = notes[path]!.offset;
			for (const vector of note.vectors) {
				floats.set(vector, offset);
				offset += vector.length;
			}
		}

		const { adapter } = this.plugin.app.vault;
		const temp = `${this.path}.tmp`;
		await adapter.writeBinary(temp, buffer);
		if (await adapter.exists(this.path)) await adapter.remove(this.path);
		await adapter.rename(temp, this.path);
	}

	// [색인 만들기]·[다시 만들기]: 지금 설정의 서버·모델로 처음부터 만듭니다.
	async rebuild(): Promise<void> {
		const { baseUrl, model } = this.plugin.settings.connector;
		if (!baseUrl || !model) return;
		this.owner = { baseUrl: sameServerUrl(baseUrl), model, options: this.currentOptions() };
		this.notes.clear();
		this.failure = null;
		// 색인 파일을 쓸 수 없으면 받은 벡터를 남길 수 없으므로 보내지 않고 이유를 보여 줍니다.
		try {
			await this.save();
		} catch (error) {
			this.failure = unknownFailure(error);
			this.emit();
			return;
		}
		await this.sync();
	}

	// 바뀐 노트만 색인합니다. 이미 도는 중이면 끝난 뒤 한 번 더 돕니다(그사이 바뀐 노트를 놓치지 않게).
	sync(): Promise<void> {
		if (!this.matchesSettings() || this.stopped) return Promise.resolve();
		if (this.running) {
			this.runAgain = true;
			return this.running;
		}
		this.running = (async () => {
			do {
				this.runAgain = false;
				try {
					await this.run();
				} catch (error) {
					this.failure = unknownFailure(error);
				}
			} while (this.runAgain && !this.failure && !this.stopped);
		})().finally(() => {
			this.running = null;
			this.emit();
		});
		this.emit();
		return this.running;
	}

	// 플러그인을 끌 때 부릅니다. 이름 변경·삭제 뒤 2초 기다리던 저장이 있으면 지금 합니다(안 하면 다음에 켰을 때
	// 옮긴 노트의 기록이 옛 경로로 남아 새 경로로 다시 전송됩니다).
	stop(): void {
		this.settleSoon.run();
		this.stopped = true;
		if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
		this.syncTimer = null;
	}

	// 자동 갱신: 노트가 바뀌었거나 켤 때 부르면, 설정한 주기(autoSyncSeconds)에 맞춰 맞추기(sync)를 예약합니다.
	// 1분 미만이면 부를 때마다 다시 기다려 쓰는 동안에는 보내지 않고, 1분 이상이면 첫 변경부터 세어 그 시각에 한꺼번에 보냅니다
	// (계속 고쳐도 주기마다 한 번은 맞춤). 설정에서 주기를 줄이면 이미 잡힌 예약도 새 주기로 센 시각으로 앞당기고, 이미 더 이른
	// 예약은 미루지 않습니다(1분 이상 주기로 잡은 예약은 15초로 바꿔도 그대로). 0이면 예약하지 않으며, 커넥터 창의 노란 상태등과
	// [업데이트]로 사용자가 직접 맞춥니다.
	// 색인이 오류로 멈춰 있으면 예약한 시각이 와도 보내지 않습니다. 인증 실패처럼 같은 오류가 날 요청을 노트를 고칠 때마다
	// 되풀이하지 않게 하려는 것이며, [다시 시도]를 누르거나 [연결 확인]이 성공하면 이어서 맞춥니다.
	requestSync(): void {
		const seconds = this.plugin.settings.connector.autoSyncSeconds;
		const long = seconds >= QUIET_LIMIT_SECONDS;
		const scheduled = this.syncTimer !== null;
		const since = long && scheduled ? this.syncSince : Date.now();
		const dueAt = since + seconds * 1000;
		// 이미 잡힌 예약이 새로 센 시각보다 이르거나 같으면 그대로 둡니다. 1분 미만 주기로 잡은 예약은 고칠 때마다 다시 기다리므로 예외입니다.
		if (scheduled && seconds > 0 && (long || this.syncLong) && this.syncDueAt <= dueAt) return;
		if (this.syncTimer !== null) window.clearTimeout(this.syncTimer);
		this.syncTimer = null;
		if (seconds <= 0 || this.stopped) return;
		this.syncSince = since;
		this.syncDueAt = dueAt;
		this.syncLong = long;
		this.syncTimer = window.setTimeout(
			() => {
				this.syncTimer = null;
				if (!this.failure) void this.sync();
			},
			Math.max(0, dueAt - Date.now()),
		);
	}

	// 이름 변경·삭제는 폴더를 옮기거나 지우면 여러 번 오므로, 잠잠해진 뒤 한 번만 저장합니다. 옮기거나 지운 기록은 서버로 보낼 것이
	// 없어 맞추기를 기다리지 않습니다. 제외 폴더로 옮긴 노트는 검색에서 바로 빠지고, 기록은 다음 맞추기에서 지웁니다.
	private readonly settleSoon = debounce(
		() => {
			void this.save().catch(() => {});
			this.emit();
		},
		2000,
		true,
	);

	// 이름을 바꾸거나 옮긴 노트는 다시 보내지 않고 기록만 옮깁니다(수정 시각이 그대로라 다음 색인에서도 건너뜀).
	// 폴더면 안의 노트 기록을 모두 옮깁니다(폴더 이벤트만 오고 파일마다 오지 않는 경우에도 다시 보내지 않게).
	rename(oldPath: string, newPath: string): void {
		let moved = false;
		for (const [path, entry] of [...this.notes]) {
			const target = movedPath(path, oldPath, newPath);
			if (target === null) continue;
			this.notes.delete(path);
			this.notes.set(target, entry);
			moved = true;
		}
		for (const note of this.inFlight) note.path = movedPath(note.path, oldPath, newPath) ?? note.path;
		if (moved) this.settleSoon();
	}

	remove(path: string): void {
		const isRemoved = (notePath: string) => notePath === path || notePath.startsWith(`${path}/`);
		let removed = false;
		for (const notePath of [...this.notes.keys()]) {
			if (isRemoved(notePath)) removed = this.notes.delete(notePath) || removed;
		}
		for (const note of [...this.inFlight]) {
			if (isRemoved(note.path)) this.inFlight.delete(note);
		}
		if (removed) this.settleSoon();
	}

	// 지금 노트와 비슷한 노트(자신 제외)를 비슷한 순서로. 지금 노트가 아직 색인되지 않았거나, 제외 대상이거나,
	// 색인이 지금 설정(서버·모델·고급 설정)과 맞지 않으면 null입니다.
	search(path: string, limit: number): SimilarNote[] | null {
		const current = this.notes.get(path)?.vectors;
		const skip = this.skipFolders();
		if (!current?.length || !this.matchesSettings() || this.isExcluded(path, skip)) return null;
		const results: SimilarNote[] = [];
		for (const [otherPath, note] of this.notes) {
			// 제외 폴더로 옮겼지만 아직 맞추기 전이라 기록이 남은 노트도 추천하지 않습니다.
			if (otherPath === path || this.isExcluded(otherPath, skip)) continue;
			const best = noteSimilarity(current, note.vectors);
			if (best.score > -Infinity) results.push({ path: otherPath, score: best.score, section: note.sections[best.b] ?? '' });
		}
		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	// 제외 폴더·템플릿 폴더의 노트, Excalidraw 그림이면 true(색인하지도 추천하지도 않음).
	isExcluded(path: string, skip = this.skipFolders()): boolean {
		const lower = path.toLowerCase();
		return lower.endsWith('.excalidraw.md') || skip.some((folder) => inFolder(lower, folder));
	}

	// 제외할 폴더(설정 + 템플릿 폴더, 소문자). 노트마다 다시 구하지 않게 한 번 구해 넘깁니다.
	private skipFolders(): string[] {
		const { app, settings } = this.plugin;
		return [...settings.connector.excludedFolders, ...templateFolders(app)].map((folder) => folder.toLowerCase());
	}

	private eligibleFiles(): TFile[] {
		const skip = this.skipFolders();
		return this.plugin.app.vault.getMarkdownFiles().filter((file) => !this.isExcluded(file.path, skip));
	}

	// 색인에 아직 반영되지 않은 노트 수: 새로 만들었거나 고친 노트 + 제외 폴더로 옮겨 빼야 할 기록(커넥터 창의 노란 상태등).
	// 이 PC 안에서 세기만 합니다. 링크·속성만 바뀐 노트도 세지만, 맞출 때 내용이 그대로면 서버로 보내지 않습니다.
	// 색인을 쓸 수 없거나 색인하는 중이면 0입니다.
	pendingCount(): number {
		if (!this.matchesSettings() || this.running) return 0;
		const files = this.eligibleFiles();
		const eligible = new Set(files.map((file) => file.path));
		let count = files.filter((file) => this.notes.get(file.path)?.mtime !== file.stat.mtime).length;
		for (const path of this.notes.keys()) {
			if (!eligible.has(path)) count++;
		}
		return count;
	}

	// 노트 하나를 서버로 보낼 조각으로 만듭니다. hash는 보낼 글이 지난번과 같은지 비교하는 값입니다.
	// 속성(frontmatter)은 날짜 같은 기록이라 뺍니다. 제목은 노트의 뜻을 잘 나타내므로 문서 형식({title})으로 조각마다
	// 붙입니다(긴 노트의 뒷조각도 어느 노트인지 알 수 있게).
	// hash는 제목과 본문에서 링크를 통째로(보이는 글자·별칭 포함) 빼고 공백 차이를 없앤 뒤 계산합니다. [링크 넣기]로 링크만
	// 더하거나 줄바꿈만 고친 노트를 다시 보내지 않으려는 것입니다(뜻은 거의 그대로라 벡터를 새로 받을 이유가 작음).
	// 그래서 [글자](주소) 링크의 글자만 고친 노트도 다시 보내지 않습니다. 보내는 글에는 링크가 그대로 들어갑니다.
	// 문서 형식은 hash에 넣지 않습니다. 형식을 바꾸는 순간 볼트 전체가 자동으로 다시 전송되지 않게 하고, [다시 만들기]로 적용합니다.
	private prepare(title: string, content: string): { hash: string; chunks: Chunk[] } {
		const { chunkChars, documentFormat } = this.plugin.settings.connector;
		const body = content.slice(getFrontMatterInfo(content).contentStart);
		const meaning = `${title}\n${body}`.replace(LINK_SYNTAX, '').replace(/\s+/g, ' ').trim();
		const format = documentFormat.includes('{text}') ? documentFormat : DEFAULT_DOCUMENT_FORMAT;
		const pieces = splitChunks(body, chunkChars, MAX_CHUNKS_PER_NOTE);
		return {
			hash: createHash('sha1').update(meaning).digest('hex'),
			// 본문이 비어도 제목만으로 한 조각을 보냅니다(제목만 있는 노트도 추천에 나오게).
			// {title}·{text}는 한 번에 바꿉니다. 차례로 바꾸면 먼저 넣은 제목 속의 "{text}"가 다시 바뀝니다(형식에 여러 번 써도 모두 바뀜).
			// 바꿔 넣을 글은 함수로 넘깁니다. 글자로 넘기면 JS가 $$·$& 같은 기호를 규칙으로 읽어 수식($$…$$) 등이 바뀐 채 전송됩니다.
			chunks: (pieces.length > 0 ? pieces : [{ text: '', heading: '' }]).map((piece) => ({
				text: format.replace(/\{(title|text)\}/g, (_, key: string) => (key === 'title' ? title : piece.text)).trim(),
				heading: piece.heading,
			})),
		};
	}

	// [색인 만들기] 확인 창에 보여 줄 전송량: 지금 설정으로 처음부터 만들 때 보낼 노트·조각·요청 수입니다.
	// 이 PC 안에서 노트를 읽어 세기만 하고 아무것도 보내지 않습니다.
	async estimate(): Promise<{ notes: number; chunks: number; requests: number }> {
		let notes = 0;
		let chunks = 0;
		for (const file of this.eligibleFiles()) {
			const content = await this.plugin.app.vault.cachedRead(file).catch(() => null);
			if (content === null) continue;
			notes++;
			chunks += this.prepare(file.basename, content).chunks.length;
		}
		return { notes, chunks, requests: Math.ceil(chunks / this.plugin.settings.connector.batchSize) };
	}

	private async run(): Promise<void> {
		const owner = this.owner;
		const { vault } = this.plugin.app;
		const { batchSize, vectorsPerNote } = this.plugin.settings.connector;
		const files = this.eligibleFiles();

		const eligible = new Set(files.map((file) => file.path));
		const todo = files.filter((file) => this.notes.get(file.path)?.mtime !== file.stat.mtime);
		// 바뀐 것이 없으면 끝날 때 색인 파일을 다시 쓰지 않습니다(노트가 많으면 수십 MB라 켤 때·이름 변경·설정 저장마다 쓰면 디스크가 바쁨).
		let changed = todo.length > 0;
		for (const path of this.notes.keys()) {
			if (!eligible.has(path)) changed = this.notes.delete(path) || changed;
		}
		this.progress = { done: 0, total: todo.length, waiting: false };
		this.failure = null;
		this.emit();

		// 서버가 같은 모델 이름으로 다른 모델을 돌리기 시작하면 벡터 크기가 달라져 서로 비교할 수 없습니다.
		// 섞어 저장하면 추천에서 조용히 빠지므로, 알아채는 즉시 멈추고 알립니다.
		// 기준은 벡터가 있는 첫 노트입니다(조각 벡터가 모두 0이라 벡터 없이 저장된 노트는 건너뜀).
		let dims = [...this.notes.values()].find((note) => note.vectors.length > 0)?.vectors[0]?.length ?? 0;
		type Pending = { path: string; mtime: number; hash: string; headings: string[]; vectors: number[][] };
		const queue: { note: Pending; text: string }[] = [];
		let lastSave = Date.now();

		// 보내기 직전에 줄 선 노트를 다시 확인해, 그사이 지웠거나(inFlight에서 빠짐) 제외 대상이 된 노트(제외 폴더로 옮김,
		// 제외 폴더를 새로 넣음)의 남은 조각을 빼고 그 노트는 끝난 것으로 셉니다. 이미 서버에 가 있는 요청은 되돌릴 수 없습니다.
		const dropUnsendable = () => {
			const skip = this.skipFolders();
			const dropped = new Set([...new Set(queue.map((item) => item.note))].filter((note) => !this.inFlight.has(note) || this.isExcluded(note.path, skip)));
			if (dropped.size === 0) return;
			for (const note of dropped) {
				this.inFlight.delete(note);
				this.progress.done++;
			}
			queue.splice(0, queue.length, ...queue.filter((item) => !dropped.has(item.note)));
		};

		// 조각을 batchSize개씩 보내고, 조각 벡터가 다 모인 노트부터 색인(메모리)에 넣습니다. 파일 저장은 SAVE_INTERVAL_MS마다와
		// 끝날 때(바뀐 것이 있을 때) 합니다.
		const send = async (all: boolean) => {
			const ready = () => {
				dropUnsendable();
				return queue.length >= batchSize || (all && queue.length > 0);
			};
			while (ready()) {
				if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
				const batch = queue.splice(0, batchSize);
				const inputs = batch.map((item) => item.text);
				const key = this.serverKey();
				let result = await createEmbeddings(this.plugin.settings.connector, inputs);
				for (let attempt = 1; !result.ok && result.kind === 'rate-limit' && attempt <= RATE_LIMIT_RETRIES; attempt++) {
					this.progress.waiting = true;
					this.emit();
					await new Promise((resolve) => window.setTimeout(resolve, this.rateLimitWaitMs * attempt));
					this.progress.waiting = false;
					if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
					result = await createEmbeddings(this.plugin.settings.connector, inputs);
				}
				this.recordServer(key, result);
				// 기다리는 사이 [다시 만들기]를 눌렀거나 서버·모델을 바꿨으면 옛 서버의 결과라 버립니다.
				if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
				if (!result.ok) {
					this.failure = result;
					throw new Stopped();
				}
				const size = dims || result.vectors[0]!.length;
				const odd = result.vectors.find((vector) => vector.length !== size);
				if (odd) {
					this.failure = { ok: false, kind: 'invalid-response', detail: `Vector size changed: ${size} → ${odd.length}` };
					throw new Stopped();
				}
				dims = size;
				batch.forEach((item, i) => item.note.vectors.push(result.vectors[i]!));
				for (const note of new Set(batch.map((item) => item.note))) {
					if (note.vectors.length < note.headings.length) continue;
					this.progress.done++;
					// 보내는 사이 지운 노트는 저장하지 않습니다(이름을 바꾼 노트는 rename이 path를 새 경로로 바꿔 둠).
					if (!this.inFlight.delete(note)) continue;
					const picked = noteVectors(note.vectors, vectorsPerNote);
					// 벡터가 하나면 노트 전체라 섹션을 적지 않습니다.
					const sections = picked.map(({ chunk }) => (picked.length > 1 ? (note.headings[chunk] ?? '') : ''));
					this.notes.set(note.path, {
						mtime: note.mtime,
						hash: note.hash,
						vectors: picked.map(({ vector }) => vector),
						sections,
					});
				}
				this.emit();
				if (Date.now() - lastSave >= SAVE_INTERVAL_MS) {
					lastSave = Date.now();
					await this.save();
				}
			}
		};

		try {
			for (const file of todo) {
				// 읽는 사이 지워진 노트는 건너뜁니다(다음 색인에서 기록도 빠짐).
				const content = await vault.cachedRead(file).catch(() => null);
				if (content === null) {
					this.progress.done++;
					continue;
				}
				const { hash, chunks } = this.prepare(file.basename, content);
				const existing = this.notes.get(file.path);
				if (existing?.hash === hash) {
					existing.mtime = file.stat.mtime;
					this.progress.done++;
					continue;
				}
				const note: Pending = {
					path: file.path,
					mtime: file.stat.mtime,
					hash,
					headings: chunks.map((chunk) => chunk.heading),
					vectors: [],
				};
				this.inFlight.add(note);
				for (const chunk of chunks) queue.push({ note, text: chunk.text });
				await send(false);
			}
			await send(true);
		} catch (error) {
			if (!(error instanceof Stopped)) throw error;
		} finally {
			this.inFlight.clear();
			// 실패하거나 멈춰도 그때까지 받은 벡터는 남깁니다(다음에 이어서 색인).
			if (this.owner === owner && changed) await this.save();
		}
	}
}
