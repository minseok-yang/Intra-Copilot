import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TFile } from './obsidian-mock';
import { ConnectorIndex } from '../src/connector/connector-index';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── 가짜 임베딩 서버 ─────────────────────────────────────
const TOPICS = ['apple', 'car', 'music', 'space'];
type Mode = {
	failAfter?: number; // 이만큼 성공한 뒤부터 status로 실패
	status?: number;
	dropOne?: boolean;
	delayMs?: number;
	dimsAfter?: number; // 이만큼 요청한 뒤부터 벡터 크기를 바꿈
	reverse?: boolean;
	limitTimes?: number; // 처음 이만큼은 429(사용량 제한)
};
let mode: Mode = {};
let served = 0;
let sentTexts: string[] = [];
let rawBodies: string[] = [];

function embed(text: string, dims: number): number[] {
	const v = new Array<number>(dims).fill(0);
	const lower = text.toLowerCase();
	TOPICS.forEach((word, i) => (v[i] = lower.split(word).length - 1));
	v[dims - 1] = 0.05;
	return v;
}

const server = http.createServer((req, res) => {
	let body = '';
	req.on('data', (c: Buffer) => (body += c.toString('utf8')));
	req.on('end', () => {
		void (async () => {
			if (req.url?.endsWith('/models')) {
				res.end(JSON.stringify({ data: [{ id: 'm' }] }));
				return;
			}
			if (mode.delayMs) await sleep(mode.delayMs);
			rawBodies.push(body);
			const parsed = JSON.parse(body) as { input: string[]; model: string; dimensions?: number };
			const n = served++;
			if (mode.limitTimes !== undefined && n < mode.limitTimes) {
				res.statusCode = 429;
				res.end(JSON.stringify({ error: { message: "rate limited" } }));
				return;
			}
			if (mode.failAfter !== undefined && n >= mode.failAfter) {
				res.statusCode = mode.status ?? 500;
				res.end(JSON.stringify({ error: { message: `fail ${res.statusCode}` } }));
				return;
			}
			// Rust·Go로 만든 실제 서버는 짝이 없는 서로게이트가 든 JSON을 거절합니다
			if (/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(body) || /(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i.test(body)) {
				res.statusCode = 400;
				res.end(JSON.stringify({ error: { message: 'lone surrogate in input' } }));
				return;
			}
			sentTexts.push(...parsed.input);
			const dims = parsed.dimensions ?? (mode.dimsAfter !== undefined && n >= mode.dimsAfter ? 16 : 8);
			let data = parsed.input.map((t, i) => ({ index: i, embedding: embed(t, dims) }));
			if (mode.dropOne) data = data.slice(1);
			if (mode.reverse) data = data.reverse();
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify({ data }));
		})();
	});
});

// ─── 가짜 볼트·플러그인 ───────────────────────────────────
class FakeVault {
	files = new Map<string, { content: string; mtime: number }>();
	store = new Map<string, string | ArrayBuffer>();
	writeDelayMs = 0;
	readDelayMs = 0;
	activeWrites = 0;
	writes = 0;
	overlaps = 0;
	clock = 1000;
	put(path: string, content: string) {
		this.files.set(path, { content, mtime: ++this.clock });
	}
	getMarkdownFiles() {
		return [...this.files].filter(([p]) => p.endsWith('.md')).map(([p, f]) => new TFile(p, f.mtime));
	}
	async cachedRead(file: TFile) {
		const f = this.files.get(file.path);
		if (!f) throw new Error('ENOENT');
		return f.content;
	}
	getFileByPath(path: string) {
		const f = this.files.get(path);
		return f ? new TFile(path, f.mtime) : null;
	}
	adapter = {
		exists: async (p: string) => this.store.has(p),
		read: async (p: string) => {
			const v = this.store.get(p); // 실제 디스크 읽기처럼 읽기를 시작한 순간의 내용을 돌려줌
			if (this.readDelayMs) await sleep(this.readDelayMs);
			if (v === undefined) throw new Error('ENOENT');
			return v;
		},
		write: async (p: string, data: string) => this.adapter.writeBinary(p, data),
		writeBinary: async (p: string, data: string | ArrayBuffer) => {
			this.writes++;
			this.activeWrites++;
			if (this.activeWrites > 1) this.overlaps++;
			if (this.writeDelayMs) await sleep(this.writeDelayMs);
			this.store.set(p, data);
			this.activeWrites--;
		},
		readBinary: async (p: string) => {
			const v = this.store.get(p);
			if (this.readDelayMs) await sleep(this.readDelayMs);
			if (!(v instanceof ArrayBuffer)) throw new Error('ENOENT');
			return v;
		},
		remove: async (p: string) => void this.store.delete(p),
		rename: async (from: string, to: string) => {
			if (this.store.has(to)) throw new Error('Destination file already exists!');
			this.store.set(to, this.store.get(from)!);
			this.store.delete(from);
		},
	};
}

