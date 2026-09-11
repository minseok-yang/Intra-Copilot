// LLM 답변을 마크다운으로 그리기 전/후에 쓰는 안전장치입니다.
//
// 왜 필요한가: 답변에 ![](http://어딘가/그림.png) 같은 이미지가 들어 있으면, Obsidian이 화면에
// 그리는 순간 그 주소로 자동 요청을 보냅니다. 지금은 노트 내용을 LLM에 보내지 않아서 위험이
// 낮지만, 나중에 노트를 문맥으로 넣는 기능이 생기면 "주소에 노트 내용을 실어 보내는" 반출
// 경로가 될 수 있습니다. 그래서 외부에서 무언가를 자동으로 불러오는 요소는 모두
// "클릭해야 열리는 링크"나 "글자"로 바꿔서, 사용자 동작 없이는 아무 요청도 나가지 않게 합니다.

// 코드블록(```/~~~)과 인라인 코드(`...`) 안의 내용은 사용자가 보고 싶은 원문이므로 건드리지 않습니다.
// split에 괄호(캡처 그룹)를 쓰면 코드 부분이 홀수 번째 칸에 들어갑니다.
const CODE_SEGMENT = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)/;

// 외부 리소스를 불러올 수 있는 HTML 태그 이름들입니다.
const RESOURCE_TAGS = new Set([
	'img',
	'image',
	'picture',
	'source',
	'track',
	'video',
	'audio',
	'iframe',
	'frame',
	'object',
	'embed',
	'link',
	'svg',
	'style',
	'input',
]);

// 태그 이름과 상관없이, 이런 속성이 들어 있으면 외부 요청이 생길 수 있습니다.
const RESOURCE_ATTRIBUTE = /\b(src|srcset|poster|background|data)\s*=|url\s*\(/i;

function neutralizeHtmlTag(tag: string): string {
	const name = /^<\/?\s*([a-zA-Z][\w-]*)/.exec(tag)?.[1]?.toLowerCase() ?? '';
	if (!RESOURCE_TAGS.has(name) && !RESOURCE_ATTRIBUTE.test(tag)) return tag;
	// 인라인 코드로 감싸서 태그가 실행되지 않고 글자 그대로 보이게 합니다.
	return `\`${tag.replace(/`/g, "'")}\``;
}

function neutralizeText(text: string): string {
	return (
		text
			// ![설명](주소), ![설명][참조] → [🖼 설명](주소): 이미지 대신 클릭해야 열리는 링크.
			// ![[노트]]처럼 볼트 안 파일을 끼워 넣는 문법은 외부 요청이 아니므로 그대로 둡니다.
			.replace(/!\[(?!\[)/g, '[🖼 ')
			.replace(/<\/?[a-zA-Z][^>]*>/g, neutralizeHtmlTag)
	);
}

export function neutralizeRemoteContent(markdown: string): string {
	return markdown
		.split(CODE_SEGMENT)
		.map((segment, index) => (index % 2 === 1 ? segment : neutralizeText(segment)))
		.join('');
}

// 그린 뒤에 한 번 더 확인합니다. 위의 전처리가 놓친 형태가 있더라도 외부 주소를 가진
// 미디어 요소는 지웁니다(볼트 안 파일은 app:// 주소라서 남습니다).
export function removeRemoteMedia(el: HTMLElement): void {
	el.querySelectorAll('img, iframe, video, audio, source, object, embed').forEach((node) => {
		const src = node.getAttribute('src') ?? node.getAttribute('data') ?? '';
		if (/^(https?:)?\/\//i.test(src.trim())) {
			node.remove();
		}
	});
}
