import type { AppSettingsPort } from './ports';

const KEY_ENABLED = 'ai.enabled';
const KEY_INSTRUCTION = 'ai.instruction';
export const MAX_INSTRUCTION_LENGTH = 1000;

export const DEFAULT_AI_INSTRUCTION =
	'Die Dokumente sind meist deutsche Behörden- oder Vertragsschreiben. Wenn ein Datum als 31.12.2027 geschrieben ist, gib es als 2027-12-31 aus. Wenn ein Wert nicht klar im Dokument steht, lass das Feld weg.';

export interface AiSettings {
	enabled: boolean;
	instruction: string;
	instructionIsDefault: boolean;
}

/** Absent means off: a fresh install reads `ai.enabled` as unset, which is
 *  "off", not a third state that needs its own handling. */
export function getAiSettings(ports: { settings: AppSettingsPort }): AiSettings {
	const enabled = ports.settings.get(KEY_ENABLED) === '1';
	const instruction = ports.settings.get(KEY_INSTRUCTION) ?? DEFAULT_AI_INSTRUCTION;
	return { enabled, instruction, instructionIsDefault: instruction === DEFAULT_AI_INSTRUCTION };
}

export class AiConsentRequiredError extends Error {}
export class AiNotConfiguredError extends Error {}

/** `hasApiKey` is passed in by the caller (server/config.ts), never read
 *  here: the application layer must not know how the key is configured,
 *  only whether one is present. Consent is checked server-side regardless
 *  of what the browser already enforced via `required`. */
export function enableAi(
	ports: { settings: AppSettingsPort },
	input: { consent: boolean; hasApiKey: boolean }
): void {
	if (!input.hasApiKey) throw new AiNotConfiguredError();
	if (!input.consent) throw new AiConsentRequiredError();
	ports.settings.set(KEY_ENABLED, '1');
}

/** No confirmation needed: turning a network feature off is never risky. */
export function disableAi(ports: { settings: AppSettingsPort }): void {
	ports.settings.set(KEY_ENABLED, '0');
}

export class InstructionTooLongError extends Error {}

export function setAiInstruction(ports: { settings: AppSettingsPort }, instruction: string): void {
	const trimmed = instruction.trim();
	if (trimmed.length > MAX_INSTRUCTION_LENGTH) throw new InstructionTooLongError();
	ports.settings.set(KEY_INSTRUCTION, trimmed || DEFAULT_AI_INSTRUCTION);
}

export function restoreDefaultAiInstruction(ports: { settings: AppSettingsPort }): void {
	ports.settings.set(KEY_INSTRUCTION, DEFAULT_AI_INSTRUCTION);
}
