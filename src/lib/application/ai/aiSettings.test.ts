import { describe, expect, it, vi } from 'vitest';
import {
	AiConsentRequiredError,
	AiNotConfiguredError,
	DEFAULT_AI_INSTRUCTION,
	InstructionTooLongError,
	disableAi,
	enableAi,
	getAiSettings,
	restoreDefaultAiInstruction,
	setAiInstruction
} from './aiSettings';

function fakeSettings(store: Record<string, string> = {}) {
	return {
		get: vi.fn((key: string) => store[key] ?? null),
		set: vi.fn((key: string, value: string) => {
			store[key] = value;
		})
	};
}

describe('getAiSettings', () => {
	it('reads as disabled on a fresh install with no ai.enabled row', () => {
		const settings = fakeSettings();
		expect(getAiSettings({ settings }).enabled).toBe(false);
	});

	it('falls back to the default instruction when none is stored', () => {
		const settings = fakeSettings();
		const result = getAiSettings({ settings });
		expect(result.instruction).toBe(DEFAULT_AI_INSTRUCTION);
		expect(result.instructionIsDefault).toBe(true);
	});
});

describe('enableAi', () => {
	it('throws AiNotConfiguredError without a key, before checking consent', () => {
		const settings = fakeSettings();
		const attempt = () => enableAi({ settings }, { consent: true, hasApiKey: false });
		expect(attempt).toThrow(AiNotConfiguredError);
		expect(settings.set).not.toHaveBeenCalled();
	});

	it('throws AiConsentRequiredError without consent', () => {
		const settings = fakeSettings();
		const attempt = () => enableAi({ settings }, { consent: false, hasApiKey: true });
		expect(attempt).toThrow(AiConsentRequiredError);
		expect(settings.set).not.toHaveBeenCalled();
	});

	it('enables with consent and a key present', () => {
		const settings = fakeSettings();
		enableAi({ settings }, { consent: true, hasApiKey: true });
		expect(settings.set).toHaveBeenCalledWith('ai.enabled', '1');
	});
});

describe('disableAi', () => {
	it('requires no confirmation and always succeeds', () => {
		const settings = fakeSettings({ 'ai.enabled': '1' });
		disableAi({ settings });
		expect(settings.set).toHaveBeenCalledWith('ai.enabled', '0');
	});
});

describe('setAiInstruction / restoreDefaultAiInstruction', () => {
	it('rejects an instruction over 1000 characters', () => {
		const settings = fakeSettings();
		expect(() => setAiInstruction({ settings }, 'x'.repeat(1001))).toThrow(InstructionTooLongError);
	});

	it('stores a trimmed instruction', () => {
		const settings = fakeSettings();
		setAiInstruction({ settings }, '  hello  ');
		expect(settings.set).toHaveBeenCalledWith('ai.instruction', 'hello');
	});

	it('restores the default instruction', () => {
		const settings = fakeSettings({ 'ai.instruction': 'custom' });
		restoreDefaultAiInstruction({ settings });
		expect(settings.set).toHaveBeenCalledWith('ai.instruction', DEFAULT_AI_INSTRUCTION);
	});
});
