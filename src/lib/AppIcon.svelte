<script lang="ts">
  export let name: 'home' | 'history' | 'exercises' | 'archive' | 'profile' | 'heart' | 'calendar' | 'signal' | 'chevron';
  export let size = 22;
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'home'}
    <path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-6h5v6"/>
  {:else if name === 'history'}
    <path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>
  {:else if name === 'exercises'}
    <path d="M7 5h10M5 9h14M7 13h10M9 17h6"/>
  {:else if name === 'archive'}
    <path d="M4 6h16v4H4z"/><path d="M6 10v10h12V10M10 14h4"/>
  {:else if name === 'profile'}
    <circle cx="12" cy="8" r="3"/><path d="M5.5 21c.4-4.1 2.6-6 6.5-6s6.1 1.9 6.5 6"/>
  {:else if name === 'heart'}
    <path d="M20.8 5.8c-2-2-5.1-1.6-6.8.5L12 8.7l-2-2.4C8.3 4.2 5.2 3.8 3.2 5.8c-2.3 2.3-1.5 6 .7 8.1L12 21l8.1-7.1c2.2-2.1 3-5.8.7-8.1Z"/>
  {:else if name === 'calendar'}
    <rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 10h18"/>
  {:else if name === 'signal'}
    <path d="M3 12h4l2-6 4 12 2-6h6"/>
  {:else}
    <path d="m9 6 6 6-6 6"/>
  {/if}
</svg>
