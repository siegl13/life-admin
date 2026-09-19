import fs from 'node:fs';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertEnoughFreeSpace, NotEnoughDiskSpaceError } from './diskSpace';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('assertEnoughFreeSpace', () => {
	it('does not throw when plenty of space is available', () => {
		vi.spyOn(fs, 'statfsSync').mockReturnValue({
			bavail: 1_000_000,
			bsize: 4096
		} as fs.StatsFsBase<number>);
		expect(() => assertEnoughFreeSpace(os.tmpdir(), 1000)).not.toThrow();
	});

	it('throws NotEnoughDiskSpaceError when available space is below the requirement', () => {
		vi.spyOn(fs, 'statfsSync').mockReturnValue({
			bavail: 10,
			bsize: 4096
		} as fs.StatsFsBase<number>);
		expect(() => assertEnoughFreeSpace(os.tmpdir(), 1_000_000_000)).toThrow(
			NotEnoughDiskSpaceError
		);
	});

	it('treats a statfsSync failure as "space unknown" and does not throw', () => {
		vi.spyOn(fs, 'statfsSync').mockImplementation(() => {
			throw new Error('ENOSYS');
		});
		expect(() => assertEnoughFreeSpace(os.tmpdir(), 1_000_000_000)).not.toThrow();
	});
});
