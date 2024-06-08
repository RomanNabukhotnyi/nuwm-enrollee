<script lang="ts">
  import Uppy from '@uppy/core';
  import XHR from '@uppy/xhr-upload';
  import Dashboard from '@uppy/dashboard';

  import '@uppy/core/dist/style.css';
  import '@uppy/dashboard/dist/style.css';
  import { onMount } from 'svelte';

  onMount(() => {
    new Uppy({
      restrictions: {
        allowedFileTypes: ['.pdf', '.docx', '.zip', '.jpg', '.png', '.jpeg'],
      },
    })
      .use(Dashboard, { inline: true, target: '#uppy-dashboard' })
      .use(XHR, { endpoint: 'http://localhost:3000/upload' });
  });
</script>

<main class="container mx-auto p-8 space-y-8">
  <div id="uppy-dashboard" class="w-min mx-auto"></div>
</main>
