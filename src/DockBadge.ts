/**
 * App dock/taskbar badge for showing unread notification counts.
 *
 * Currently implements macOS dock badge via Electron's remote API.
 * Windows (setOverlayIcon) and Linux (setBadgeCount) can be added later.
 */

export class DockBadge {
	private currentCount: number = 0;

	/** Update the dock badge to show the given unread count. */
	update(count: number): void {
		if (count === this.currentCount) return;
		this.currentCount = count;

		if (process.platform === 'darwin') {
			this.setMacOsBadge(count);
		}
		// Windows: setOverlayIcon (future)
		// Linux: setBadgeCount (future)
	}

	/** Clear the dock badge. */
	clear(): void {
		this.update(0);
	}

	private setMacOsBadge(count: number): void {
		try {
			const remote = this.getElectronRemote();
			if (remote?.app?.dock?.setBadge) {
				remote.app.dock.setBadge(count > 0 ? String(count) : '');
			}
		} catch {
			// Electron remote not available — ignore silently
		}
	}

	private getElectronRemote(): Record<string, any> | null {
		try {
			const electron = (window as any).require?.('electron');
			return electron?.remote ?? (window as any).electron?.remote ?? null;
		} catch {
			return null;
		}
	}
}
