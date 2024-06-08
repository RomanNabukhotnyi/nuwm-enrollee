<script lang="ts">
  import api from '../../api';

  export let data: {
    files: { id: string; name: string }[];
  };

  const deleteFile = (id: string) => {
    api
      .files({ id })
      .delete()
      .then(() => {
        data.files = data.files.filter((file) => file.id !== id);
      });
  };
</script>

<main class="container mx-auto p-8 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
  {#each data.files as file}
    <div
      class="relative bg-white shadow-md p-4 rounded-md max-w-sm hover:shadow-lg transition duration-300 ease-in-out group"
    >
      <h2 class="text-lg font-semibold">{file.name}</h2>
      <button
        class="absolute -top-2 -right-2 flex h-7 w-7 justify-center items-center variant-filled-error rounded-full shadow-md group-hover:opacity-100 transition duration-300 ease-in-out opacity-0"
        on:click={() => deleteFile(file.id)}
      >
        <iconify-icon icon="mdi:trash-outline" width="16" height="16" />
      </button>
    </div>
  {/each}
</main>
