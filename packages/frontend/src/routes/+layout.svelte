<script lang="ts">
  import './styles.css';
  import 'iconify-icon';
  import { AppShell } from '@skeletonlabs/skeleton';
</script>

<AppShell slotSidebarLeft="bg-surface-500/5 w-56 p-4">
  <!-- (header) -->
  <svelte:fragment slot="sidebarLeft">
    <!-- Insert the list: -->
    <nav class="list-nav">
      <ul>
        <li><a href="/">Upload</a></li>
        <li><a href="/files">Files</a></li>
      </ul>
    </nav>
    <!-- --- -->
  </svelte:fragment>
  <!-- (sidebarRight) -->
  <!-- (pageHeader) -->
  <!-- Router Slot -->
  <slot />
  <!-- ---- / ---- -->
  <!-- (pageFooter) -->
  <!-- (footer) -->
</AppShell>
