import { createHash } from 'crypto';
import { debounce, getFrontMatterInfo, type TFile } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { createEmbeddings, type LlmFailure } from '../llm/client';
import { pluginDir } from '../plugin-paths';
import { inFolder } from '../reminder/due-notes';
import { templateFolders } from '../template-folders';
import { decodeVector, encodeVector, noteSimilarity, noteVectors, splitChunks } from './vectors';

// 링크 색인입니다. 노트마다 벡터를(설정한 수만큼) 플러그인 폴더의 link-index.json에 저장하고, 비슷한 노트를 찾아 줍니다.
//
// 언제 서버로 보내나
// - 처음 색인은 사용자가 [색인 만들기]를 눌러야만 시작합니다(볼트 전체 본문이 임베딩 서버로 가기 때문).
// - 그 뒤로는 켤 때와 노트를 고친 뒤에 바뀐 노트만 자동으로 보냅니다.
// - 색인 파일에 만든 서버 주소·모델을 적어 두고, 설정과 다르면 자동으로 보내지 않습니다. 모델이 다르면 벡터끼리
//   비교할 수 없어 다시 만들어야 하는데, 주소나 모델을 바꾸는 순간 볼트 전체가 새 서버로 조용히 나가지 않게 하려는 것입니다.
//
// 무엇이 바뀌었나: 파일 수정 시각이 달라진 노트만 다시 읽고, 보낼 글(제목 + 속성을 뺀 본문)이 그대로면 보내지 않습니다.
// 리마인더가 속성에 날짜만 적은 노트가 다시 전송되지 않는 이유입니다.

const INDEX_FILE = 'link-index.json';
// 2: 노트당 벡터를 여러 개(vectors 배열) 저장. 이전 형식 파일은 색인이 없는 것으로 보고 다시 만듭니다.
const INDEX_VERSION = 2;
// ponytail: 아주 긴 노트는 앞부분 조각만 씁니다(공용 서버 보호). 뒷부분까지 필요하면 이 값을 설정으로 빼세요.
const MAX_CHUNKS_PER_NOTE = 20;
// 색인하는 동안 받은 벡터를 파일에 적는 간격. 파일은 노트가 많으면 수십 MB라 요청마다 쓰면 디스크가 바빠지고,
// 너무 드물면 도중에 끄면 받은 벡터를 잃어 다시 보내야 합니다.
const SAVE_INTERVAL_MS = 30_000;
// 사용량 제한(429)에 걸리면 기다렸다 다시 보냅니다. 무료 API는 분당 요청 수가 적어 첫 색인 도중 자주 걸리는데,
// 그때마다 멈추면 사용자가 [다시 시도]를 여러 번 눌러야 합니다. 기다리는 시간은 횟수마다 늘립니다(20초·40초·60초).
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_WAIT_MS = 20_000;

interface StoredNote {
	mtime: number;
	hash: string;
	vectors: string[]; // 비어 있으면 보낼 본문이 없는 노트
}

interface StoredIndex {
	version: number;
	baseUrl: string;
	model: string;
	notes: Record<string, StoredNote>;
}

interface NoteEntry {
	mtime: number;
	hash: string;
	vectors: Float32Array[];
}

export type IndexState =
	| { kind: 'not-configured' } // 서버 주소나 모델이 비어 있음
	| { kind: 'not-built'; builtWith: string } // 색인이 없거나(builtWith '') 다른 서버·모델로 만든 색인
	| { kind: 'indexing'; done: number; total: number; waiting: boolean } // waiting: 사용량 제한으로 기다리는 중
	| { kind: 'error'; failure: LlmFailure }
	| { kind: 'ready'; count: number };

export interface SimilarNote {
	path: string;
	score: number; // -1~1, 클수록 비슷함
}

class Stopped extends Error {}

// "http://서버/v1"과 "http://서버/v1/"은 같은 서버입니다. 끝의 /만 달라 색인을 다시 만들게 되지 않게 맞춥니다.
function sameServerUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

export class LinkIndex {
	private owner: { baseUrl: string; model: string } | null = null;
	private notes = new Map<string, NoteEntry>();
	private running: Promise<void> | null = null;
	private runAgain = false;
	private progress = { done: 0, total: 0, waiting: false };
	private failure: LlmFailure | null = null;
	private stopped = false;
	private listeners = new Set<() => void>();
	// 파일 쓰기를 한 줄로 세웁니다. 두 저장이 겹치면 같은 파일을 동시에 써서 내용이 깨질 수 있습니다.
	private saving: Promise<void> = Promise.resolve();

