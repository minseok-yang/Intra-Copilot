import assert from 'node:assert';
import { splitChunks, noteVectors, noteSimilarity, encodeVector, decodeVector } from '../src/link/vectors';

assert.deepStrictEqual(splitChunks('a\n\nb', 10, 5), ['a\n\nb']);
assert.deepStrictEqual(splitChunks('aaaa\n\nbbbb', 5, 5), ['aaaa', 'bbbb']);
assert.deepStrictEqual(splitChunks('abcdefghij', 4, 5), ['abcd', 'efgh', 'ij']);
assert.strictEqual(splitChunks('x'.repeat(100), 10, 3).length, 3);
assert.strictEqual(splitChunks('', 10, 3).length, 0);

// 1개 = 평균, 길이 1
const one = noteVectors([[3, 0], [0, 3]], 1);
assert.strictEqual(one.length, 1);
assert.ok(Math.abs(one[0]![0]! - Math.SQRT1_2) < 1e-6);
// 조각 수 ≤ count면 조각 그대로
assert.strictEqual(noteVectors([[1, 0]], 3).length, 1);
assert.strictEqual(noteVectors([[0, 0]], 1).length, 0);
// 두 주제(축 0 조각 3개, 축 1 조각 2개) → count 2면 주제별 벡터
const topics = noteVectors([[1, 0.1, 0], [1, 0, 0.1], [0.9, 0.1, 0], [0, 1, 0], [0.1, 1, 0]], 2);
assert.strictEqual(topics.length, 2);
const axis1 = [new Float32Array([0, 1, 0])];
const axis0 = [new Float32Array([1, 0, 0])];
assert.ok(noteSimilarity(topics, axis1) > 0.99 && noteSimilarity(topics, axis0) > 0.99, 'both topics kept');
assert.ok(noteSimilarity(one, axis1) < 0.8, 'mean blurs');
// 결정적
assert.deepStrictEqual(noteVectors([[1, 0], [0, 1], [1, 1]], 2), noteVectors([[1, 0], [0, 1], [1, 1]], 2));
assert.strictEqual(noteSimilarity([], axis0), -Infinity);

const w = new Float32Array([0.25, -1.5, 3]);
assert.deepStrictEqual(Array.from(decodeVector(encodeVector(w))!), [0.25, -1.5, 3]);
assert.strictEqual(decodeVector(''), null);
console.log('vectors ok');
// surrogate pairs never split; progress guaranteed even when maxChars=1
const emo = splitChunks('aaaaa😀😀😀😀😀😀😀', 10, 20);
assert.ok(emo.every((c) => !/[\uD800-\uDBFF]$/.test(c) && !/^[\uDC00-\uDFFF]/.test(c)), JSON.stringify(emo));
assert.strictEqual(emo.join(''), 'aaaaa😀😀😀😀😀😀😀');
assert.ok(splitChunks('😀😀', 1, 20).length > 0);
console.log('surrogate ok');
