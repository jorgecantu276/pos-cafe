import { posProfile } from '@/lib/pos-profile';
import Register from './register/Register';
import { clipSettings } from '@/lib/clip-config';
export const dynamic='force-dynamic';
export default function POSPage() {
  const smoothies = posProfile.id === 'smoothies';
  const ui = process.env.POS_REGISTER_UI;
  return <Register smoothies={smoothies} appearance={!smoothies && (ui === 'owner' || ui === 'prototype') ? ui : 'workspace'}
    clipEnabled={!smoothies && clipSettings().enabled} />;
}
