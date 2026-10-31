<script lang="ts">
  let { label = '', checked = $bindable(), hint = '' }: { label?: string; checked: boolean; hint?: string } = $props();
</script>

<label class="toggle" title={hint}>
  <span class="label">{label}</span>
  <input type="checkbox" role="switch" bind:checked />
  <span class="track" aria-hidden="true"><span class="knob"></span></span>
</label>

<style>
  .toggle {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 8px;
    min-height: 26px;
    cursor: pointer;
    position: relative;
  }
  input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
  }
  .track {
    width: 30px;
    height: 16px;
    border-radius: 8px;
    background: var(--frame-2);
    border: 1px solid var(--rule);
    position: relative;
    transition: background 0.12s;
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--ink-3);
    transition: transform 0.12s, background 0.12s;
  }
  input:checked + .track {
    background: var(--lake-dim);
    border-color: var(--lake);
  }
  input:checked + .track .knob {
    transform: translateX(14px);
    background: var(--lake);
  }
  input:focus-visible + .track {
    outline: 2px solid var(--lake);
    outline-offset: 2px;
  }
</style>
