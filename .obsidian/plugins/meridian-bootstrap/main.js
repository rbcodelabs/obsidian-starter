"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MeridianBootstrapPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var MeridianBootstrapPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.pluginData = {};
  }
  async onload() {
    this.pluginData = await this.loadData() ?? {};
    if (this.pluginData.bootstrapped) return;
    this.app.workspace.onLayoutReady(() => {
      this.runBootstrap();
    });
  }
  onunload() {
  }
  // ── Bootstrap orchestrator ────────────────────────────────────────────────
  async runBootstrap() {
    const config = await this.readConfig();
    if (!config) return;
    const communityPlugins = config.communityPlugins ?? [];
    const githubPlugins = config.githubPlugins ?? [];
    if (communityPlugins.length === 0 && githubPlugins.length === 0) return;
    const steps = [
      ...communityPlugins.map((id) => ({ id, label: id, status: "pending" })),
      ...githubPlugins.map((repo) => ({
        id: repo,
        label: repo.split("/")[1],
        status: "pending"
      }))
    ];
    const modal = new BootstrapModal(this.app, steps);
    modal.open();
    let registry = [];
    if (communityPlugins.length > 0) {
      try {
        const res = await (0, import_obsidian.requestUrl)(
          "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json"
        );
        registry = res.json;
      } catch (e) {
        console.error("meridian-bootstrap: failed to fetch community registry", e);
      }
    }
    for (const id of communityPlugins) {
      modal.updateStep(id, "running");
      try {
        const entry = registry.find((e) => e.id === id);
        if (!entry) {
          modal.updateStep(id, "failed", "Not in registry");
          continue;
        }
        await this.installFromGitHub(entry.repo, id);
        await this.activatePlugin(id);
        modal.updateStep(id, "done");
      } catch (e) {
        modal.updateStep(id, "failed", String(e));
        console.error(`meridian-bootstrap: failed to install community plugin ${id}`, e);
      }
    }
    for (const repo of githubPlugins) {
      modal.updateStep(repo, "running");
      try {
        const pluginId = await this.getPluginId(repo);
        await this.installFromGitHub(repo, pluginId);
        await this.activatePlugin(pluginId);
        modal.updateStep(repo, "done");
      } catch (e) {
        modal.updateStep(repo, "failed", String(e));
        console.error(`meridian-bootstrap: failed to install GitHub plugin ${repo}`, e);
      }
    }
    await this.seedBrat(githubPlugins);
    this.pluginData.bootstrapped = true;
    await this.saveData(this.pluginData);
    modal.showDone();
  }
  // ── Installation helpers ──────────────────────────────────────────────────
  async readConfig() {
    try {
      const text = await this.app.vault.adapter.read(".obsidian/meridian.json");
      return JSON.parse(text);
    } catch {
      console.log("meridian-bootstrap: .obsidian/meridian.json not found \u2014 skipping");
      return null;
    }
  }
  async getPluginId(repo) {
    const res = await (0, import_obsidian.requestUrl)(
      `https://raw.githubusercontent.com/${repo}/HEAD/manifest.json`
    );
    return res.json.id;
  }
  async installFromGitHub(repo, pluginId) {
    const releaseRes = await (0, import_obsidian.requestUrl)(
      `https://api.github.com/repos/${repo}/releases/latest`
    );
    const release = releaseRes.json;
    const assetMap = {};
    for (const asset of release.assets) {
      assetMap[asset.name] = asset.browser_download_url;
    }
    const pluginDir = `.obsidian/plugins/${pluginId}`;
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(pluginDir)) {
      await adapter.mkdir(pluginDir);
    }
    for (const filename of ["main.js", "manifest.json", "styles.css"]) {
      const url = assetMap[filename];
      if (!url) continue;
      const res = await (0, import_obsidian.requestUrl)({ url, throw: false });
      if (res.status === 200) {
        await adapter.writeBinary(`${pluginDir}/${filename}`, res.arrayBuffer);
      }
    }
  }
  async activatePlugin(id) {
    let enabled = [];
    try {
      const raw = await this.app.vault.adapter.read(".obsidian/community-plugins.json");
      enabled = JSON.parse(raw);
    } catch {
    }
    if (!enabled.includes(id)) {
      enabled.push(id);
      await this.app.vault.adapter.write(
        ".obsidian/community-plugins.json",
        JSON.stringify(enabled, null, 2)
      );
    }
    const plugins = this.app.plugins;
    await plugins.loadPlugin(id);
    await plugins.enablePlugin(id);
  }
  async seedBrat(githubPlugins) {
    if (githubPlugins.length === 0) return;
    const bratDataPath = ".obsidian/plugins/obsidian42-brat/data.json";
    let bratData = {
      // eslint-disable-line @typescript-eslint/no-explicit-any
      pluginList: [],
      pluginSubListFrozenVersion: [],
      updateAtStartup: true,
      enableAfterInstall: true,
      loggingEnabled: false,
      notificationsEnabled: true
    };
    try {
      const existing = await this.app.vault.adapter.read(bratDataPath);
      bratData = JSON.parse(existing);
    } catch {
    }
    const existingRepos = new Set(bratData.pluginList ?? []);
    for (const repo of githubPlugins) {
      if (!existingRepos.has(repo)) {
        bratData.pluginList.push(repo);
        bratData.pluginSubListFrozenVersion.push({ repo, version: "latest" });
      }
    }
    try {
      await this.app.vault.adapter.write(bratDataPath, JSON.stringify(bratData, null, 2));
    } catch (e) {
      console.warn("meridian-bootstrap: could not seed BRAT data.json", e);
    }
  }
};
var BootstrapModal = class extends import_obsidian.Modal {
  constructor(app, steps) {
    super(app);
    this.stepEls = /* @__PURE__ */ new Map();
    this.steps = steps;
    this.modalEl.addClass("meridian-bootstrap-modal");
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Setting up your vault" });
    contentEl.createEl("p", {
      text: "Installing plugins \u2014 this only happens once.",
      cls: "setting-item-description"
    });
    const list = contentEl.createDiv({ cls: "meridian-steps" });
    for (const step of this.steps) {
      const row = list.createDiv({ cls: "meridian-step" });
      const icon = row.createSpan({ cls: "meridian-step-icon", text: "\xB7" });
      row.createSpan({ cls: "meridian-step-name", text: step.label });
      const detail = row.createSpan({ cls: "meridian-step-detail" });
      this.stepEls.set(step.id, { icon, detail });
    }
  }
  updateStep(id, status, detail) {
    const els = this.stepEls.get(id);
    if (!els) return;
    const icons = {
      pending: "\xB7",
      running: "\u23F3",
      done: "\u2705",
      failed: "\u274C",
      skipped: "\u2013"
    };
    els.icon.textContent = icons[status];
    if (detail) els.detail.textContent = detail;
  }
  showDone() {
    const { contentEl } = this;
    const msg = contentEl.createDiv({ cls: "meridian-done-message" });
    msg.createEl("strong", { text: "All done! " });
    msg.appendText("Please restart Obsidian to finish activating your plugins.");
    new import_obsidian.ButtonComponent(contentEl).setButtonText("OK").setCta().setClass("meridian-restart-btn").onClick(() => this.close());
  }
  onClose() {
    this.contentEl.empty();
    this.stepEls.clear();
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL21haW4udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IEFwcCwgQnV0dG9uQ29tcG9uZW50LCBNb2RhbCwgUGx1Z2luLCByZXF1ZXN0VXJsIH0gZnJvbSAnb2JzaWRpYW4nO1xuXG4vLyBcdTI1MDBcdTI1MDAgVHlwZXMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbmludGVyZmFjZSBNZXJpZGlhbkNvbmZpZyB7XG4gIGNvbW11bml0eVBsdWdpbnM/OiBzdHJpbmdbXTtcbiAgZ2l0aHViUGx1Z2lucz86IHN0cmluZ1tdO1xufVxuXG5pbnRlcmZhY2UgUGx1Z2luRGF0YSB7XG4gIGJvb3RzdHJhcHBlZD86IGJvb2xlYW47XG59XG5cbmludGVyZmFjZSBDb21tdW5pdHlSZWdpc3RyeUVudHJ5IHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICByZXBvOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBHaXRodWJSZWxlYXNlIHtcbiAgYXNzZXRzOiBBcnJheTx7IG5hbWU6IHN0cmluZzsgYnJvd3Nlcl9kb3dubG9hZF91cmw6IHN0cmluZyB9Pjtcbn1cblxudHlwZSBTdGVwU3RhdHVzID0gJ3BlbmRpbmcnIHwgJ3J1bm5pbmcnIHwgJ2RvbmUnIHwgJ2ZhaWxlZCcgfCAnc2tpcHBlZCc7XG5cbmludGVyZmFjZSBJbnN0YWxsU3RlcCB7XG4gIGlkOiBzdHJpbmc7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIHN0YXR1czogU3RlcFN0YXR1cztcbiAgZGV0YWlsPzogc3RyaW5nO1xufVxuXG4vLyBcdTI1MDBcdTI1MDAgUGx1Z2luIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNZXJpZGlhbkJvb3RzdHJhcFBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHByaXZhdGUgcGx1Z2luRGF0YTogUGx1Z2luRGF0YSA9IHt9O1xuXG4gIGFzeW5jIG9ubG9hZCgpIHtcbiAgICB0aGlzLnBsdWdpbkRhdGEgPSAoYXdhaXQgdGhpcy5sb2FkRGF0YSgpKSA/PyB7fTtcbiAgICBpZiAodGhpcy5wbHVnaW5EYXRhLmJvb3RzdHJhcHBlZCkgcmV0dXJuO1xuXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLm9uTGF5b3V0UmVhZHkoKCkgPT4ge1xuICAgICAgdGhpcy5ydW5Cb290c3RyYXAoKTtcbiAgICB9KTtcbiAgfVxuXG4gIG9udW5sb2FkKCkge31cblxuICAvLyBcdTI1MDBcdTI1MDAgQm9vdHN0cmFwIG9yY2hlc3RyYXRvciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIHJ1bkJvb3RzdHJhcCgpIHtcbiAgICBjb25zdCBjb25maWcgPSBhd2FpdCB0aGlzLnJlYWRDb25maWcoKTtcbiAgICBpZiAoIWNvbmZpZykgcmV0dXJuO1xuXG4gICAgY29uc3QgY29tbXVuaXR5UGx1Z2lucyA9IGNvbmZpZy5jb21tdW5pdHlQbHVnaW5zID8/IFtdO1xuICAgIGNvbnN0IGdpdGh1YlBsdWdpbnMgPSBjb25maWcuZ2l0aHViUGx1Z2lucyA/PyBbXTtcbiAgICBpZiAoY29tbXVuaXR5UGx1Z2lucy5sZW5ndGggPT09IDAgJiYgZ2l0aHViUGx1Z2lucy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIGNvbnN0IHN0ZXBzOiBJbnN0YWxsU3RlcFtdID0gW1xuICAgICAgLi4uY29tbXVuaXR5UGx1Z2lucy5tYXAoaWQgPT4gKHsgaWQsIGxhYmVsOiBpZCwgc3RhdHVzOiAncGVuZGluZycgYXMgU3RlcFN0YXR1cyB9KSksXG4gICAgICAuLi5naXRodWJQbHVnaW5zLm1hcChyZXBvID0+ICh7XG4gICAgICAgIGlkOiByZXBvLFxuICAgICAgICBsYWJlbDogcmVwby5zcGxpdCgnLycpWzFdLFxuICAgICAgICBzdGF0dXM6ICdwZW5kaW5nJyBhcyBTdGVwU3RhdHVzLFxuICAgICAgfSkpLFxuICAgIF07XG5cbiAgICBjb25zdCBtb2RhbCA9IG5ldyBCb290c3RyYXBNb2RhbCh0aGlzLmFwcCwgc3RlcHMpO1xuICAgIG1vZGFsLm9wZW4oKTtcblxuICAgIC8vIEZldGNoIGNvbW11bml0eSByZWdpc3RyeSBvbmNlIHVwZnJvbnRcbiAgICBsZXQgcmVnaXN0cnk6IENvbW11bml0eVJlZ2lzdHJ5RW50cnlbXSA9IFtdO1xuICAgIGlmIChjb21tdW5pdHlQbHVnaW5zLmxlbmd0aCA+IDApIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlcyA9IGF3YWl0IHJlcXVlc3RVcmwoXG4gICAgICAgICAgJ2h0dHBzOi8vcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbS9vYnNpZGlhbm1kL29ic2lkaWFuLXJlbGVhc2VzL21hc3Rlci9jb21tdW5pdHktcGx1Z2lucy5qc29uJ1xuICAgICAgICApO1xuICAgICAgICByZWdpc3RyeSA9IHJlcy5qc29uIGFzIENvbW11bml0eVJlZ2lzdHJ5RW50cnlbXTtcbiAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcignbWVyaWRpYW4tYm9vdHN0cmFwOiBmYWlsZWQgdG8gZmV0Y2ggY29tbXVuaXR5IHJlZ2lzdHJ5JywgZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSW5zdGFsbCBjb21tdW5pdHkgcGx1Z2luc1xuICAgIGZvciAoY29uc3QgaWQgb2YgY29tbXVuaXR5UGx1Z2lucykge1xuICAgICAgbW9kYWwudXBkYXRlU3RlcChpZCwgJ3J1bm5pbmcnKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gcmVnaXN0cnkuZmluZChlID0+IGUuaWQgPT09IGlkKTtcbiAgICAgICAgaWYgKCFlbnRyeSkge1xuICAgICAgICAgIG1vZGFsLnVwZGF0ZVN0ZXAoaWQsICdmYWlsZWQnLCAnTm90IGluIHJlZ2lzdHJ5Jyk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5pbnN0YWxsRnJvbUdpdEh1YihlbnRyeS5yZXBvLCBpZCk7XG4gICAgICAgIGF3YWl0IHRoaXMuYWN0aXZhdGVQbHVnaW4oaWQpO1xuICAgICAgICBtb2RhbC51cGRhdGVTdGVwKGlkLCAnZG9uZScpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBtb2RhbC51cGRhdGVTdGVwKGlkLCAnZmFpbGVkJywgU3RyaW5nKGUpKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihgbWVyaWRpYW4tYm9vdHN0cmFwOiBmYWlsZWQgdG8gaW5zdGFsbCBjb21tdW5pdHkgcGx1Z2luICR7aWR9YCwgZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSW5zdGFsbCBHaXRIdWIgcGx1Z2luc1xuICAgIGZvciAoY29uc3QgcmVwbyBvZiBnaXRodWJQbHVnaW5zKSB7XG4gICAgICBtb2RhbC51cGRhdGVTdGVwKHJlcG8sICdydW5uaW5nJyk7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBwbHVnaW5JZCA9IGF3YWl0IHRoaXMuZ2V0UGx1Z2luSWQocmVwbyk7XG4gICAgICAgIGF3YWl0IHRoaXMuaW5zdGFsbEZyb21HaXRIdWIocmVwbywgcGx1Z2luSWQpO1xuICAgICAgICBhd2FpdCB0aGlzLmFjdGl2YXRlUGx1Z2luKHBsdWdpbklkKTtcbiAgICAgICAgbW9kYWwudXBkYXRlU3RlcChyZXBvLCAnZG9uZScpO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBtb2RhbC51cGRhdGVTdGVwKHJlcG8sICdmYWlsZWQnLCBTdHJpbmcoZSkpO1xuICAgICAgICBjb25zb2xlLmVycm9yKGBtZXJpZGlhbi1ib290c3RyYXA6IGZhaWxlZCB0byBpbnN0YWxsIEdpdEh1YiBwbHVnaW4gJHtyZXBvfWAsIGUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFNlZWQgQlJBVCBzbyBpdCBvd25zIGZ1dHVyZSB1cGRhdGVzIGZvciB0aGUgR2l0SHViIHBsdWdpbnNcbiAgICBhd2FpdCB0aGlzLnNlZWRCcmF0KGdpdGh1YlBsdWdpbnMpO1xuXG4gICAgLy8gTWFyayBjb21wbGV0ZVxuICAgIHRoaXMucGx1Z2luRGF0YS5ib290c3RyYXBwZWQgPSB0cnVlO1xuICAgIGF3YWl0IHRoaXMuc2F2ZURhdGEodGhpcy5wbHVnaW5EYXRhKTtcblxuICAgIG1vZGFsLnNob3dEb25lKCk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgSW5zdGFsbGF0aW9uIGhlbHBlcnMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBhc3luYyByZWFkQ29uZmlnKCk6IFByb21pc2U8TWVyaWRpYW5Db25maWcgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHRleHQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoJy5vYnNpZGlhbi9tZXJpZGlhbi5qc29uJyk7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh0ZXh0KSBhcyBNZXJpZGlhbkNvbmZpZztcbiAgICB9IGNhdGNoIHtcbiAgICAgIGNvbnNvbGUubG9nKCdtZXJpZGlhbi1ib290c3RyYXA6IC5vYnNpZGlhbi9tZXJpZGlhbi5qc29uIG5vdCBmb3VuZCBcdTIwMTQgc2tpcHBpbmcnKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZ2V0UGx1Z2luSWQocmVwbzogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCByZXMgPSBhd2FpdCByZXF1ZXN0VXJsKFxuICAgICAgYGh0dHBzOi8vcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbS8ke3JlcG99L0hFQUQvbWFuaWZlc3QuanNvbmBcbiAgICApO1xuICAgIHJldHVybiAocmVzLmpzb24gYXMgeyBpZDogc3RyaW5nIH0pLmlkO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBpbnN0YWxsRnJvbUdpdEh1YihyZXBvOiBzdHJpbmcsIHBsdWdpbklkOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZWxlYXNlUmVzID0gYXdhaXQgcmVxdWVzdFVybChcbiAgICAgIGBodHRwczovL2FwaS5naXRodWIuY29tL3JlcG9zLyR7cmVwb30vcmVsZWFzZXMvbGF0ZXN0YFxuICAgICk7XG4gICAgY29uc3QgcmVsZWFzZSA9IHJlbGVhc2VSZXMuanNvbiBhcyBHaXRodWJSZWxlYXNlO1xuXG4gICAgY29uc3QgYXNzZXRNYXA6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fTtcbiAgICBmb3IgKGNvbnN0IGFzc2V0IG9mIHJlbGVhc2UuYXNzZXRzKSB7XG4gICAgICBhc3NldE1hcFthc3NldC5uYW1lXSA9IGFzc2V0LmJyb3dzZXJfZG93bmxvYWRfdXJsO1xuICAgIH1cblxuICAgIGNvbnN0IHBsdWdpbkRpciA9IGAub2JzaWRpYW4vcGx1Z2lucy8ke3BsdWdpbklkfWA7XG4gICAgY29uc3QgYWRhcHRlciA9IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXI7XG5cbiAgICBpZiAoIShhd2FpdCBhZGFwdGVyLmV4aXN0cyhwbHVnaW5EaXIpKSkge1xuICAgICAgYXdhaXQgYWRhcHRlci5ta2RpcihwbHVnaW5EaXIpO1xuICAgIH1cblxuICAgIGZvciAoY29uc3QgZmlsZW5hbWUgb2YgWydtYWluLmpzJywgJ21hbmlmZXN0Lmpzb24nLCAnc3R5bGVzLmNzcyddKSB7XG4gICAgICBjb25zdCB1cmwgPSBhc3NldE1hcFtmaWxlbmFtZV07XG4gICAgICBpZiAoIXVybCkgY29udGludWU7XG4gICAgICBjb25zdCByZXMgPSBhd2FpdCByZXF1ZXN0VXJsKHsgdXJsLCB0aHJvdzogZmFsc2UgfSk7XG4gICAgICBpZiAocmVzLnN0YXR1cyA9PT0gMjAwKSB7XG4gICAgICAgIGF3YWl0IGFkYXB0ZXIud3JpdGVCaW5hcnkoYCR7cGx1Z2luRGlyfS8ke2ZpbGVuYW1lfWAsIHJlcy5hcnJheUJ1ZmZlcik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhY3RpdmF0ZVBsdWdpbihpZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gQWRkIHRvIGNvbW11bml0eS1wbHVnaW5zLmpzb25cbiAgICBsZXQgZW5hYmxlZDogc3RyaW5nW10gPSBbXTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmF3ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci5yZWFkKCcub2JzaWRpYW4vY29tbXVuaXR5LXBsdWdpbnMuanNvbicpO1xuICAgICAgZW5hYmxlZCA9IEpTT04ucGFyc2UocmF3KSBhcyBzdHJpbmdbXTtcbiAgICB9IGNhdGNoIHsgLyogZmlsZSBtYXkgbm90IGV4aXN0IHlldCAqLyB9XG5cbiAgICBpZiAoIWVuYWJsZWQuaW5jbHVkZXMoaWQpKSB7XG4gICAgICBlbmFibGVkLnB1c2goaWQpO1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZShcbiAgICAgICAgJy5vYnNpZGlhbi9jb21tdW5pdHktcGx1Z2lucy5qc29uJyxcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoZW5hYmxlZCwgbnVsbCwgMilcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gTG9hZCBhbmQgZW5hYmxlIHZpYSBpbnRlcm5hbCBBUEkgKHdpZGVseSB1c2VkIHBhdHRlcm4gaW4gY29tbXVuaXR5IHBsdWdpbnMpXG4gICAgY29uc3QgcGx1Z2lucyA9ICh0aGlzLmFwcCBhcyBhbnkpLnBsdWdpbnM7IC8vIGVzbGludC1kaXNhYmxlLWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuICAgIGF3YWl0IHBsdWdpbnMubG9hZFBsdWdpbihpZCk7XG4gICAgYXdhaXQgcGx1Z2lucy5lbmFibGVQbHVnaW4oaWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZWVkQnJhdChnaXRodWJQbHVnaW5zOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChnaXRodWJQbHVnaW5zLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgY29uc3QgYnJhdERhdGFQYXRoID0gJy5vYnNpZGlhbi9wbHVnaW5zL29ic2lkaWFuNDItYnJhdC9kYXRhLmpzb24nO1xuICAgIGxldCBicmF0RGF0YTogUmVjb3JkPHN0cmluZywgYW55PiA9IHsgLy8gZXNsaW50LWRpc2FibGUtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG4gICAgICBwbHVnaW5MaXN0OiBbXSxcbiAgICAgIHBsdWdpblN1Ykxpc3RGcm96ZW5WZXJzaW9uOiBbXSxcbiAgICAgIHVwZGF0ZUF0U3RhcnR1cDogdHJ1ZSxcbiAgICAgIGVuYWJsZUFmdGVySW5zdGFsbDogdHJ1ZSxcbiAgICAgIGxvZ2dpbmdFbmFibGVkOiBmYWxzZSxcbiAgICAgIG5vdGlmaWNhdGlvbnNFbmFibGVkOiB0cnVlLFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5hZGFwdGVyLnJlYWQoYnJhdERhdGFQYXRoKTtcbiAgICAgIGJyYXREYXRhID0gSlNPTi5wYXJzZShleGlzdGluZyk7XG4gICAgfSBjYXRjaCB7IC8qIEJSQVQgZGF0YS5qc29uIG1heSBub3QgZXhpc3QgeWV0ICovIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nUmVwb3MgPSBuZXcgU2V0PHN0cmluZz4oYnJhdERhdGEucGx1Z2luTGlzdCA/PyBbXSk7XG4gICAgZm9yIChjb25zdCByZXBvIG9mIGdpdGh1YlBsdWdpbnMpIHtcbiAgICAgIGlmICghZXhpc3RpbmdSZXBvcy5oYXMocmVwbykpIHtcbiAgICAgICAgYnJhdERhdGEucGx1Z2luTGlzdC5wdXNoKHJlcG8pO1xuICAgICAgICAoYnJhdERhdGEucGx1Z2luU3ViTGlzdEZyb3plblZlcnNpb24gYXMgYW55W10pLnB1c2goeyByZXBvLCB2ZXJzaW9uOiAnbGF0ZXN0JyB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuYWRhcHRlci53cml0ZShicmF0RGF0YVBhdGgsIEpTT04uc3RyaW5naWZ5KGJyYXREYXRhLCBudWxsLCAyKSk7XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgY29uc29sZS53YXJuKCdtZXJpZGlhbi1ib290c3RyYXA6IGNvdWxkIG5vdCBzZWVkIEJSQVQgZGF0YS5qc29uJywgZSk7XG4gICAgfVxuICB9XG59XG5cbi8vIFx1MjUwMFx1MjUwMCBNb2RhbCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuY2xhc3MgQm9vdHN0cmFwTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIHByaXZhdGUgc3RlcHM6IEluc3RhbGxTdGVwW107XG4gIHByaXZhdGUgc3RlcEVscyA9IG5ldyBNYXA8c3RyaW5nLCB7IGljb246IEhUTUxFbGVtZW50OyBkZXRhaWw6IEhUTUxFbGVtZW50IH0+KCk7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHN0ZXBzOiBJbnN0YWxsU3RlcFtdKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgICB0aGlzLnN0ZXBzID0gc3RlcHM7XG4gICAgdGhpcy5tb2RhbEVsLmFkZENsYXNzKCdtZXJpZGlhbi1ib290c3RyYXAtbW9kYWwnKTtcbiAgfVxuXG4gIG9uT3BlbigpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoJ2gyJywgeyB0ZXh0OiAnU2V0dGluZyB1cCB5b3VyIHZhdWx0JyB9KTtcbiAgICBjb250ZW50RWwuY3JlYXRlRWwoJ3AnLCB7XG4gICAgICB0ZXh0OiAnSW5zdGFsbGluZyBwbHVnaW5zIFx1MjAxNCB0aGlzIG9ubHkgaGFwcGVucyBvbmNlLicsXG4gICAgICBjbHM6ICdzZXR0aW5nLWl0ZW0tZGVzY3JpcHRpb24nLFxuICAgIH0pO1xuXG4gICAgY29uc3QgbGlzdCA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6ICdtZXJpZGlhbi1zdGVwcycgfSk7XG5cbiAgICBmb3IgKGNvbnN0IHN0ZXAgb2YgdGhpcy5zdGVwcykge1xuICAgICAgY29uc3Qgcm93ID0gbGlzdC5jcmVhdGVEaXYoeyBjbHM6ICdtZXJpZGlhbi1zdGVwJyB9KTtcbiAgICAgIGNvbnN0IGljb24gPSByb3cuY3JlYXRlU3Bhbih7IGNsczogJ21lcmlkaWFuLXN0ZXAtaWNvbicsIHRleHQ6ICdcdTAwQjcnIH0pO1xuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6ICdtZXJpZGlhbi1zdGVwLW5hbWUnLCB0ZXh0OiBzdGVwLmxhYmVsIH0pO1xuICAgICAgY29uc3QgZGV0YWlsID0gcm93LmNyZWF0ZVNwYW4oeyBjbHM6ICdtZXJpZGlhbi1zdGVwLWRldGFpbCcgfSk7XG4gICAgICB0aGlzLnN0ZXBFbHMuc2V0KHN0ZXAuaWQsIHsgaWNvbiwgZGV0YWlsIH0pO1xuICAgIH1cbiAgfVxuXG4gIHVwZGF0ZVN0ZXAoaWQ6IHN0cmluZywgc3RhdHVzOiBTdGVwU3RhdHVzLCBkZXRhaWw/OiBzdHJpbmcpIHtcbiAgICBjb25zdCBlbHMgPSB0aGlzLnN0ZXBFbHMuZ2V0KGlkKTtcbiAgICBpZiAoIWVscykgcmV0dXJuO1xuXG4gICAgY29uc3QgaWNvbnM6IFJlY29yZDxTdGVwU3RhdHVzLCBzdHJpbmc+ID0ge1xuICAgICAgcGVuZGluZzogJ1x1MDBCNycsXG4gICAgICBydW5uaW5nOiAnXHUyM0YzJyxcbiAgICAgIGRvbmU6ICdcdTI3MDUnLFxuICAgICAgZmFpbGVkOiAnXHUyNzRDJyxcbiAgICAgIHNraXBwZWQ6ICdcdTIwMTMnLFxuICAgIH07XG4gICAgZWxzLmljb24udGV4dENvbnRlbnQgPSBpY29uc1tzdGF0dXNdO1xuICAgIGlmIChkZXRhaWwpIGVscy5kZXRhaWwudGV4dENvbnRlbnQgPSBkZXRhaWw7XG4gIH1cblxuICBzaG93RG9uZSgpIHtcbiAgICBjb25zdCB7IGNvbnRlbnRFbCB9ID0gdGhpcztcblxuICAgIGNvbnN0IG1zZyA9IGNvbnRlbnRFbC5jcmVhdGVEaXYoeyBjbHM6ICdtZXJpZGlhbi1kb25lLW1lc3NhZ2UnIH0pO1xuICAgIG1zZy5jcmVhdGVFbCgnc3Ryb25nJywgeyB0ZXh0OiAnQWxsIGRvbmUhICcgfSk7XG4gICAgbXNnLmFwcGVuZFRleHQoJ1BsZWFzZSByZXN0YXJ0IE9ic2lkaWFuIHRvIGZpbmlzaCBhY3RpdmF0aW5nIHlvdXIgcGx1Z2lucy4nKTtcblxuICAgIG5ldyBCdXR0b25Db21wb25lbnQoY29udGVudEVsKVxuICAgICAgLnNldEJ1dHRvblRleHQoJ09LJylcbiAgICAgIC5zZXRDdGEoKVxuICAgICAgLnNldENsYXNzKCdtZXJpZGlhbi1yZXN0YXJ0LWJ0bicpXG4gICAgICAub25DbGljaygoKSA9PiB0aGlzLmNsb3NlKCkpO1xuICB9XG5cbiAgb25DbG9zZSgpIHtcbiAgICB0aGlzLmNvbnRlbnRFbC5lbXB0eSgpO1xuICAgIHRoaXMuc3RlcEVscy5jbGVhcigpO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxzQkFBZ0U7QUFrQ2hFLElBQXFCLDBCQUFyQixjQUFxRCx1QkFBTztBQUFBLEVBQTVEO0FBQUE7QUFDRSxTQUFRLGFBQXlCLENBQUM7QUFBQTtBQUFBLEVBRWxDLE1BQU0sU0FBUztBQUNiLFNBQUssYUFBYyxNQUFNLEtBQUssU0FBUyxLQUFNLENBQUM7QUFDOUMsUUFBSSxLQUFLLFdBQVcsYUFBYztBQUVsQyxTQUFLLElBQUksVUFBVSxjQUFjLE1BQU07QUFDckMsV0FBSyxhQUFhO0FBQUEsSUFDcEIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLFdBQVc7QUFBQSxFQUFDO0FBQUE7QUFBQSxFQUlaLE1BQWMsZUFBZTtBQUMzQixVQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVc7QUFDckMsUUFBSSxDQUFDLE9BQVE7QUFFYixVQUFNLG1CQUFtQixPQUFPLG9CQUFvQixDQUFDO0FBQ3JELFVBQU0sZ0JBQWdCLE9BQU8saUJBQWlCLENBQUM7QUFDL0MsUUFBSSxpQkFBaUIsV0FBVyxLQUFLLGNBQWMsV0FBVyxFQUFHO0FBRWpFLFVBQU0sUUFBdUI7QUFBQSxNQUMzQixHQUFHLGlCQUFpQixJQUFJLFNBQU8sRUFBRSxJQUFJLE9BQU8sSUFBSSxRQUFRLFVBQXdCLEVBQUU7QUFBQSxNQUNsRixHQUFHLGNBQWMsSUFBSSxXQUFTO0FBQUEsUUFDNUIsSUFBSTtBQUFBLFFBQ0osT0FBTyxLQUFLLE1BQU0sR0FBRyxFQUFFLENBQUM7QUFBQSxRQUN4QixRQUFRO0FBQUEsTUFDVixFQUFFO0FBQUEsSUFDSjtBQUVBLFVBQU0sUUFBUSxJQUFJLGVBQWUsS0FBSyxLQUFLLEtBQUs7QUFDaEQsVUFBTSxLQUFLO0FBR1gsUUFBSSxXQUFxQyxDQUFDO0FBQzFDLFFBQUksaUJBQWlCLFNBQVMsR0FBRztBQUMvQixVQUFJO0FBQ0YsY0FBTSxNQUFNLFVBQU07QUFBQSxVQUNoQjtBQUFBLFFBQ0Y7QUFDQSxtQkFBVyxJQUFJO0FBQUEsTUFDakIsU0FBUyxHQUFHO0FBQ1YsZ0JBQVEsTUFBTSwwREFBMEQsQ0FBQztBQUFBLE1BQzNFO0FBQUEsSUFDRjtBQUdBLGVBQVcsTUFBTSxrQkFBa0I7QUFDakMsWUFBTSxXQUFXLElBQUksU0FBUztBQUM5QixVQUFJO0FBQ0YsY0FBTSxRQUFRLFNBQVMsS0FBSyxPQUFLLEVBQUUsT0FBTyxFQUFFO0FBQzVDLFlBQUksQ0FBQyxPQUFPO0FBQ1YsZ0JBQU0sV0FBVyxJQUFJLFVBQVUsaUJBQWlCO0FBQ2hEO0FBQUEsUUFDRjtBQUNBLGNBQU0sS0FBSyxrQkFBa0IsTUFBTSxNQUFNLEVBQUU7QUFDM0MsY0FBTSxLQUFLLGVBQWUsRUFBRTtBQUM1QixjQUFNLFdBQVcsSUFBSSxNQUFNO0FBQUEsTUFDN0IsU0FBUyxHQUFHO0FBQ1YsY0FBTSxXQUFXLElBQUksVUFBVSxPQUFPLENBQUMsQ0FBQztBQUN4QyxnQkFBUSxNQUFNLDBEQUEwRCxFQUFFLElBQUksQ0FBQztBQUFBLE1BQ2pGO0FBQUEsSUFDRjtBQUdBLGVBQVcsUUFBUSxlQUFlO0FBQ2hDLFlBQU0sV0FBVyxNQUFNLFNBQVM7QUFDaEMsVUFBSTtBQUNGLGNBQU0sV0FBVyxNQUFNLEtBQUssWUFBWSxJQUFJO0FBQzVDLGNBQU0sS0FBSyxrQkFBa0IsTUFBTSxRQUFRO0FBQzNDLGNBQU0sS0FBSyxlQUFlLFFBQVE7QUFDbEMsY0FBTSxXQUFXLE1BQU0sTUFBTTtBQUFBLE1BQy9CLFNBQVMsR0FBRztBQUNWLGNBQU0sV0FBVyxNQUFNLFVBQVUsT0FBTyxDQUFDLENBQUM7QUFDMUMsZ0JBQVEsTUFBTSx1REFBdUQsSUFBSSxJQUFJLENBQUM7QUFBQSxNQUNoRjtBQUFBLElBQ0Y7QUFHQSxVQUFNLEtBQUssU0FBUyxhQUFhO0FBR2pDLFNBQUssV0FBVyxlQUFlO0FBQy9CLFVBQU0sS0FBSyxTQUFTLEtBQUssVUFBVTtBQUVuQyxVQUFNLFNBQVM7QUFBQSxFQUNqQjtBQUFBO0FBQUEsRUFJQSxNQUFjLGFBQTZDO0FBQ3pELFFBQUk7QUFDRixZQUFNLE9BQU8sTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLEtBQUsseUJBQXlCO0FBQ3hFLGFBQU8sS0FBSyxNQUFNLElBQUk7QUFBQSxJQUN4QixRQUFRO0FBQ04sY0FBUSxJQUFJLHVFQUFrRTtBQUM5RSxhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsWUFBWSxNQUErQjtBQUN2RCxVQUFNLE1BQU0sVUFBTTtBQUFBLE1BQ2hCLHFDQUFxQyxJQUFJO0FBQUEsSUFDM0M7QUFDQSxXQUFRLElBQUksS0FBd0I7QUFBQSxFQUN0QztBQUFBLEVBRUEsTUFBYyxrQkFBa0IsTUFBYyxVQUFpQztBQUM3RSxVQUFNLGFBQWEsVUFBTTtBQUFBLE1BQ3ZCLGdDQUFnQyxJQUFJO0FBQUEsSUFDdEM7QUFDQSxVQUFNLFVBQVUsV0FBVztBQUUzQixVQUFNLFdBQW1DLENBQUM7QUFDMUMsZUFBVyxTQUFTLFFBQVEsUUFBUTtBQUNsQyxlQUFTLE1BQU0sSUFBSSxJQUFJLE1BQU07QUFBQSxJQUMvQjtBQUVBLFVBQU0sWUFBWSxxQkFBcUIsUUFBUTtBQUMvQyxVQUFNLFVBQVUsS0FBSyxJQUFJLE1BQU07QUFFL0IsUUFBSSxDQUFFLE1BQU0sUUFBUSxPQUFPLFNBQVMsR0FBSTtBQUN0QyxZQUFNLFFBQVEsTUFBTSxTQUFTO0FBQUEsSUFDL0I7QUFFQSxlQUFXLFlBQVksQ0FBQyxXQUFXLGlCQUFpQixZQUFZLEdBQUc7QUFDakUsWUFBTSxNQUFNLFNBQVMsUUFBUTtBQUM3QixVQUFJLENBQUMsSUFBSztBQUNWLFlBQU0sTUFBTSxVQUFNLDRCQUFXLEVBQUUsS0FBSyxPQUFPLE1BQU0sQ0FBQztBQUNsRCxVQUFJLElBQUksV0FBVyxLQUFLO0FBQ3RCLGNBQU0sUUFBUSxZQUFZLEdBQUcsU0FBUyxJQUFJLFFBQVEsSUFBSSxJQUFJLFdBQVc7QUFBQSxNQUN2RTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGVBQWUsSUFBMkI7QUFFdEQsUUFBSSxVQUFvQixDQUFDO0FBQ3pCLFFBQUk7QUFDRixZQUFNLE1BQU0sTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLEtBQUssa0NBQWtDO0FBQ2hGLGdCQUFVLEtBQUssTUFBTSxHQUFHO0FBQUEsSUFDMUIsUUFBUTtBQUFBLElBQStCO0FBRXZDLFFBQUksQ0FBQyxRQUFRLFNBQVMsRUFBRSxHQUFHO0FBQ3pCLGNBQVEsS0FBSyxFQUFFO0FBQ2YsWUFBTSxLQUFLLElBQUksTUFBTSxRQUFRO0FBQUEsUUFDM0I7QUFBQSxRQUNBLEtBQUssVUFBVSxTQUFTLE1BQU0sQ0FBQztBQUFBLE1BQ2pDO0FBQUEsSUFDRjtBQUdBLFVBQU0sVUFBVyxLQUFLLElBQVk7QUFDbEMsVUFBTSxRQUFRLFdBQVcsRUFBRTtBQUMzQixVQUFNLFFBQVEsYUFBYSxFQUFFO0FBQUEsRUFDL0I7QUFBQSxFQUVBLE1BQWMsU0FBUyxlQUF3QztBQUM3RCxRQUFJLGNBQWMsV0FBVyxFQUFHO0FBRWhDLFVBQU0sZUFBZTtBQUNyQixRQUFJLFdBQWdDO0FBQUE7QUFBQSxNQUNsQyxZQUFZLENBQUM7QUFBQSxNQUNiLDRCQUE0QixDQUFDO0FBQUEsTUFDN0IsaUJBQWlCO0FBQUEsTUFDakIsb0JBQW9CO0FBQUEsTUFDcEIsZ0JBQWdCO0FBQUEsTUFDaEIsc0JBQXNCO0FBQUEsSUFDeEI7QUFFQSxRQUFJO0FBQ0YsWUFBTSxXQUFXLE1BQU0sS0FBSyxJQUFJLE1BQU0sUUFBUSxLQUFLLFlBQVk7QUFDL0QsaUJBQVcsS0FBSyxNQUFNLFFBQVE7QUFBQSxJQUNoQyxRQUFRO0FBQUEsSUFBeUM7QUFFakQsVUFBTSxnQkFBZ0IsSUFBSSxJQUFZLFNBQVMsY0FBYyxDQUFDLENBQUM7QUFDL0QsZUFBVyxRQUFRLGVBQWU7QUFDaEMsVUFBSSxDQUFDLGNBQWMsSUFBSSxJQUFJLEdBQUc7QUFDNUIsaUJBQVMsV0FBVyxLQUFLLElBQUk7QUFDN0IsUUFBQyxTQUFTLDJCQUFxQyxLQUFLLEVBQUUsTUFBTSxTQUFTLFNBQVMsQ0FBQztBQUFBLE1BQ2pGO0FBQUEsSUFDRjtBQUVBLFFBQUk7QUFDRixZQUFNLEtBQUssSUFBSSxNQUFNLFFBQVEsTUFBTSxjQUFjLEtBQUssVUFBVSxVQUFVLE1BQU0sQ0FBQyxDQUFDO0FBQUEsSUFDcEYsU0FBUyxHQUFHO0FBQ1YsY0FBUSxLQUFLLHFEQUFxRCxDQUFDO0FBQUEsSUFDckU7QUFBQSxFQUNGO0FBQ0Y7QUFJQSxJQUFNLGlCQUFOLGNBQTZCLHNCQUFNO0FBQUEsRUFJakMsWUFBWSxLQUFVLE9BQXNCO0FBQzFDLFVBQU0sR0FBRztBQUhYLFNBQVEsVUFBVSxvQkFBSSxJQUF3RDtBQUk1RSxTQUFLLFFBQVE7QUFDYixTQUFLLFFBQVEsU0FBUywwQkFBMEI7QUFBQSxFQUNsRDtBQUFBLEVBRUEsU0FBUztBQUNQLFVBQU0sRUFBRSxVQUFVLElBQUk7QUFDdEIsY0FBVSxTQUFTLE1BQU0sRUFBRSxNQUFNLHdCQUF3QixDQUFDO0FBQzFELGNBQVUsU0FBUyxLQUFLO0FBQUEsTUFDdEIsTUFBTTtBQUFBLE1BQ04sS0FBSztBQUFBLElBQ1AsQ0FBQztBQUVELFVBQU0sT0FBTyxVQUFVLFVBQVUsRUFBRSxLQUFLLGlCQUFpQixDQUFDO0FBRTFELGVBQVcsUUFBUSxLQUFLLE9BQU87QUFDN0IsWUFBTSxNQUFNLEtBQUssVUFBVSxFQUFFLEtBQUssZ0JBQWdCLENBQUM7QUFDbkQsWUFBTSxPQUFPLElBQUksV0FBVyxFQUFFLEtBQUssc0JBQXNCLE1BQU0sT0FBSSxDQUFDO0FBQ3BFLFVBQUksV0FBVyxFQUFFLEtBQUssc0JBQXNCLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFDOUQsWUFBTSxTQUFTLElBQUksV0FBVyxFQUFFLEtBQUssdUJBQXVCLENBQUM7QUFDN0QsV0FBSyxRQUFRLElBQUksS0FBSyxJQUFJLEVBQUUsTUFBTSxPQUFPLENBQUM7QUFBQSxJQUM1QztBQUFBLEVBQ0Y7QUFBQSxFQUVBLFdBQVcsSUFBWSxRQUFvQixRQUFpQjtBQUMxRCxVQUFNLE1BQU0sS0FBSyxRQUFRLElBQUksRUFBRTtBQUMvQixRQUFJLENBQUMsSUFBSztBQUVWLFVBQU0sUUFBb0M7QUFBQSxNQUN4QyxTQUFTO0FBQUEsTUFDVCxTQUFTO0FBQUEsTUFDVCxNQUFNO0FBQUEsTUFDTixRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsSUFDWDtBQUNBLFFBQUksS0FBSyxjQUFjLE1BQU0sTUFBTTtBQUNuQyxRQUFJLE9BQVEsS0FBSSxPQUFPLGNBQWM7QUFBQSxFQUN2QztBQUFBLEVBRUEsV0FBVztBQUNULFVBQU0sRUFBRSxVQUFVLElBQUk7QUFFdEIsVUFBTSxNQUFNLFVBQVUsVUFBVSxFQUFFLEtBQUssd0JBQXdCLENBQUM7QUFDaEUsUUFBSSxTQUFTLFVBQVUsRUFBRSxNQUFNLGFBQWEsQ0FBQztBQUM3QyxRQUFJLFdBQVcsNERBQTREO0FBRTNFLFFBQUksZ0NBQWdCLFNBQVMsRUFDMUIsY0FBYyxJQUFJLEVBQ2xCLE9BQU8sRUFDUCxTQUFTLHNCQUFzQixFQUMvQixRQUFRLE1BQU0sS0FBSyxNQUFNLENBQUM7QUFBQSxFQUMvQjtBQUFBLEVBRUEsVUFBVTtBQUNSLFNBQUssVUFBVSxNQUFNO0FBQ3JCLFNBQUssUUFBUSxNQUFNO0FBQUEsRUFDckI7QUFDRjsiLAogICJuYW1lcyI6IFtdCn0K