	// rateLimitWaitMs는 테스트에서 기다림을 줄이려고만 바꿉니다.
	constructor(
		private readonly plugin: IntraCopilotPlugin,
		private readonly rateLimitWaitMs = RATE_LIMIT_WAIT_MS,
	) {}

	private get path(): string {
		return `${pluginDir(this.plugin)}/${INDEX_FILE}`;
	}

	private matchesSettings(): boolean {
		const { baseUrl, model } = this.plugin.settings.link;
		return this.owner !== null && this.owner.baseUrl === sameServerUrl(baseUrl) && this.owner.model === model;
	}

	state(): IndexState {
		const { baseUrl, model } = this.plugin.settings.link;
		if (!baseUrl || !model) return { kind: 'not-configured' };
		if (!this.matchesSettings()) return { kind: 'not-built', builtWith: this.owner?.model ?? '' };
		if (this.running) return { kind: 'indexing', ...this.progress };
		if (this.failure) return { kind: 'error', failure: this.failure };
		return { kind: 'ready', count: this.notes.size };
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
			const data = JSON.parse(await adapter.read(path)) as Partial<StoredIndex>;
			// 읽는 사이 [색인 만들기]를 눌렀다면 새 색인을 옛 파일로 덮지 않습니다.
			if (this.owner !== ownerBefore) return;
			if (data.version !== INDEX_VERSION || typeof data.baseUrl !== 'string' || typeof data.model !== 'string') return;
			const notes = new Map<string, NoteEntry>();
			for (const [notePath, note] of Object.entries(data.notes ?? {})) {
				if (typeof note?.mtime !== 'number' || typeof note.hash !== 'string' || !Array.isArray(note.vectors)) continue;
				const vectors = note.vectors
					.map((text) => (typeof text === 'string' ? decodeVector(text) : null))
					.filter((vector): vector is Float32Array => vector !== null);
				notes.set(notePath, { mtime: note.mtime, hash: note.hash, vectors });
			}
			this.owner = { baseUrl: sameServerUrl(data.baseUrl), model: data.model };
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
		for (const [path, note] of this.notes) {
			notes[path] = { mtime: note.mtime, hash: note.hash, vectors: note.vectors.map(encodeVector) };
		}
		const data: StoredIndex = { version: INDEX_VERSION, ...this.owner, notes };
		const { adapter } = this.plugin.app.vault;
		const temp = `${this.path}.tmp`;
		await adapter.write(temp, JSON.stringify(data));
		if (await adapter.exists(this.path)) await adapter.remove(this.path);
		await adapter.rename(temp, this.path);
	}

