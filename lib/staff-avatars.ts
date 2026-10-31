export const staffAvatars = [
  { label: 'Hombre', src: '/staff-avatars/avatar-1.svg' },
  { label: 'Mujer', src: '/staff-avatars/avatar-2.svg' },
] as const;

export function isStaffAvatarPath(value: string): boolean {
  return staffAvatars.some(avatar => avatar.src === value);
}

export function staffAvatarSource(value: string | null | undefined, username: string): string {
  if (value && isStaffAvatarPath(value)) return value;
  const hash = [...username.toLowerCase()].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) >>> 0, 0);
  return staffAvatars[hash % staffAvatars.length].src;
}
