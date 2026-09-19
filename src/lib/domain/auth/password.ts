export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'BLANK' | 'SAME_AS_USERNAME';

export function checkPassword(password: string, username: string): PasswordProblem | null {
	if (password.trim().length === 0) return 'BLANK';
	if (password.length < MIN_PASSWORD_LENGTH) return 'TOO_SHORT';
	if (password.length > MAX_PASSWORD_LENGTH) return 'TOO_LONG';
	if (password.toLocaleLowerCase() === username.trim().toLocaleLowerCase())
		return 'SAME_AS_USERNAME';
	return null;
}