	// [색인 만들기]·[다시 만들기]: 지금 설정의 서버·모델로 처음부터 만듭니다.
	async rebuild(): Promise<void> {
		const { baseUrl, model } = this.plugin.settings.link;
		if (!baseUrl || !model) return;
		this.owner = { baseUrl: sameServerUrl(baseUrl), model };
		this.notes.clear();
		this.failure = null;
		await this.save();
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
					// 서버 실패가 아닌 문제(색인 파일 쓰기 실패 등)도 화면에 이유가 보이게 합니다.
					this.failure = { ok: false, kind: 'unknown', detail: error instanceof Error ? error.message : String(error) };
				}
			} while (this.runAgain && !this.failure && !this.stopped);
		})().finally(() => {
			this.running = null;
			this.emit();
		});
		this.emit();
		return this.running;
	}

	stop(): void {
		this.stopped = true;
	}

	// 이름 변경·삭제는 폴더를 옮기거나 지우면 여러 번 오므로, 잠잠해진 뒤 한 번만 색인을 맞춥니다.
	// 맞추기(sync)는 제외 폴더로 옮겨진 노트를 빼고 저장까지 합니다(바뀐 내용이 없으면 서버로 보내지 않음).
	private readonly settleSoon = debounce(
		() => {
			if (this.matchesSettings()) void this.sync();
			else void this.save().catch(() => {});
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
			const target = path === oldPath ? newPath : path.startsWith(`${oldPath}/`) ? newPath + path.slice(oldPath.length) : null;
			if (target === null) continue;
			this.notes.delete(path);
			this.notes.set(target, entry);
			moved = true;
		}
		if (moved) this.settleSoon();
	}

	remove(path: string): void {
		let removed = false;
		for (const notePath of [...this.notes.keys()]) {
			if (notePath === path || notePath.startsWith(`${path}/`)) removed = this.notes.delete(notePath) || removed;
		}
		if (removed) this.settleSoon();
	}

	// 지금 노트와 비슷한 노트(자신 제외)를 비슷한 순서로. 지금 노트가 아직 색인되지 않았으면 null입니다.
	search(path: string, limit: number): SimilarNote[] | null {
		const current = this.notes.get(path)?.vectors;
		if (!current?.length || !this.matchesSettings()) return null;
		const results: SimilarNote[] = [];
		for (const [otherPath, note] of this.notes) {
			if (otherPath === path) continue;
			const score = noteSimilarity(current, note.vectors);
			if (score > -Infinity) results.push({ path: otherPath, score });
		}
		return results.sort((a, b) => b.score - a.score).slice(0, limit);
	}

	// 제외 폴더·템플릿 폴더의 노트, Excalidraw 그림이면 true(색인하지도 추천하지도 않음).
	isExcluded(path: string): boolean {
		const lower = path.toLowerCase();
		const { app, settings } = this.plugin;
		const skip = [...settings.link.excludedFolders, ...templateFolders(app)].map((folder) => folder.toLowerCase());
		return lower.endsWith('.excalidraw.md') || skip.some((folder) => inFolder(lower, folder));
	}

	private eligibleFiles(): TFile[] {
		return this.plugin.app.vault.getMarkdownFiles().filter((file) => !this.isExcluded(file.path));
	}

	// 노트 하나를 서버로 보낼 조각으로 만듭니다. hash는 보낼 글이 지난번과 같은지 비교하는 값입니다.
	// 제목도 노트의 뜻을 잘 나타내므로 본문 앞에 붙여 보냅니다. 속성(frontmatter)은 날짜 같은 기록이라 뺍니다.
	private prepare(title: string, content: string): { hash: string; chunks: string[] } {
		const text = `${title}\n\n${content.slice(getFrontMatterInfo(content).contentStart)}`.trim();
		return {
			hash: createHash('sha1').update(text).digest('hex'),
			chunks: splitChunks(text, this.plugin.settings.link.chunkChars, MAX_CHUNKS_PER_NOTE),
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
		return { notes, chunks, requests: Math.ceil(chunks / this.plugin.settings.link.batchSize) };
	}

	private async run(): Promise<void> {
		const owner = this.owner;
		const { vault } = this.plugin.app;
		const { batchSize, vectorsPerNote } = this.plugin.settings.link;
		const files = this.eligibleFiles();

		const eligible = new Set(files.map((file) => file.path));
		for (const path of this.notes.keys()) {
			if (!eligible.has(path)) this.notes.delete(path);
		}
		const todo = files.filter((file) => this.notes.get(file.path)?.mtime !== file.stat.mtime);
		this.progress = { done: 0, total: todo.length, waiting: false };
		this.failure = null;
		this.emit();

		// 서버가 같은 모델 이름으로 다른 모델을 돌리기 시작하면 벡터 크기가 달라져 서로 비교할 수 없습니다.
		// 섞어 저장하면 추천에서 조용히 빠지므로, 알아채는 즉시 멈추고 알립니다.
		let dims = this.notes.values().next().value?.vectors[0]?.length ?? 0;
		type Pending = { path: string; mtime: number; hash: string; chunks: number; vectors: number[][] };
		const queue: { note: Pending; text: string }[] = [];
		let lastSave = Date.now();

		// 조각을 batchSize개씩 보내고, 조각 벡터가 다 모인 노트부터 저장합니다.
		const send = async (all: boolean) => {
			while (queue.length >= batchSize || (all && queue.length > 0)) {
				if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
				const batch = queue.splice(0, batchSize);
				const inputs = batch.map((item) => item.text);
				let result = await createEmbeddings(this.plugin.settings.link, inputs);
				for (let attempt = 1; !result.ok && result.kind === 'rate-limit' && attempt <= RATE_LIMIT_RETRIES; attempt++) {
					this.progress.waiting = true;
					this.emit();
					await new Promise((resolve) => window.setTimeout(resolve, this.rateLimitWaitMs * attempt));
					this.progress.waiting = false;
					if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
					result = await createEmbeddings(this.plugin.settings.link, inputs);
				}
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
					if (note.vectors.length < note.chunks) continue;
					this.notes.set(note.path, { mtime: note.mtime, hash: note.hash, vectors: noteVectors(note.vectors, vectorsPerNote) });
					this.progress.done++;
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
				const note: Pending = { path: file.path, mtime: file.stat.mtime, hash, chunks: chunks.length, vectors: [] };
				for (const chunk of chunks) queue.push({ note, text: chunk });
				await send(false);
			}
			await send(true);
		} catch (error) {
			if (!(error instanceof Stopped)) throw error;
		} finally {
			// 실패하거나 멈춰도 그때까지 받은 벡터는 남깁니다(다음에 이어서 색인).
			if (this.owner === owner) await this.save();
		}
	}
}
