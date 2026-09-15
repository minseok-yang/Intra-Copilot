import assert from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { TFile } from './obsidian-mock';
import { LinkIndex } from '../src/link/link-index';
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
	store = new Map<string, string>();
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
	adapter = {
		exists: async (p: string) => this.store.has(p),
		read: async (p: string) => {
			const v = this.store.get(p); // 실제 디스크 읽기처럼 읽기를 시작한 순간의 내용을 돌려줌
			if (this.readDelayMs) await sleep(this.readDelayMs);
			if (v === undefined) throw new Error('ENOENT');
			return v;
		},
		write: async (p: string, data: string) => {
			this.writes++;
			this.activeWrites++;
			if (this.activeWrites > 1) this.overlaps++;
			if (this.writeDelayMs) await sleep(this.writeDelayMs);
			this.store.set(p, data);
			this.activeWrites--;
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
			link: {
				...DEFAULT_SETTINGS.link,
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
		const index = new LinkIndex(plugin as never, 5);
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
		b.plugin.settings.link.vectorsPerNote = 2;
		await b.index.rebuild();
		const k2 = b.index.search('car1.md', 10)!.find((r) => r.path === 'mixed.md')!.score;
		const k2apple = b.index.search('Fruit/apple1.md', 10)!.find((r) => r.path === 'mixed.md')!.score;
		assert.ok(k2 > k1 + 0.05 && k2apple > 0.95, `k1=${k1} k2=${k2} k2apple=${k2apple}`);
	});

	await test('T09 persistence round trip; corrupt/old file → not built', async () => {
		const { vault, plugin, index } = await setup();
		const before = index.search('Fruit/apple1.md', 10);
		const again = new LinkIndex(plugin as never);
		await again.load();
		assert.deepStrictEqual(again.search('Fruit/apple1.md', 10), before);
		vault.store.set('plug/link-index.json', '{broken');
		const broken = new LinkIndex(plugin as never);
		await broken.load();
		assert.strictEqual(broken.state().kind, 'not-built');
		vault.store.set('plug/link-index.json', JSON.stringify({ version: 1, baseUrl: plugin.settings.link.baseUrl, model: 'm', notes: {} }));
		const old = new LinkIndex(plugin as never);
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
		const saved = JSON.parse(vault.store.get('plug/link-index.json')!) as { notes: Record<string, unknown> };
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
		plugin.settings.link.model = 'other';
		await run;
		assert.strictEqual(index.state().kind, 'not-built');
		plugin.settings.link.model = 'm';
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
		plugin.settings.link.chunkChars = 10;
		vault.put('emoji.md', `${'a'.repeat(5)}😀😀😀😀😀😀😀`); // a 5개 + 이모지: 10칸에서 자르면 이모지 한가운데
		reset();
		await index.rebuild();
		assert.strictEqual(index.state().kind, 'ready', JSON.stringify(index.state()));
	});

	await test('T17 rebuild while load() is still reading keeps the new index', async () => {
		const { vault, plugin, index } = await setup();
		const fresh = new LinkIndex(plugin as never);
		vault.readDelayMs = 400; // 다시 만들기가 끝난 뒤에 읽기가 끝나게
		plugin.settings.link.model = 'm2';
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
		plugin.settings.link.batchSize = 1;
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
		plugin.settings.link.baseUrl += '/';
		assert.strictEqual(index.state().kind, 'ready');
	});

	await test('T30 interrupted save (only temp file left) is recovered', async () => {
		const { vault, plugin } = await setup();
		const data = vault.store.get('plug/link-index.json')!;
		vault.store.delete('plug/link-index.json');
		vault.store.set('plug/link-index.json.tmp', data);
		const again = new LinkIndex(plugin as never);
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
		plugin.settings.link.chunkChars = 200;
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
		plugin.settings.link.excludedFolders = ['Private', 'Fruit'];
		await index.sync();
		assert.ok(!index.search('apple2.md', 10)!.some((r) => r.path.startsWith('Fruit/')));
	});

	await test('T24 network down → network error, not crash', async () => {
		const { plugin, index } = await setup(false);
		plugin.settings.link.baseUrl = 'http://127.0.0.1:1/v1';
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
		plugin.settings.link.dimensions = 6;
		await index.rebuild();
		assert.ok(rawBodies.every((b) => (JSON.parse(b) as { dimensions?: number }).dimensions === 6));
		assert.strictEqual(index.state().kind, 'ready');
		plugin.settings.link.dimensions = 5;
		vault.put('car1.md', 'car changed');
		await index.sync();
		const s = index.state();
		assert.strictEqual(s.kind === 'error' && s.failure.kind, 'invalid-response');
	});

	server.close();
	for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.error ? `\n     → ${r.error}` : ''}`);
	console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
	process.exit(results.every((r) => r.ok) ? 0 : 1);
}

void main();
