// 변경 전/후 글을 줄 단위로 비교해서, 화면에 보여줄 "바뀐 줄 목록"을 만듭니다.
//
// 왜 줄 단위인가: 노트는 마크다운이라 원래 줄 단위 구조(제목, 목록 항목, 문단)입니다. 글자 단위로
// 비교하면 "- 담당자 미정"과 "- 담당자: 김영수"가 뒤섞여 알아보기 어렵지만, 줄 단위로 보면
// "이 줄이 저 줄로 바뀐다"가 한눈에 들어옵니다. git이 쓰는 방식과 같습니다.
//
// 왜 라이브러리를 안 쓰는가: 비교하는 것은 노트 전체가 아니라 수정 제안 한 조각(보통 몇 줄~수십 줄)
// 입니다. 아래 알고리즘으로 충분하고, 반입 파일을 3개로 유지하려면 의존성을 늘리지 않는 편이 낫습니다.

export type DiffKind = 'same' | 'removed' | 'added';

export interface DiffLine {
	kind: DiffKind;
	text: string;
}

// 두 글이 이보다 많은 줄이면 한 줄씩 대응을 찾지 않고 통째로 "지우고 새로 넣기"로 보여줍니다.
// 아래 대응 찾기는 줄 수의 곱에 비례해서 느려지므로(500×500 = 25만 칸), 상한을 둡니다.
const MAX_ALIGN_LINES = 500;

function splitLines(text: string): string[] {
	// 끝의 줄바꿈 하나는 "빈 줄이 하나 더 있다"는 뜻이 아니므로 떼어냅니다.
	const body = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
	return body === '' ? [] : body.split('\n');
}

// 두 줄 목록에서 "순서를 지키면서 양쪽에 다 있는 가장 긴 줄들"(최장 공통 부분 수열)을 찾습니다.
// 그 줄들을 '그대로', 나머지를 '지움'/'넣음'으로 표시하면 바뀐 부분만 드러납니다.
function longestCommon(before: readonly string[], after: readonly string[]): number[][] {
	// lengths[i][j] = before의 i번째부터, after의 j번째부터 비교했을 때 공통으로 남는 줄 수
	const lengths: number[][] = Array.from({ length: before.length + 1 }, () =>
		new Array<number>(after.length + 1).fill(0),
	);
	for (let i = before.length - 1; i >= 0; i--) {
		for (let j = after.length - 1; j >= 0; j--) {
			lengths[i]![j] =
				before[i] === after[j]
					? lengths[i + 1]![j + 1]! + 1
					: Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
		}
	}
	return lengths;
}

// 변경 전/후 글을 받아 화면에 한 줄씩 그릴 목록을 돌려줍니다.
export function diffLines(before: string, after: string): DiffLine[] {
	const oldLines = splitLines(before);
	const newLines = splitLines(after);

	if (oldLines.length + newLines.length > MAX_ALIGN_LINES) {
		return [
			...oldLines.map((text): DiffLine => ({ kind: 'removed', text })),
			...newLines.map((text): DiffLine => ({ kind: 'added', text })),
		];
	}

	const lengths = longestCommon(oldLines, newLines);
	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < oldLines.length && j < newLines.length) {
		if (oldLines[i] === newLines[j]) {
			result.push({ kind: 'same', text: oldLines[i]! });
			i++;
			j++;
		} else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!) {
			result.push({ kind: 'removed', text: oldLines[i]! });
			i++;
		} else {
			result.push({ kind: 'added', text: newLines[j]! });
			j++;
		}
	}
	for (; i < oldLines.length; i++) result.push({ kind: 'removed', text: oldLines[i]! });
	for (; j < newLines.length; j++) result.push({ kind: 'added', text: newLines[j]! });
	return result;
}

// 바뀐 줄에서 멀리 떨어진 "그대로인 줄"은 접어서 보여주기 위해, 바뀐 줄 주변 이만큼만 남깁니다.
const CONTEXT_LINES = 2;

export interface DiffBlock {
	lines: DiffLine[];
	// 이 덩어리 앞에서 생략한 "그대로인 줄" 수(0이면 생략 없음). 화면에 "… 3줄 생략"으로 보여줍니다.
	skippedBefore: number;
}

// 바뀐 줄 주변만 남겨 덩어리로 묶습니다. 긴 조각에서 안 바뀐 부분이 화면을 가득 채우는 것을 막습니다.
export function collapseUnchanged(lines: readonly DiffLine[]): DiffBlock[] {
	const keep = lines.map(
		(line, index) =>
			line.kind !== 'same' ||
			lines.some(
				(other, otherIndex) =>
					other.kind !== 'same' && Math.abs(otherIndex - index) <= CONTEXT_LINES,
			),
	);

	const blocks: DiffBlock[] = [];
	let skipped = 0;
	for (const [index, line] of lines.entries()) {
		if (!keep[index]) {
			skipped++;
			continue;
		}
		const last = blocks[blocks.length - 1];
		if (skipped > 0 || blocks.length === 0) {
			blocks.push({ lines: [line], skippedBefore: skipped });
			skipped = 0;
		} else {
			last!.lines.push(line);
		}
	}
	// 마지막 바뀐 줄 뒤로도 생략된 줄이 있으면, 줄 없이 "… n줄 생략"만 있는 덩어리를 하나 더 둡니다.
	if (skipped > 0) blocks.push({ lines: [], skippedBefore: skipped });
	return blocks;
}

// 바뀐 줄이 하나도 없는지(모델이 "고쳤다"면서 같은 글을 준 경우를 걸러냅니다).
export function hasChanges(lines: readonly DiffLine[]): boolean {
	return lines.some((line) => line.kind !== 'same');
}
