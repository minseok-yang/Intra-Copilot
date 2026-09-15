import { Buffer } from 'buffer';

// 링크 색인의 계산 부분입니다. Obsidian 없이 동작해서 따로 확인하기 쉽습니다.
//
// 벡터(임베딩)는 글의 뜻을 수백~수천 개 숫자로 나타낸 것입니다. 뜻이 비슷한 글일수록 숫자 목록이 같은 방향을
// 가리키므로, 두 벡터의 방향이 얼마나 같은지(코사인 유사도)로 비슷한 노트를 찾습니다.

// 노트를 문단(빈 줄) 단위로 모아 maxChars 이하의 조각으로 나눕니다. 서버와 모델이 한 번에 받는 길이에 한계가
// 있어서입니다. 한 문단이 maxChars보다 길면 글자 수로 자릅니다. 조각은 maxChunks개까지만 만듭니다.
export function splitChunks(text: string, maxChars: number, maxChunks: number): string[] {
	const chunks: string[] = [];
	let current = '';
	for (const block of text.split(/\n\s*\n/)) {
		const paragraph = block.trim();
		for (let start = 0, end = 0; start < paragraph.length; start = end) {
			end = Math.min(start + maxChars, paragraph.length);
			// 이모지 같은 글자는 두 칸(서로게이트 쌍)이라, 그 사이에서 자르면 깨진 글자가 되어 서버가 요청을 거절합니다.
			const code = paragraph.charCodeAt(end - 1);
			if (end < paragraph.length && end - start > 1 && code >= 0xd800 && code <= 0xdbff) end--;
			const piece = paragraph.slice(start, end);
			if (current && current.length + 2 + piece.length > maxChars) {
				chunks.push(current);
				current = piece;
			} else {
				current = current ? `${current}\n\n${piece}` : piece;
			}
		}
		if (chunks.length >= maxChunks) break;
	}
	if (current) chunks.push(current);
	return chunks.slice(0, maxChunks);
}

// 길이를 1로 맞춥니다. 길이가 1이면 코사인 유사도가 곱의 합(dot)과 같아 검색 계산이 가벼워집니다.
function normalize(vector: Float32Array): Float32Array | null {
	const norm = Math.hypot(...vector);
	if (!norm) return null;
	for (let i = 0; i < vector.length; i++) vector[i]! /= norm;
	return vector;
}

export function similarity(a: Float32Array, b: Float32Array): number {
	let total = 0;
	for (let i = 0; i < a.length; i++) total += a[i]! * b[i]!;
	return total;
}

function meanOf(points: Float32Array[]): Float32Array | null {
	const sum = new Float32Array(points[0]?.length ?? 0);
	for (const point of points) {
		for (let i = 0; i < sum.length; i++) sum[i]! += point[i]!;
	}
	return normalize(sum);
}

// 조각 벡터들을 뜻이 가까운 것끼리 count개 묶음으로 나누고, 묶음마다 평균 벡터 하나를 돌려줍니다.
// count가 1이면 노트 전체의 평균입니다. 주제가 여러 개인 노트는 평균 하나로 뭉치면 어느 주제와도 덜 비슷해지므로,
// 2 이상이면 주제별 벡터를 따로 남깁니다(조각이 count개 이하면 조각 벡터를 그대로 씀).
// 묶는 방법은 k-평균입니다. 시작점은 서로 가장 먼 조각부터 고르고(매번 같은 결과), 몇 번 되풀이해 묶음을 다듬습니다.
export function noteVectors(chunkVectors: number[][], count: number): Float32Array[] {
	const points = chunkVectors
		.map((vector) => normalize(Float32Array.from(vector)))
		.filter((vector): vector is Float32Array => vector !== null);
	if (points.length <= count) return points;

	const centers = [points[0]!];
	while (centers.length < count) {
		let farthest = points[0]!;
		let lowest = Infinity;
		for (const point of points) {
			const closest = Math.max(...centers.map((center) => similarity(point, center)));
			if (closest < lowest) {
				lowest = closest;
				farthest = point;
			}
		}
		centers.push(farthest);
	}

	for (let round = 0; round < 10; round++) {
		const groups: Float32Array[][] = centers.map(() => []);
		for (const point of points) {
			let best = 0;
			for (let i = 1; i < centers.length; i++) {
				if (similarity(point, centers[i]!) > similarity(point, centers[best]!)) best = i;
			}
			groups[best]!.push(point);
		}
		groups.forEach((group, i) => {
			const mean = group.length > 0 ? meanOf(group) : null;
			if (mean) centers[i] = mean;
		});
	}
	return centers;
}

// 두 노트의 유사도: 서로의 벡터 중 가장 비슷한 한 쌍의 값입니다. 주제 하나만 겹쳐도 찾아낼 수 있습니다.
export function noteSimilarity(a: Float32Array[], b: Float32Array[]): number {
	let best = -Infinity;
	for (const x of a) {
		for (const y of b) {
			if (x.length === y.length) best = Math.max(best, similarity(x, y));
		}
	}
	return best;
}

// 파일에는 숫자를 글자로 늘어놓지 않고 4바이트 실수 그대로 base64로 적습니다(JSON 숫자 목록보다 약 3배 작음).
export function encodeVector(vector: Float32Array): string {
	return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

export function decodeVector(text: string): Float32Array | null {
	const bytes = Uint8Array.from(Buffer.from(text, 'base64'));
	return bytes.length > 0 && bytes.length % 4 === 0 ? new Float32Array(bytes.buffer) : null;
}
