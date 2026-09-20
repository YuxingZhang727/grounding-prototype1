import adapterCloudflare from '@sveltejs/adapter-cloudflare';
import adapterStatic from '@sveltejs/adapter-static';

const capacitorBuild = process.env.CAPACITOR_BUILD === 'true';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: capacitorBuild
      ? adapterStatic({ fallback: 'index.html', strict: false })
      : adapterCloudflare()
  }
};

export default config;
