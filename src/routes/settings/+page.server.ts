import { config } from '$lib/server/config';
import { loadPlaybookCatalog } from '$lib/server/playbooks/catalog';
import type { PageServerLoad } from './$types';
import type { Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { changePassword } from '$lib/application/auth/changePassword';
import {
	accountsPort,
	appSettingsPort,
	clock,
	passwordHasherPort,
	playbookInstallPort,
	notificationChannelsPort,
	notificationDeliveriesPort,
	sessionsPort,
	tokensPort
} from '$lib/server/appPorts';
import { installPlaybook, PlaybookInstallError } from '$lib/application/playbooks/installPlaybook';
import {
	CannotUninstallBundledPlaybookError,
	uninstallPlaybook
} from '$lib/application/playbooks/uninstallPlaybook';
import { UnsafePlaybookDestinationError } from '$lib/server/playbooks/install';
import { MAX_PLAYBOOK_BYTES } from '$lib/domain/playbook/limits';
import { getDb } from '$lib/server/db/database';
import {
	getNotificationLastTick,
	getNotificationSettings,
	saveNotificationSettings
} from '$lib/server/notify/notificationSettingsRepository';
import {
	InvalidNotificationSettingsError,
	validateNotificationSettings
} from '$lib/application/notify/notifySettings';
import { setSessionCookie } from '$lib/server/auth/cookies';
import fs from 'node:fs';
import path from 'node:path';
import { commitRestore, stageRestore } from '$lib/server/backup/restore';
import { MAX_ARCHIVE_BYTES } from '$lib/server/backup/archive';
import { log } from '$lib/server/log';
import {
	categorizeRestoreFailure,
	type RestoreErrorCategory
} from '$lib/domain/backup/restoreError';
import type { TranslationKey } from '$lib/i18n/de';
import { t } from '$lib/i18n';
import {
	MultipartFileTooLargeError,
	MultipartFieldTooLargeError,
	parseSingleFileForm
} from '$lib/server/http/parseSingleFileForm';
import {
	AiConsentRequiredError,
	AiNotConfiguredError,
	InstructionTooLongError,
	disableAi,
	enableAi,
	getAiSettings,
	restoreDefaultAiInstruction,
	setAiInstruction
} from '$lib/application/ai/aiSettings';
import {
	InvalidThemePreferenceError,
	getThemePreference,
	setThemePreference
} from '$lib/application/settings/theme';
import { catalogErrorsForPage } from '$lib/server/playbooks/pageErrors';

// One user-facing message per category, never the raw internal reason: see
// categorizeRestoreFailure's own docblock for why several internal codes
// share a category. Logging uses the same categorization, so an
// unrecognized (and therefore potentially unsafe) message is never written
// to the log either — only the closed set of category names ever appears.
const CATEGORY_TO_I18N_KEY: Record<RestoreErrorCategory, TranslationKey> = {
	NOT_A_BACKUP: 'settings.restore.error.notABackup',
	UNSUPPORTED_FORMAT: 'settings.restore.error.unsupportedFormat',
	UNSAFE_CONTENTS: 'settings.restore.error.unsafeContents',
	TOO_LARGE: 'settings.restore.error.tooLarge',
	INTEGRITY_FAILURE: 'settings.restore.error.integrityFailure',
	NOT_ENOUGH_DISK_SPACE: 'settings.restore.error.notEnoughDiskSpace',
	UNKNOWN: 'settings.restore.error.unknown'
};

export const load: PageServerLoad = ({ url }) => {
	const catalog = loadPlaybookCatalog(config.bundledPlaybooksDir, config.customPlaybooksDir);
	const aiSettings = getAiSettings({ settings: appSettingsPort });
	const notificationSettings = getNotificationSettings(getDb());
	return {
		theme: getThemePreference({ settings: appSettingsPort }),
		playbooks: catalog.entries.map((e) => ({
			id: e.playbook.id,
			name: e.playbook.name,
			labelI18n: e.playbook.labelI18n,
			version: e.playbook.version,
			source: e.source,
			managed:
				e.source === 'custom' &&
				path.resolve(e.filePath) ===
					path.resolve(config.customPlaybooksDir, `${e.playbook.id}.yaml`),
			fieldCount: e.playbook.fields.length,
			actionCount: e.playbook.actions.length
		})),
		errors: catalogErrorsForPage(catalog.errors),
		// No key, no path: only enabled/whether-a-key-is-present/model/
		// instruction ever leave the server.
		ai: {
			enabled: aiSettings.enabled,
			keyPresent: config.aiCredentialConfigured,
			model: config.aiModel,
			instruction: aiSettings.instruction,
			instructionIsDefault: aiSettings.instructionIsDefault
		},
		notifications: {
			enabled: notificationSettings.enabled,
			channel: notificationSettings.channel,
			baseUrl: notificationSettings.baseUrl,
			topic: notificationSettings.topic,
			tokenSet: notificationSettings.tokenSet,
			webhookSet: notificationSettings.webhookSet,
			leadDays: notificationSettings.leadDays,
			minimalContent: notificationSettings.minimalContent,
			lastTickAt: getNotificationLastTick(getDb()),
			saved: url.searchParams.get('notificationsSaved') === '1',
			testSent: url.searchParams.get('notificationTest') === '1',
			lastFailure: notificationDeliveriesPort.getLastFailure()
		}
	};
};

export const actions: Actions = {
	installPlaybook: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		let parsed: Awaited<ReturnType<typeof parseSingleFileForm>>;
		try {
			parsed = await parseSingleFileForm(request, {
				destDir: path.join(config.customPlaybooksDir, '.tmp'),
				maxFileBytes: MAX_PLAYBOOK_BYTES,
				maxFieldBytes: MAX_PLAYBOOK_BYTES,
				maxFields: 2
			});
		} catch (error) {
			if (
				error instanceof MultipartFileTooLargeError ||
				error instanceof MultipartFieldTooLargeError
			)
				return fail(400, { playbookError: 'too_large' as const });
			return fail(400, { playbookError: 'invalid' as const });
		}

		try {
			const pasted = parsed.fields.yaml ?? '';
			const uploaded = parsed.file;
			const hasUpload = uploaded?.fieldName === 'file' && uploaded.byteLength > 0;
			if (uploaded?.fieldName !== undefined && uploaded.fieldName !== 'file')
				return fail(400, { playbookError: 'source' as const });
			if ((pasted.trim() === '' && !hasUpload) || (pasted.trim() !== '' && hasUpload)) {
				return fail(400, { playbookError: 'source' as const });
			}
			if (hasUpload && uploaded && !uploaded.filename.toLowerCase().endsWith('.yaml')) {
				return fail(400, { playbookError: 'invalid' as const });
			}
			const yaml = hasUpload && uploaded ? fs.readFileSync(uploaded.path, 'utf8') : pasted;
			const catalog = loadPlaybookCatalog(config.bundledPlaybooksDir, config.customPlaybooksDir);
			try {
				const playbook = installPlaybook(
					{ installer: playbookInstallPort },
					{
						yaml,
						replace: parsed.fields.replace === 'yes',
						installed: catalog.entries.map((entry) => ({
							id: entry.playbook.id,
							version: entry.playbook.version,
							source: entry.source,
							filePath: entry.filePath
						}))
					}
				);
				redirect(303, `/settings#g-playbook-${playbook.id}`);
			} catch (error) {
				if (error instanceof PlaybookInstallError) {
					return fail(400, {
						playbookError: error.code.toLowerCase() as
							'invalid' | 'too_large' | 'bundled' | 'installed' | 'too_many' | 'future_schema',
						playbookReasons: error.reasons,
						playbookExistingVersion: error.existingVersion,
						playbookSubmittedVersion: error.submittedVersion
					});
				}
				if (error instanceof UnsafePlaybookDestinationError) {
					return fail(400, { playbookError: 'invalid' as const });
				}
				throw error;
			}
		} finally {
			if (parsed.file) fs.rmSync(parsed.file.path, { force: true });
		}
	},

	uninstallPlaybook: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		const playbookId = String((await request.formData()).get('playbookId') ?? '');
		const catalog = loadPlaybookCatalog(config.bundledPlaybooksDir, config.customPlaybooksDir);
		try {
			uninstallPlaybook(
				{ installer: playbookInstallPort },
				{
					playbookId,
					installed: catalog.entries.map((entry) => ({
						id: entry.playbook.id,
						version: entry.playbook.version,
						source: entry.source,
						filePath: entry.filePath
					}))
				}
			);
		} catch (error) {
			if (
				error instanceof CannotUninstallBundledPlaybookError ||
				error instanceof UnsafePlaybookDestinationError
			) {
				return fail(400, { playbookError: 'invalid' as const });
			}
			throw error;
		}
		redirect(303, '/settings#g-playbooks');
	},

	saveNotifications: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		const data = await request.formData();
		const notificationChannel = String(data.get('channel') ?? '');
		try {
			const values = validateNotificationSettings({
				channel: notificationChannel,
				baseUrl: String(data.get('baseUrl') ?? ''),
				topic: String(data.get('topic') ?? ''),
				webhookUrl: String(data.get('webhookUrl') ?? ''),
				leadDays: String(data.get('leadDays') ?? '')
			});
			saveNotificationSettings(getDb(), {
				...values,
				enabled: data.get('enabled') === 'yes',
				minimalContent: data.get('minimalContent') === 'yes',
				token: String(data.get('token') ?? ''),
				removeToken: data.get('removeToken') === 'yes',
				removeWebhook: data.get('removeWebhook') === 'yes'
			});
		} catch (error) {
			if (error instanceof InvalidNotificationSettingsError) {
				return fail(400, {
					notificationChannel: notificationChannel === 'SLACK' ? 'SLACK' : 'NTFY',
					notificationError:
						`settings.notify.invalid${error.key[0].toUpperCase()}${error.key.slice(1)}` as const
				});
			}
			throw error;
		}
		redirect(303, '/settings?notificationsSaved=1');
	},

	testNotification: async ({ locals }) => {
		if (!locals.user) return fail(403);
		const settings = getNotificationSettings(getDb());
		if (!settings.selectedChannelConfigured)
			return fail(400, { notificationTestError: 'not_configured' });
		try {
			const channel = notificationChannelsPort.get(settings.channel);
			if (!channel) return fail(400, { notificationTestError: 'not_configured' });
			await channel.send({
				title: t('notify.message.minimalTitle'),
				body: t('notify.message.test'),
				clickUrl: config.origin
			});
		} catch (error) {
			const reason =
				error instanceof Error && /^[a-z0-9_]{1,32}$/.test(error.message)
					? error.message
					: 'send_failed';
			return fail(400, { notificationTestError: reason });
		}
		redirect(303, '/settings?notificationTest=1');
	},

	setTheme: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		const data = await request.formData();
		try {
			setThemePreference({ settings: appSettingsPort }, String(data.get('theme') ?? ''));
		} catch (err) {
			if (err instanceof InvalidThemePreferenceError) return fail(400);
			throw err;
		}
		redirect(303, '/settings');
	},

	enableAi: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		const data = await request.formData();
		try {
			enableAi(
				{ settings: appSettingsPort },
				{ consent: data.get('consent') === 'yes', hasApiKey: config.aiCredentialConfigured }
			);
		} catch (err) {
			if (err instanceof AiConsentRequiredError) {
				return fail(400, { aiError: true, aiErrorKey: 'settings.ai.consentRequired' as const });
			}
			if (err instanceof AiNotConfiguredError) {
				return fail(400, { aiError: true, aiErrorKey: 'settings.ai.keyMissing' as const });
			}
			throw err;
		}
		redirect(303, '/settings');
	},

	disableAi: async ({ locals }) => {
		if (!locals.user) return fail(403);
		disableAi({ settings: appSettingsPort });
		redirect(303, '/settings');
	},

	saveAiInstruction: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		const data = await request.formData();
		try {
			setAiInstruction({ settings: appSettingsPort }, String(data.get('instruction') ?? ''));
		} catch (err) {
			if (err instanceof InstructionTooLongError) {
				return fail(400, { aiError: true, aiErrorKey: 'settings.ai.instructionTooLong' as const });
			}
			throw err;
		}
		redirect(303, '/settings');
	},

	restoreAiInstruction: async ({ locals }) => {
		if (!locals.user) return fail(403);
		restoreDefaultAiInstruction({ settings: appSettingsPort });
		redirect(303, '/settings');
	},

	changePassword: async ({ request, locals, cookies }) => {
		if (!locals.user) return fail(403);
		const data = await request.formData();
		try {
			const result = await changePassword(
				{
					accounts: accountsPort,
					sessions: sessionsPort,
					tokens: tokensPort,
					hasher: passwordHasherPort,
					clock
				},
				{
					userId: locals.user.id,
					current: String(data.get('current') ?? ''),
					password: String(data.get('password') ?? ''),
					confirmation: String(data.get('confirmation') ?? '')
				}
			);
			setSessionCookie(cookies, result.token);
		} catch {
			return fail(400, { passwordError: true });
		}
		redirect(303, '/settings?passwordChanged=1');
	},
	restore: async ({ request, locals }) => {
		if (!locals.user) return fail(403);
		const unknownError = {
			restoreError: true as const,
			restoreErrorKey: CATEGORY_TO_I18N_KEY.UNKNOWN
		};
		// Streams the upload straight to a temp file under restoreStagingDir;
		// never buffers the whole (possibly hundreds-of-MB) archive in memory
		// the way `await request.formData()` would. maxFileBytes matches the
		// exact cap extractArchive itself enforces, so a too-large upload is
		// rejected mid-stream rather than fully received first.
		let parsed: Awaited<ReturnType<typeof parseSingleFileForm>>;
		try {
			parsed = await parseSingleFileForm(request, {
				destDir: config.restoreStagingDir,
				maxFileBytes: MAX_ARCHIVE_BYTES,
				maxFieldBytes: 16,
				maxFields: 1
			});
		} catch (cause) {
			if (cause instanceof MultipartFileTooLargeError) {
				return fail(400, { restoreError: true, restoreErrorKey: CATEGORY_TO_I18N_KEY.TOO_LARGE });
			}
			return fail(400, unknownError);
		}
		if (parsed.fields.confirm !== 'yes' || !parsed.file) {
			if (parsed.file) fs.rmSync(parsed.file.path, { force: true });
			return fail(400, unknownError);
		}
		const uploadPath = parsed.file.path;
		try {
			const staged = await stageRestore(uploadPath);
			commitRestore(staged);
			// Reported, never a reason to fail: restore does not control what it
			// is handed, unlike backup's own AttachmentBackupError.
			const { missingFiles, mismatchedFiles, orphanedFiles } = staged.attachmentReconciliation;
			if (missingFiles.length || mismatchedFiles.length || orphanedFiles.length) {
				log.warn('restored attachments are inconsistent with the database', {
					missingFiles: missingFiles.length,
					mismatchedFiles: mismatchedFiles.length,
					orphanedFiles: orphanedFiles.length
				});
			}
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'unknown';
			const category = categorizeRestoreFailure(message);
			log.warn('restore failed', { category });
			return fail(400, { restoreError: true, restoreErrorKey: CATEGORY_TO_I18N_KEY[category] });
		} finally {
			fs.rmSync(uploadPath, { force: true });
		}
		redirect(303, '/settings');
	}
};
