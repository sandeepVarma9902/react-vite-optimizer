export function validatePassword(value) {
  const problems = [];
  if (!value) problems.push('Enter a new password');
  if (value && value.length < 10) problems.push("Use at least 10 characters");
  if (value && !/[A-Z]/.test(value)) problems.push("Include an uppercase letter");
  if (value && !/[a-z]/.test(value)) problems.push("Include a lowercase letter");
  if (value && !/[0-9]/.test(value)) problems.push("Include a number");
  return problems;
}

export function validateEmail(value) {
  if (!value) return 'Email is required';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'Enter a valid email';
  return null;
}
