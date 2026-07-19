import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type ClaudeCodeTabsPlugin from './main';
import type { CliProfile, SessionListDensity } from './types';
import { DEFAULT_TERMINAL_FONT_FAMILY } from './types';
import { SPECIAL_CLI_ID_DEFAULT_SHELL } from './SessionManager';
import { listGhosttyThemes } from './GhosttyThemeLoader';
import { normalizeCliId } from './utils';

function parseArgsInput(value: string): string[] {
	return value
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function formatArgsInput(args: string[]): string {
	return args.join(' ');
}

function createNewCliProfile(existingProfiles: CliProfile[]): CliProfile {
	const baseId = 'custom-cli';
	let candidateId = baseId;
	let suffix = 2;
	const existingIds = new Set(existingProfiles.map((profile) => profile.id));
	while (existingIds.has(candidateId)) {
		candidateId = `${baseId}-${suffix}`;
		suffix += 1;
	}

	return {
		id: candidateId,
		displayName: `Custom CLI ${existingProfiles.length + 1}`,
		executablePath: candidateId,
		defaultArgs: [],
		supportsResume: false,
		resumeArgs: []
	};
}

export class ClaudeCodeTabsSettingTab extends PluginSettingTab {
	plugin: ClaudeCodeTabsPlugin;

	constructor(app: App, plugin: ClaudeCodeTabsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private async saveAndRefresh(): Promise<void> {
		await this.plugin.saveSettings();
		this.display();
	}

	display(): void {
		const { containerEl } = this;
		const profiles = this.plugin.settings.cliProfiles;

		containerEl.empty();
		new Setting(containerEl).setName('Agent CLI tabs').setHeading();

		new Setting(containerEl)
			.setName('Default CLI for new tabs')
			.setDesc('Preselected target when opening a new session tab')
			.addDropdown((dropdown) => {
				for (const profile of profiles) {
					dropdown.addOption(profile.id, `${profile.displayName} (${profile.id})`);
				}
				dropdown.addOption(SPECIAL_CLI_ID_DEFAULT_SHELL, 'Default shell');
				dropdown
					.setValue(this.plugin.settings.defaultCliId)
					.onChange(async (value) => {
						this.plugin.settings.defaultCliId = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl).setName('CLI profiles').setHeading();

		new Setting(containerEl)
			.setName('Add CLI profile')
			.setDesc('Add another agent CLI profile')
			.addButton((button) =>
				button.setButtonText('Add')
					.onClick(async () => {
						this.plugin.settings.cliProfiles.push(createNewCliProfile(profiles));
						await this.saveAndRefresh();
					})
			);

		for (const profile of profiles) {
			new Setting(containerEl).setName(`${profile.displayName} (${profile.id})`).setHeading();

			new Setting(containerEl)
				.setName('Display name')
				.setDesc('Name shown in CLI selection UI')
				.addText((text) => text
					.setPlaceholder('My CLI')
					.setValue(profile.displayName)
					.onChange(async (value) => {
						profile.displayName = value.trim() || profile.id;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('CLI ID')
				.setDesc('Internal identifier (lowercase letters, numbers, "-" and "_")')
				.addText((text) => text
					.setPlaceholder('My-cli')
					.setValue(profile.id)
					.onChange(async (value) => {
						const currentId = profile.id;
						const nextId = normalizeCliId(value);
						if (!nextId) return;
						const hasDuplicate = profiles.some((item) => item !== profile && item.id === nextId);
						if (hasDuplicate) {
							new Notice(`CLI ID "${nextId}" already exists.`);
							return;
						}
						profile.id = nextId;
						if (this.plugin.settings.defaultCliId === currentId) {
							this.plugin.settings.defaultCliId = nextId;
						}
						await this.saveAndRefresh();
					}));

			new Setting(containerEl)
				.setName('Executable path')
				.setDesc('Path to this CLI executable')
				.addText((text) => text
					.setPlaceholder(profile.id)
					.setValue(profile.executablePath)
					.onChange(async (value) => {
						profile.executablePath = value.trim() || profile.id;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Default args')
				.setDesc('Space-separated arguments automatically added for this CLI')
				.addText((text) => text
					.setPlaceholder('--flag value')
					.setValue(formatArgsInput(profile.defaultArgs))
					.onChange(async (value) => {
						profile.defaultArgs = parseArgsInput(value);
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Supports resume')
				.setDesc('Enable restart in continue/resume mode for this CLI')
				.addToggle((toggle) => toggle
					.setValue(profile.supportsResume)
					.onChange(async (value) => {
						profile.supportsResume = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Resume args')
				.setDesc('Space-separated arguments used for continue/resume mode')
				.addText((text) => text
					.setPlaceholder('--resume')
					.setValue(formatArgsInput(profile.resumeArgs))
					.onChange(async (value) => {
						profile.resumeArgs = parseArgsInput(value);
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Remove this profile')
				.setDesc('Delete this CLI profile')
				.addButton((button) =>
					button.setWarning()
						.setButtonText('Remove')
						.onClick(async () => {
							if (profiles.length <= 1) {
								new Notice('At least one CLI profile is required.');
								return;
							}
							this.plugin.settings.cliProfiles = profiles.filter((item) => item !== profile);
							if (this.plugin.settings.defaultCliId === profile.id) {
								this.plugin.settings.defaultCliId = this.plugin.settings.cliProfiles[0].id;
							}
							await this.saveAndRefresh();
						})
				);
		}

		new Setting(containerEl).setName('Session sidebar').setHeading();

		new Setting(containerEl)
			.setName('Session list density')
			.setDesc('How much detail each session shows in the sidebar. Compact fits the most sessions; normal adds a one-line subtitle. Full detail is always on the hover tooltip.')
			.addDropdown((dropdown) => {
				dropdown.addOption('compact', 'Compact');
				dropdown.addOption('normal', 'Normal');
				dropdown
					.setValue(this.plugin.settings.sessionListDensity)
					.onChange(async (value) => {
						this.plugin.settings.sessionListDensity = value as SessionListDensity;
						await this.plugin.saveSettings();
						this.plugin.refreshSessionSidebars();
					});
			});

		new Setting(containerEl).setName('Terminal appearance').setHeading();

		const ghosttyThemes = listGhosttyThemes();
		new Setting(containerEl)
			.setName('Terminal color theme')
			.setDesc(ghosttyThemes.length > 0
				? `Select a Ghostty theme (${ghosttyThemes.length} available). Empty = built-in dark.`
				: 'No Ghostty themes found. Install Ghostty or place themes in ~/.config/ghostty/themes/')
			.addDropdown((dropdown) => {
				dropdown.addOption('', '(default dark)');
				for (const name of ghosttyThemes) {
					dropdown.addOption(name, name);
				}
				dropdown
					.setValue(this.plugin.settings.terminalThemeName)
					.onChange(async (value) => {
						this.plugin.settings.terminalThemeName = value;
						await this.plugin.saveSettings();
						this.plugin.applyTerminalAppearanceToOpenSessions();
					});
			});

		new Setting(containerEl)
			.setName('Default font size')
			.setDesc('Default terminal font size in pixels (8-32)')
			.addSlider((slider) => slider
				.setLimits(8, 32, 1)
				.setValue(this.plugin.settings.defaultFontSize)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.defaultFontSize = value;
					await this.plugin.saveSettings();
					this.plugin.applyTerminalAppearanceToOpenSessions({ resetFontSize: true });
				}));

		new Setting(containerEl)
			.setName('Terminal font family')
			.setDesc('CSS font-family value for terminal rendering')
			.addText((text) => text
				.setPlaceholder(DEFAULT_TERMINAL_FONT_FAMILY)
				.setValue(this.plugin.settings.terminalFontFamily)
				.onChange(async (value) => {
					const trimmed = value.trim();
					this.plugin.settings.terminalFontFamily =
						trimmed || DEFAULT_TERMINAL_FONT_FAMILY;
					await this.plugin.saveSettings();
					this.plugin.applyTerminalAppearanceToOpenSessions();
				}));

		new Setting(containerEl)
			.setName('Use custom block glyphs')
			.setDesc('Toggle xterm block-character rendering. If box/ASCII art looks split, turn this on.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.terminalCustomGlyphs)
				.onChange(async (value) => {
					this.plugin.settings.terminalCustomGlyphs = value;
					await this.plugin.saveSettings();
					this.plugin.applyTerminalAppearanceToOpenSessions();
				}));

		new Setting(containerEl)
			.setName('Sync terminal clipboard')
			.setDesc('Forward terminal copy events to system clipboard.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableOsc52ClipboardSync)
				.onChange(async (value) => {
					this.plugin.settings.enableOsc52ClipboardSync = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Track shell directory')
			.setDesc('Report the shell\'s current directory so a restored tab reopens there. Applies to zsh; takes effect on the next session start.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableShellCwdTracking)
				.onChange(async (value) => {
					this.plugin.settings.enableShellCwdTracking = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Agent hook notifications').setHeading();

		new Setting(containerEl)
			.setName('Enable hook notifications')
			.setDesc('Show Obsidian notices from events emitted by CLI hooks.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableHookNotifications)
				.onChange(async (value) => {
					this.plugin.settings.enableHookNotifications = value;
					await this.plugin.saveSettings();
					this.plugin.restartHookEventMonitor();
				}));

		new Setting(containerEl)
			.setName('Play notification sound')
			.setDesc('Play a short sound when hook notifications are shown.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableHookNotificationSound)
				.onChange(async (value) => {
					this.plugin.settings.enableHookNotificationSound = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Hook events file path')
			.setDesc(`Path to JSONL event file (empty = default: ${this.plugin.getDefaultHookEventsFilePath()})`)
			.addText((text) => text
				.setPlaceholder(this.plugin.getDefaultHookEventsFilePath())
				.setValue(this.plugin.settings.hookEventsFilePath)
				.onChange(async (value) => {
					this.plugin.settings.hookEventsFilePath = value.trim();
					await this.plugin.saveSettings();
					this.plugin.restartHookEventMonitor();
				}));

		new Setting(containerEl)
			.setName('Hook poll interval (ms)')
			.setDesc('How often to scan hook event file for new lines.')
			.addSlider((slider) => slider
				.setLimits(250, 10000, 250)
				.setValue(this.plugin.settings.hookEventsPollIntervalMs)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.hookEventsPollIntervalMs = Math.max(250, Math.min(10000, Math.floor(value)));
					await this.plugin.saveSettings();
					this.plugin.restartHookEventMonitor();
				}));

		new Setting(containerEl).setName('Agent event log').setHeading();

		new Setting(containerEl)
			.setName('Record notification events')
			.setDesc('Write permission and idle prompts to the event log. Turning this off also disables the related notifications.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.hookLogNotificationEnabled)
				.onChange(async (value) => {
					this.plugin.settings.hookLogNotificationEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Record turn-complete events')
			.setDesc('Write turn completion events to the event log.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.hookLogStopEnabled)
				.onChange(async (value) => {
					this.plugin.settings.hookLogStopEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Record tool-use events')
			.setDesc('Write an entry every time a tool runs. Very high frequency and the largest contributor to log growth, so this is off by default.')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.hookLogPreToolUseEnabled)
				.onChange(async (value) => {
					this.plugin.settings.hookLogPreToolUseEnabled = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Log rotation size')
			.setDesc('Rotate the event log once it reaches this size, in megabytes.')
			.addSlider((slider) => slider
				.setLimits(1, 50, 1)
				.setValue(this.plugin.settings.hookLogMaxSizeMb)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.hookLogMaxSizeMb = value;
					await this.plugin.saveSettings();
					this.plugin.restartHookEventMonitor();
				}));

		new Setting(containerEl)
			.setName('Log rotation backups to keep')
			.setDesc('Number of rotated log files to retain before the oldest is deleted.')
			.addSlider((slider) => slider
				.setLimits(1, 5, 1)
				.setValue(this.plugin.settings.hookLogMaxGenerations)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.hookLogMaxGenerations = value;
					await this.plugin.saveSettings();
					this.plugin.restartHookEventMonitor();
				}));

		new Setting(containerEl).setName('Send selection').setHeading();

		new Setting(containerEl)
			.setName('Wrap selection in code block')
			.setDesc('Wrap selected text in a code block when sending to active CLI')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.wrapSelectionInCodeBlock)
				.onChange(async (value) => {
					this.plugin.settings.wrapSelectionInCodeBlock = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Include note path')
			.setDesc('Prepend the note file path when sending selection to active CLI')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.includeNotePathInSelectionSend)
				.onChange(async (value) => {
					this.plugin.settings.includeNotePathInSelectionSend = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl).setName('Debug').setHeading();

		new Setting(containerEl)
			.setName('Enable debug logging')
			.setDesc('Write terminal output to per-session log files (disable when not needed)')
			.addToggle((toggle) => toggle
				.setValue(this.plugin.settings.enableDebugLogging)
				.onChange(async (value) => {
					this.plugin.settings.enableDebugLogging = value;
					await this.plugin.saveSettings();
				}));
	}
}
