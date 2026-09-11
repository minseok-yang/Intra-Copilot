import {
	Editor,
	MarkdownView,
	MarkdownFileInfo,
	Modal,
	Notice,
	Plugin,
} from 'obsidian';
import {
	DEFAULT_SETTINGS,
	MyPluginSettings,
	SampleSettingTab,
} from './settings';

// 이 클래스와 인터페이스 이름은 나중에 프로젝트에 맞게 바꿔야 합니다!

export default class MyPlugin extends Plugin {
	settings!: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// 왼쪽 리본 메뉴에 아이콘을 추가합니다.
		this.addRibbonIcon('dice', 'Sample', (_evt: MouseEvent) => {
			// 사용자가 아이콘을 클릭했을 때 호출됩니다.
			new Notice('This is a notice!');
		});

		// 앱 하단 상태 표시줄에 항목을 추가합니다. 모바일 앱에서는 동작하지 않습니다.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status bar text');

		// 어디서든 실행할 수 있는 간단한 명령을 추가합니다.
		this.addCommand({
			id: 'open-modal-simple',
			name: 'Open modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// 현재 에디터에서 특정 동작을 수행하는 에디터 명령을 추가합니다.
		this.addCommand({
			id: 'replace-selected',
			name: 'Replace selected content',
			editorCallback: (
				editor: Editor,
				_ctx: MarkdownView | MarkdownFileInfo,
			) => {
				editor.replaceSelection('Sample editor command');
			},
		});
		// 현재 앱 상태에 따라 실행 가능 여부를 확인하는 복합 명령을 추가합니다.
		this.addCommand({
			id: 'open-modal-complex',
			name: 'Open modal (complex)',
			checkCallback: (checking: boolean) => {
				// 확인할 조건
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// checking이 true이면 명령을 실행할 수 있는지 '확인'만 하는 것입니다.
					// checking이 false이면 실제로 동작을 수행합니다.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// 이 명령은 체크 함수가 true를 반환할 때만 명령 팔레트에 표시됩니다.
					return true;
				}
				return false;
			},
		});

		// 사용자가 플러그인의 여러 설정을 변경할 수 있도록 설정 탭을 추가합니다.
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// 플러그인이 앱의 다른 부분(플러그인 소유가 아닌 영역)에 전역 DOM 이벤트를 연결할 경우,
		// 이 함수를 사용하면 플러그인이 비활성화될 때 이벤트 리스너가 자동으로 제거됩니다.
		this.registerDomEvent(activeDocument, 'click', (_evt: MouseEvent) => {
			new Notice('Click');
		});

		// 인터벌을 등록할 때 이 함수를 사용하면 플러그인이 비활성화될 때 인터벌이 자동으로 정리됩니다.
		this.registerInterval(
			window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000),
		);
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<MyPluginSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	onOpen() {
		const { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
