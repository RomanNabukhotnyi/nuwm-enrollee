<script lang="ts">
  import './styles.css';
  import Nav from './nav.svelte';
  import FileUp from 'lucide-svelte/icons/file-up';
  import Files from 'lucide-svelte/icons/files';
</script>

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
