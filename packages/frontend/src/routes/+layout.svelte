<script lang="ts">
  import './styles.css';
  import Nav from './nav.svelte';
  import FileUp from 'lucide-svelte/icons/file-up';
  import Files from 'lucide-svelte/icons/files';
  import type { LayoutData } from './$types';
  import Button from '$lib/components/ui/button/button.svelte';

  // export let data: LayoutData;

  import api from '../api';
  import { onMount } from 'svelte';

  let user: unknown;

  onMount(async () => {
    const res = await api.me.get();
    if (res.status === 401) {
      user = null;
    }
    user = res.data?.user ?? null;
  });
</script>

{#if user}
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

{#if !user}
  <div class="h-full flex items-center justify-center">
    <Button
      href={process.env.NODE_ENV === 'development'
        ? 'http://localhost:3000/sign-in'
        : 'https://nuwm-enrollee-be.fly.dev/sign-in'}>Sign In</Button
    >
  </div>
{/if}
