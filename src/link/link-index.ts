import { createHash } from 'crypto';
import { debounce, getFrontMatterInfo, TFile } from 'obsidian';
import type IntraCopilotPlugin from '../main';
import { createEmbeddings, type LlmFailure } from '../llm/client';
import { pluginDir } from '../plugin-paths';
import { inFolder } from '../reminder/due-notes';
import { templateFolders } from '../ui/reminder-view';
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
const SAVE_EVERY_REQUESTS = 10;

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
	| { kind: 'indexing'; done: number; total: number }
	| { kind: 'error'; failure: LlmFailure }
	| { kind: 'ready'; count: number };

export interface SimilarNote {
	path: string;
	score: number; // -1~1, 클수록 비슷함
}

class Stopped extends Error {}

export class LinkIndex {
	private owner: { baseUrl: string; model: string } | null = null;
	private notes = new Map<string, NoteEntry>();
	private running: Promise<void> | null = null;
	private runAgain = false;
	private progress = { done: 0, total: 0 };
	private failure: LlmFailure | null = null;
	private stopped = false;
	private listeners = new Set<() => void>();

	constructor(private readonly plugin: IntraCopilotPlugin) {}

	private get path(): string {
		return `${pluginDir(this.plugin)}/${INDEX_FILE}`;
	}

	private matchesSettings(): boolean {
		const { baseUrl, model } = this.plugin.settings.link;
		return this.owner !== null && this.owner.baseUrl === baseUrl && this.owner.model === model;
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
	async load(): Promise<void> {
		const { adapter } = this.plugin.app.vault;
		try {
			if (!(await adapter.exists(this.path))) return;
			const data = JSON.parse(await adapter.read(this.path)) as Partial<StoredIndex>;
			if (data.version !== INDEX_VERSION || typeof data.baseUrl !== 'string' || typeof data.model !== 'string') return;
			this.owner = { baseUrl: data.baseUrl, model: data.model };
			for (const [path, note] of Object.entries(data.notes ?? {})) {
				if (typeof note?.mtime !== 'number' || typeof note.hash !== 'string' || !Array.isArray(note.vectors)) continue;
				const vectors = note.vectors.map((text) => (typeof text === 'string' ? decodeVector(text) : null));
				this.notes.set(path, { mtime: note.mtime, hash: note.hash, vectors: vectors.filter((v): v is Float32Array => v !== null) });
			}
		} catch {
			this.owner = null;
			this.notes.clear();
		} finally {
			this.emit();
		}
	}

	private async save(): Promise<void> {
		if (!this.owner) return;
		const notes: Record<string, StoredNote> = {};
		for (const [path, note] of this.notes) {
			notes[path] = { mtime: note.mtime, hash: note.hash, vectors: note.vectors.map(encodeVector) };
		}
		const data: StoredIndex = { version: INDEX_VERSION, ...this.owner, notes };
		await this.plugin.app.vault.adapter.write(this.path, JSON.stringify(data));
	}

	// [색인 만들기]·[다시 만들기]: 지금 설정의 서버·모델로 처음부터 만듭니다.
	async rebuild(): Promise<void> {
		const { baseUrl, model } = this.plugin.settings.link;
		if (!baseUrl || !model) return;
		this.owner = { baseUrl, model };
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
			} while (this.runAgain && !this.failure);
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

	// 폴더를 옮기거나 지우면 안의 파일마다 불리므로, 잠잠해진 뒤 한 번만 저장하고 알립니다.
	private readonly saveSoon = debounce(
		() => {
			void this.save();
			this.emit();
		},
		2000,
		true,
	);

	// 이름을 바꾸거나 옮긴 노트는 다시 보내지 않고 기록만 옮깁니다(수정 시각이 그대로라 다음 색인에서도 건너뜀).
	rename(oldPath: string, newPath: string): void {
		const entry = this.notes.get(oldPath);
		if (!entry) return;
		this.notes.delete(oldPath);
		this.notes.set(newPath, entry);
		this.saveSoon();
	}

	remove(path: string): void {
		if (this.notes.delete(path)) this.saveSoon();
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

	private eligibleFiles(): TFile[] {
		const { app, settings } = this.plugin;
		const skip = [...settings.link.excludedFolders, ...templateFolders(app)].map((folder) => folder.toLowerCase());
		return app.vault.getMarkdownFiles().filter((file) => {
			const lower = file.path.toLowerCase();
			return !lower.endsWith('.excalidraw.md') && !skip.some((folder) => inFolder(lower, folder));
		});
	}

	private async run(): Promise<void> {
		const owner = this.owner;
		const { vault } = this.plugin.app;
		const { batchSize, chunkChars, vectorsPerNote } = this.plugin.settings.link;
		const files = this.eligibleFiles();

		const eligible = new Set(files.map((file) => file.path));
		for (const path of this.notes.keys()) {
			if (!eligible.has(path)) this.notes.delete(path);
		}
		const todo = files.filter((file) => this.notes.get(file.path)?.mtime !== file.stat.mtime);
		this.progress = { done: 0, total: todo.length };
		this.failure = null;
		this.emit();

		type Pending = { path: string; mtime: number; hash: string; chunks: number; vectors: number[][] };
		const queue: { note: Pending; text: string }[] = [];
		let requests = 0;

		// 조각을 batchSize개씩 보내고, 조각 벡터가 다 모인 노트부터 저장합니다.
		const send = async (all: boolean) => {
			while (queue.length >= batchSize || (all && queue.length > 0)) {
				if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
				const batch = queue.splice(0, batchSize);
				const result = await createEmbeddings(this.plugin.settings.link, batch.map((item) => item.text));
				// 기다리는 사이 [다시 만들기]를 눌렀거나 서버·모델을 바꿨으면 옛 서버의 결과라 버립니다.
				if (this.stopped || this.owner !== owner || !this.matchesSettings()) throw new Stopped();
				if (!result.ok) {
					this.failure = result;
					throw new Stopped();
				}
				batch.forEach((item, i) => item.note.vectors.push(result.vectors[i]!));
				for (const note of new Set(batch.map((item) => item.note))) {
					if (note.vectors.length < note.chunks) continue;
					this.notes.set(note.path, { mtime: note.mtime, hash: note.hash, vectors: noteVectors(note.vectors, vectorsPerNote) });
					this.progress.done++;
				}
				this.emit();
				if (++requests % SAVE_EVERY_REQUESTS === 0) await this.save();
			}
		};

		try {
			for (const file of todo) {
				// 제목도 노트의 뜻을 잘 나타내므로 본문 앞에 붙여 보냅니다. 속성(frontmatter)은 날짜 같은 기록이라 뺍니다.
				// 읽는 사이 지워진 노트는 건너뜁니다(다음 색인에서 기록도 빠짐).
				const content = await vault.cachedRead(file).catch(() => null);
				if (content === null) {
					this.progress.done++;
					continue;
				}
				const text = `${file.basename}\n\n${content.slice(getFrontMatterInfo(content).contentStart)}`.trim();
				const hash = createHash('sha1').update(text).digest('hex');
				const existing = this.notes.get(file.path);
				if (existing?.hash === hash) {
					existing.mtime = file.stat.mtime;
					this.progress.done++;
					continue;
				}
				const chunks = splitChunks(text, chunkChars, MAX_CHUNKS_PER_NOTE);
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
