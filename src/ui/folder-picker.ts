import { App, Modal, Setting, setIcon, TFolder } from 'obsidian';
import type { Dictionary } from '../i18n';

// 볼트의 폴더를 펼쳐 보고 하나를 고르는 창입니다([찾기] 버튼 → 이 창 → [열기]).
//
// 왜 직접 만들었나: Obsidian에는 폴더 선택 창을 띄우는 공개 API가 없습니다. 경로를 손으로 적게 하면
// 오타 하나로 엉뚱한 폴더가 만들어지므로, 지금 볼트에 있는 폴더만 고르게 합니다.
// 이 창은 볼트 안만 보여 주며(볼트 밖 폴더는 아예 고를 수 없음), 폴더를 만들거나 고치지 않습니다.
//
// 마크업은 Obsidian 파일 탐색기와 같은 것(nav-folder · nav-folder-title · nav-folder-children)을 씁니다.
// 그래서 들여쓰기·글자색·마우스 올렸을 때 모습·접기 화살표가 파일 탐색기와 똑같이, 쓰는 테마대로 보입니다.

type FolderStrings = Dictionary['folders'];

export class FolderPickerModal extends Modal {
	// 펼쳐 둔 폴더 경로. 처음에는 지금 지정된 폴더까지의 길만 펼칩니다.
	private readonly expanded = new Set<string>();
	private selected: string;
	private listEl!: HTMLElement;
	private pathEl!: HTMLElement;

	constructor(
		app: App,
		private readonly options: {
			strings: FolderStrings;
			current: string; // 지금 지정된 폴더(볼트 기준 경로). ''이면 볼트 맨 위
			onChoose: (path: string) => void; // 볼트 맨 위를 고르면 ''
		},
	) {
		super(app);
		this.selected = options.current;
		// 지정된 폴더가 보이도록 그 위 폴더들을 펼쳐 둡니다.
		const parts = options.current.split('/').filter((part) => part !== '');
		for (let i = 1; i <= parts.length; i++) this.expanded.add(parts.slice(0, i).join('/'));
	}

	onOpen(): void {
		const { strings } = this.options;
		this.modalEl.addClass('intra-copilot-folder-modal');
		this.setTitle(strings.pickTitle);
		this.contentEl.createEl('p', { cls: 'intra-copilot-section-intro', text: strings.pickIntro });

		this.listEl = this.contentEl.createDiv({ cls: 'intra-copilot-folder-tree nav-files-container' });
		this.pathEl = this.contentEl.createDiv({ cls: 'intra-copilot-folder-chosen' });

		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText(strings.cancel).onClick(() => this.close()))
			.addButton((button) =>
				button
					.setButtonText(strings.open)
					.setCta()
					.onClick(() => {
						this.close();
						this.options.onChoose(this.selected);
					}),
			);

		this.draw();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private draw(): void {
		const { strings } = this.options;
		this.listEl.empty();
		// 볼트 맨 위도 고를 수 있게 트리의 첫 줄로 둡니다(저장 폴더를 볼트 맨 위로 두려는 경우).
		this.addFolder(this.listEl, this.app.vault.getRoot(), strings.root);
		this.pathEl.setText(`${strings.chosen} ${this.selected || strings.root}`);
	}

	// 폴더 한 줄과, 펼쳐져 있으면 그 안의 폴더들을 파일 탐색기와 같은 모양으로 그립니다.
	private addFolder(parentEl: HTMLElement, folder: TFolder, rootLabel?: string): void {
		const isRoot = folder.isRoot();
		const path = isRoot ? '' : folder.path;
		const children = folder.children
			.filter((child): child is TFolder => child instanceof TFolder)
			.sort((a, b) => a.name.localeCompare(b.name));
		// 볼트 맨 위는 늘 펼쳐 둡니다(접으면 아무것도 고를 수 없습니다).
		const open = isRoot || this.expanded.has(path);

		const wrapper = parentEl.createDiv({
			cls: `nav-folder${isRoot ? ' mod-root' : ''}${open ? '' : ' is-collapsed'}`,
		});
		const title = wrapper.createDiv({ cls: 'nav-folder-title is-clickable' });
		if (path === this.selected) title.addClass('is-active'); // 고른 폴더(파일 탐색기의 열린 파일 표시와 같은 자리)

		// 접기 화살표는 하위 폴더가 있을 때만 붙입니다(파일 탐색기도 빈 폴더에는 화살표가 없습니다).
		if (!isRoot && children.length > 0) {
			const indicator = title.createDiv({ cls: 'nav-folder-collapse-indicator collapse-icon' });
			setIcon(indicator, 'right-triangle');
			indicator.addEventListener('click', (evt) => {
				evt.stopPropagation(); // 화살표는 펼치기만, 줄 클릭은 고르기만
				if (open) this.expanded.delete(path);
				else this.expanded.add(path);
				this.draw();
			});
		} else {
			// 화살표가 없는 폴더도 이름이 같은 자리에서 시작하도록 같은 폭의 빈 칸을 둡니다.
			title.createDiv({ cls: 'intra-copilot-folder-indent' });
		}
		title.createDiv({ cls: 'nav-folder-title-content', text: isRoot ? (rootLabel ?? '/') : folder.name });
		title.addEventListener('click', () => {
			this.selected = path;
			this.draw();
		});

		const childrenEl = wrapper.createDiv({ cls: 'nav-folder-children' });
		if (open) {
			for (const child of children) this.addFolder(childrenEl, child);
		}
	}
}