function makePlugin(port: number) {
	const vault = new FakeVault();
	const plugin = {
		app: { vault },
		manifest: { dir: 'plug', id: 'intra-copilot' },
		settings: {
			general: { language: 'ko' as const },
			connector: {
				...DEFAULT_SETTINGS.connector,
				baseUrl: `http://127.0.0.1:${port}/v1`,
				model: 'm',
				batchSize: 4,
				chunkChars: 200,
				excludedFolders: ['Private'],
			},
		},
	};
	return { vault, plugin };
}

function seed(vault: FakeVault) {
	vault.put('Fruit/apple1.md', 'apple apple apple');
	vault.put('apple2.md', '---\ntags: x\n---\napple pie with apple');
	vault.put('car1.md', 'car car engine');
	vault.put('music1.md', 'music music');
	vault.put('private/secret.md', 'apple secret');
	vault.put('draw.excalidraw.md', 'apple drawing');
	vault.put('image.png', 'binary');
	const appleSection = Array.from({ length: 3 }, () => 'apple '.repeat(30)).join('\n\n');
	const carSection = Array.from({ length: 5 }, () => 'car '.repeat(45)).join('\n\n');
	vault.put('mixed.md', `${appleSection}\n\n${carSection}`);
}

// 색인 파일(connector-index.bin) 모양: [머리말 길이 4바이트][머리말 JSON][4바이트 정렬][float32 벡터]
function binaryIndex(header: unknown): ArrayBuffer {
	const json = new TextEncoder().encode(JSON.stringify(header));
	const buffer = new ArrayBuffer(Math.ceil((4 + json.length) / 4) * 4);
	new DataView(buffer).setUint32(0, json.length, true);
	new Uint8Array(buffer, 4).set(json);
	return buffer;
}

function indexHeader(vault: FakeVault): unknown {
	const buffer = vault.store.get('plug/connector-index.bin') as ArrayBuffer;
	const length = new DataView(buffer).getUint32(0, true);
	return JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, length)));
}

function reset(next: Mode = {}) {
	mode = next;
	served = 0;
	sentTexts = [];
	rawBodies = [];
}

const results: { name: string; ok: boolean; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) {
	reset();
	try {
		await fn();
		results.push({ name, ok: true });
	} catch (error) {
		results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
	}
}

