<script setup lang="ts">
// Shown when a page's code could not be downloaded (offline, or an older tab after a new version
// replaced the files). Reloading fetches the current files (spec 010 A-25).
import { t } from '../i18n'
const reload = () => location.reload()
</script>

<template>
  <div class="panel page-load-error" role="alert">
    <p>{{ t('common.pageLoadFailed') }}</p>
    <button type="button" class="btn pri" @click="reload">{{ t('common.reload') }}</button>
  </div>
</template>

<style scoped>
.page-load-error { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 20px; }
.page-load-error p { margin: 0; }
</style>
