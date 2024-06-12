<script lang="ts">
  import { cn } from '$lib/utils.js';
  import { Button } from '$lib/components/ui/button';

  import type { ComponentType } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  type Route = {
    title: string;
    href: string;
    icon: ComponentType;
  };

  export let routes: Route[];
</script>

<div class="group flex flex-col gap-4 py-2 data-[collapsed=true]:py-2">
  <nav class="grid gap-1 px-2 group-[[data-collapsed=true]]:justify-center group-[[data-collapsed=true]]:px-2">
    {#each routes as route}
      <Button
        href="#"
        size="sm"
        variant={route.href === $page.url.pathname ? 'default' : 'ghost'}
        class={cn('justify-start')}
        on:click={() => goto(route.href)}
      >
        <svelte:component this={route.icon} class="mr-2 size-4" aria-hidden="true" />
        {route.title}
      </Button>
    {/each}
  </nav>
</div>
