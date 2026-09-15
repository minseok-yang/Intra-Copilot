import assert from 'node:assert';
import { splitChunks, noteVectors, noteSimilarity, encodeVector, decodeVector } from '../src/link/vectors';

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

const w = new Float32Array([0.25, -1.5, 3]);
assert.deepStrictEqual(Array.from(decodeVector(encodeVector(w))!), [0.25, -1.5, 3]);
assert.strictEqual(decodeVector(''), null);
console.log('vectors ok');

// 이모지(서로게이트 쌍)는 반으로 자르지 않고, maxChars가 1이어도 끝남
const emo = texts('aaaaa😀😀😀😀😀😀😀', 10, 20);
assert.ok(emo.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)), JSON.stringify(emo));
assert.strictEqual(emo.join(''), 'aaaaa😀😀😀😀😀😀😀');
assert.ok(splitChunks('😀😀', 1, 20).length > 0);
console.log('surrogate ok');
