"use strict";
// Minimal dataset loader stub for broken-docs fixture
window.LocalDatasetLoader = class LocalDatasetLoader {
  constructor(basePath) {
    this.basePath = basePath;
    this.manifest = null;
  }

  async loadManifest() {
    const response = await fetch(`${this.basePath}/dataset-manifest.json`);
    if (!response.ok) {
      throw new Error(`Failed to load manifest: ${response.status}`);
    }
    // This will throw on malformed JSON
    this.manifest = await response.json();
    return this.manifest;
  }

  async loadDimensions() {
    return { repositories: [], teams: [], authors: [] };
  }

  async getWeeklyRollups() {
    return [];
  }

  getCoverage() {
    return this.manifest?.coverage || null;
  }
};
