"use strict";
// Minimal artifact client stub for broken-docs fixture
window.ArtifactClient = class ArtifactClient {
  constructor(projectId) {
    this.projectId = projectId;
    this.initialized = false;
  }
  async initialize() {
    this.initialized = true;
    return this;
  }
};
