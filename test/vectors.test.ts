import assert from 'node:assert';
import { splitChunks, noteVectors, noteSimilarity, meanVector, centered, similarity } from '../src/connector/vectors';

const texts = (text: string, max: number, chunks: number) => splitChunks(text, max, chunks).map((c) => c.text);

assert.deepStrictEqual(texts('a\n\nb', 10, 5), ['a\n\nb']);
assert.deepStrictEqual(texts('aaaa\n\nbbbb', 5, 5), ['aaaa', 'bbbb']);
assert.deepStrictEqual(texts('abcdefghij', 4, 5), ['abcd', 'efgh', 'ij']);
assert.strictEqual(splitChunks('x'.repeat(100), 10, 3).length, 3);
assert.strictEqual(splitChunks('', 10, 3).length, 0);

// 조각마다 속한 제목: 제목 줄로 시작하는 문단은 그 제목, 이어지는 문단은 앞 제목, 제목 전은 ''
const sections = splitChunks('intro\n\n# Apple part\nred\n\nmore apple\n\n## Car part ##\n\nwheels', 20, 20);
assert.deepStrictEqual(
	sections.map((c) => c.heading),
	['', 'Apple part', 'Apple part', 'Car part', 'Car part'],
	JSON.stringify(sections),
);
// 코드 블록 안의 "# 주석"은 제목이 아님(코드 블록 안에 빈 줄이 있어 문단이 나뉘어도)
const fenced = splitChunks('# Real\nintro\n\n```python\n# comment\n\n# another\nx = 1\n```\n\nafter code', 30, 20);
assert.deepStrictEqual(
	fenced.map((c) => c.heading),
	fenced.map(() => 'Real'),
	JSON.stringify(fenced),
);
// 닫는 줄은 같은 기호로 같거나 더 길게: ~~~ 안의 ```, ```` 안의 ```는 코드 내용이라 그 뒤 # 주석도 제목이 아님
for (const block of ['~~~md\n```js\n# inside\n```\n~~~', '````\n```\n# inside\n````']) {
	const nested = splitChunks(`# Top\n\n${block}\n\nafter`, 12, 20);
	assert.deepStrictEqual(nested.map((c) => c.heading), nested.map(() => 'Top'), JSON.stringify(nested));
}
// 들여쓴 코드 블록: 문단은 첫 줄만 앞 빈칸이 지워지므로, 닫는 줄에는 들여쓰기가 남아 있어도 알아봐야 함
const indented = splitChunks('# A\n\n\t```js\n\t# inside\n\t```\n\n## B\n\nbody', 20, 20);
assert.deepStrictEqual(indented.map((c) => c.heading), ['A', 'A', 'B'], JSON.stringify(indented));
// 줄 첫머리의 인라인 코드는 코드 블록 여는 줄이 아님(` 로 여는 줄 뒤에는 ` 를 쓸 수 없음)
const inline = splitChunks('# Top\n\n```sh``` 로 실행합니다\n\n## Second\n\nbody', 20, 20);
assert.deepStrictEqual(inline.map((c) => c.heading), ['Top', 'Top', 'Second'], JSON.stringify(inline));
// 끝의 #은 앞에 빈칸이 있을 때만 닫는 표시
assert.deepStrictEqual(
	['# C#\nx', '## F# notes ##\nx', '# Title #tag\nx'].map((t) => splitChunks(t, 100, 5)[0]!.heading),
	['C#', 'F# notes', 'Title #tag'],
);

// 1개 = 평균, 길이 1
const one = noteVectors([[3, 0], [0, 3]], 1);
assert.strictEqual(one.length, 1);
assert.ok(Math.abs(one[0]!.vector[0]! - Math.SQRT1_2) < 1e-6);
// 조각 수 ≤ count면 조각 그대로(조각 번호 유지, 0벡터 조각은 빠짐)
assert.deepStrictEqual(noteVectors([[0, 0], [1, 0]], 3).map((v) => v.chunk), [1]);
assert.strictEqual(noteVectors([[0, 0]], 1).length, 0);
// 두 주제(축 0 조각 3개, 축 1 조각 2개) → count 2면 주제별 벡터, 대표 조각은 그 주제의 조각
const topics = noteVectors([[1, 0.1, 0], [1, 0, 0.1], [0.9, 0.1, 0], [0, 1, 0], [0.1, 1, 0]], 2);
assert.strictEqual(topics.length, 2);
const axis1 = [new Float32Array([0, 1, 0])];
const axis0 = [new Float32Array([1, 0, 0])];
const topicVectors = topics.map((t) => t.vector);
const toCar = noteSimilarity(topicVectors, axis1);
assert.ok(toCar.score > 0.99 && noteSimilarity(topicVectors, axis0).score > 0.99, 'both topics kept');
assert.ok([3, 4].includes(topics[toCar.a]!.chunk), `representative chunk ${topics[toCar.a]!.chunk}`);
assert.ok(noteSimilarity(one.map((t) => t.vector), axis1).score < 0.8, 'mean blurs');
// 결정적
assert.deepStrictEqual(noteVectors([[1, 0], [0, 1], [1, 1]], 2), noteVectors([[1, 0], [0, 1], [1, 1]], 2));
assert.strictEqual(noteSimilarity([], axis0).score, -Infinity);

// 모든 벡터가 한쪽(3번째 숫자)으로 기울어 있으면 뜻이 반대인 둘도 0.96으로 붙어 나옴. 평균을 빼면 갈라짐
const unit = (v: number[]) => Float32Array.from(v, (x) => x / Math.hypot(...v));
const tilted = [Float32Array.from([1, 0, 5]), Float32Array.from([0, 1, 5])];
const tiltMean = meanVector(tilted)!;
const raw = similarity(unit([1, 0, 5]), unit([0, 1, 5]));
const fixed = similarity(centered(tilted[0]!, tiltMean)!, centered(tilted[1]!, tiltMean)!);
assert.ok(raw > 0.95 && fixed < 0, `raw=${raw} fixed=${fixed}`);
// 원본은 그대로 둠(색인 파일에는 서버에서 받은 그대로 저장)
assert.deepStrictEqual([...tilted[0]!], [1, 0, 5]);
// 차원이 섞이면 평균도 빼기도 하지 않음
assert.strictEqual(meanVector([Float32Array.from([1, 0]), Float32Array.from([1, 0, 0])]), null);
assert.strictEqual(centered(Float32Array.from([1, 0]), tiltMean), null);

console.log('vectors ok');

// 이모지(서로게이트 쌍)는 반으로 자르지 않고, maxChars가 1이어도 끝남
const emo = texts('aaaaa😀😀😀😀😀😀😀', 10, 20);
assert.ok(emo.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)), JSON.stringify(emo));
assert.strictEqual(emo.join(''), 'aaaaa😀😀😀😀😀😀😀');
assert.ok(splitChunks('😀😀', 1, 20).length > 0);
console.log('surrogate ok');
