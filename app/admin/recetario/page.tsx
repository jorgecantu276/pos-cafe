import { posProfile } from '@/lib/pos-profile';
import { notFound } from 'next/navigation';
import RecipeBook from './RecipeBook';
import './recipe-book.css';

export default async function RecipeBookPage({ searchParams }: { searchParams: Promise<{ receta?: string; nueva?: string }> }) {
  if (posProfile.id !== 'smoothies') notFound();
  const query = await searchParams;
  const recipe = typeof query.receta === 'string' ? query.receta : undefined;
  return <RecipeBook key={`${recipe ?? ''}:${query.nueva === '1'}`} initialRecipe={recipe} startNew={query.nueva === '1'} />;
}
