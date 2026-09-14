// 데스크톱 Obsidian에 들어 있는 Electron 중 이 플러그인이 쓰는 부분만 타입을 적어 둡니다
// (electron 패키지 전체를 개발 의존성으로 설치하지 않기 위해서입니다).
declare module 'electron' {
	export const shell: {
		// 파일·폴더를 운영체제 기본 프로그램(폴더는 파일 탐색기)으로 엽니다. 성공하면 '', 실패하면 오류 문구.
		openPath(path: string): Promise<string>;
	};
}
