/**
 * Minimal structured JSON logger. No external dependency: this is
 * intentionally small (see the approved plan's dependency-management
 * rules — prefer no dependency over a logging library for ~30 lines of
 * behavior).
 *
 * Never log secrets, file contents of untrusted playbooks, or full stack
 * traces from user-triggered errors to stdout in a way that could leak
 * internal paths to a client; this logger is server-side only.
 */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields?: Record<string, unknown>) {
	const entry = {
		time: new Date().toISOString(),
		level,
		message,
		...fields
	};
	const line = JSON.stringify(entry);
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
}

export const log = {
	info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
	warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
	error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields)
};
