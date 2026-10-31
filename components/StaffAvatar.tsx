import Image from 'next/image';
import { staffAvatarSource } from '@/lib/staff-avatars';

export default function StaffAvatar({ value, username, size = 64, className = '' }: {
  value?: string | null; username: string; size?: number; className?: string;
}) {
  return <Image unoptimized src={staffAvatarSource(value, username)} width={size} height={size}
    alt="" aria-hidden="true" className={className}/>;
}
