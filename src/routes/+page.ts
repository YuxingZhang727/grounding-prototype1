import { redirect } from '@sveltejs/kit';

export function load({ url }) {
  const start = url.searchParams.get('start');
  if (start !== 'see' && start !== 'sound') redirect(307, '/app');
}
