<script lang="ts">
  import './styles.css';
  import Nav from './nav.svelte';
  import FileUp from 'lucide-svelte/icons/file-up';
  import Files from 'lucide-svelte/icons/files';
  import type { LayoutServerData } from './$types';
  import Button from '$lib/components/ui/button/button.svelte';

  export let data: LayoutServerData;
</script>

{#if data.user}
  <div class="h-full flex">
    <div class="min-w-[200px] max-w-[200px] border-r">
      <Nav
        routes={[
          {
            title: 'Upload',
            href: '/',
            icon: FileUp,
          },
          {
            title: 'Files',
            href: '/files',
            icon: Files,
          },
        ]}
      />
    </div>
    <slot />
  </div>
{/if}

{#if !data.user}
  <div class="h-full flex items-center justify-center">
    <Button href="https://nuwm-enrollee-be.fly.dev/sign-in">Sign In</Button>
  </div>
{/if}