async function main() {
	await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
	const port = (server.address() as AddressInfo).port;
	const setup = async (build = true) => {
		const { vault, plugin } = makePlugin(port);
		seed(vault);
		const index = new ConnectorIndex(plugin as never, 5);
		if (build) await index.rebuild();
		return { vault, plugin, index };
	};

	await test('T01 rebuild indexes eligible notes only, batches ≤ batchSize', async () => {
		const { index } = await setup();
		assert.deepStrictEqual(index.state(), { kind: 'ready', count: 5 });
		assert.ok(!sentTexts.some((t) => t.includes('secret')), 'excluded folder (case-insensitive) sent');
		assert.ok(!sentTexts.some((t) => t.includes('drawing')), 'excalidraw sent');
		assert.ok(rawBodies.every((b) => (JSON.parse(b) as { input: string[] }).input.length <= 4));
		assert.ok(!sentTexts.some((t) => t.includes('tags: x')), 'frontmatter sent');
		const top = index.search('Fruit/apple1.md', 10)!;
		assert.strictEqual(top[0]!.path, 'apple2.md');
	});

	await test('T02 sync without changes sends nothing', async () => {
		const { index } = await setup();
		reset();
		await index.sync();
		assert.strictEqual(served, 0);
	});

	await test('T03 frontmatter-only change is not re-sent', async () => {
		const { vault, index } = await setup();
		reset();
		vault.put('apple2.md', '---\ntags: x\nread: 2026-09-15\n---\napple pie with apple');
		await index.sync();
		assert.strictEqual(served, 0);
	});

	await test('T04 body change re-sends only that note', async () => {
		const { vault, index } = await setup();
		reset();
		vault.put('car1.md', 'car car engine wheel');
		await index.sync();
		assert.deepStrictEqual(sentTexts, ['car1\n\ncar car engine wheel']);
	});

	await test('T05 rename keeps vectors without sending', async () => {
		const { vault, index } = await setup();
		reset();
		const f = vault.files.get('car1.md')!;
		vault.files.delete('car1.md');
		vault.files.set('Cars/car1.md', f);
		index.rename('car1.md', 'Cars/car1.md');
		await index.sync();
		assert.strictEqual(served, 0);
		assert.ok(index.search('Cars/car1.md', 3));
	});

	await test('T06 rename into excluded folder drops it from suggestions', async () => {
		const { vault, index } = await setup();
		const f = vault.files.get('apple2.md')!;
		vault.files.delete('apple2.md');
		vault.files.set('Private/apple2.md', f);
		index.rename('apple2.md', 'Private/apple2.md');
		await sleep(2300); // 이름 변경 뒤 잠잠해지기를 기다림
		const top = index.search('Fruit/apple1.md', 10)!;
		assert.ok(!top.some((r) => r.path.startsWith('Private/')), 'excluded note still suggested');
	});

	await test('T07 delete removes note', async () => {
		const { vault, index } = await setup();
		vault.files.delete('apple2.md');
		index.remove('apple2.md');
		assert.ok(!index.search('Fruit/apple1.md', 10)!.some((r) => r.path === 'apple2.md'));
	});

	await test('T08 vectorsPerNote=2 finds multi-topic note better', async () => {
		const a = await setup();
		const k1 = a.index.search('car1.md', 10)!.find((r) => r.path === 'mixed.md')!.score;
		reset();
		const b = await setup(false);
		b.plugin.settings.connector.vectorsPerNote = 2;
		await b.index.rebuild();
		const k2 = b.index.search('car1.md', 10)!.find((r) => r.path === 'mixed.md')!.score;
		const k2apple = b.index.search('Fruit/apple1.md', 10)!.find((r) => r.path === 'mixed.md')!.score;
		assert.ok(k2 > k1 + 0.05 && k2apple > 0.95, `k1=${k1} k2=${k2} k2apple=${k2apple}`);
	});

	await test('T09 persistence round trip; corrupt/old file → not built', async () => {
		const { vault, plugin, index } = await setup();
		const before = index.search('Fruit/apple1.md', 10);
		const again = new ConnectorIndex(plugin as never);
		await again.load();
		assert.deepStrictEqual(again.search('Fruit/apple1.md', 10), before);
		vault.store.set('plug/connector-index.bin', new Uint8Array([200, 1, 0, 0, 7]).buffer);
		const broken = new ConnectorIndex(plugin as never);
		await broken.load();
		assert.strictEqual(broken.state().kind, 'not-built');
		vault.store.set('plug/connector-index.bin', binaryIndex({ version: 2, baseUrl: plugin.settings.connector.baseUrl, model: 'm', notes: {} }));
		const old = new ConnectorIndex(plugin as never);
		await old.load();
		assert.strictEqual(old.state().kind, 'not-built');
	});

	await test('T10 auth failure keeps progress; retry resumes without resending', async () => {
		const { vault, plugin, index } = await setup(false);
		reset({ failAfter: 1, status: 401 });
		await index.rebuild();
		const state = index.state();
		assert.strictEqual(state.kind, 'error');
		assert.strictEqual(state.kind === 'error' && state.failure.kind, 'auth');
		const firstSent = [...sentTexts];
		const saved = indexHeader(vault) as { notes: Record<string, unknown> };
		assert.ok(Object.keys(saved.notes).length >= 1, 'partial progress not saved');
		reset();
		await index.sync();
		assert.strictEqual(index.state().kind, 'ready');
		assert.ok(!sentTexts.some((t) => firstSent.includes(t)), 'already indexed chunks re-sent');
		void plugin;
	});

	await test('T11 vector count mismatch → invalid-response', async () => {
		const { index } = await setup(false);
		reset({ dropOne: true });
		await index.rebuild();
		const s = index.state();
		assert.strictEqual(s.kind === 'error' && s.failure.kind, 'invalid-response');
	});

	await test('T12 out-of-order response is sorted by index', async () => {
		const { index } = await setup(false);
		reset({ reverse: true });
		await index.rebuild();
		assert.strictEqual(index.search('Fruit/apple1.md', 10)![0]!.path, 'apple2.md');
	});

	await test('T13 model change mid-run stops without storing; state not-built', async () => {
		const { plugin, index } = await setup(false);
		reset({ delayMs: 80 });
		const run = index.rebuild();
		await sleep(40);
		plugin.settings.connector.model = 'other';
		await run;
		assert.strictEqual(index.state().kind, 'not-built');
		plugin.settings.connector.model = 'm';
		mode = {};
		await index.sync();
		assert.strictEqual(index.state().kind, 'ready');
	});

	await test('T14 rebuild during run ends consistent', async () => {
		const { index } = await setup(false);
		reset({ delayMs: 30 });
		const first = index.rebuild();
		await sleep(50);
		const second = index.rebuild();
		await Promise.all([first, second]);
		await sleep(50);
		assert.deepStrictEqual(index.state(), { kind: 'ready', count: 5 });
	});

	await test('T15 concurrent sync calls do not duplicate requests', async () => {
		const { vault, index } = await setup();
		reset();
		vault.put('car1.md', 'car new');
		await Promise.all([index.sync(), index.sync(), index.sync()]);
		assert.strictEqual(sentTexts.filter((t) => t.includes('car new')).length, 1);
	});

	await test('T16 emoji at chunk boundary does not produce lone surrogates', async () => {
		const { vault, plugin, index } = await setup(false);
		vault.files.clear();
		plugin.settings.connector.chunkChars = 10;
		vault.put('emoji.md', `${'a'.repeat(5)}😀😀😀😀😀😀😀`); // a 5개 + 이모지: 10칸에서 자르면 이모지 한가운데
		reset();
		await index.rebuild();
		assert.strictEqual(index.state().kind, 'ready', JSON.stringify(index.state()));
	});

	await test('T17 rebuild while load() is still reading keeps the new index', async () => {
		const { vault, plugin, index } = await setup();
		const fresh = new ConnectorIndex(plugin as never);
		vault.readDelayMs = 400; // 다시 만들기가 끝난 뒤에 읽기가 끝나게
		plugin.settings.connector.model = 'm2';
		const loading = fresh.load();
		await fresh.rebuild();
		await loading;
		vault.readDelayMs = 0;
		assert.deepStrictEqual(fresh.state(), { kind: 'ready', count: 5 });
		void index;
	});

	await test('T18 saves never overlap', async () => {
		const { vault, index } = await setup();
		vault.writeDelayMs = 300;
		index.rename('car1.md', 'car2.md'); // 약 2000ms 뒤 저장이 실행됨
		await sleep(1900);
		const p = index.rebuild(); // 2000ms 시점에 이 저장이 아직 쓰는 중
		await p;
		await sleep(600);
		assert.strictEqual(vault.overlaps, 0, `overlapping writes: ${vault.overlaps}`);
	});

	await test('T26 large run does not rewrite the index file on every few requests', async () => {
		const { vault, plugin, index } = await setup(false);
		vault.files.clear();
		for (let i = 0; i < 60; i++) vault.put(`n${i}.md`, `apple ${i}`);
		plugin.settings.connector.batchSize = 1;
		vault.writes = 0;
		await index.rebuild();
		assert.ok(vault.writes <= 3, `writes=${vault.writes}`);
	});

	await test('T27 folder rename event alone keeps child vectors', async () => {
		const { vault, index } = await setup();
		reset();
		const f = vault.files.get('Fruit/apple1.md')!;
		vault.files.delete('Fruit/apple1.md');
		vault.files.set('Food/apple1.md', f);
		index.rename('Fruit', 'Food');
		await index.sync();
		assert.strictEqual(served, 0, 'children re-sent after folder rename');
		assert.ok(index.search('Food/apple1.md', 3));
	});

	await test('T28 folder delete event alone removes children', async () => {
		const { vault, index } = await setup();
		vault.files.delete('Fruit/apple1.md');
		index.remove('Fruit');
		assert.ok(!index.search('apple2.md', 10)!.some((r) => r.path.startsWith('Fruit/')));
	});

	await test('T29 trailing slash in server address does not invalidate index', async () => {
		const { plugin, index } = await setup();
		plugin.settings.connector.baseUrl += '/';
		assert.strictEqual(index.state().kind, 'ready');
	});

	await test('T30 interrupted save (only temp file left) is recovered', async () => {
		const { vault, plugin } = await setup();
		const data = vault.store.get('plug/connector-index.bin')!;
		vault.store.delete('plug/connector-index.bin');
		vault.store.set('plug/connector-index.bin.tmp', data);
		const again = new ConnectorIndex(plugin as never);
		await again.load();
		assert.strictEqual(again.state().kind, 'ready');
	});

	await test('T31 isExcluded tells excluded notes apart from not-yet-indexed', async () => {
		const { index } = await setup();
		const idx = index as unknown as { isExcluded: (p: string) => boolean };
		assert.strictEqual(idx.isExcluded('private/secret.md'), true);
		assert.strictEqual(idx.isExcluded('draw.excalidraw.md'), true);
		assert.strictEqual(idx.isExcluded('new.md'), false);
	});

	await test('T19 server dimension change is reported, not silently mixed', async () => {
		const { index } = await setup(false);
		reset({ dimsAfter: 1 });
		await index.rebuild();
		assert.strictEqual(index.state().kind, 'error', JSON.stringify(index.state()));
	});

	await test('T20 very long note sends at most 20 chunks', async () => {
		const { vault, plugin, index } = await setup(false);
		vault.files.clear();
		vault.put('long.md', Array.from({ length: 60 }, (_, i) => `para ${i} `.repeat(20)).join('\n\n'));
		plugin.settings.connector.chunkChars = 200;
		reset();
		await index.rebuild();
		assert.ok(sentTexts.length <= 20, `sent ${sentTexts.length}`);
	});

	await test('T21 stop() halts further requests', async () => {
		const { index } = await setup(false);
		reset({ delayMs: 30 });
		const run = index.rebuild();
		await sleep(40);
		index.stop();
		const count = served;
		await run;
		assert.ok(served <= count + 1, `served ${served} after stop at ${count}`);
	});

	await test('T22 frontmatter-only / empty note is indexed by title', async () => {
		const { vault, index } = await setup(false);
		vault.put('empty.md', '---\na: 1\n---\n');
		vault.put('blank.md', '');
		await index.rebuild();
		assert.ok(sentTexts.includes('empty') && sentTexts.includes('blank'));
	});

	await test('T23 excluded folder change + sync removes entries', async () => {
		const { plugin, index } = await setup();
		plugin.settings.connector.excludedFolders = ['Private', 'Fruit'];
		await index.sync();
		assert.ok(!index.search('apple2.md', 10)!.some((r) => r.path.startsWith('Fruit/')));
	});

	await test('T24 network down → network error, not crash', async () => {
		const { plugin, index } = await setup(false);
		plugin.settings.connector.baseUrl = 'http://127.0.0.1:1/v1';
		await index.rebuild();
		const s = index.state();
		assert.strictEqual(s.kind === 'error' && s.failure.kind, 'network');
	});

	await test('T25 search on unknown/excluded note returns null', async () => {
		const { index } = await setup();
		assert.strictEqual(index.search('private/secret.md', 10), null);
		assert.strictEqual(index.search('nope.md', 10), null);
	});

	await test("T32 rate limit waits and continues", async () => {
		const { index } = await setup(false);
		reset({ limitTimes: 2 });
		let sawWaiting = false;
		index.subscribe(() => {
			const s = index.state();
			if (s.kind === "indexing" && s.waiting) sawWaiting = true;
		});
		await index.rebuild();
		assert.deepStrictEqual(index.state(), { kind: "ready", count: 5 });
		assert.ok(sawWaiting, "waiting state not shown");
	});

	await test("T33 rate limit beyond retries stops with rate-limit error", async () => {
		const { index } = await setup(false);
		reset({ limitTimes: 100 });
		await index.rebuild();
		const s = index.state();
		assert.strictEqual(s.kind === "error" && s.failure.kind, "rate-limit");
		assert.strictEqual(served, 4, `served=${served}`);
	});

	await test("T34 estimate matches what rebuild actually sends", async () => {
		const { index } = await setup(false);
		const estimate = await index.estimate();
		assert.strictEqual(served, 0, "estimate must not contact the server");
		await index.rebuild();
		assert.deepStrictEqual(estimate, { notes: 5, chunks: sentTexts.length, requests: rawBodies.length });
	});

	await test("T35 adding or removing only links (and blank lines) is not re-sent", async () => {
		const { vault, index } = await setup();
		reset();
		vault.put('apple2.md', '---\ntags: x\n---\napple [[car1]] pie with apple\n\n![[image.png]]\n\n[music](music1.md)\n');
		await index.sync();
		assert.strictEqual(served, 0, 'link-only change re-sent');
		vault.put('apple2.md', '---\ntags: x\n---\napple pie with apple and banana');
		await index.sync();
		assert.strictEqual(served, 1, "real text change not re-sent");
	});

	await test('T36 dimensions setting is sent only when set, and size change is caught', async () => {
		const { vault, plugin, index } = await setup();
		assert.ok(rawBodies.every((b) => !b.includes('dimensions')), 'dimensions sent while 0');
		reset();
		plugin.settings.connector.dimensions = 6;
		await index.rebuild();
		assert.ok(rawBodies.every((b) => (JSON.parse(b) as { dimensions?: number }).dimensions === 6));
		assert.strictEqual(index.state().kind, 'ready');
		// 크기를 바꾸면 고급 설정이 바뀐 것이라 섞어 저장하지 않고 다시 만들 때까지 멈춥니다.
		plugin.settings.connector.dimensions = 5;
		vault.put('car1.md', 'car changed');
		reset();
		await index.sync();
		assert.strictEqual(served, 0, 'sent with changed dimensions');
		assert.deepStrictEqual(index.state(), { kind: 'not-built', builtWith: '', optionsChanged: true });
	});

	await test('T37 document format is applied to every chunk; missing {text} falls back', async () => {
		const { vault, plugin, index } = await setup(false);
		plugin.settings.connector.documentFormat = 'title: {title} | text: {text}';
		await index.rebuild();
		assert.ok(sentTexts.includes('title: car1 | text: car car engine'), JSON.stringify(sentTexts.slice(0, 3)));
		const mixedChunks = sentTexts.filter((t) => t.startsWith('title: mixed | text: '));
		assert.ok(mixedChunks.length > 1, 'title not repeated on every chunk');
		reset();
		plugin.settings.connector.documentFormat = 'no body here';
		vault.put('music1.md', 'music music drums');
		await index.rebuild();
		assert.ok(sentTexts.includes('music1\n\nmusic music drums'), JSON.stringify(sentTexts.slice(0, 3)));
	});

	await test('T43 $ signs in note text ($$ math, $&) are sent unchanged', async () => {
		const { vault, index } = await setup(false);
		vault.files.clear();
		vault.put('math.md', 'apple $$E=mc^2$$ and $& here');
		vault.put('$&$$.md', 'car');
		reset();
		await index.rebuild();
		assert.deepStrictEqual(sentTexts.sort(), ['$&$$\n\ncar', 'math\n\napple $$E=mc^2$$ and $& here']);
	});

	await test('T44 after an indexing error, automatic update does not resend until retry', async () => {
		const { vault, plugin, index } = await setup(false);
		reset({ failAfter: 0, status: 401 });
		await index.rebuild();
		assert.strictEqual(index.state().kind, 'error');
		const failed = served;
		plugin.settings.connector.autoSyncSeconds = 1;
		vault.put('car1.md', 'car edited');
		index.requestSync();
		await sleep(1300);
		assert.strictEqual(served, failed, 'resent automatically while in error');
		reset();
		await index.sync(); // [다시 시도]
		assert.strictEqual(index.state().kind, 'ready');
		index.stop();
	});

	await test('T45 shortening the update interval moves an already scheduled update earlier', async () => {
		const { plugin, index } = await setup();
		const timer = () => index as unknown as { syncTimer: unknown; syncDueAt: number };
		plugin.settings.connector.autoSyncSeconds = 3600;
		index.requestSync();
		const hourDue = timer().syncDueAt;
		plugin.settings.connector.autoSyncSeconds = 600;
		index.requestSync();
		assert.ok(timer().syncDueAt <= hourDue - 3000 * 1000, 'still waiting for the 1-hour schedule');
		const tenDue = timer().syncDueAt;
		plugin.settings.connector.autoSyncSeconds = 1800;
		index.requestSync(); // 늘리면 이미 잡힌 예약을 미루지 않음
		assert.strictEqual(timer().syncDueAt, tenDue);
		plugin.settings.connector.autoSyncSeconds = 0;
		index.requestSync();
		assert.strictEqual(timer().syncTimer, null, 'turning it off keeps a pending update');
		index.stop();
	});

	await test('T46 a note renamed or deleted while its vectors are on the way is stored under the new path or not at all', async () => {
		const { vault, index } = await setup(false);
		reset({ delayMs: 150 });
		const running = index.rebuild();
		await sleep(60); // 첫 요청(apple1·apple2·car1·mixed 앞 조각)이 서버에 가 있는 동안
		const car = vault.files.get('car1.md')!;
		vault.files.delete('car1.md');
		vault.files.set('Cars/car2.md', car);
		index.rename('car1.md', 'Cars/car2.md');
		vault.files.delete('apple2.md');
		index.remove('apple2.md');
		await running;
		assert.notStrictEqual(index.search('Cars/car2.md', 10), null, 'renamed note not stored under the new path');
		assert.strictEqual(index.search('car1.md', 10), null);
		assert.strictEqual(index.search('apple2.md', 10), null);
		reset();
		await index.sync();
		assert.deepStrictEqual(sentTexts, [], 'renamed note was sent again');
	});

	await test('T47 stop() saves a rename that was still waiting to be saved', async () => {
		const { vault, index } = await setup();
		index.rename('car1.md', 'car9.md');
		index.stop();
		await sleep(50);
		const notes = Object.keys((indexHeader(vault) as { notes: Record<string, unknown> }).notes);
		assert.ok(notes.includes('car9.md') && !notes.includes('car1.md'), JSON.stringify(notes));
	});

	await test('T48 an excluded folder added while indexing: its notes are not sent', async () => {
		const { vault, plugin, index } = await setup(false);
		vault.put('Later/late.md', 'zebra late note');
		reset({ delayMs: 150 });
		const running = index.rebuild();
		await sleep(60); // 첫 요청이 서버에 가 있는 동안 제외 폴더를 넣음
		plugin.settings.connector.excludedFolders = ['Private', 'Later'];
		await running;
		assert.ok(!sentTexts.some((t) => t.includes('zebra')), 'note in the newly excluded folder was sent');
		assert.deepStrictEqual(index.state(), { kind: 'ready', count: 5 });
	});

	await test('T49 a note moved into an excluded folder or deleted while its chunks wait: the rest is not sent', async () => {
		for (const action of ['move', 'delete'] as const) {
			const { vault, index } = await setup(false);
			reset({ delayMs: 150 });
			const running = index.rebuild();
			await sleep(220); // 둘째 요청(mixed 앞 4조각)이 서버에 가 있는 동안, mixed 뒤 4조각은 줄 서 있음
			if (action === 'move') index.rename('mixed.md', 'Private/mixed.md');
			else index.remove('mixed.md');
			await running;
			const mixedSent = sentTexts.filter((t) => t.startsWith('mixed')).length;
			assert.strictEqual(mixedSent, 4, `${action}: mixed chunks sent ${mixedSent}`);
			const state = index.state();
			assert.ok(state.kind === 'ready', `${action}: ${JSON.stringify(state)}`);
		}
	});

	await test('T49b a note deleted while it is being read is not sent', async () => {
		const { vault, index } = await setup(false);
		vault.files.clear();
		vault.put('ghost.md', 'zebra ghost');
		vault.put('car1.md', 'car car engine');
		const read = vault.cachedRead.bind(vault);
		vault.cachedRead = async (file: TFile) => {
			const content = await read(file);
			// 읽기가 끝난 직후, 아직 inFlight에 넣기 전에 지움
			if (file.path === 'ghost.md') {
				vault.files.delete('ghost.md');
				index.remove('ghost.md');
			}
			return content;
		};
		reset();
		await index.rebuild();
		assert.ok(!sentTexts.some((t) => t.includes('zebra')), 'deleted note was sent');
		assert.deepStrictEqual(index.state(), { kind: 'ready', count: 1 });
	});

	await test('T50 document format fills {title}/{text} in one pass: a title with "{text}", {title} used twice', async () => {
		const { vault, plugin, index } = await setup(false);
		vault.files.clear();
		vault.put('{text} guide.md', 'apple body');
		reset();
		await index.rebuild();
		assert.deepStrictEqual(sentTexts, ['{text} guide\n\napple body']);
		vault.files.clear();
		vault.put('car1.md', 'car');
		plugin.settings.connector.documentFormat = '{title} | {title}: {text}';
		reset();
		await index.rebuild();
		assert.deepStrictEqual(sentTexts, ['car1 | car1: car']);
	});

	await test('T51 a sync with nothing changed does not rewrite the index file', async () => {
		const { vault, plugin, index } = await setup();
		vault.writes = 0;
		await index.sync();
		assert.strictEqual(vault.writes, 0, `writes=${vault.writes}`);
		plugin.settings.connector.excludedFolders = ['Private', 'Fruit']; // 기록을 빼야 하면 씀
		await index.sync();
		assert.strictEqual(vault.writes, 1, `writes=${vault.writes}`);
	});

	await test('T52 when the index file cannot be written, [Start indexing] shows an error and sends nothing', async () => {
		const { vault, index } = await setup(false);
		vault.adapter.writeBinary = async () => {
			throw new Error('EACCES');
		};
		reset();
		await index.rebuild();
		const state = index.state();
		assert.ok(state.kind === 'error' && state.failure.detail === 'EACCES', JSON.stringify(state));
		assert.strictEqual(served, 0);
	});

	await test('T53 vector size check uses a note that has vectors, even if the first stored note has none', async () => {
		const { vault, index } = await setup();
		const notes = (index as unknown as { notes: Map<string, { vectors: Float32Array[] }> }).notes;
		[...notes.values()][0]!.vectors = [];
		reset({ dimsAfter: 0 });
		vault.put('car1.md', 'car changed dims');
		await index.sync();
		const state = index.state();
		assert.ok(state.kind === 'error' && state.failure.kind === 'invalid-response', JSON.stringify(state));
	});

	await test('T54 switching from 10 minutes to 15 seconds does not postpone an earlier update', async () => {
		const { plugin, index } = await setup();
		const timer = () => index as unknown as { syncDueAt: number };
		plugin.settings.connector.autoSyncSeconds = 600;
		index.requestSync();
		timer().syncDueAt = Date.now() + 2000; // 10분 예약이 2초 남았다고 둠
		plugin.settings.connector.autoSyncSeconds = 15;
		index.requestSync();
		assert.ok(timer().syncDueAt - Date.now() <= 2100, 'postponed to 15 seconds');
		index.requestSync(); // 고쳐도 더 이른 예약은 그대로
		assert.ok(timer().syncDueAt - Date.now() <= 2100, 'postponed by an edit');
		index.stop();
	});

	await test('T39 advanced option change needs a rebuild; batch size does not; old file without options loads', async () => {
		const { vault, plugin, index } = await setup();
		plugin.settings.connector.batchSize = 2;
		assert.strictEqual(index.state().kind, 'ready');
		for (const [key, value] of [['chunkChars', 150], ['vectorsPerNote', 2], ['dimensions', 8], ['documentFormat', 'x {text}']] as const) {
			const before = plugin.settings.connector[key];
			(plugin.settings.connector as Record<string, unknown>)[key] = value;
			assert.deepStrictEqual(index.state(), { kind: 'not-built', builtWith: '', optionsChanged: true }, key);
			assert.strictEqual(index.search('car1.md', 3), null, key);
			(plugin.settings.connector as Record<string, unknown>)[key] = before;
			assert.strictEqual(index.state().kind, 'ready', key);
		}
		reset();
		plugin.settings.connector.chunkChars = 150;
		vault.put('car1.md', 'car changed again');
		await index.sync();
		assert.strictEqual(served, 0, 'auto sync sent with changed options');
		// 고급 설정 기록이 없는 예전 파일은 지금 설정으로 만든 것으로 봅니다.
		const header = indexHeader(vault) as Record<string, unknown>;
		delete header.options;
		vault.store.set('plug/connector-index.bin', binaryIndex(header));
		const old = new ConnectorIndex(plugin as never);
		await old.load();
		assert.strictEqual(old.state().kind, 'ready');
	});

	await test('T38 with 2 vectors per note, suggestions name the matching section', async () => {
		const { vault, plugin, index } = await setup(false);
		plugin.settings.connector.vectorsPerNote = 2;
		const apple = Array.from({ length: 3 }, () => 'apple '.repeat(30)).join('\n\n');
		const car = Array.from({ length: 3 }, () => 'car '.repeat(30)).join('\n\n');
		vault.put('sections.md', `# Fruit notes\n\n${apple}\n\n## Car notes\n\n${car}`);
		await index.rebuild();
		const fromCar = index.search('car1.md', 10)!.find((r) => r.path === 'sections.md')!;
		const fromApple = index.search('Fruit/apple1.md', 10)!.find((r) => r.path === 'sections.md')!;
		assert.strictEqual(fromCar.section, 'Car notes');
		assert.strictEqual(fromApple.section, 'Fruit notes');
		const again = new ConnectorIndex(plugin as never);
		await again.load();
		assert.strictEqual(again.search('car1.md', 10)!.find((r) => r.path === 'sections.md')!.section, 'Car notes');
		// 벡터가 하나인 노트는 섹션이 없음
		assert.strictEqual(index.search('sections.md', 10)!.find((r) => r.path === 'car1.md')!.section, '');
	});

	await test('T40 pendingCount counts changed, new, and newly excluded notes without contacting the server', async () => {
		const { vault, plugin, index } = await setup();
		reset();
		assert.strictEqual(index.pendingCount(), 0);
		vault.put('car1.md', 'car car engine wheel');
		vault.put('new.md', 'brand new');
		plugin.settings.connector.excludedFolders = ['Private', 'Fruit'];
		assert.strictEqual(index.pendingCount(), 3);
		assert.strictEqual(served, 0, 'counting contacted the server');
		await index.sync();
		assert.strictEqual(index.pendingCount(), 0);
	});

	await test('T41 auto update waits while editing, follows the interval, and 0 never syncs on its own', async () => {
		const { vault, plugin, index } = await setup();
		plugin.settings.connector.autoSyncSeconds = 1;
		reset();
		vault.put('car1.md', 'car one');
		index.requestSync();
		await sleep(500);
		vault.put('car1.md', 'car two');
		index.requestSync(); // 1분 미만: 고칠 때마다 다시 기다림
		await sleep(700);
		assert.strictEqual(served, 0, 'sent while still editing');
		await sleep(700);
		assert.deepStrictEqual(sentTexts, ['car1\n\ncar two']);
		plugin.settings.connector.autoSyncSeconds = 0;
		reset();
		vault.put('car1.md', 'car three');
		index.requestSync();
		await sleep(1300);
		assert.strictEqual(served, 0, 'synced while automatic update is off');
		assert.strictEqual(index.pendingCount(), 1);
	});

	await test('T42 connector view and settings share one server check: in-flight flag, record, resume after error', async () => {
		const { index } = await setup(false);
		reset({ failAfter: 1, status: 401 });
		await index.rebuild();
		assert.strictEqual(index.state().kind, 'error');
		assert.ok(index.serverStatus()?.failure, 'failure from indexing not recorded');
		reset({ delayMs: 100 });
		const first = index.checkServer();
		const second = index.checkServer(); // 다른 화면에서 또 눌러도 요청은 하나
		assert.strictEqual(first, second);
		assert.ok(index.isCheckingServer());
		await first;
		assert.ok(!index.isCheckingServer());
		const status = index.serverStatus()!;
		assert.strictEqual(status.failure, null);
		assert.ok(status.dims > 0, 'dims not recorded');
		await sleep(50);
		await index.sync(); // 성공한 확인이 시작한 이어 맞추기를 기다림
		assert.strictEqual(index.state().kind, 'ready');
	});

	await test('T55 the 1.0.0 index file name is renamed and read instead of re-sending the vault', async () => {
		const { vault, plugin, index } = await setup();
		const before = index.search('Fruit/apple1.md', 10);
		vault.store.set('plug/link-index.bin', vault.store.get('plug/connector-index.bin')!);
		vault.store.delete('plug/connector-index.bin');
		const again = new ConnectorIndex(plugin as never);
		await again.load();
		assert.deepStrictEqual(again.search('Fruit/apple1.md', 10), before);
		assert.ok(vault.store.has('plug/connector-index.bin'), '옛 이름이 새 이름으로 옮겨지지 않음');
		assert.ok(!vault.store.has('plug/link-index.bin'), '옛 파일이 그대로 남음');
	});

	server.close();
	for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.error ? `\n     → ${r.error}` : ''}`);
	console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
	process.exit(results.every((r) => r.ok) ? 0 : 1);
}

void main();
