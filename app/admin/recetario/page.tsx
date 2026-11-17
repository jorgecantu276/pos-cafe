import { posProfile } from '@/lib/pos-profile';
import { notFound } from 'next/navigation';
import RecipeBook from './RecipeBook';
import './recipe-book.css';

export default function RecipeBookPage() {
  if (posProfile.id !== 'smoothies') notFound();
  return <RecipeBook />;
}
