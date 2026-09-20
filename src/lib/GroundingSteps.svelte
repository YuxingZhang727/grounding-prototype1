<script lang="ts">
  export let active: 'touch' | 'see' | 'hear';
  export let onselect: (step: 'touch' | 'see' | 'hear') => void;
</script>

<div class="flow-bar">
  <a href="/app?tab=exercises" class="exit" aria-label="Leave digital grounding">‹ <span>Exercises</span></a>
  <nav aria-label="Digital grounding steps">
    {#each ['touch', 'see', 'hear'] as item, index}
      <button aria-label={`${index + 1}. ${item}`} class:active={active === item} aria-current={active === item ? 'step' : undefined} onclick={() => onselect(item as 'touch' | 'see' | 'hear')}>
        <span>{index + 1}</span>{item}
      </button>
    {/each}
  </nav>
</div>

<style>
  .flow-bar { position:fixed; z-index:90; top:max(8px,env(safe-area-inset-top)); left:max(12px,env(safe-area-inset-left)); right:max(12px,env(safe-area-inset-right)); min-height:54px; display:grid; grid-template-columns:minmax(68px,1fr) auto minmax(68px,1fr); align-items:center; pointer-events:none; color:#2f302d; font-family:Manrope,Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  .exit,nav { pointer-events:auto; }
  .exit { justify-self:start; min-height:44px; display:flex; align-items:center; gap:3px; color:inherit; text-decoration:none; font-size:13px; font-weight:600; }
  nav { grid-column:2; display:flex; gap:4px; padding:5px; background:rgba(247,241,231,.94); border:1px solid #ded6c9; border-radius:20px; box-shadow:0 6px 20px rgba(45,40,35,.08); backdrop-filter:blur(14px); }
  button { min-width:62px; min-height:38px; padding:0 10px; border:0; border-radius:15px; background:transparent; color:#6f716b; font:600 10px/1 Manrope,Inter,sans-serif; text-transform:capitalize; cursor:pointer; }
  button span { display:inline-block; margin-right:5px; font-size:9px; opacity:.65; }
  button.active { background:#fcecc6; color:#2f302d; }
  button:focus-visible,.exit:focus-visible { outline:2px solid #b9785f; outline-offset:2px; }
  @media(max-width:390px) { .flow-bar { grid-template-columns:44px 1fr 0; }.exit span { display:none; } nav { width:100%; justify-content:space-between; } button { min-width:0; flex:1; padding-inline:7px; } }
</style>
