// 커넥터 색인의 계산 부분입니다. Obsidian 없이 동작해서 따로 확인하기 쉽습니다.
//
// 벡터(임베딩)는 글의 뜻을 수백~수천 개 숫자로 나타낸 것입니다. 뜻이 비슷한 글일수록 숫자 목록이 같은 방향을
// 가리키므로, 두 벡터의 방향이 얼마나 같은지(코사인 유사도)로 비슷한 노트를 찾습니다.

export interface Chunk {
	text: string;
	heading: string; // 조각이 시작하는 곳의 마크다운 제목(# 없이). 제목 아래가 아니면 ''
}

// 끝의 #들은 앞에 빈칸이 있을 때만 닫는 표시입니다("# C#"의 제목은 "C#").
const HEADING_LINE = /^#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\r?$/;
// 코드 블록(``` 또는 ~~~ 3개 이상으로 여닫음)의 여는·닫는 줄. 코드 블록 안의 "# 주석"은 제목이 아닙니다.
// 닫는 줄은 여는 줄과 같은 기호로 같거나 더 길게, 뒤에 글자 없이 써야 합니다(~~~ 안의 ```, ```` 안의 ```는 코드 내용).
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

// 노트를 문단(빈 줄) 단위로 모아 maxChars 이하의 조각으로 나눕니다. 서버와 모델이 한 번에 받는 길이에 한계가
// 있어서입니다. 한 문단이 maxChars보다 길면 글자 수로 자릅니다. 조각은 maxChunks개까지만 만듭니다.
// 조각마다 그 조각이 속한 제목을 함께 적어, 비슷한 "섹션"을 알려 주고 [[노트#제목]] 링크를 만들 수 있게 합니다.
export function splitChunks(text: string, maxChars: number, maxChunks: number): Chunk[] {
	const chunks: Chunk[] = [];
	let current: Chunk | null = null;
	let heading = '';
	// 코드 블록은 빈 줄을 품을 수 있어 여러 문단에 걸치므로, 열린 코드 블록의 여는 표시를 문단 사이에서도 기억합니다('' = 밖).
	let fence = '';
	for (const block of text.split(/\n\s*\n/)) {
		const paragraph = block.trim();
		// 문단 첫 줄이 제목이면 그 제목부터, 아니면 앞에서 이어진 제목 아래입니다.
		const headings: string[] = [];
		let startsWithHeading = false;
		paragraph.split('\n').forEach((line, i) => {
			const fenceMatch = FENCE_LINE.exec(line);
			if (fenceMatch) {
				const marker = fenceMatch[1]!;
				if (!fence) fence = marker;
				else if (marker[0] === fence[0] && marker.length >= fence.length && !fenceMatch[2]!.trim()) fence = '';
				return;
			}
			const match = fence ? null : HEADING_LINE.exec(line);
			if (!match) return;
			headings.push(match[1]!.trim());
			if (i === 0) startsWithHeading = true;
		});
		const blockHeading = startsWithHeading ? headings[0]! : heading;
		if (headings.length > 0) heading = headings[headings.length - 1]!;

		for (let start = 0, end = 0; start < paragraph.length; start = end) {
			end = Math.min(start + maxChars, paragraph.length);
			// 이모지 같은 글자는 두 칸(서로게이트 쌍)이라, 그 사이에서 자르면 깨진 글자가 되어 서버가 요청을 거절합니다.
			const code = paragraph.charCodeAt(end - 1);
			if (end < paragraph.length && end - start > 1 && code >= 0xd800 && code <= 0xdbff) end--;
			const piece = paragraph.slice(start, end);
			if (current && current.text.length + 2 + piece.length > maxChars) {
				chunks.push(current);
				current = null;
			}
			if (current) current.text = `${current.text}\n\n${piece}`;
			else current = { text: piece, heading: start === 0 ? blockHeading : heading };
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

export interface NoteVector {
	vector: Float32Array;
	chunk: number; // 이 벡터를 가장 잘 대표하는 조각의 번호(그 조각의 제목을 섹션으로 보여 줌)
}

// 조각 벡터들을 뜻이 가까운 것끼리 count개 묶음으로 나누고, 묶음마다 평균 벡터 하나를 돌려줍니다.
// count가 1이면 노트 전체의 평균입니다. 주제가 여러 개인 노트는 평균 하나로 뭉치면 어느 주제와도 덜 비슷해지므로,
// 2 이상이면 주제별 벡터를 따로 남깁니다(조각이 count개 이하면 조각 벡터를 그대로 씀).
// 묶는 방법은 k-평균입니다. 시작점은 첫 조각에서 출발해, 이미 고른 시작점들과 가장 덜 비슷한 조각을 차례로 더하고
// (매번 같은 결과), 10번 되풀이해 묶음을 다듬습니다.
export function noteVectors(chunkVectors: number[][], count: number): NoteVector[] {
	const points = chunkVectors
		.map((vector, chunk) => ({ vector: normalize(Float32Array.from(vector)), chunk }))
		.filter((point): point is NoteVector => point.vector !== null);
	if (points.length <= count) return points;

	const centers = [points[0]!.vector];
	while (centers.length < count) {
		let farthest = points[0]!.vector;
		let lowest = Infinity;
		for (const { vector } of points) {
			const closest = Math.max(...centers.map((center) => similarity(vector, center)));
			if (closest < lowest) {
				lowest = closest;
				farthest = vector;
			}
		}
		centers.push(farthest);
	}

	const nearestCenter = (vector: Float32Array) => {
		let best = 0;
		for (let i = 1; i < centers.length; i++) {
			if (similarity(vector, centers[i]!) > similarity(vector, centers[best]!)) best = i;
		}
		return best;
	};
	for (let round = 0; round < 10; round++) {
		const groups: Float32Array[][] = centers.map(() => []);
		for (const { vector } of points) groups[nearestCenter(vector)]!.push(vector);
		groups.forEach((group, i) => {
			const mean = group.length > 0 ? meanOf(group) : null;
			if (mean) centers[i] = mean;
		});
	}

	return centers.map((center) => {
		let best = points[0]!;
		for (const point of points) {
			if (similarity(point.vector, center) > similarity(best.vector, center)) best = point;
		}
		return { vector: center, chunk: best.chunk };
	});
}

// 두 노트의 유사도: 서로의 벡터 중 가장 비슷한 한 쌍의 값과, 그 쌍이 몇 번째 벡터인지(a: 앞 노트, b: 뒤 노트)입니다.
// 주제 하나만 겹쳐도 찾아낼 수 있습니다. 비교할 벡터가 없으면 score가 -Infinity입니다.
export function noteSimilarity(a: Float32Array[], b: Float32Array[]): { score: number; a: number; b: number } {
	const best = { score: -Infinity, a: -1, b: -1 };
	a.forEach((x, i) => {
		b.forEach((y, j) => {
			if (x.length !== y.length) return;
			const score = similarity(x, y);
			if (score > best.score) Object.assign(best, { score, a: i, b: j });
		});
	});
	return best;
}
