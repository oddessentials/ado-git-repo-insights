"use strict";
var PRInsightsSettings = (() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // ../ui/types.ts
  function isErrorWithMessage(error) {
    return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";
  }
  function getErrorMessage(error) {
    if (isErrorWithMessage(error)) return error.message;
    if (typeof error === "string") return error;
    return "Unknown error";
  }

  // ../ui/modules/shared/security.ts
  function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // ../ui/modules/shared/render.ts
  function clearElement(el) {
    if (!el) return;
    while (el.firstChild) {
      el.removeChild(el.firstChild);
    }
  }
  function createElement(tag, attributes, textContent) {
    const el = document.createElement(tag);
    if (attributes) {
      for (const [key, value] of Object.entries(attributes)) {
        el.setAttribute(key, value);
      }
    }
    if (textContent !== void 0) {
      el.textContent = textContent;
    }
    return el;
  }
  function renderTrustedHtml(container, trustedHtml) {
    if (!container) return;
    container.innerHTML = trustedHtml;
  }
  function createOption(value, text, selected = false) {
    const option = createElement("option", { value }, text);
    if (selected) {
      option.selected = true;
    }
    return option;
  }

  // ../ui/modules/shared/focus-trap.ts
  var trapStates = /* @__PURE__ */ new WeakMap();
  function restoreFocus(controller) {
    const state = trapStates.get(controller);
    controller.abort();
    if (state && state.returnTarget && !state.returnTarget.isConnected) {
      return;
    }
    state?.returnTarget?.focus();
  }

  // ../ui/modules/drilldown/lifecycle-signals.ts
  var COMPARISON_TOGGLED_EVENT = "drilldown:comparison-toggled";

  // ../ui/modules/tooltip-manager.ts
  var scrollDismissController = null;
  function releaseScrollDismissListener() {
    scrollDismissController?.abort();
    scrollDismissController = null;
  }
  function dismissAllTooltips() {
    const chartTooltip = document.querySelector(".chart-tooltip");
    if (chartTooltip) chartTooltip.remove();
    const infoTooltip = document.querySelector(".info-tooltip");
    if (infoTooltip) infoTooltip.remove();
    releaseScrollDismissListener();
  }

  // ../ui/modules/shared/detail-panel.ts
  var panelEls = null;
  var panelState = "closed";
  var activeContext = null;
  var focusTrapController = null;
  var openScopedController = null;
  var comparisonActive = false;
  {
    const lifetimeComparisonListener = (evt) => {
      const e2 = evt;
      comparisonActive = e2.detail.enabled;
    };
    window.addEventListener(COMPARISON_TOGGLED_EVENT, lifetimeComparisonListener);
  }
  var outsideClickAbort = null;
  var outsideClickFrame = null;
  function clearOutsideClickListener() {
    outsideClickAbort?.abort();
    outsideClickAbort = null;
    if (outsideClickFrame !== null) {
      cancelAnimationFrame(outsideClickFrame);
      outsideClickFrame = null;
    }
  }
  function isDetailPanelOpen() {
    return panelState === "opening" || panelState === "open";
  }
  function dismissDetailPanel(reason) {
    if (!isDetailPanelOpen()) return;
    panelState = "closing";
    openScopedController?.abort();
    openScopedController = null;
    dismissAllTooltips();
    clearOutsideClickListener();
    const trigger = activeContext?.triggerElement ?? null;
    if (focusTrapController) {
      if (trigger && trigger.isConnected) {
        restoreFocus(focusTrapController);
        trigger.focus();
      } else {
        restoreFocus(focusTrapController);
      }
      focusTrapController = null;
    }
    finalizeClose();
    void reason;
  }
  function finalizeClose() {
    if (panelEls) {
      panelEls.root.classList.remove("is-open");
    }
    activeContext = null;
    panelState = "closed";
  }

  // ../node_modules/.pnpm/azure-devops-extension-sdk@4.2.0/node_modules/azure-devops-extension-sdk/esm/SDK.min.js
  var e = parseInt("10000000000", 36);
  var t = Number.MAX_SAFE_INTEGER || 9007199254740991;
  var n = class {
    constructor() {
      __publicField(this, "objects", {});
    }
    register(e2, t2) {
      this.objects[e2] = t2;
    }
    unregister(e2) {
      delete this.objects[e2];
    }
    getInstance(e2, t2) {
      var n2 = this.objects[e2];
      if (n2) return "function" == typeof n2 ? n2(t2) : n2;
    }
  };
  var o = 1;
  var r = class {
    constructor(r2, i2) {
      __publicField(this, "promises", {});
      __publicField(this, "postToWindow");
      __publicField(this, "targetOrigin");
      __publicField(this, "handshakeToken");
      __publicField(this, "registry");
      __publicField(this, "channelId");
      __publicField(this, "nextMessageId", 1);
      __publicField(this, "nextProxyId", 1);
      __publicField(this, "proxyFunctions", {});
      this.postToWindow = r2, this.targetOrigin = i2, this.registry = new n(), this.channelId = o++, this.targetOrigin || (this.handshakeToken = Math.floor(Math.random() * (t - e) + e).toString(36) + Math.floor(Math.random() * (t - e) + e).toString(36));
    }
    getObjectRegistry() {
      return this.registry;
    }
    async invokeRemoteMethod(e2, t2, n2, o2, r2) {
      const i2 = { id: this.nextMessageId++, methodName: e2, instanceId: t2, instanceContext: o2, params: this._customSerializeObject(n2, r2), serializationSettings: r2 };
      this.targetOrigin || (i2.handshakeToken = this.handshakeToken);
      const s2 = new Promise(((e3, t3) => {
        this.promises[i2.id] = { resolve: e3, reject: t3 };
      }));
      return this._sendRpcMessage(i2), s2;
    }
    getRemoteObjectProxy(e2, t2) {
      return this.invokeRemoteMethod("", e2, void 0, t2);
    }
    invokeMethod(e2, t2) {
      if (t2.methodName) {
        var n2 = e2[t2.methodName];
        if ("function" == typeof n2) try {
          var o2 = [];
          t2.params && (o2 = this._customDeserializeObject(t2.params, {}));
          var r2 = n2.apply(e2, o2);
          r2 && r2.then && "function" == typeof r2.then ? r2.then(((e3) => {
            this._success(t2, e3, t2.handshakeToken);
          }), ((e3) => {
            this.error(t2, e3);
          })) : this._success(t2, r2, t2.handshakeToken);
        } catch (e3) {
          this.error(t2, e3);
        }
        else this.error(t2, new Error("RPC method not found: " + t2.methodName));
      } else this._success(t2, e2, t2.handshakeToken);
    }
    getRegisteredObject(e2, t2) {
      if ("__proxyFunctions" === e2) return this.proxyFunctions;
      var n2 = this.registry.getInstance(e2, t2);
      return n2 || (n2 = i.getInstance(e2, t2)), n2;
    }
    onMessage(e2) {
      if (e2.instanceId) {
        const t2 = this.getRegisteredObject(e2.instanceId, e2.instanceContext);
        if (!t2) return false;
        "function" == typeof t2.then ? t2.then(((t3) => {
          this.invokeMethod(t3, e2);
        }), ((t3) => {
          this.error(e2, t3);
        })) : this.invokeMethod(t2, e2);
      } else {
        const t2 = this.promises[e2.id];
        if (!t2) return false;
        e2.error ? t2.reject(this._customDeserializeObject([e2.error], {})[0]) : t2.resolve(this._customDeserializeObject([e2.result], {})[0]), delete this.promises[e2.id];
      }
      return true;
    }
    owns(e2, t2, n2) {
      if (this.postToWindow === e2) {
        if (this.targetOrigin) return !!t2 && ("null" === t2.toLowerCase() || 0 === this.targetOrigin.toLowerCase().indexOf(t2.toLowerCase()));
        if (n2.handshakeToken && n2.handshakeToken === this.handshakeToken) return this.targetOrigin = t2, true;
      }
      return false;
    }
    error(e2, t2) {
      this._sendRpcMessage({ id: e2.id, error: this._customSerializeObject([t2], e2.serializationSettings)[0], handshakeToken: e2.handshakeToken });
    }
    _success(e2, t2, n2) {
      this._sendRpcMessage({ id: e2.id, result: this._customSerializeObject([t2], e2.serializationSettings)[0], handshakeToken: n2 });
    }
    _sendRpcMessage(e2) {
      this.postToWindow.postMessage(JSON.stringify(e2), "*");
    }
    _customSerializeObject(e2, t2, n2, o2 = 1, r2 = 1) {
      if (!e2 || r2 > 100) return;
      if (e2 instanceof Node || e2 instanceof Window || e2 instanceof Event) return;
      var i2;
      let s2;
      s2 = n2 || { newObjects: [], originalObjects: [] }, s2.originalObjects.push(e2);
      var c = (n3, i3, c2) => {
        var a3;
        try {
          a3 = n3[c2];
        } catch (e3) {
        }
        var h3 = typeof a3;
        if ("undefined" !== h3) {
          var d3 = -1;
          if ("object" === h3 && (d3 = s2.originalObjects.indexOf(a3)), d3 >= 0) {
            var u2 = s2.newObjects[d3];
            u2.__circularReferenceId || (u2.__circularReferenceId = o2++), i3[c2] = { __circularReference: u2.__circularReferenceId };
          } else "function" === h3 ? (this.nextProxyId++, i3[c2] = { __proxyFunctionId: this._registerProxyFunction(a3, e2), _channelId: this.channelId }) : "object" === h3 ? a3 && a3 instanceof Date ? i3[c2] = { __proxyDate: a3.getTime() } : i3[c2] = this._customSerializeObject(a3, t2, s2, o2, r2 + 1) : "__proxyFunctionId" !== c2 && (i3[c2] = a3);
        }
      };
      if (e2 instanceof Array) {
        i2 = [], s2.newObjects.push(i2);
        for (var a2 = 0, h2 = e2.length; a2 < h2; a2++) c(e2, i2, a2);
      } else {
        i2 = {}, s2.newObjects.push(i2);
        let n3 = {};
        try {
          n3 = (function(e3) {
            const t3 = {};
            for (; e3 && e3 !== Object.prototype; ) {
              const n4 = Object.getOwnPropertyNames(e3);
              for (const e4 of n4) "constructor" !== e4 && (t3[e4] = true);
              e3 = Object.getPrototypeOf(e3);
            }
            return t3;
          })(e2);
        } catch (e3) {
        }
        for (var d2 in n3) (d2 && "_" !== d2[0] || t2 && t2.includeUnderscoreProperties) && c(e2, i2, d2);
      }
      return s2.originalObjects.pop(), s2.newObjects.pop(), i2;
    }
    _registerProxyFunction(e2, t2) {
      var n2 = this.nextProxyId++;
      return this.proxyFunctions["proxy" + n2] = function() {
        return e2.apply(t2, Array.prototype.slice.call(arguments, 0));
      }, n2;
    }
    _customDeserializeObject(e2, t2) {
      var n2 = this;
      if (!e2) return null;
      var o2 = (e3, o3) => {
        var r3 = e3[o3], i3 = typeof r3;
        "__circularReferenceId" === o3 && "number" === i3 ? (t2[r3] = e3, delete e3[o3]) : "object" === i3 && r3 && (r3.__proxyFunctionId ? e3[o3] = function() {
          return n2.invokeRemoteMethod("proxy" + r3.__proxyFunctionId, "__proxyFunctions", Array.prototype.slice.call(arguments, 0), {}, { includeUnderscoreProperties: true });
        } : r3.__proxyDate ? e3[o3] = new Date(r3.__proxyDate) : r3.__circularReference ? e3[o3] = t2[r3.__circularReference] : this._customDeserializeObject(r3, t2));
      };
      if (e2 instanceof Array) for (var r2 = 0, i2 = e2.length; r2 < i2; r2++) o2(e2, r2);
      else if ("object" == typeof e2) for (var s2 in e2) o2(e2, s2);
      return e2;
    }
  };
  var i = new n();
  var s = new class {
    constructor() {
      __publicField(this, "_channels", []);
      __publicField(this, "_handleMessageReceived", (e2) => {
        let t2;
        if ("string" == typeof e2.data) try {
          t2 = JSON.parse(e2.data);
        } catch (e3) {
        }
        if (t2) {
          let n2, o2 = false;
          for (const r2 of this._channels) r2.owns(e2.source, e2.origin, t2) && (n2 = r2, o2 = r2.onMessage(t2) || o2);
          n2 && !o2 && (window.console && console.error(`No handler found on any channel for message: ${JSON.stringify(t2)}`), t2.instanceId && n2.error(t2, new Error(`The registered object ${t2.instanceId} could not be found.`)));
        }
      });
      window.addEventListener("message", this._handleMessageReceived);
    }
    addChannel(e2, t2) {
      const n2 = new r(e2, t2);
      return this._channels.push(n2), n2;
    }
    removeChannel(e2) {
      this._channels = this._channels.filter(((t2) => t2 !== e2));
    }
  }();
  var a = window;
  var h;
  a._AzureDevOpsSDKVersion && console.error("The AzureDevOps SDK is already loaded. Only one version of this module can be loaded in a given document."), a._AzureDevOpsSDKVersion = 4.2, (function(e2) {
    e2[e2.Unknown = 0] = "Unknown", e2[e2.Deployment = 1] = "Deployment", e2[e2.Enterprise = 2] = "Enterprise", e2[e2.Organization = 4] = "Organization";
  })(h || (h = {}));
  var d = "DevOps.HostControl";
  var u = s.addChannel(window.parent);
  var l;
  var f;
  var g;
  var p;
  var m;
  var y;
  var v;
  var _;
  var b;
  var w;
  var O = new Promise(((e2) => {
    w = e2;
  }));
  function x(e2, t2) {
    const n2 = window;
    let o2;
    "function" == typeof n2.CustomEvent ? o2 = new n2.CustomEvent(e2, t2) : (t2 = t2 || { bubbles: false, cancelable: false }, o2 = document.createEvent("CustomEvent"), o2.initCustomEvent(e2, t2.bubbles, t2.cancelable, t2.detail)), window.dispatchEvent(o2);
  }
  function k(e2) {
    return new Promise(((t2) => {
      const n2 = { ...e2, sdkVersion: 4.2 };
      u.invokeRemoteMethod("initialHandshake", d, [n2]).then(((e3) => {
        if ("pageContext" in e3) {
          const t3 = e3;
          if (g = t3.pageContext, f = g ? g.webContext : void 0, l = f ? f.team : void 0, m = t3.initialConfig || {}, y = t3.contribution.id, p = t3.extensionContext, p.id = p.publisherId + "." + p.extensionId, "context" in e3) {
            const t4 = e3.context;
            v = t4.user, _ = t4.host;
          }
        } else {
          const t3 = e3, n3 = t3.context;
          g = n3.pageContext, f = g ? g.webContext : void 0, l = f ? f.team : void 0, m = t3.initialConfig || {}, y = t3.contributionId, p = n3.extension, v = n3.user, _ = n3.host;
        }
        e3.themeData && (J(e3.themeData), window.addEventListener("themeChanged", ((e4) => {
          J(e4.detail.data);
        }))), w(), t2();
      }));
    }));
  }
  async function j() {
    return O;
  }
  function R() {
    return u.invokeRemoteMethod("notifyLoadSucceeded", d);
  }
  function I(e2) {
    return `Attempted to call ${e2}() before init() was complete. Wait for init to complete or place within a ready() callback.`;
  }
  function T() {
    if (!v) throw new Error(I("getUser"));
    return v;
  }
  function D() {
    if (!_) throw new Error(I("getHost"));
    return _;
  }
  function S() {
    if (!p) throw new Error(I("getExtensionContext"));
    return p;
  }
  function A() {
    if (!f) throw new Error(I("getWebContext"));
    return f;
  }
  async function F(e2) {
    return j().then((() => u.invokeRemoteMethod("getService", "DevOps.ServiceManager", [e2])));
  }
  async function L() {
    return u.invokeRemoteMethod("getAccessToken", d).then(((e2) => e2.token));
  }
  function H(e2, t2) {
    const n2 = document.body;
    if (n2) {
      const o2 = "number" == typeof e2 ? e2 : n2 ? n2.scrollWidth : void 0, r2 = "number" == typeof t2 ? t2 : n2 ? n2.scrollHeight : void 0;
      u.invokeRemoteMethod("resize", d, [o2, r2]);
    }
  }
  function J(e2) {
    b || (b = document.createElement("style"), b.type = "text/css", document.head.appendChild(b));
    const t2 = [];
    if (e2) for (const n2 in e2) t2.push("--" + n2 + ": " + e2[n2]);
    b.innerText = ":root { " + t2.join("; ") + " } body { color: var(--text-primary-color) }", x("themeApplied", { detail: e2 });
  }
  u.getObjectRegistry().register("DevOps.SdkClient", { dispatchEvent: x });

  // ../ui/modules/api-versions.ts
  var ADO_REST_API_VERSIONS = ["7.1", "6.0", "5.1"];
  var EXTENSION_DATA_API_VERSION = "7.1-preview.1";
  async function fetchWithVersionFallback(buildUrl, fetchFn, options) {
    let lastError = null;
    for (const version of ADO_REST_API_VERSIONS) {
      const response = await fetchFn(buildUrl(version));
      if (response.status === 401 || response.status === 403) {
        return { response, version };
      }
      if (response.status === 400 || options.isListEndpoint && response.status === 404) {
        lastError = new Error(`API api-version=${version}: ${response.status}`);
        continue;
      }
      return { response, version };
    }
    throw lastError ?? new Error("No compatible API version found");
  }

  // ../ui/modules/sdk.ts
  var LocationServiceId = "ms.vss-features.location-service";
  var CORE_RESOURCE_AREA_ID = "79134c72-4a58-4b42-976c-04e7115f32bf";
  var sdkInitialized = false;
  var sdkReadyForCalls = false;
  var initAttemptId = 0;
  var initPromise = null;
  var cachedCollectionUri = null;
  var tokenInflight = null;
  var DEFAULT_TIMEOUT_MS = 1e4;
  function isSdkCallable() {
    return sdkInitialized || sdkReadyForCalls;
  }
  async function initializeAdoSdk(options) {
    if (sdkInitialized) return;
    if (initPromise) return initPromise;
    const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
    const attemptId = ++initAttemptId;
    const initSequence = async () => {
      await k({ loaded: false });
      await j();
      if (attemptId !== initAttemptId) return;
      sdkReadyForCalls = true;
      try {
        if (options?.onReady) {
          options.onReady();
        }
        if (attemptId !== initAttemptId) return;
        await R();
      } finally {
        sdkReadyForCalls = false;
      }
      if (attemptId !== initAttemptId) return;
      sdkInitialized = true;
    };
    let timeoutId;
    const timeoutPromise = new Promise((_2, reject) => {
      timeoutId = setTimeout(() => {
        initAttemptId++;
        reject(new Error("Azure DevOps SDK initialization timed out"));
      }, timeout);
    });
    initPromise = Promise.race([initSequence(), timeoutPromise]).finally(() => {
      clearTimeout(timeoutId);
      initPromise = null;
    });
    return initPromise;
  }
  async function getExtensionDataService() {
    const collectionUri = await getCollectionUri();
    const ctx = S();
    function buildUrl(key, scopeType) {
      const scope = scopeType === "User" ? "User" : "Default";
      const scopeValue = scopeType === "User" ? "Me" : "Current";
      return `${collectionUri}_apis/ExtensionManagement/InstalledExtensions/${encodeURIComponent(ctx.publisherId)}/${encodeURIComponent(ctx.extensionId)}/Data/Scopes/${scope}/${scopeValue}/Collections/%24settings/Documents/${encodeURIComponent(key)}?api-version=${EXTENSION_DATA_API_VERSION}`;
    }
    return {
      async getValue(key, options) {
        const accessToken = await getAccessToken();
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        const url = buildUrl(key, options?.scopeType);
        const response = await fetch(url, { headers });
        if (response.status === 404) {
          return options?.defaultValue ?? void 0;
        }
        if (!response.ok) {
          throw new Error(
            `Extension data GET failed: ${response.status} ${response.statusText}`
          );
        }
        const doc = await response.json();
        if (doc !== null && typeof doc === "object" && "value" in doc) {
          return doc.value;
        }
        return doc;
      },
      async setValue(key, value, options) {
        const accessToken = await getAccessToken();
        const headers = {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json"
        };
        const url = buildUrl(key, options?.scopeType);
        const body = JSON.stringify({ id: key, value });
        const response = await fetch(url, { method: "PUT", headers, body });
        if (!response.ok) {
          throw new Error(
            `Extension data PUT failed: ${response.status} ${response.statusText}`
          );
        }
        const doc = await response.json();
        if (doc !== null && typeof doc === "object" && "value" in doc) {
          return doc.value;
        }
        return doc;
      }
    };
  }
  function getWebContext() {
    if (!isSdkCallable()) return void 0;
    const webCtx = A();
    const user = T();
    const host = D();
    return {
      project: webCtx.project ? { id: webCtx.project.id, name: webCtx.project.name } : void 0,
      team: webCtx.team ? { id: webCtx.team.id, name: webCtx.team.name } : void 0,
      user: { id: user.id, name: user.name, displayName: user.displayName },
      host: { id: host.id, name: host.name }
    };
  }
  async function getCollectionUri() {
    if (cachedCollectionUri) return cachedCollectionUri;
    const locationService = await F(LocationServiceId);
    const raw = await locationService.getResourceAreaLocation(
      CORE_RESOURCE_AREA_ID
    );
    cachedCollectionUri = raw.endsWith("/") ? raw : `${raw}/`;
    return cachedCollectionUri;
  }
  async function getAccessToken() {
    if (tokenInflight) return tokenInflight;
    tokenInflight = L();
    try {
      return await tokenInflight;
    } finally {
      tokenInflight = null;
    }
  }
  function resizeHost(width, height) {
    if (!isSdkCallable()) return;
    try {
      H(width, height);
    } catch {
    }
  }

  // ../ui/modules/shared/host-resize.ts
  var pendingHostResize = false;
  var rafHandle = null;
  var hostResizeObserver = null;
  var windowListenerAttached = false;
  var generation = 0;
  function syncHostHeight() {
    const bodyHeight = document.body.scrollHeight;
    const docHeight = document.documentElement.scrollHeight;
    const targetHeight = Math.max(bodyHeight, docHeight);
    if (targetHeight > 0) {
      resizeHost(void 0, targetHeight);
    }
  }
  function scheduleHostResize() {
    if (pendingHostResize) return;
    pendingHostResize = true;
    const gen = generation;
    rafHandle = requestAnimationFrame(() => {
      rafHandle = null;
      if (gen !== generation) return;
      pendingHostResize = false;
      syncHostHeight();
    });
  }
  function initializeHostResizeSync(containerSelector) {
    generation++;
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    pendingHostResize = false;
    hostResizeObserver?.disconnect();
    hostResizeObserver = null;
    if (typeof ResizeObserver === "function") {
      const root = document.querySelector(containerSelector);
      if (root) {
        hostResizeObserver = new ResizeObserver(() => {
          scheduleHostResize();
        });
        hostResizeObserver.observe(root);
      }
    }
    if (windowListenerAttached) {
      window.removeEventListener("resize", scheduleHostResize);
    }
    window.addEventListener("resize", scheduleHostResize);
    windowListenerAttached = true;
    scheduleHostResize();
  }

  // ../ui/error-types.ts
  var ErrorTypes = {
    SETUP_REQUIRED: "setup_required",
    MULTIPLE_PIPELINES: "multiple_pipelines",
    NO_SUCCESSFUL_BUILDS: "no_successful_builds",
    ARTIFACTS_MISSING: "artifacts_missing",
    PERMISSION_DENIED: "permission_denied",
    INVALID_CONFIG: "invalid_config"
  };
  var PrInsightsError = class extends Error {
    constructor(type, title, message, details = null) {
      super(message);
      this.name = "PrInsightsError";
      this.type = type;
      this.title = title;
      this.details = details;
    }
  };
  function createPermissionDeniedError(operation) {
    return new PrInsightsError(
      ErrorTypes.PERMISSION_DENIED,
      "Permission Denied",
      `You don't have permission to ${operation}.`,
      {
        instructions: [
          'Request "Build (Read)" permission from your project administrator',
          "Ensure you have access to view pipeline artifacts",
          "If using a service account, verify its permissions"
        ],
        permissionNeeded: "Build (Read)"
      }
    );
  }
  if (typeof window !== "undefined") {
    window.PrInsightsError = PrInsightsError;
  }

  // ../ui/modules/export.ts
  function showToast(message, type = "success", durationMs = 3e3) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  // ../ui/modules/drilldown/comparison-advisory.ts
  var CHART_CONTAINER_IDS = [
    "throughput-chart",
    "cycle-time-trend",
    "reviewer-activity"
  ];
  var SUMMARY_CARDS_SELECTOR = ".summary-cards";
  var COMPARISON_BANNER_ID = "comparison-banner";
  var BANNER_NOTE_CLASS = "comparison-advisory-banner";
  var DISABLED_ATTR = "data-drilldown-disabled";
  var DISABLED_VALUE = "comparison";
  var BANNER_MESSAGE = "Chart details are unavailable during comparison.";
  var isActive = false;
  var activeToast = null;
  var activeToastTimer = null;
  function dismissActiveToast() {
    if (activeToastTimer !== null) {
      clearTimeout(activeToastTimer);
      activeToastTimer = null;
    }
    if (activeToast && activeToast.isConnected) {
      activeToast.remove();
    }
    activeToast = null;
  }
  function getChartContainers() {
    const out = [];
    for (const id of CHART_CONTAINER_IDS) {
      const el = document.getElementById(id);
      if (el) out.push(el);
    }
    const summary = document.querySelector(SUMMARY_CARDS_SELECTOR);
    if (summary) out.push(summary);
    return out;
  }
  function mountBanner() {
    const banner = document.getElementById(COMPARISON_BANNER_ID);
    if (!banner) return;
    if (banner.querySelector(`.${BANNER_NOTE_CLASS}`)) return;
    const note = createElement(
      "div",
      { class: BANNER_NOTE_CLASS, role: "status", "aria-live": "polite" },
      BANNER_MESSAGE
    );
    banner.appendChild(note);
  }
  function unmountBanner() {
    const banner = document.getElementById(COMPARISON_BANNER_ID);
    if (!banner) return;
    const note = banner.querySelector(`.${BANNER_NOTE_CLASS}`);
    if (note) {
      note.remove();
    }
  }
  function setChartDisabled(enabled) {
    for (const el of getChartContainers()) {
      if (enabled) {
        el.setAttribute(DISABLED_ATTR, DISABLED_VALUE);
      } else {
        el.removeAttribute(DISABLED_ATTR);
      }
    }
  }
  var comparisonListener = (evt) => {
    const e2 = evt;
    if (e2.detail.enabled) {
      isActive = true;
      mountBanner();
      setChartDisabled(true);
      if (isDetailPanelOpen()) {
        dismissDetailPanel("comparison-toggled");
      }
    } else {
      isActive = false;
      unmountBanner();
      setChartDisabled(false);
      dismissActiveToast();
    }
  };
  window.addEventListener(COMPARISON_TOGGLED_EVENT, comparisonListener);

  // ../ui/schemas/types.ts
  function validResult(warnings = []) {
    return { valid: true, errors: [], warnings };
  }
  function invalidResult(errors, warnings = []) {
    return { valid: false, errors, warnings };
  }
  function createError(field, expected, actual, message) {
    return {
      field,
      expected,
      actual,
      message: message || `Expected ${expected} at '${field}', got ${actual}`
    };
  }
  function createWarning(field, message) {
    return {
      field,
      message: message || `Unknown field '${field}'`
    };
  }

  // ../ui/schemas/errors.ts
  var SchemaValidationError = class _SchemaValidationError extends Error {
    constructor(errors, artifactType) {
      const errorSummary = errors.slice(0, 3).map((e2) => `${e2.field}: ${e2.message}`).join("; ");
      const moreCount = errors.length > 3 ? ` (+${errors.length - 3} more)` : "";
      super(
        `Schema validation failed for ${artifactType}: ${errorSummary}${moreCount}`
      );
      this.name = "SchemaValidationError";
      this.errors = errors;
      this.artifactType = artifactType;
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, _SchemaValidationError);
      }
    }
    /**
     * Get a formatted string of all validation errors.
     */
    getDetailedMessage() {
      const lines = [`Schema validation failed for ${this.artifactType}:`];
      for (const error of this.errors) {
        lines.push(`  - ${error.field}: ${error.message}`);
        lines.push(`    Expected: ${error.expected}`);
        lines.push(`    Actual: ${error.actual}`);
      }
      return lines.join("\n");
    }
  };

  // ../ui/schemas/utils.ts
  function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function isString(value) {
    return typeof value === "string";
  }
  function isNumber(value) {
    return typeof value === "number" && !Number.isNaN(value);
  }
  function isBoolean(value) {
    return typeof value === "boolean";
  }
  function isArray(value) {
    return Array.isArray(value);
  }
  function isNullish(value) {
    return value === null || value === void 0;
  }
  function getTypeName(value) {
    if (value === null) return "null";
    if (value === void 0) return "undefined";
    if (Array.isArray(value)) return "array";
    return typeof value;
  }
  function buildPath(parent, key) {
    if (parent === "") {
      return typeof key === "number" ? `[${key}]` : key;
    }
    if (typeof key === "number") {
      return `${parent}[${key}]`;
    }
    return `${parent}.${key}`;
  }
  function validateRequired(data, field, path) {
    const hasField = Object.prototype.hasOwnProperty.call(data, field);
    const fieldValue = hasField ? Object.getOwnPropertyDescriptor(data, field)?.value : void 0;
    if (!hasField || fieldValue === void 0) {
      return createError(
        buildPath(path, field),
        "required field",
        "missing",
        `Missing required field '${field}'`
      );
    }
    return null;
  }
  function validateString(value, path) {
    if (!isString(value)) {
      return createError(path, "string", getTypeName(value));
    }
    return null;
  }
  function validateNumber(value, path) {
    if (!isNumber(value)) {
      return createError(path, "number", getTypeName(value));
    }
    return null;
  }
  function validateNonNegativeNumber(value, path) {
    if (!isNumber(value)) {
      return createError(path, "number", getTypeName(value));
    }
    if (value < 0) {
      return createError(
        path,
        "number >= 0",
        String(value),
        `Expected non-negative number at '${path}'`
      );
    }
    return null;
  }
  function validateBoolean(value, path) {
    if (!isBoolean(value)) {
      return createError(path, "boolean", getTypeName(value));
    }
    return null;
  }
  function validateArray(value, path) {
    if (!isArray(value)) {
      return createError(path, "array", getTypeName(value));
    }
    return null;
  }
  var ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  function isValidIsoDatetime(input) {
    if (input.length < 19) {
      return false;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.substring(0, 10))) {
      return false;
    }
    if (input.charAt(10) !== "T") {
      return false;
    }
    if (!/^\d{2}:\d{2}:\d{2}$/.test(input.substring(11, 19))) {
      return false;
    }
    let pos = 19;
    if (pos < input.length && input.charAt(pos) === ".") {
      pos++;
      const fracStart = pos;
      while (pos < input.length && /^\d$/.test(input.charAt(pos))) {
        pos++;
      }
      const fracLen = pos - fracStart;
      if (fracLen < 1 || fracLen > 6) {
        return false;
      }
    }
    if (pos < input.length) {
      const tail = input.substring(pos);
      if (tail === "Z") {
        return true;
      }
      if (!/^[+-]\d{2}:\d{2}$/.test(tail)) {
        return false;
      }
    }
    return true;
  }
  var ISO_WEEK_PATTERN = /^\d{4}-W\d{2}$/;
  var YEAR_PATTERN = /^\d{4}$/;
  function validateIsoDate(value, path) {
    if (!isString(value)) {
      return createError(
        path,
        "ISO date string (YYYY-MM-DD)",
        getTypeName(value)
      );
    }
    if (!ISO_DATE_PATTERN.test(value)) {
      return createError(
        path,
        "ISO date format (YYYY-MM-DD)",
        value,
        `Invalid date format at '${path}': expected YYYY-MM-DD`
      );
    }
    return null;
  }
  function validateIsoDatetime(value, path) {
    if (!isString(value)) {
      return createError(path, "ISO datetime string", getTypeName(value));
    }
    if (!isValidIsoDatetime(value)) {
      return createError(
        path,
        "ISO datetime format",
        value,
        `Invalid datetime format at '${path}'`
      );
    }
    return null;
  }
  function validateIsoWeek(value, path) {
    if (!isString(value)) {
      return createError(path, "ISO week string (YYYY-Www)", getTypeName(value));
    }
    if (!ISO_WEEK_PATTERN.test(value)) {
      return createError(
        path,
        "ISO week format (YYYY-Www)",
        value,
        `Invalid week format at '${path}': expected YYYY-Www`
      );
    }
    return null;
  }
  function validateYear(value, path) {
    if (!isString(value)) {
      return createError(path, "year string (YYYY)", getTypeName(value));
    }
    if (!YEAR_PATTERN.test(value)) {
      return createError(
        path,
        "year format (YYYY)",
        value,
        `Invalid year format at '${path}': expected YYYY`
      );
    }
    return null;
  }
  function findUnknownFields(data, knownFields, path, strict) {
    const errors = [];
    const warnings = [];
    for (const key of Object.keys(data)) {
      if (!knownFields.has(key)) {
        const fieldPath = buildPath(path, key);
        if (strict) {
          errors.push(
            createError(
              fieldPath,
              "known field",
              "unknown",
              `Unknown field '${key}' not allowed in strict mode`
            )
          );
        } else {
          warnings.push(
            createWarning(
              fieldPath,
              `Unknown field '${key}' (ignored in permissive mode)`
            )
          );
        }
      }
    }
    return { errors, warnings };
  }

  // ../ui/schemas/manifest.schema.ts
  var KNOWN_ROOT_FIELDS = /* @__PURE__ */ new Set([
    "manifest_schema_version",
    "dataset_schema_version",
    "aggregates_schema_version",
    "predictions_schema_version",
    "insights_schema_version",
    "generated_at",
    "run_id",
    "defaults",
    "limits",
    "demo_profile",
    "generation_provenance",
    "published_files",
    "features",
    "capabilities",
    "reviewer_fixtures",
    "coverage",
    "aggregate_index",
    "warnings",
    "operational"
    // Production field for operational metadata
  ]);
  var KNOWN_WEEKLY_ROLLUP_FIELDS = /* @__PURE__ */ new Set([
    "week",
    "path",
    "pr_count",
    "size_bytes",
    "start_date",
    // Production field
    "end_date"
    // Production field
  ]);
  var KNOWN_DISTRIBUTION_FIELDS = /* @__PURE__ */ new Set([
    "year",
    "path",
    "total_prs",
    "size_bytes",
    "start_date",
    // Production field
    "end_date"
    // Production field
  ]);
  var KNOWN_COVERAGE_FIELDS = /* @__PURE__ */ new Set([
    "total_prs",
    "date_range",
    "comments",
    "row_counts",
    // Production field
    "teams_count"
    // Production field
  ]);
  var KNOWN_DATE_RANGE_FIELDS = /* @__PURE__ */ new Set(["min", "max"]);
  var KNOWN_COMMENTS_COVERAGE_FIELDS = /* @__PURE__ */ new Set([
    "status",
    "threads_fetched",
    "comments_fetched",
    "prs_with_threads",
    "capped"
  ]);
  var KNOWN_FEATURES_FIELDS = /* @__PURE__ */ new Set([
    "teams",
    "comments",
    "predictions",
    "ai_insights",
    "cross_dimensional"
  ]);
  var KNOWN_CAPABILITIES_FIELDS = /* @__PURE__ */ new Set([
    "author_filters",
    "author_repo_exact",
    "comments_metrics",
    "reviewer_repository_mode",
    "reviewer_team_mode",
    "cross_dimensional_available"
  ]);
  var KNOWN_LIMITS_FIELDS = /* @__PURE__ */ new Set([
    "max_weekly_files",
    "max_distribution_files",
    "max_date_range_days_soft"
    // Production field
  ]);
  var KNOWN_DEFAULTS_FIELDS = /* @__PURE__ */ new Set(["default_date_range_days"]);
  var KNOWN_DEMO_PROFILE_FIELDS = /* @__PURE__ */ new Set([
    "name",
    "version",
    "seed",
    "canonical_output_root"
  ]);
  var KNOWN_GENERATION_PROVENANCE_FIELDS = /* @__PURE__ */ new Set([
    "python_version",
    "python_major_minor",
    "generator_script",
    "generation_mode"
  ]);
  var KNOWN_PUBLISHED_FILES_FIELDS = /* @__PURE__ */ new Set(["direct", "globs"]);
  var KNOWN_REVIEWER_FIXTURES_FIELDS = /* @__PURE__ */ new Set([
    "minimum_active_reviewers",
    "minimum_reviewed_prs_per_reviewer",
    "minimum_review_actions_per_reviewer",
    "minimum_multi_repo_reviewers",
    "reviewer_filter_examples",
    "reviewer_constrained_example",
    "reviewer_team_disallowed_example"
  ]);
  var KNOWN_REVIEWER_FILTER_EXAMPLE_FIELDS = /* @__PURE__ */ new Set([
    "reviewer_id",
    "reviewer_name",
    "week",
    "reviewed_prs",
    "reviews_count",
    "repositories_count"
  ]);
  var KNOWN_REVIEWER_FIXTURE_EXAMPLE_FIELDS = /* @__PURE__ */ new Set([
    "reviewer_id",
    "reviewer_name",
    "week",
    "mode",
    "reason",
    "repository_name",
    "team_name"
  ]);
  function validateWeeklyRollupEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const weekReq = validateRequired(data, "week", path);
    if (weekReq) errors.push(weekReq);
    else {
      const weekErr = validateIsoWeek(data.week, buildPath(path, "week"));
      if (weekErr) errors.push(weekErr);
    }
    const pathReq = validateRequired(data, "path", path);
    if (pathReq) errors.push(pathReq);
    else {
      const pathErr = validateString(data.path, buildPath(path, "path"));
      if (pathErr) errors.push(pathErr);
    }
    if ("size_bytes" in data && data.size_bytes !== void 0) {
      const sizeErr = validateNonNegativeNumber(
        data.size_bytes,
        buildPath(path, "size_bytes")
      );
      if (sizeErr) errors.push(sizeErr);
    }
    if ("pr_count" in data && data.pr_count !== void 0) {
      const prCountErr = validateNonNegativeNumber(
        data.pr_count,
        buildPath(path, "pr_count")
      );
      if (prCountErr) errors.push(prCountErr);
    }
    if ("start_date" in data && data.start_date !== void 0) {
      const err = validateIsoDate(data.start_date, buildPath(path, "start_date"));
      if (err) errors.push(err);
    }
    if ("end_date" in data && data.end_date !== void 0) {
      const err = validateIsoDate(data.end_date, buildPath(path, "end_date"));
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_WEEKLY_ROLLUP_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDistributionEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const yearReq = validateRequired(data, "year", path);
    if (yearReq) errors.push(yearReq);
    else {
      const yearErr = validateYear(data.year, buildPath(path, "year"));
      if (yearErr) errors.push(yearErr);
    }
    const pathReq = validateRequired(data, "path", path);
    if (pathReq) errors.push(pathReq);
    else {
      const pathErr = validateString(data.path, buildPath(path, "path"));
      if (pathErr) errors.push(pathErr);
    }
    if ("size_bytes" in data && data.size_bytes !== void 0) {
      const sizeErr = validateNonNegativeNumber(
        data.size_bytes,
        buildPath(path, "size_bytes")
      );
      if (sizeErr) errors.push(sizeErr);
    }
    if ("total_prs" in data && data.total_prs !== void 0) {
      const totalPrsErr = validateNonNegativeNumber(
        data.total_prs,
        buildPath(path, "total_prs")
      );
      if (totalPrsErr) errors.push(totalPrsErr);
    }
    if ("start_date" in data && data.start_date !== void 0) {
      const err = validateIsoDate(data.start_date, buildPath(path, "start_date"));
      if (err) errors.push(err);
    }
    if ("end_date" in data && data.end_date !== void 0) {
      const err = validateIsoDate(data.end_date, buildPath(path, "end_date"));
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DISTRIBUTION_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateAggregateIndex(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const weeklyReq = validateRequired(data, "weekly_rollups", path);
    if (weeklyReq) errors.push(weeklyReq);
    else {
      const weeklyArrErr = validateArray(
        data.weekly_rollups,
        buildPath(path, "weekly_rollups")
      );
      if (weeklyArrErr) errors.push(weeklyArrErr);
      else if (isArray(data.weekly_rollups)) {
        data.weekly_rollups.forEach((item, i2) => {
          const result = validateWeeklyRollupEntry(
            item,
            buildPath(path, `weekly_rollups[${i2}]`),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    const distReq = validateRequired(data, "distributions", path);
    if (distReq) errors.push(distReq);
    else {
      const distArrErr = validateArray(
        data.distributions,
        buildPath(path, "distributions")
      );
      if (distArrErr) errors.push(distArrErr);
      else if (isArray(data.distributions)) {
        data.distributions.forEach((item, i2) => {
          const result = validateDistributionEntry(
            item,
            buildPath(path, `distributions[${i2}]`),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    return { errors, warnings };
  }
  function validateDateRange(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const minReq = validateRequired(data, "min", path);
    if (minReq) errors.push(minReq);
    else {
      const minErr = validateIsoDate(data.min, buildPath(path, "min"));
      if (minErr) errors.push(minErr);
    }
    const maxReq = validateRequired(data, "max", path);
    if (maxReq) errors.push(maxReq);
    else {
      const maxErr = validateIsoDate(data.max, buildPath(path, "max"));
      if (maxErr) errors.push(maxErr);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DATE_RANGE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateCoverage(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("total_prs" in data) {
      const prErr = validateNonNegativeNumber(
        data.total_prs,
        buildPath(path, "total_prs")
      );
      if (prErr) errors.push(prErr);
    }
    if ("date_range" in data) {
      const result = validateDateRange(
        data.date_range,
        buildPath(path, "date_range"),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("comments" in data && data.comments !== void 0) {
      const commentsValue = data.comments;
      if (typeof commentsValue !== "string" && !isObject(commentsValue)) {
        errors.push(
          createError(
            buildPath(path, "comments"),
            "string or object",
            getTypeName(commentsValue),
            `Expected string or object at '${buildPath(path, "comments")}'`
          )
        );
      } else if (isObject(commentsValue)) {
        const commentsPath = buildPath(path, "comments");
        const statusReq = validateRequired(commentsValue, "status", commentsPath);
        if (statusReq) {
          errors.push(statusReq);
        } else {
          const statusPath = buildPath(commentsPath, "status");
          const statusErr = validateString(commentsValue.status, statusPath);
          if (statusErr) {
            errors.push(statusErr);
          } else if (typeof commentsValue.status === "string" && !(/* @__PURE__ */ new Set(["disabled", "full", "partial"])).has(commentsValue.status)) {
            errors.push(
              createError(
                statusPath,
                "disabled | full | partial",
                commentsValue.status
              )
            );
          }
        }
        const numericFields = [
          "threads_fetched",
          "comments_fetched",
          "prs_with_threads"
        ];
        for (const field of numericFields) {
          if (Object.prototype.hasOwnProperty.call(commentsValue, field) && Object.getOwnPropertyDescriptor(commentsValue, field)?.value !== void 0) {
            const fieldValue = Object.getOwnPropertyDescriptor(
              commentsValue,
              field
            )?.value;
            const err = validateNonNegativeNumber(
              fieldValue,
              buildPath(commentsPath, field)
            );
            if (err) errors.push(err);
          }
        }
        if (Object.prototype.hasOwnProperty.call(commentsValue, "capped") && Object.getOwnPropertyDescriptor(commentsValue, "capped")?.value !== void 0) {
          const cappedErr = validateBoolean(
            Object.getOwnPropertyDescriptor(commentsValue, "capped")?.value,
            buildPath(commentsPath, "capped")
          );
          if (cappedErr) errors.push(cappedErr);
        }
        const unknownComments = findUnknownFields(
          commentsValue,
          KNOWN_COMMENTS_COVERAGE_FIELDS,
          commentsPath,
          strict
        );
        errors.push(...unknownComments.errors);
        warnings.push(...unknownComments.warnings);
      }
    }
    if ("row_counts" in data && data.row_counts !== void 0) {
      if (!isObject(data.row_counts)) {
        errors.push(
          createError(
            buildPath(path, "row_counts"),
            "object",
            getTypeName(data.row_counts)
          )
        );
      }
    }
    if ("teams_count" in data && data.teams_count !== void 0) {
      const err = validateNonNegativeNumber(
        data.teams_count,
        buildPath(path, "teams_count")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_COVERAGE_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateFeatures(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const boolFields = ["teams", "comments", "predictions", "ai_insights"];
    for (const field of boolFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue !== void 0) {
          const err = validateBoolean(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(data, KNOWN_FEATURES_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateCapabilities(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const booleanFields = [
      "author_filters",
      "author_repo_exact",
      "comments_metrics",
      "cross_dimensional_available"
    ];
    for (const field of booleanFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue !== void 0) {
          const err = validateBoolean(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const modeFields = ["reviewer_repository_mode", "reviewer_team_mode"];
    const validModes = /* @__PURE__ */ new Set(["exact", "constrained", "disallowed"]);
    for (const field of modeFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        const err = validateString(fieldValue, buildPath(path, field));
        if (err) {
          errors.push(err);
        } else if (typeof fieldValue === "string" && !validModes.has(fieldValue)) {
          errors.push(
            createError(
              buildPath(path, field),
              "exact | constrained | disallowed",
              fieldValue
            )
          );
        }
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_CAPABILITIES_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateLimits(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("max_weekly_files" in data && data.max_weekly_files !== void 0) {
      const err = validateNonNegativeNumber(
        data.max_weekly_files,
        buildPath(path, "max_weekly_files")
      );
      if (err) errors.push(err);
    }
    if ("max_distribution_files" in data && data.max_distribution_files !== void 0) {
      const err = validateNonNegativeNumber(
        data.max_distribution_files,
        buildPath(path, "max_distribution_files")
      );
      if (err) errors.push(err);
    }
    if ("max_date_range_days_soft" in data && data.max_date_range_days_soft !== void 0) {
      const err = validateNonNegativeNumber(
        data.max_date_range_days_soft,
        buildPath(path, "max_date_range_days_soft")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_LIMITS_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDefaults(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("default_date_range_days" in data && data.default_date_range_days !== void 0) {
      const err = validateNonNegativeNumber(
        data.default_date_range_days,
        buildPath(path, "default_date_range_days")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_DEFAULTS_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDemoProfile(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const nameReq = validateRequired(data, "name", path);
    if (nameReq) errors.push(nameReq);
    else {
      const err = validateString(data.name, buildPath(path, "name"));
      if (err) errors.push(err);
    }
    const versionReq = validateRequired(data, "version", path);
    if (versionReq) errors.push(versionReq);
    else {
      const err = validateString(data.version, buildPath(path, "version"));
      if (err) errors.push(err);
    }
    if ("seed" in data && data.seed !== void 0) {
      const err = validateNonNegativeNumber(data.seed, buildPath(path, "seed"));
      if (err) errors.push(err);
    }
    if ("canonical_output_root" in data && data.canonical_output_root !== void 0) {
      const err = validateString(
        data.canonical_output_root,
        buildPath(path, "canonical_output_root")
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DEMO_PROFILE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validatePublishedFiles(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("direct" in data && data.direct !== void 0) {
      const err = validateArray(data.direct, buildPath(path, "direct"));
      if (err) {
        errors.push(err);
      } else {
        const directEntries = data.direct;
        for (const [index, item] of directEntries.entries()) {
          const itemError = validateString(
            item,
            buildPath(buildPath(path, "direct"), String(index))
          );
          if (itemError) errors.push(itemError);
        }
      }
    }
    if ("globs" in data && data.globs !== void 0) {
      const err = validateArray(data.globs, buildPath(path, "globs"));
      if (err) {
        errors.push(err);
      } else {
        const globEntries = data.globs;
        for (const [index, item] of globEntries.entries()) {
          const itemError = validateString(
            item,
            buildPath(buildPath(path, "globs"), String(index))
          );
          if (itemError) errors.push(itemError);
        }
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_PUBLISHED_FILES_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateGenerationProvenance(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const field of KNOWN_GENERATION_PROVENANCE_FIELDS) {
      const fieldPath = buildPath(path, field);
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateString(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        fieldPath
      );
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_GENERATION_PROVENANCE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerFilterExample(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const stringFields = ["reviewer_id", "reviewer_name", "week"];
    for (const field of stringFields) {
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateString(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        buildPath(path, field)
      );
      if (err) errors.push(err);
    }
    if ("week" in data) {
      const err = validateIsoWeek(data.week, buildPath(path, "week"));
      if (err) errors.push(err);
    }
    const numericFields = ["reviewed_prs", "reviews_count", "repositories_count"];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const err = validateNonNegativeNumber(
          Object.getOwnPropertyDescriptor(data, field)?.value,
          buildPath(path, field)
        );
        if (err) errors.push(err);
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_FILTER_EXAMPLE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerFixtureExample(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const requiredStringFields = [
      "reviewer_id",
      "reviewer_name",
      "week",
      "mode",
      "reason"
    ];
    for (const field of requiredStringFields) {
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateString(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        buildPath(path, field)
      );
      if (err) errors.push(err);
    }
    if ("week" in data) {
      const err = validateIsoWeek(data.week, buildPath(path, "week"));
      if (err) errors.push(err);
    }
    if ("mode" in data && typeof data.mode === "string") {
      if (!(/* @__PURE__ */ new Set(["constrained", "disallowed"])).has(data.mode)) {
        errors.push(
          createError(
            buildPath(path, "mode"),
            "constrained | disallowed",
            data.mode
          )
        );
      }
    }
    for (const field of ["repository_name", "team_name"]) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const err = validateString(
          Object.getOwnPropertyDescriptor(data, field)?.value,
          buildPath(path, field)
        );
        if (err) errors.push(err);
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_FIXTURE_EXAMPLE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerFixtures(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const thresholdFields = [
      "minimum_active_reviewers",
      "minimum_reviewed_prs_per_reviewer",
      "minimum_review_actions_per_reviewer",
      "minimum_multi_repo_reviewers"
    ];
    for (const field of thresholdFields) {
      const required = validateRequired(data, field, path);
      if (required) {
        errors.push(required);
        continue;
      }
      const err = validateNonNegativeNumber(
        Object.getOwnPropertyDescriptor(data, field)?.value,
        buildPath(path, field)
      );
      if (err) errors.push(err);
    }
    const filterExamplesRequired = validateRequired(
      data,
      "reviewer_filter_examples",
      path
    );
    if (filterExamplesRequired) {
      errors.push(filterExamplesRequired);
    } else {
      const filterPath = buildPath(path, "reviewer_filter_examples");
      const err = validateArray(data.reviewer_filter_examples, filterPath);
      if (err) {
        errors.push(err);
      } else if (isArray(data.reviewer_filter_examples)) {
        data.reviewer_filter_examples.forEach((item, index) => {
          const result = validateReviewerFilterExample(
            item,
            buildPath(filterPath, String(index)),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    const constrainedRequired = validateRequired(
      data,
      "reviewer_constrained_example",
      path
    );
    if (constrainedRequired) {
      errors.push(constrainedRequired);
    } else {
      const result = validateReviewerFixtureExample(
        data.reviewer_constrained_example,
        buildPath(path, "reviewer_constrained_example"),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const disallowedRequired = validateRequired(
      data,
      "reviewer_team_disallowed_example",
      path
    );
    if (disallowedRequired) {
      errors.push(disallowedRequired);
    } else {
      const result = validateReviewerFixtureExample(
        data.reviewer_team_disallowed_example,
        buildPath(path, "reviewer_team_disallowed_example"),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_FIXTURES_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateManifest(data, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(
        createError(
          "",
          "object",
          getTypeName(data),
          "Manifest must be an object"
        )
      );
      return invalidResult(errors);
    }
    const requiredFields = [
      "manifest_schema_version",
      "dataset_schema_version",
      "aggregates_schema_version",
      "generated_at",
      "run_id",
      "aggregate_index"
    ];
    for (const field of requiredFields) {
      const err = validateRequired(data, field, "");
      if (err) errors.push(err);
    }
    if ("manifest_schema_version" in data) {
      const err = validateNumber(
        data.manifest_schema_version,
        "manifest_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("dataset_schema_version" in data) {
      const err = validateNumber(
        data.dataset_schema_version,
        "dataset_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("aggregates_schema_version" in data) {
      const err = validateNumber(
        data.aggregates_schema_version,
        "aggregates_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("generated_at" in data) {
      const err = validateIsoDatetime(data.generated_at, "generated_at");
      if (err) errors.push(err);
    }
    if ("run_id" in data) {
      const err = validateString(data.run_id, "run_id");
      if (err) errors.push(err);
    }
    if ("aggregate_index" in data) {
      const result = validateAggregateIndex(
        data.aggregate_index,
        "aggregate_index",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("predictions_schema_version" in data && data.predictions_schema_version !== void 0) {
      const err = validateNumber(
        data.predictions_schema_version,
        "predictions_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("insights_schema_version" in data && data.insights_schema_version !== void 0) {
      const err = validateNumber(
        data.insights_schema_version,
        "insights_schema_version"
      );
      if (err) errors.push(err);
    }
    if ("defaults" in data && data.defaults !== void 0) {
      const result = validateDefaults(data.defaults, "defaults", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("limits" in data && data.limits !== void 0) {
      const result = validateLimits(data.limits, "limits", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("demo_profile" in data && data.demo_profile !== void 0) {
      const result = validateDemoProfile(
        data.demo_profile,
        "demo_profile",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("generation_provenance" in data && data.generation_provenance !== void 0) {
      const result = validateGenerationProvenance(
        data.generation_provenance,
        "generation_provenance",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("published_files" in data && data.published_files !== void 0) {
      const result = validatePublishedFiles(
        data.published_files,
        "published_files",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("features" in data && data.features !== void 0) {
      const result = validateFeatures(data.features, "features", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("capabilities" in data && data.capabilities !== void 0) {
      const result = validateCapabilities(
        data.capabilities,
        "capabilities",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("reviewer_fixtures" in data && data.reviewer_fixtures !== void 0) {
      const result = validateReviewerFixtures(
        data.reviewer_fixtures,
        "reviewer_fixtures",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("coverage" in data && data.coverage !== void 0) {
      const result = validateCoverage(data.coverage, "coverage", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("warnings" in data && data.warnings !== void 0) {
      const err = validateArray(data.warnings, "warnings");
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/schemas/rollup.schema.ts
  var KNOWN_ROOT_FIELDS2 = /* @__PURE__ */ new Set([
    "week",
    "start_date",
    "end_date",
    "pr_count",
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
    "authors_count",
    "reviewers_count",
    "by_repository",
    "by_author",
    "by_author_and_repo",
    "by_team",
    "by_reviewer",
    "by_team_and_repo",
    // Feature 060 PR-level detail fields (optional on tenant rollups,
    // absent from demo-surface rollups).
    "prs",
    "_prs_truncated",
    "_prs_cap",
    // Feature 333 weekly comments-aggregate (gated on capabilities.comments_metrics).
    // Atomic when present per INV-1-08; absent entirely when capability-off (FR-3-03).
    "comments",
    // Feature 334 per-author comments-density (gated on capabilities.comments_metrics).
    // Outer dict at rollup root; per-entry atomic per INV-2-08; absent entirely
    // when capability-off (FR-3-03 + INV-2-09).
    "by_author_comments"
  ]);
  var PR_RECORD_REQUIRED_FIELDS = [
    "id",
    "title",
    "author_id",
    "repository_id",
    "cycle_time"
  ];
  var KNOWN_BREAKDOWN_FIELDS = /* @__PURE__ */ new Set([
    "pr_count",
    "cycle_time_p50",
    "cycle_time_p90",
    "review_time_p50",
    "review_time_p90",
    "authors_count",
    "reviewers_count"
  ]);
  var KNOWN_REVIEWER_BREAKDOWN_FIELDS = /* @__PURE__ */ new Set([
    "reviewed_prs",
    "reviews_count",
    "approval_rate",
    "authors_count",
    "repositories_count"
  ]);
  function validateBreakdownEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("pr_count" in data) {
      const err = validateNonNegativeNumber(
        data.pr_count,
        buildPath(path, "pr_count")
      );
      if (err) errors.push(err);
    }
    const numericFields = [
      "cycle_time_p50",
      "cycle_time_p90",
      "review_time_p50",
      "review_time_p90"
    ];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue != null) {
          const err = validateNumber(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(data, KNOWN_BREAKDOWN_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateBreakdown(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const [key, value] of Object.entries(data)) {
      const result = validateBreakdownEntry(value, buildPath(path, key), strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    return { errors, warnings };
  }
  function validateReviewerBreakdownEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    if ("reviewed_prs" in data) {
      const err = validateNonNegativeNumber(
        data.reviewed_prs,
        buildPath(path, "reviewed_prs")
      );
      if (err) errors.push(err);
    }
    if ("reviews_count" in data) {
      const err = validateNonNegativeNumber(
        data.reviews_count,
        buildPath(path, "reviews_count")
      );
      if (err) errors.push(err);
    }
    if (Object.prototype.hasOwnProperty.call(data, "approval_rate")) {
      const fieldValue = Object.getOwnPropertyDescriptor(
        data,
        "approval_rate"
      )?.value;
      if (fieldValue != null) {
        const err = validateNumber(fieldValue, buildPath(path, "approval_rate"));
        if (err) {
          errors.push(err);
        } else if (typeof fieldValue === "number" && (fieldValue < 0 || fieldValue > 1)) {
          errors.push(
            createError(
              buildPath(path, "approval_rate"),
              "number between 0 and 1",
              `${fieldValue}`
            )
          );
        }
      }
    }
    const numericFields = ["authors_count", "repositories_count"];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue != null) {
          const err = validateNonNegativeNumber(
            fieldValue,
            buildPath(path, field)
          );
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REVIEWER_BREAKDOWN_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerBreakdown(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const [key, value] of Object.entries(data)) {
      const result = validateReviewerBreakdownEntry(
        value,
        buildPath(path, key),
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    return { errors, warnings };
  }
  function validateNestedBreakdown(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    for (const [outerKey, innerValue] of Object.entries(data)) {
      if (outerKey.startsWith("_")) continue;
      const innerPath = buildPath(path, outerKey);
      if (!isObject(innerValue)) {
        errors.push(createError(innerPath, "object", getTypeName(innerValue)));
        continue;
      }
      for (const [innerKey, entryValue] of Object.entries(
        innerValue
      )) {
        const entryResult = validateBreakdownEntry(
          entryValue,
          buildPath(innerPath, innerKey),
          strict
        );
        errors.push(...entryResult.errors);
        warnings.push(...entryResult.warnings);
      }
    }
    return { errors, warnings };
  }
  function validatePrRecordArray(data, path) {
    const warnings = [];
    if (!isArray(data)) {
      warnings.push(
        createWarning(
          path,
          `'prs' present but not an array (got ${getTypeName(data)}); ignored`
        )
      );
      return { warnings };
    }
    for (const [i2, pr] of data.entries()) {
      const prPath = buildPath(path, i2);
      if (!isObject(pr)) {
        warnings.push(
          createWarning(
            prPath,
            `'prs[${i2}]' is not an object (got ${getTypeName(pr)}); element ignored`
          )
        );
        continue;
      }
      for (const field of PR_RECORD_REQUIRED_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(pr, field)) {
          warnings.push(
            createWarning(
              buildPath(prPath, field),
              `missing required PR field '${field}'; element will be treated as absent`
            )
          );
        }
      }
      if (pr.id !== void 0 && !isNumber(pr.id)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "id"),
            `expected number, got ${getTypeName(pr.id)}`
          )
        );
      }
      if (pr.title !== void 0 && !isString(pr.title)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "title"),
            `expected string, got ${getTypeName(pr.title)}`
          )
        );
      }
      if (pr.author_id !== void 0 && !isString(pr.author_id)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "author_id"),
            `expected string, got ${getTypeName(pr.author_id)}`
          )
        );
      }
      if (pr.repository_id !== void 0 && !isString(pr.repository_id)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "repository_id"),
            `expected string, got ${getTypeName(pr.repository_id)}`
          )
        );
      }
      if (pr.cycle_time !== void 0 && !isNumber(pr.cycle_time)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "cycle_time"),
            `expected number, got ${getTypeName(pr.cycle_time)}`
          )
        );
      }
      const threadCount = pr.thread_count;
      const commentCount = pr.comment_count;
      const activeThreadCount = pr.active_thread_count;
      if (threadCount !== void 0 && threadCount !== null && !isNumber(threadCount)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "thread_count"),
            `expected number or null, got ${getTypeName(threadCount)}`
          )
        );
      }
      if (commentCount !== void 0 && commentCount !== null && !isNumber(commentCount)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "comment_count"),
            `expected number or null, got ${getTypeName(commentCount)}`
          )
        );
      }
      if (activeThreadCount !== void 0 && activeThreadCount !== null && !isNumber(activeThreadCount)) {
        warnings.push(
          createWarning(
            buildPath(prPath, "active_thread_count"),
            `expected number or null, got ${getTypeName(activeThreadCount)}`
          )
        );
      }
      const presentCount = (threadCount !== void 0 ? 1 : 0) + (commentCount !== void 0 ? 1 : 0) + (activeThreadCount !== void 0 ? 1 : 0);
      if (presentCount !== 0 && presentCount !== 3) {
        warnings.push(
          createWarning(
            prPath,
            `comments-metrics atomicity violated (INV-08): expected all three of thread_count / comment_count / active_thread_count to be present together, or all absent; got ${presentCount} of 3 present`
          )
        );
      }
      if (presentCount === 3) {
        const nullCount = (threadCount === null ? 1 : 0) + (commentCount === null ? 1 : 0) + (activeThreadCount === null ? 1 : 0);
        if (nullCount !== 0 && nullCount !== 3) {
          warnings.push(
            createWarning(
              prPath,
              `comments-metrics coverage-partial consistency violated (INV-10): expected thread_count / comment_count / active_thread_count to be all numeric or all null; got ${nullCount} of 3 null`
            )
          );
        }
        if (isNumber(threadCount) && isNumber(activeThreadCount) && activeThreadCount > threadCount) {
          warnings.push(
            createWarning(
              prPath,
              `comments-metrics ordering violated (INV-09): active_thread_count (${activeThreadCount}) MUST NOT exceed thread_count (${threadCount})`
            )
          );
        }
      }
    }
    return { warnings };
  }
  function validateCommentsAggregate(data, path) {
    const errors = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors };
    }
    const requiredFields = [
      "thread_count",
      "comment_count",
      "active_thread_count",
      "coverage_partial"
    ];
    const missing = requiredFields.filter(
      (field) => !Object.prototype.hasOwnProperty.call(data, field)
    );
    if (missing.length > 0) {
      errors.push(
        createError(
          path,
          "all four of thread_count / comment_count / active_thread_count / coverage_partial",
          `missing: ${missing.join(", ")}`,
          `comments-aggregate atomicity violated (INV-1-08): expected all four of thread_count / comment_count / active_thread_count / coverage_partial; missing: ${missing.join(", ")}`
        )
      );
    }
    const numericFieldChecks = [
      { name: "thread_count", value: data.thread_count },
      { name: "comment_count", value: data.comment_count },
      { name: "active_thread_count", value: data.active_thread_count }
    ];
    for (const { name, value } of numericFieldChecks) {
      if (!Object.prototype.hasOwnProperty.call(data, name)) {
        continue;
      }
      if (value === null) {
        errors.push(
          createError(
            buildPath(path, name),
            "number (non-null per INV-1-08; zero is the valid sum over an empty extracted-subset)",
            "null",
            `comments.${name} MUST be a non-null number (INV-1-08); null is not a valid sentinel \u2014 use 0 for an empty extracted-subset`
          )
        );
      } else if (!isNumber(value)) {
        errors.push(
          createError(
            buildPath(path, name),
            "number",
            getTypeName(value),
            `expected number at 'comments.${name}', got ${getTypeName(value)}`
          )
        );
      } else if (value < 0) {
        errors.push(
          createError(
            buildPath(path, name),
            "non-negative number (counts cannot be negative)",
            String(value),
            `comments.${name} MUST be non-negative; got ${value}`
          )
        );
      } else if (!Number.isInteger(value)) {
        errors.push(
          createError(
            buildPath(path, name),
            "integer (counts must be whole numbers)",
            String(value),
            `comments.${name} MUST be an integer; got ${value}`
          )
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "coverage_partial")) {
      const coveragePartial = data.coverage_partial;
      if (!isBoolean(coveragePartial)) {
        errors.push(
          createError(
            buildPath(path, "coverage_partial"),
            "boolean",
            getTypeName(coveragePartial),
            `expected boolean at 'comments.coverage_partial', got ${getTypeName(coveragePartial)}`
          )
        );
      }
    }
    const threadCount = data.thread_count;
    const activeCount = data.active_thread_count;
    if (isNumber(threadCount) && isNumber(activeCount) && Number.isInteger(threadCount) && Number.isInteger(activeCount) && threadCount >= 0 && activeCount >= 0 && activeCount > threadCount) {
      errors.push(
        createError(
          buildPath(path, "active_thread_count"),
          "<= thread_count (INV-1-06; active is a subset of total)",
          `${activeCount} > ${threadCount}`,
          `comments-aggregate ordering violated (INV-1-06): active_thread_count (${activeCount}) MUST NOT exceed thread_count (${threadCount})`
        )
      );
    }
    return { errors };
  }
  function validateAuthorCommentsDensity(data, path) {
    const errors = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors };
    }
    const entries = Object.entries(
      data
    );
    if (entries.length === 0) {
      errors.push(
        createError(
          path,
          "non-empty Record<string, AuthorCommentsDensityEntry>",
          "{}",
          `by_author_comments MUST be omitted entirely when no per-author buckets exist (FR-3-03 + INV-2-09); empty object is a contract violation`
        )
      );
      return { errors };
    }
    const requiredFields = [
      "thread_count",
      "comment_count",
      "active_thread_count",
      "coverage_partial"
    ];
    for (const [key, entry] of entries) {
      const entryPath = buildPath(path, key);
      if (!isObject(entry)) {
        errors.push(createError(entryPath, "object", getTypeName(entry)));
        continue;
      }
      const missing = requiredFields.filter(
        (field) => !Object.prototype.hasOwnProperty.call(entry, field)
      );
      if (missing.length > 0) {
        errors.push(
          createError(
            entryPath,
            "all four of thread_count / comment_count / active_thread_count / coverage_partial",
            `missing: ${missing.join(", ")}`,
            `by_author_comments[${key}] atomicity violated (INV-2-08): expected all four of thread_count / comment_count / active_thread_count / coverage_partial; missing: ${missing.join(", ")}`
          )
        );
      }
      const numericFieldChecks = [
        { name: "thread_count", value: entry.thread_count },
        { name: "comment_count", value: entry.comment_count },
        { name: "active_thread_count", value: entry.active_thread_count }
      ];
      for (const { name, value } of numericFieldChecks) {
        if (!Object.prototype.hasOwnProperty.call(entry, name)) {
          continue;
        }
        if (value === null) {
          errors.push(
            createError(
              buildPath(entryPath, name),
              "number (non-null per INV-2-08; zero is the valid sum over an empty extracted-subset)",
              "null",
              `by_author_comments[${key}].${name} MUST be a non-null number (INV-2-08); null is not a valid sentinel \u2014 use 0 for an empty extracted-subset`
            )
          );
        } else if (!isNumber(value)) {
          errors.push(
            createError(
              buildPath(entryPath, name),
              "number",
              getTypeName(value),
              `expected number at 'by_author_comments[${key}].${name}', got ${getTypeName(value)}`
            )
          );
        } else if (value < 0) {
          errors.push(
            createError(
              buildPath(entryPath, name),
              "non-negative number (counts cannot be negative)",
              String(value),
              `by_author_comments[${key}].${name} MUST be non-negative; got ${value}`
            )
          );
        } else if (!Number.isInteger(value)) {
          errors.push(
            createError(
              buildPath(entryPath, name),
              "integer (counts must be whole numbers)",
              String(value),
              `by_author_comments[${key}].${name} MUST be an integer; got ${value}`
            )
          );
        }
      }
      if (Object.prototype.hasOwnProperty.call(entry, "coverage_partial")) {
        const coveragePartial = entry.coverage_partial;
        if (!isBoolean(coveragePartial)) {
          errors.push(
            createError(
              buildPath(entryPath, "coverage_partial"),
              "boolean",
              getTypeName(coveragePartial),
              `expected boolean at 'by_author_comments[${key}].coverage_partial', got ${getTypeName(coveragePartial)}`
            )
          );
        }
      }
      const entryThread = entry.thread_count;
      const entryActive = entry.active_thread_count;
      if (isNumber(entryThread) && isNumber(entryActive) && Number.isInteger(entryThread) && Number.isInteger(entryActive) && entryThread >= 0 && entryActive >= 0 && entryActive > entryThread) {
        errors.push(
          createError(
            buildPath(entryPath, "active_thread_count"),
            "<= thread_count (INV-2-07; active is a subset of total)",
            `${entryActive} > ${entryThread}`,
            `by_author_comments[${key}] ordering violated (INV-2-07): active_thread_count (${entryActive}) MUST NOT exceed thread_count (${entryThread})`
          )
        );
      }
    }
    return { errors };
  }
  function validateRollup(data, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(
        createError("", "object", getTypeName(data), "Rollup must be an object")
      );
      return invalidResult(errors);
    }
    const requiredFields = ["week", "pr_count"];
    for (const field of requiredFields) {
      const err = validateRequired(data, field, "");
      if (err) errors.push(err);
    }
    if ("week" in data) {
      const err = validateIsoWeek(data.week, "week");
      if (err) errors.push(err);
    }
    if ("pr_count" in data) {
      const err = validateNonNegativeNumber(data.pr_count, "pr_count");
      if (err) errors.push(err);
    }
    if ("start_date" in data && data.start_date !== void 0) {
      const err = validateIsoDate(data.start_date, "start_date");
      if (err) errors.push(err);
    }
    if ("end_date" in data && data.end_date !== void 0) {
      const err = validateIsoDate(data.end_date, "end_date");
      if (err) errors.push(err);
    }
    const numericFields = [
      "cycle_time_p50",
      "cycle_time_p90",
      "review_time_p50",
      "review_time_p90",
      "authors_count",
      "reviewers_count"
    ];
    for (const field of numericFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue != null) {
          const err = validateNumber(fieldValue, field);
          if (err) errors.push(err);
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_repository") && data.by_repository !== void 0) {
      const result = validateBreakdown(
        data.by_repository,
        "by_repository",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_author") && data.by_author !== void 0) {
      const result = validateBreakdown(data.by_author, "by_author", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("by_team" in data && data.by_team !== void 0) {
      const result = validateBreakdown(data.by_team, "by_team", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if ("by_reviewer" in data && data.by_reviewer !== void 0) {
      const result = validateReviewerBreakdown(
        data.by_reviewer,
        "by_reviewer",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_author_and_repo") && data.by_author_and_repo !== void 0) {
      const result = validateNestedBreakdown(
        data.by_author_and_repo,
        "by_author_and_repo",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_team_and_repo") && data.by_team_and_repo !== void 0) {
      const result = validateNestedBreakdown(
        data.by_team_and_repo,
        "by_team_and_repo",
        strict
      );
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const prsValue = data.prs;
    const truncatedValue = data._prs_truncated;
    const capValue = data._prs_cap;
    const hasPrs = prsValue !== void 0;
    const hasTruncated = truncatedValue !== void 0;
    const hasCap = capValue !== void 0;
    if (hasPrs) {
      const prsResult = validatePrRecordArray(prsValue, "prs");
      warnings.push(...prsResult.warnings);
      if (!hasTruncated) {
        warnings.push(
          createWarning(
            "_prs_truncated",
            "'prs' present but '_prs_truncated' absent; treated as false"
          )
        );
      } else if (!isBoolean(truncatedValue)) {
        warnings.push(
          createWarning(
            "_prs_truncated",
            `expected boolean, got ${getTypeName(truncatedValue)}`
          )
        );
      }
      if (!hasCap) {
        warnings.push(
          createWarning(
            "_prs_cap",
            "'prs' present but '_prs_cap' absent; truncation-indicator math will be skipped"
          )
        );
      } else if (!isNumber(capValue)) {
        warnings.push(
          createWarning(
            "_prs_cap",
            `expected number, got ${getTypeName(capValue)}`
          )
        );
      }
    } else {
      if (hasTruncated) {
        warnings.push(
          createWarning(
            "_prs_truncated",
            "'_prs_truncated' present without 'prs'; ignored"
          )
        );
      }
      if (hasCap) {
        warnings.push(
          createWarning("_prs_cap", "'_prs_cap' present without 'prs'; ignored")
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(data, "comments") && data.comments !== void 0) {
      const commentsResult = validateCommentsAggregate(data.comments, "comments");
      errors.push(...commentsResult.errors);
    }
    if (Object.prototype.hasOwnProperty.call(data, "by_author_comments") && data.by_author_comments !== void 0) {
      const byAuthorCommentsResult = validateAuthorCommentsDensity(
        data.by_author_comments,
        "by_author_comments"
      );
      errors.push(...byAuthorCommentsResult.errors);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS2, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/schemas/dimensions.schema.ts
  var KNOWN_ROOT_FIELDS3 = /* @__PURE__ */ new Set([
    "repositories",
    "users",
    "authors",
    "reviewers",
    "projects",
    "teams",
    "date_range"
  ]);
  var KNOWN_REPOSITORY_FIELDS = /* @__PURE__ */ new Set([
    "repository_id",
    "repository_name",
    "organization_name",
    "project_name",
    // Legacy fields
    "id",
    "name",
    "project"
  ]);
  var KNOWN_USER_FIELDS = /* @__PURE__ */ new Set([
    "user_id",
    "display_name",
    // Legacy fields
    "id",
    "displayName",
    "uniqueName"
  ]);
  var KNOWN_REVIEWER_FIELDS = /* @__PURE__ */ new Set(["reviewer_id", "reviewer_name"]);
  var KNOWN_AUTHOR_FIELDS = /* @__PURE__ */ new Set(["author_id", "author_name"]);
  var KNOWN_PROJECT_FIELDS = /* @__PURE__ */ new Set([
    "organization_name",
    "project_name",
    // Legacy fields
    "id",
    "name"
  ]);
  var KNOWN_TEAM_FIELDS = /* @__PURE__ */ new Set([
    "id",
    "name",
    "projectId",
    "team_id",
    "team_name",
    "project_id",
    // Extended production fields
    "member_count",
    "organization_name",
    "project_name"
  ]);
  var KNOWN_DATE_RANGE_FIELDS2 = /* @__PURE__ */ new Set(["min", "max"]);
  function validateRepositoryEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const isProductionFormat = "repository_id" in data || "repository_name" in data;
    const isLegacyFormat = "id" in data || "name" in data;
    if (isProductionFormat) {
      const idReq = validateRequired(data, "repository_id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(
          data.repository_id,
          buildPath(path, "repository_id")
        );
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "repository_name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(
          data.repository_name,
          buildPath(path, "repository_name")
        );
        if (nameErr) errors.push(nameErr);
      }
      const orgReq = validateRequired(data, "organization_name", path);
      if (orgReq) errors.push(orgReq);
      else {
        const orgErr = validateString(
          data.organization_name,
          buildPath(path, "organization_name")
        );
        if (orgErr) errors.push(orgErr);
      }
      const projReq = validateRequired(data, "project_name", path);
      if (projReq) errors.push(projReq);
      else {
        const projErr = validateString(
          data.project_name,
          buildPath(path, "project_name")
        );
        if (projErr) errors.push(projErr);
      }
    } else if (isLegacyFormat) {
      const idReq = validateRequired(data, "id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.id, buildPath(path, "id"));
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(data.name, buildPath(path, "name"));
        if (nameErr) errors.push(nameErr);
      }
      if ("project" in data && data.project !== void 0) {
        const projErr = validateString(data.project, buildPath(path, "project"));
        if (projErr) errors.push(projErr);
      }
    } else {
      errors.push(
        createError(
          path,
          "repository with (repository_id, repository_name) or (id, name)",
          "empty object",
          `Repository entry at '${path}' must have required identifier fields`
        )
      );
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_REPOSITORY_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateUserEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const isProductionFormat = "user_id" in data || "display_name" in data;
    const isLegacyFormat = "id" in data || "displayName" in data;
    if (isProductionFormat) {
      const idReq = validateRequired(data, "user_id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.user_id, buildPath(path, "user_id"));
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "display_name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(
          data.display_name,
          buildPath(path, "display_name")
        );
        if (nameErr) errors.push(nameErr);
      }
    } else if (isLegacyFormat) {
      const idReq = validateRequired(data, "id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.id, buildPath(path, "id"));
        if (idErr) errors.push(idErr);
      }
      const displayNameReq = validateRequired(data, "displayName", path);
      if (displayNameReq) errors.push(displayNameReq);
      else {
        const nameErr = validateString(
          data.displayName,
          buildPath(path, "displayName")
        );
        if (nameErr) errors.push(nameErr);
      }
      const uniqueNameReq = validateRequired(data, "uniqueName", path);
      if (uniqueNameReq) errors.push(uniqueNameReq);
      else {
        const uNameErr = validateString(
          data.uniqueName,
          buildPath(path, "uniqueName")
        );
        if (uNameErr) errors.push(uNameErr);
      }
    } else {
      errors.push(
        createError(
          path,
          "user with (user_id, display_name) or (id, displayName, uniqueName)",
          "empty object",
          `User entry at '${path}' must have required identifier fields`
        )
      );
    }
    const unknown = findUnknownFields(data, KNOWN_USER_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateProjectEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const isProductionFormat = "organization_name" in data || "project_name" in data;
    const isLegacyFormat = "id" in data || "name" in data;
    if (isProductionFormat) {
      const orgReq = validateRequired(data, "organization_name", path);
      if (orgReq) errors.push(orgReq);
      else {
        const orgErr = validateString(
          data.organization_name,
          buildPath(path, "organization_name")
        );
        if (orgErr) errors.push(orgErr);
      }
      const projReq = validateRequired(data, "project_name", path);
      if (projReq) errors.push(projReq);
      else {
        const projErr = validateString(
          data.project_name,
          buildPath(path, "project_name")
        );
        if (projErr) errors.push(projErr);
      }
    } else if (isLegacyFormat) {
      const idReq = validateRequired(data, "id", path);
      if (idReq) errors.push(idReq);
      else {
        const idErr = validateString(data.id, buildPath(path, "id"));
        if (idErr) errors.push(idErr);
      }
      const nameReq = validateRequired(data, "name", path);
      if (nameReq) errors.push(nameReq);
      else {
        const nameErr = validateString(data.name, buildPath(path, "name"));
        if (nameErr) errors.push(nameErr);
      }
    } else {
      errors.push(
        createError(
          path,
          "project with (organization_name, project_name) or (id, name)",
          "empty object",
          `Project entry at '${path}' must have required identifier fields`
        )
      );
    }
    const unknown = findUnknownFields(data, KNOWN_PROJECT_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateReviewerEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const idReq = validateRequired(data, "reviewer_id", path);
    if (idReq) {
      errors.push(idReq);
    } else {
      const idErr = validateString(
        data.reviewer_id,
        buildPath(path, "reviewer_id")
      );
      if (idErr) errors.push(idErr);
    }
    const nameReq = validateRequired(data, "reviewer_name", path);
    if (nameReq) {
      errors.push(nameReq);
    } else {
      const nameErr = validateString(
        data.reviewer_name,
        buildPath(path, "reviewer_name")
      );
      if (nameErr) errors.push(nameErr);
    }
    const unknown = findUnknownFields(data, KNOWN_REVIEWER_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateAuthorEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const idReq = validateRequired(data, "author_id", path);
    if (idReq) {
      errors.push(idReq);
    } else {
      const idErr = validateString(data.author_id, buildPath(path, "author_id"));
      if (idErr) errors.push(idErr);
    }
    const nameReq = validateRequired(data, "author_name", path);
    if (nameReq) {
      errors.push(nameReq);
    } else {
      const nameErr = validateString(
        data.author_name,
        buildPath(path, "author_name")
      );
      if (nameErr) errors.push(nameErr);
    }
    const unknown = findUnknownFields(data, KNOWN_AUTHOR_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateTeamEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const stringFields = [
      "id",
      "name",
      "projectId",
      "team_id",
      "team_name",
      "project_id"
    ];
    for (const field of stringFields) {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        if (fieldValue !== void 0) {
          const err = validateString(fieldValue, buildPath(path, field));
          if (err) errors.push(err);
        }
      }
    }
    const unknown = findUnknownFields(data, KNOWN_TEAM_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDateRange2(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const minReq = validateRequired(data, "min", path);
    if (minReq) errors.push(minReq);
    else {
      const minErr = validateIsoDate(data.min, buildPath(path, "min"));
      if (minErr) errors.push(minErr);
    }
    const maxReq = validateRequired(data, "max", path);
    if (maxReq) errors.push(maxReq);
    else {
      const maxErr = validateIsoDate(data.max, buildPath(path, "max"));
      if (maxErr) errors.push(maxErr);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_DATE_RANGE_FIELDS2,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateDimensions(data, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(
        createError(
          "",
          "object",
          getTypeName(data),
          "Dimensions must be an object"
        )
      );
      return invalidResult(errors);
    }
    const requiredArrays = ["repositories", "users", "projects"];
    for (const field of requiredArrays) {
      const req = validateRequired(data, field, "");
      if (req) {
        errors.push(req);
      } else {
        const fieldValue = Object.getOwnPropertyDescriptor(data, field)?.value;
        const arrErr = validateArray(fieldValue, field);
        if (arrErr) {
          errors.push(arrErr);
        }
      }
    }
    if ("repositories" in data && isArray(data.repositories)) {
      data.repositories.forEach((item, i2) => {
        const result = validateRepositoryEntry(
          item,
          buildPath("repositories", i2),
          strict
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("users" in data && isArray(data.users)) {
      data.users.forEach((item, i2) => {
        const result = validateUserEntry(item, buildPath("users", i2), strict);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("reviewers" in data && data.reviewers !== void 0) {
      const arrErr = validateArray(data.reviewers, "reviewers");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.reviewers)) {
        data.reviewers.forEach((item, i2) => {
          const result = validateReviewerEntry(
            item,
            buildPath("reviewers", i2),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("authors" in data && data.authors !== void 0) {
      const arrErr = validateArray(data.authors, "authors");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.authors)) {
        data.authors.forEach((item, i2) => {
          const result = validateAuthorEntry(
            item,
            buildPath("authors", i2),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("projects" in data && isArray(data.projects)) {
      data.projects.forEach((item, i2) => {
        const result = validateProjectEntry(
          item,
          buildPath("projects", i2),
          strict
        );
        errors.push(...result.errors);
        warnings.push(...result.warnings);
      });
    }
    if ("teams" in data && data.teams !== void 0) {
      const arrErr = validateArray(data.teams, "teams");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.teams)) {
        data.teams.forEach((item, i2) => {
          const result = validateTeamEntry(item, buildPath("teams", i2), strict);
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("date_range" in data && data.date_range !== void 0) {
      const result = validateDateRange2(data.date_range, "date_range", strict);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS3, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/schemas/predictions.schema.ts
  var KNOWN_ROOT_FIELDS4 = /* @__PURE__ */ new Set([
    "schema_version",
    "generated_at",
    "generated_by",
    "is_stub",
    "forecasts",
    "state"
  ]);
  var KNOWN_FORECAST_FIELDS = /* @__PURE__ */ new Set([
    "metric",
    "unit",
    "horizon_weeks",
    "values"
  ]);
  var KNOWN_FORECAST_VALUE_FIELDS = /* @__PURE__ */ new Set([
    "period_start",
    "predicted",
    "lower_bound",
    "upper_bound"
  ]);
  function validateForecastValue(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const periodReq = validateRequired(data, "period_start", path);
    if (periodReq) errors.push(periodReq);
    else {
      const periodErr = validateIsoDate(
        data.period_start,
        buildPath(path, "period_start")
      );
      if (periodErr) errors.push(periodErr);
    }
    const predictedReq = validateRequired(data, "predicted", path);
    if (predictedReq) errors.push(predictedReq);
    else {
      const predictedErr = validateNumber(
        data.predicted,
        buildPath(path, "predicted")
      );
      if (predictedErr) errors.push(predictedErr);
    }
    if ("lower_bound" in data && data.lower_bound !== void 0) {
      const lowerErr = validateNumber(
        data.lower_bound,
        buildPath(path, "lower_bound")
      );
      if (lowerErr) errors.push(lowerErr);
    }
    if ("upper_bound" in data && data.upper_bound !== void 0) {
      const upperErr = validateNumber(
        data.upper_bound,
        buildPath(path, "upper_bound")
      );
      if (upperErr) errors.push(upperErr);
    }
    const unknown = findUnknownFields(
      data,
      KNOWN_FORECAST_VALUE_FIELDS,
      path,
      strict
    );
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validateForecastEntry(data, path, strict) {
    const errors = [];
    const warnings = [];
    if (!isObject(data)) {
      errors.push(createError(path, "object", getTypeName(data)));
      return { errors, warnings };
    }
    const metricReq = validateRequired(data, "metric", path);
    if (metricReq) errors.push(metricReq);
    else {
      const metricErr = validateString(data.metric, buildPath(path, "metric"));
      if (metricErr) errors.push(metricErr);
    }
    const unitReq = validateRequired(data, "unit", path);
    if (unitReq) errors.push(unitReq);
    else {
      const unitErr = validateString(data.unit, buildPath(path, "unit"));
      if (unitErr) errors.push(unitErr);
    }
    const horizonReq = validateRequired(data, "horizon_weeks", path);
    if (horizonReq) errors.push(horizonReq);
    else {
      const horizonErr = validateNonNegativeNumber(
        data.horizon_weeks,
        buildPath(path, "horizon_weeks")
      );
      if (horizonErr) errors.push(horizonErr);
    }
    const valuesReq = validateRequired(data, "values", path);
    if (valuesReq) errors.push(valuesReq);
    else {
      const valuesArrErr = validateArray(data.values, buildPath(path, "values"));
      if (valuesArrErr) {
        errors.push(valuesArrErr);
      } else if (isArray(data.values)) {
        data.values.forEach((item, i2) => {
          const result = validateForecastValue(
            item,
            buildPath(path, `values[${i2}]`),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    const unknown = findUnknownFields(data, KNOWN_FORECAST_FIELDS, path, strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    return { errors, warnings };
  }
  function validatePredictions(data, strict) {
    const errors = [];
    const warnings = [];
    if (isNullish(data)) {
      return validResult();
    }
    if (!isObject(data)) {
      errors.push(
        createError(
          "",
          "object",
          getTypeName(data),
          "Predictions must be an object"
        )
      );
      return invalidResult(errors);
    }
    const requiredFields = ["schema_version", "generated_at", "forecasts"];
    for (const field of requiredFields) {
      const err = validateRequired(data, field, "");
      if (err) errors.push(err);
    }
    if ("schema_version" in data) {
      const err = validateNumber(data.schema_version, "schema_version");
      if (err) errors.push(err);
    }
    if ("generated_at" in data) {
      const err = validateIsoDatetime(data.generated_at, "generated_at");
      if (err) errors.push(err);
    }
    if ("forecasts" in data) {
      const arrErr = validateArray(data.forecasts, "forecasts");
      if (arrErr) {
        errors.push(arrErr);
      } else if (isArray(data.forecasts)) {
        data.forecasts.forEach((item, i2) => {
          const result = validateForecastEntry(
            item,
            buildPath("forecasts", i2),
            strict
          );
          errors.push(...result.errors);
          warnings.push(...result.warnings);
        });
      }
    }
    if ("generated_by" in data && data.generated_by !== void 0) {
      const err = validateString(data.generated_by, "generated_by");
      if (err) errors.push(err);
    }
    if ("is_stub" in data && data.is_stub !== void 0) {
      const err = validateBoolean(data.is_stub, "is_stub");
      if (err) errors.push(err);
    }
    if ("state" in data && data.state !== void 0) {
      const err = validateString(data.state, "state");
      if (err) errors.push(err);
    }
    const unknown = findUnknownFields(data, KNOWN_ROOT_FIELDS4, "", strict);
    errors.push(...unknown.errors);
    warnings.push(...unknown.warnings);
    if (errors.length > 0) {
      return invalidResult(errors, warnings);
    }
    return validResult(warnings);
  }

  // ../ui/dataset-loader.ts
  function validateSchema(data, validator, artifactType, strict, context) {
    const result = validator(data, strict);
    if (!result.valid) {
      throw new SchemaValidationError(result.errors, artifactType);
    }
    if (result.warnings.length > 0) {
      const contextSuffix = context ? ` for ${context}` : "";
      console.warn(
        `[DatasetLoader] ${artifactType} validation warnings${contextSuffix}:`,
        result.warnings.map((w2) => w2.message).join("; ")
      );
    }
  }
  var SUPPORTED_MANIFEST_VERSION = 1;
  var SUPPORTED_DATASET_VERSION = 1;
  var SUPPORTED_AGGREGATES_VERSION = 3;
  var DEFAULT_CAPABILITY_STATE = {
    authorFiltersAvailable: false,
    authorRepoExactAvailable: false,
    commentsMetricsAvailable: false,
    commentsCoverageStatus: "disabled",
    reviewerRepositoryMode: "constrained",
    reviewerTeamMode: "disallowed",
    crossDimensionalAvailable: false
  };
  function normalizeCapabilityState(manifest) {
    const capabilities = manifest.capabilities ?? {};
    const features = manifest.features ?? {};
    const commentsCoverage = manifest.coverage?.comments;
    const commentsCoverageStatus = typeof commentsCoverage === "object" && commentsCoverage !== null && "status" in commentsCoverage && (commentsCoverage.status === "full" || commentsCoverage.status === "partial" || commentsCoverage.status === "disabled") ? commentsCoverage.status : typeof commentsCoverage === "string" && (commentsCoverage === "full" || commentsCoverage === "partial" || commentsCoverage === "disabled") ? commentsCoverage : DEFAULT_CAPABILITY_STATE.commentsCoverageStatus;
    return {
      authorFiltersAvailable: capabilities.author_filters ?? (manifest.aggregates_schema_version ?? 0) >= 3,
      authorRepoExactAvailable: capabilities.author_repo_exact ?? (manifest.aggregates_schema_version ?? 0) >= 3,
      commentsMetricsAvailable: capabilities.comments_metrics ?? features.comments === true,
      commentsCoverageStatus,
      reviewerRepositoryMode: capabilities.reviewer_repository_mode ?? DEFAULT_CAPABILITY_STATE.reviewerRepositoryMode,
      reviewerTeamMode: capabilities.reviewer_team_mode ?? DEFAULT_CAPABILITY_STATE.reviewerTeamMode,
      crossDimensionalAvailable: capabilities.cross_dimensional_available ?? features.cross_dimensional === true
    };
  }
  var DATASET_CANDIDATE_PATHS = [
    "",
    // Root of provided base URL (preferred)
    "aggregates"
    // Single nesting (legacy ADO artifact download)
  ];
  var ROLLUP_FIELD_DEFAULTS = {
    pr_count: 0,
    cycle_time_p50: null,
    cycle_time_p90: null,
    authors_count: 0,
    reviewers_count: 0,
    by_repository: null,
    // null indicates feature not available
    by_author: null,
    by_team: null,
    // null indicates feature not available
    by_reviewer: null
    // null indicates feature not available
  };
  function normalizeRollup2(rollup) {
    if (!rollup || typeof rollup !== "object") {
      return { week: "unknown", ...ROLLUP_FIELD_DEFAULTS };
    }
    const r2 = rollup;
    return {
      // Preserve all existing fields
      ...r2,
      // Ensure required fields have defaults (don't override if already set)
      pr_count: r2.pr_count ?? ROLLUP_FIELD_DEFAULTS.pr_count,
      cycle_time_p50: r2.cycle_time_p50 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p50,
      cycle_time_p90: r2.cycle_time_p90 ?? ROLLUP_FIELD_DEFAULTS.cycle_time_p90,
      authors_count: r2.authors_count ?? ROLLUP_FIELD_DEFAULTS.authors_count,
      reviewers_count: r2.reviewers_count ?? ROLLUP_FIELD_DEFAULTS.reviewers_count,
      // by_repository and by_team are optional features - preserve null if missing
      by_repository: r2.by_repository !== void 0 ? r2.by_repository : null,
      by_author: r2.by_author !== void 0 ? r2.by_author : null,
      ...r2.by_author_and_repo !== void 0 ? {
        by_author_and_repo: r2.by_author_and_repo
      } : {},
      by_team: r2.by_team !== void 0 ? r2.by_team : null,
      by_reviewer: r2.by_reviewer !== void 0 ? r2.by_reviewer : null,
      // Cross-dimensional breakdown (v2 schema) — pass through if present
      ...r2.by_team_and_repo !== void 0 ? {
        by_team_and_repo: r2.by_team_and_repo
      } : {}
    };
  }
  function normalizeRollups(rollups) {
    if (!Array.isArray(rollups)) {
      return [];
    }
    return rollups.map(normalizeRollup2);
  }
  var fetchSemaphore = {
    maxConcurrent: 4,
    maxRetries: 1,
    retryDelayMs: 200,
    active: 0,
    queue: [],
    /**
     * Acquire a semaphore slot. Blocks until slot available.
     * @returns {Promise<void>}
     */
    acquire() {
      return new Promise((resolve) => {
        if (this.active < this.maxConcurrent) {
          this.active++;
          resolve();
        } else {
          this.queue.push(resolve);
        }
      });
    },
    /**
     * Release a semaphore slot. Unblocks next waiter if any.
     */
    release() {
      const next = this.queue.shift();
      if (next) {
        next();
      } else {
        this.active--;
      }
    },
    /**
     * Get current state (for testing).
     * @returns {{ active: number, queued: number }}
     */
    getState() {
      return { active: this.active, queued: this.queue.length };
    },
    /**
     * Reset semaphore state (for testing).
     */
    reset() {
      this.active = 0;
      this.queue = [];
    }
  };
  function createRollupCache(clock = Date.now) {
    const maxSize = 52;
    const ttlMs = 5 * 60 * 1e3;
    const entries = /* @__PURE__ */ new Map();
    const requiredKeyFields = ["week", "org", "project", "repo"];
    return {
      maxSize,
      ttlMs,
      clock,
      /**
       * Build composite cache key. Throws if required params missing.
       */
      makeKey(params) {
        const paramsMap = new Map(Object.entries(params));
        for (const field of requiredKeyFields) {
          if (!paramsMap.get(field)) {
            throw new Error(`Cache key missing required field: ${field}`);
          }
        }
        const {
          week,
          org,
          project,
          repo,
          branch = "",
          apiVersion = "1"
        } = params;
        return `${week}|${org}|${project}|${repo}|${branch}|${apiVersion}`;
      },
      /**
       * Get cached value if valid.
       */
      get(key) {
        const entry = entries.get(key);
        if (!entry) return void 0;
        const now = clock();
        if (now - entry.createdAt > ttlMs) {
          entries.delete(key);
          return void 0;
        }
        entry.touchedAt = now;
        return entry.value;
      },
      /**
       * Set cache value, evicting oldest if at capacity.
       */
      set(key, value) {
        const now = clock();
        if (entries.size >= maxSize && !entries.has(key)) {
          let oldestKey = null;
          let oldestTime = Infinity;
          for (const [k2, v2] of entries) {
            if (v2.touchedAt < oldestTime) {
              oldestTime = v2.touchedAt;
              oldestKey = k2;
            }
          }
          if (oldestKey) entries.delete(oldestKey);
        }
        entries.set(key, {
          value,
          createdAt: now,
          touchedAt: now
        });
      },
      /**
       * Check if key exists and is not expired.
       */
      has(key) {
        return this.get(key) !== void 0;
      },
      /**
       * Clear all entries.
       */
      clear() {
        entries.clear();
      },
      /**
       * Get cache size.
       */
      size() {
        return entries.size;
      }
    };
  }
  var DatasetLoader = class {
    // year -> data
    constructor(baseUrl) {
      this.effectiveBaseUrl = null;
      // Resolved after probing
      this.manifest = null;
      this.dimensions = null;
      this.capabilityState = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      // week -> data
      this.distributionCache = /* @__PURE__ */ new Map();
      this.baseUrl = baseUrl || "";
      this.effectiveBaseUrl = null;
    }
    /**
     * Resolve the dataset root by probing candidate paths for manifest.
     * Caches the result for subsequent path resolutions.
     * @returns The effective base URL or null if not found
     */
    async resolveDatasetRoot() {
      if (this.effectiveBaseUrl !== null) {
        return this.effectiveBaseUrl || null;
      }
      for (const candidate of DATASET_CANDIDATE_PATHS) {
        const candidateBase = candidate ? `${this.baseUrl}/${candidate}` : this.baseUrl;
        const manifestUrl = candidateBase ? `${candidateBase}/dataset-manifest.json` : "dataset-manifest.json";
        try {
          const response = await fetch(manifestUrl, { method: "HEAD" });
          if (response.ok) {
            console.log("[DatasetLoader] Found manifest at: %s", manifestUrl);
            this.effectiveBaseUrl = candidateBase;
            return candidateBase;
          }
        } catch {
        }
      }
      console.warn(
        "[DatasetLoader] No manifest found in candidate paths, using baseUrl as fallback"
      );
      this.effectiveBaseUrl = this.baseUrl;
      return null;
    }
    /**
     * Load and validate the dataset manifest.
     * Automatically resolves nested dataset root before loading.
     */
    async loadManifest() {
      if (this.manifest) {
        return this.manifest;
      }
      if (this.effectiveBaseUrl === null) {
        await this.resolveDatasetRoot();
      }
      const url = this.resolvePath("dataset-manifest.json");
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(
            "Dataset not found. Ensure the analytics pipeline has run successfully."
          );
        }
        throw new Error(
          `Failed to load manifest: ${response.status} ${response.statusText}`
        );
      }
      const manifest = await response.json();
      this.validateManifestSchema(manifest);
      this.manifest = manifest;
      this.capabilityState = normalizeCapabilityState(manifest);
      return manifest;
    }
    /**
     * Validate manifest schema using schema validator.
     * Throws SchemaValidationError on invalid data.
     */
    validateManifestSchema(manifest) {
      validateSchema(manifest, validateManifest, "manifest", true);
      const m2 = manifest;
      if (m2.manifest_schema_version !== void 0 && m2.manifest_schema_version > SUPPORTED_MANIFEST_VERSION) {
        throw new Error(
          `Manifest version ${m2.manifest_schema_version} not supported. Maximum supported: ${SUPPORTED_MANIFEST_VERSION}. Please update the extension.`
        );
      }
      if (m2.dataset_schema_version !== void 0 && m2.dataset_schema_version > SUPPORTED_DATASET_VERSION) {
        throw new Error(
          `Dataset version ${m2.dataset_schema_version} not supported. Please update the extension.`
        );
      }
      if (m2.aggregates_schema_version !== void 0 && m2.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION) {
        throw new Error(
          `Aggregates version ${m2.aggregates_schema_version} not supported. Please update the extension.`
        );
      }
    }
    /**
     * Load dimensions (filter values).
     * Validates against schema and throws SchemaValidationError on invalid data.
     */
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      const url = this.resolvePath("aggregates/dimensions.json");
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load dimensions: ${response.status}`);
      }
      const rawDimensions = await response.json();
      validateSchema(rawDimensions, validateDimensions, "dimensions", true);
      this.dimensions = rawDimensions;
      return this.dimensions;
    }
    /**
     * Get weekly rollups for a date range.
     * Implements lazy loading with caching.
     */
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cached = this.rollupCache.get(weekStr);
        if (cached) {
          results.push(cached);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r2) => r2.week === weekStr
        );
        if (!indexEntry) {
          continue;
        }
        const url = this.resolvePath(indexEntry.path);
        const response = await fetch(url);
        if (response.ok) {
          const rawData = await response.json();
          validateSchema(rawData, validateRollup, "rollup", false, weekStr);
          const data = normalizeRollup2(rawData);
          this.rollupCache.set(weekStr, data);
          results.push(data);
        }
      }
      return results.sort((a2, b2) => a2.week.localeCompare(b2.week));
    }
    /**
     * Get weekly rollups with concurrent fetching, progress reporting, and caching (Phase 4).
     */
    async getWeeklyRollupsWithProgress(startDate, endDate, context, onProgress = () => {
    }, cache = null) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const allWeeks = this.getWeeksInRange(startDate, endDate);
      const data = [];
      const missingWeeks = [];
      const failedWeeks = [];
      let authError = false;
      const useCache = cache || {
        makeKey: (params) => params.week,
        get: (key) => this.rollupCache.get(key),
        set: (key, value) => this.rollupCache.set(key, value),
        has: (key) => this.rollupCache.has(key),
        maxSize: Infinity,
        ttlMs: Infinity,
        clock: Date.now,
        clear: () => this.rollupCache.clear(),
        size: () => this.rollupCache.size
      };
      const cachedResults = [];
      const weeksToFetch = [];
      for (const weekStr of allWeeks) {
        try {
          const cacheKey = useCache.makeKey({ week: weekStr, ...context });
          const cached = useCache.get(cacheKey);
          if (cached !== void 0) {
            cachedResults.push(cached);
          } else {
            weeksToFetch.push(weekStr);
          }
        } catch {
          weeksToFetch.push(weekStr);
        }
      }
      const batches = [];
      for (let i2 = 0; i2 < weeksToFetch.length; i2 += fetchSemaphore.maxConcurrent) {
        batches.push(weeksToFetch.slice(i2, i2 + fetchSemaphore.maxConcurrent));
      }
      let loaded = 0;
      const total = weeksToFetch.length;
      for (const batch of batches) {
        const batchPromises = batch.map(async (weekStr) => {
          onProgress({ loaded, total, currentWeek: weekStr });
          const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
            (r2) => r2.week === weekStr
          );
          if (!indexEntry) {
            return { week: weekStr, status: "missing" };
          }
          return await this._fetchWeekWithRetry(
            weekStr,
            indexEntry,
            context,
            useCache
          );
        });
        const results = await Promise.allSettled(batchPromises);
        for (const result of results) {
          loaded++;
          if (result.status === "fulfilled") {
            const outcome = result.value;
            if (outcome.status === "ok") {
              data.push(outcome.data);
            } else if (outcome.status === "missing") {
              missingWeeks.push(outcome.week);
            } else if (outcome.status === "auth") {
              authError = true;
            } else if (outcome.status === "failed") {
              failedWeeks.push(outcome.week);
            }
          } else {
            failedWeeks.push("unknown");
          }
        }
      }
      const allData = [...cachedResults, ...data];
      const partial = missingWeeks.length > 0 || failedWeeks.length > 0;
      const degraded = partial || authError;
      if (authError && allData.length === 0) {
        const error = new Error("Authentication required");
        error.code = "AUTH_REQUIRED";
        throw error;
      }
      onProgress({ loaded: total, total, currentWeek: null });
      return {
        data: allData.sort((a2, b2) => a2.week.localeCompare(b2.week)),
        missingWeeks,
        failedWeeks,
        partial,
        authError,
        degraded
      };
    }
    /**
     * Fetch a single week with semaphore control and bounded retry.
     */
    async _fetchWeekWithRetry(weekStr, indexEntry, context, cache) {
      let retries = 0;
      while (retries <= fetchSemaphore.maxRetries) {
        await fetchSemaphore.acquire();
        try {
          const url = this.resolvePath(indexEntry.path);
          const response = await fetch(url);
          if (response.ok) {
            const rawData = await response.json();
            const data = normalizeRollup2(rawData);
            try {
              const cacheKey = cache.makeKey({ week: weekStr, ...context });
              cache.set(cacheKey, data);
            } catch {
            }
            return { week: weekStr, status: "ok", data };
          }
          if (response.status === 401 || response.status === 403) {
            return { week: weekStr, status: "auth" };
          }
          if (response.status === 404) {
            return { week: weekStr, status: "missing" };
          }
          if (response.status >= 500 && retries < fetchSemaphore.maxRetries) {
            retries++;
            await this._delay(fetchSemaphore.retryDelayMs);
            continue;
          }
          return {
            week: weekStr,
            status: "failed",
            error: `HTTP ${response.status}`
          };
        } catch (err) {
          if (retries < fetchSemaphore.maxRetries) {
            retries++;
            await this._delay(fetchSemaphore.retryDelayMs);
            continue;
          }
          return { week: weekStr, status: "failed", error: getErrorMessage(err) };
        } finally {
          fetchSemaphore.release();
        }
      }
      return { week: weekStr, status: "failed", error: "max retries exceeded" };
    }
    /**
     * Delay helper for retry backoff.
     */
    _delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Get yearly distributions for a date range.
     */
    async getDistributions(startDate, endDate) {
      if (!this.manifest) {
        throw new Error("Manifest not loaded. Call loadManifest() first.");
      }
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = year.toString();
        const cached = this.distributionCache.get(yearStr);
        if (cached) {
          results.push(cached);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d2) => d2.year === yearStr
        );
        if (!indexEntry) continue;
        const url = this.resolvePath(indexEntry.path);
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          this.distributionCache.set(yearStr, data);
          results.push(data);
        }
      }
      return results;
    }
    /**
     * Check if a feature is enabled in the dataset.
     */
    isFeatureEnabled(feature) {
      if (!this.manifest) return false;
      const featuresMap = new Map(Object.entries(this.manifest.features ?? {}));
      return featuresMap.get(feature) === true;
    }
    getCapabilityState() {
      return this.capabilityState ?? DEFAULT_CAPABILITY_STATE;
    }
    /**
     * Get dataset coverage info.
     */
    getCoverage() {
      if (!this.manifest) return null;
      return this.manifest.coverage ?? null;
    }
    /**
     * Get default date range days.
     */
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    /**
     * Load predictions data (Phase 3.5).
     * Validates against schema (permissive mode - unknown fields produce warnings).
     */
    async loadPredictions() {
      if (!this.isFeatureEnabled("predictions")) {
        return { state: "disabled" };
      }
      try {
        const url = this.resolvePath("predictions/trends.json");
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            return { state: "missing" };
          }
          if (response.status === 401 || response.status === 403) {
            return { state: "auth" };
          }
          return {
            state: "error",
            error: "PRED_003",
            message: `HTTP ${response.status}`
          };
        }
        const predictions = await response.json();
        const schemaResult = validatePredictions(
          predictions,
          false
        );
        if (!schemaResult.valid) {
          console.error(
            "[DatasetLoader] Invalid predictions schema:",
            schemaResult.errors.map((e2) => e2.message).join("; ")
          );
          return {
            state: "invalid",
            error: "PRED_001",
            message: schemaResult.errors[0]?.message ?? "Schema validation failed"
          };
        }
        if (schemaResult.warnings.length > 0) {
          console.warn(
            "[DatasetLoader] Predictions validation warnings:",
            schemaResult.warnings.map((w2) => w2.message).join("; ")
          );
        }
        return { state: "ok", data: predictions };
      } catch (err) {
        console.error("[DatasetLoader] Error loading predictions:", err);
        return {
          state: "error",
          error: "PRED_002",
          message: getErrorMessage(err)
        };
      }
    }
    /**
     * Load AI insights data (Phase 3.5).
     */
    async loadInsights() {
      if (!this.isFeatureEnabled("ai_insights")) {
        return { state: "disabled" };
      }
      try {
        const url = this.resolvePath("insights/summary.json");
        const response = await fetch(url);
        if (!response.ok) {
          if (response.status === 404) {
            return { state: "missing" };
          }
          if (response.status === 401 || response.status === 403) {
            return { state: "auth" };
          }
          return {
            state: "error",
            error: "AI_003",
            message: `HTTP ${response.status}`
          };
        }
        const insights = await response.json();
        const validationResult = this.validateInsightsSchema(insights);
        if (!validationResult.valid) {
          console.error(
            "[DatasetLoader] Invalid insights schema:",
            validationResult.error
          );
          return {
            state: "invalid",
            error: "AI_001",
            message: validationResult.error
          };
        }
        return { state: "ok", data: insights };
      } catch (err) {
        console.error("[DatasetLoader] Error loading insights:", err);
        return { state: "error", error: "AI_002", message: getErrorMessage(err) };
      }
    }
    /**
     * Validate predictions schema.
     */
    validatePredictionsSchema(predictions) {
      if (!predictions || typeof predictions !== "object")
        return { valid: false, error: "Missing predictions data" };
      const p2 = predictions;
      if (typeof p2.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (p2.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${p2.schema_version}`
        };
      }
      if (!Array.isArray(p2.forecasts)) {
        return { valid: false, error: "Missing forecasts array" };
      }
      for (const forecast of p2.forecasts) {
        if (!forecast.metric || !forecast.unit || !Array.isArray(forecast.values)) {
          return { valid: false, error: "Invalid forecast structure" };
        }
      }
      return { valid: true };
    }
    /**
     * Validate insights schema.
     */
    validateInsightsSchema(insights) {
      if (!insights || typeof insights !== "object")
        return { valid: false, error: "Missing insights data" };
      const i2 = insights;
      if (typeof i2.schema_version !== "number") {
        return { valid: false, error: "Missing schema_version" };
      }
      if (i2.schema_version > 1) {
        return {
          valid: false,
          error: `Unsupported schema version: ${i2.schema_version}`
        };
      }
      if (!Array.isArray(i2.insights)) {
        return { valid: false, error: "Missing insights array" };
      }
      for (const insight of i2.insights) {
        if (!insight.id || !insight.category || !insight.severity || !insight.title) {
          return { valid: false, error: "Invalid insight structure" };
        }
      }
      return { valid: true };
    }
    /**
     * Resolve a relative path to full URL.
     * Uses effectiveBaseUrl if resolved, otherwise falls back to baseUrl.
     */
    resolvePath(relativePath) {
      const base = this.effectiveBaseUrl !== null ? this.effectiveBaseUrl : this.baseUrl;
      if (base) {
        return `${base}/${relativePath}`;
      }
      return relativePath;
    }
    /**
     * Get ISO week strings for a date range.
     */
    getWeeksInRange(start, end) {
      const weeks = [];
      const current = new Date(start);
      while (current <= end) {
        const weekStr = this.getISOWeek(current);
        if (!weeks.includes(weekStr)) {
          weeks.push(weekStr);
        }
        current.setDate(current.getDate() + 7);
      }
      const endWeek = this.getISOWeek(end);
      if (!weeks.includes(endWeek)) {
        weeks.push(endWeek);
      }
      return weeks;
    }
    /**
     * Get ISO week string for a date.
     */
    getISOWeek(date) {
      const d2 = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      const dayNum = d2.getUTCDay() || 7;
      d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d2.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d2.getUTCFullYear()}-W${weekNo.toString().padStart(2, "0")}`;
    }
  };
  if (typeof window !== "undefined") {
    window.DatasetLoader = DatasetLoader;
    window.fetchSemaphore = fetchSemaphore;
    window.createRollupCache = createRollupCache;
    window.normalizeRollup = normalizeRollup2;
    window.normalizeRollups = normalizeRollups;
    window.ROLLUP_FIELD_DEFAULTS = ROLLUP_FIELD_DEFAULTS;
  }

  // ../ui/artifact-client.ts
  var LIST_ENDPOINT_FAMILIES = /* @__PURE__ */ new Set([
    "definitions",
    "builds",
    "artifacts"
  ]);
  var ArtifactClient = class {
    /**
     * Create a new ArtifactClient.
     *
     * @param projectId - Azure DevOps project ID
     */
    constructor(projectId) {
      this.collectionUri = null;
      this.tokenProvider = null;
      this.initialized = false;
      /** Per-family API version cache. Scoped to this client instance,
       *  which is bound to a single collectionUri + projectId by
       *  initialize(). A new context requires a new client instance. */
      this.resolvedApiVersions = /* @__PURE__ */ new Map();
      this.projectId = projectId;
    }
    /**
     * Initialize the client with authentication credentials.
     * MUST be called after SDK initialization and before any other methods.
     *
     * @param collectionUri - Azure DevOps collection/organization base URI
     * @param tokenProvider - Async function that returns a fresh Bearer token
     *   per request. The host manages token lifecycle; callers should pass
     *   the SDK's getAccessToken function directly.
     * @returns This client instance
     */
    async initialize(collectionUri, tokenProvider) {
      if (this.initialized) {
        return this;
      }
      this.collectionUri = collectionUri;
      this.tokenProvider = tokenProvider;
      this.initialized = true;
      return this;
    }
    /**
     * Ensure the client is initialized.
     */
    _ensureInitialized() {
      if (!this.initialized) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
    }
    /**
     * Fetch a file from a build artifact.
     *
     * @param buildId - Build ID
     * @param artifactName - Artifact name (e.g., 'aggregates')
     * @param filePath - Path within artifact (e.g., 'dataset-manifest.json')
     * @returns Parsed JSON content
     * @throws {PrInsightsError} On permission denied or not found
     */
    async getArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "artifact-file",
        (v2) => this._buildFileUrl(buildId, artifactName, filePath, v2)
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact files");
      }
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch artifact file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Check if a specific file exists in an artifact.
     */
    async hasArtifactFile(buildId, artifactName, filePath) {
      this._ensureInitialized();
      try {
        const response = await this._fetchWithVersionFallback(
          "artifact-file",
          (v2) => this._buildFileUrl(buildId, artifactName, filePath, v2),
          { method: "HEAD" }
        );
        return response.ok;
      } catch {
        return false;
      }
    }
    /**
     * Get artifact metadata by looking it up from the artifacts list.
     */
    async getArtifactMetadata(buildId, artifactName) {
      this._ensureInitialized();
      const artifacts = await this.getArtifacts(buildId);
      const artifact = artifacts.find(
        (a2) => a2.name === artifactName
      );
      if (!artifact) {
        console.log(
          "[getArtifactMetadata] Artifact '%s' not found in build %d",
          artifactName,
          buildId
        );
        return null;
      }
      return artifact;
    }
    /**
     * Get artifact content via SDK approach.
     */
    async getArtifactFileViaSdk(buildId, artifactName, filePath) {
      this._ensureInitialized();
      const artifact = await this.getArtifactMetadata(buildId, artifactName);
      if (!artifact) {
        throw new Error(
          `Artifact '${artifactName}' not found in build ${buildId}`
        );
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        throw new Error(
          `No downloadUrl available for artifact '${artifactName}'`
        );
      }
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      let url;
      if (downloadUrl.includes("format=")) {
        url = downloadUrl.replace(/format=\w+/, "format=file");
      } else {
        const separator = downloadUrl.includes("?") ? "&" : "?";
        url = `${downloadUrl}${separator}format=file`;
      }
      url += `&subPath=${encodeURIComponent(normalizedPath)}`;
      const response = await this._authenticatedFetch(url);
      if (response.status === 404) {
        throw new Error(
          `File '${filePath}' not found in artifact '${artifactName}'`
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("read artifact file");
      }
      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }
      return response.json();
    }
    /**
     * Fetch a URL with API version fallback. If the version is already
     * cached, uses it directly. Otherwise delegates to the shared
     * fetchWithVersionFallback probe and caches on success.
     *
     * @param family Endpoint family for per-route version caching
     * @param buildUrl Function that builds the URL for a given api-version
     * @param options Optional fetch options (e.g., { method: "HEAD" })
     */
    async _fetchWithVersionFallback(family, buildUrl, options) {
      this._ensureInitialized();
      const cachedVersion = this.resolvedApiVersions.get(family);
      if (cachedVersion) {
        return this._authenticatedFetch(buildUrl(cachedVersion), options);
      }
      const isListEndpoint = LIST_ENDPOINT_FAMILIES.has(family);
      const { response, version } = await fetchWithVersionFallback(
        buildUrl,
        (url) => this._authenticatedFetch(url, options),
        { isListEndpoint }
      );
      if (response.ok) {
        this.resolvedApiVersions.set(family, version);
      }
      return response;
    }
    /**
     * Get list of artifacts for a build.
     */
    async getArtifacts(buildId) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "artifacts",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?api-version=${v2}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build artifacts");
      }
      if (response.status === 404) {
        throw new Error(`Build ${buildId} not found or has been deleted`);
      }
      if (!response.ok) {
        throw new Error(`Failed to list artifacts: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get pipeline definitions for the project.
     *
     * @param top - Maximum number of definitions to return (default: 50)
     * @param queryOrder - Sort order (2 = lastModifiedDescending)
     * @returns Array of pipeline definition references
     */
    async getDefinitions(top = 50, queryOrder = 2) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "definitions",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/definitions?api-version=${v2}&$top=${top}&queryOrder=${queryOrder}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list build definitions");
      }
      if (!response.ok) {
        throw new Error(`Failed to list definitions: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Get builds for a specific pipeline definition.
     *
     * @param definitionId - Pipeline definition ID to filter by
     * @param top - Maximum number of builds to return (default: 1)
     * @returns Array of builds (filtered to completed + succeeded)
     */
    async getBuilds(definitionId, top = 1) {
      this._ensureInitialized();
      const response = await this._fetchWithVersionFallback(
        "builds",
        (v2) => `${this.collectionUri}${this.projectId}/_apis/build/builds?api-version=${v2}&definitions=${definitionId}&statusFilter=2&resultFilter=6&$top=${top}`
      );
      if (response.status === 401 || response.status === 403) {
        throw createPermissionDeniedError("list builds");
      }
      if (!response.ok) {
        throw new Error(`Failed to list builds: ${response.status}`);
      }
      const data = await response.json();
      return data.value || [];
    }
    /**
     * Create a DatasetLoader that uses this client for authenticated requests.
     */
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(this, buildId, artifactName);
    }
    /**
     * Build the URL for accessing a file within an artifact.
     * Takes an explicit API version — callers route through
     * _fetchWithVersionFallback which provides the version.
     */
    _buildFileUrl(buildId, artifactName, filePath, apiVersion) {
      const normalizedPath = filePath.startsWith("/") ? filePath : "/" + filePath;
      return `${this.collectionUri}${this.projectId}/_apis/build/builds/${buildId}/artifacts?artifactName=${encodeURIComponent(artifactName)}&%24format=file&subPath=${encodeURIComponent(normalizedPath)}&api-version=${apiVersion}`;
    }
    /**
     * Perform an authenticated fetch using the ADO auth token.
     */
    async _authenticatedFetch(url, options = {}) {
      if (!this.tokenProvider) {
        throw new Error(
          "ArtifactClient not initialized. Call initialize() first."
        );
      }
      const token = await this.tokenProvider();
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...options.headers || {}
      };
      return fetch(url, { ...options, headers });
    }
    /**
     * Public wrapper for authenticated fetch.
     * Use this for external callers (e.g., dashboard raw data download).
     *
     * @param url - URL to fetch
     * @param options - Fetch options
     * @returns Response
     */
    async authenticatedFetch(url, options = {}) {
      this._ensureInitialized();
      return this._authenticatedFetch(url, options);
    }
  };
  var AuthenticatedDatasetLoader = class {
    constructor(artifactClient, buildId, artifactName) {
      this.manifest = null;
      this.capabilityState = null;
      this.dimensions = null;
      this.rollupCache = /* @__PURE__ */ new Map();
      this.distributionCache = /* @__PURE__ */ new Map();
      this.artifactClient = artifactClient;
      this.buildId = buildId;
      this.artifactName = artifactName;
    }
    async loadManifest() {
      try {
        this.manifest = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          "dataset-manifest.json"
        );
        if (!this.manifest) {
          throw new Error("Manifest file is empty or invalid");
        }
        this.validateManifest(this.manifest);
        this.capabilityState = normalizeCapabilityState(this.manifest);
        return this.manifest;
      } catch (error) {
        const wrappedError = new Error(
          `Failed to load dataset manifest: ${getErrorMessage(error)}`
        );
        wrappedError.cause = error;
        throw wrappedError;
      }
    }
    validateManifest(manifest) {
      const SUPPORTED_MANIFEST_VERSION2 = 1;
      const SUPPORTED_DATASET_VERSION2 = 1;
      const SUPPORTED_AGGREGATES_VERSION2 = 3;
      if (!manifest.manifest_schema_version) {
        throw new Error("Invalid manifest: missing schema version");
      }
      if (manifest.manifest_schema_version > SUPPORTED_MANIFEST_VERSION2) {
        throw new Error(
          `Manifest version ${manifest.manifest_schema_version} not supported.`
        );
      }
      if (manifest.dataset_schema_version !== void 0 && manifest.dataset_schema_version > SUPPORTED_DATASET_VERSION2) {
        throw new Error(
          `Dataset version ${manifest.dataset_schema_version} not supported.`
        );
      }
      if (manifest.aggregates_schema_version !== void 0 && manifest.aggregates_schema_version > SUPPORTED_AGGREGATES_VERSION2) {
        throw new Error(
          `Aggregates version ${manifest.aggregates_schema_version} not supported.`
        );
      }
    }
    async loadDimensions() {
      if (this.dimensions) return this.dimensions;
      this.dimensions = await this.artifactClient.getArtifactFileViaSdk(
        this.buildId,
        this.artifactName,
        "aggregates/dimensions.json"
      );
      if (!this.dimensions) {
        throw new Error("Dimensions file is empty or invalid");
      }
      return this.dimensions;
    }
    async getWeeklyRollups(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const neededWeeks = this.getWeeksInRange(startDate, endDate);
      const results = [];
      for (const weekStr of neededWeeks) {
        const cachedRollup = this.rollupCache.get(weekStr);
        if (cachedRollup) {
          results.push(cachedRollup);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.weekly_rollups?.find(
          (r2) => r2.week === weekStr
        );
        if (!indexEntry) continue;
        try {
          const rollup = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.rollupCache.set(weekStr, rollup);
          results.push(rollup);
        } catch (e2) {
          console.warn("Failed to load rollup for %s:", weekStr, e2);
        }
      }
      return results;
    }
    async getDistributions(startDate, endDate) {
      if (!this.manifest) throw new Error("Manifest not loaded.");
      const startYear = startDate.getFullYear();
      const endYear = endDate.getFullYear();
      const results = [];
      for (let year = startYear; year <= endYear; year++) {
        const yearStr = String(year);
        const cachedDistribution = this.distributionCache.get(yearStr);
        if (cachedDistribution) {
          results.push(cachedDistribution);
          continue;
        }
        const indexEntry = this.manifest?.aggregate_index?.distributions?.find(
          (d2) => d2.year === yearStr
        );
        if (!indexEntry) continue;
        try {
          const dist = await this.artifactClient.getArtifactFileViaSdk(
            this.buildId,
            this.artifactName,
            indexEntry.path
          );
          this.distributionCache.set(yearStr, dist);
          results.push(dist);
        } catch (e2) {
          console.warn("Failed to load distribution for %s:", yearStr, e2);
        }
      }
      return results;
    }
    getWeeksInRange(startDate, endDate) {
      const weeks = [];
      const current = new Date(startDate);
      const day = current.getDay();
      const diff = current.getDate() - day + (day === 0 ? -6 : 1);
      current.setDate(diff);
      while (current <= endDate) {
        weeks.push(this.getISOWeek(current));
        current.setDate(current.getDate() + 7);
      }
      return weeks;
    }
    getISOWeek(date) {
      const d2 = new Date(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
      );
      d2.setUTCDate(d2.getUTCDate() + 4 - (d2.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d2.getTime() - yearStart.getTime()) / 864e5 + 1) / 7
      );
      return `${d2.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
    getCoverage() {
      return this.manifest?.coverage || null;
    }
    getDefaultRangeDays() {
      return this.manifest?.defaults?.default_date_range_days || 90;
    }
    getCapabilityState() {
      return this.capabilityState ?? DEFAULT_CAPABILITY_STATE;
    }
    async loadPredictions() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.predictions;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e2) {
        console.warn("Failed to load predictions:", e2);
        return { state: "unavailable" };
      }
    }
    async loadInsights() {
      try {
        const indexEntry = this.manifest?.aggregate_index?.ai_insights;
        if (!indexEntry) return { state: "unavailable" };
        const data = await this.artifactClient.getArtifactFileViaSdk(
          this.buildId,
          this.artifactName,
          indexEntry.path
        );
        return { state: "ok", data };
      } catch (e2) {
        console.warn("Failed to load AI insights:", e2);
        return { state: "unavailable" };
      }
    }
  };
  var MockArtifactClient = class {
    constructor(mockData = {}) {
      this.projectId = "mock-project";
      this.initialized = true;
      this.mockData = new Map(Object.entries(mockData));
    }
    async initialize() {
      return this;
    }
    async getArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      if (this.mockData.has(key)) {
        return JSON.parse(JSON.stringify(this.mockData.get(key)));
      }
      throw new Error(`Mock: File not found: ${key}`);
    }
    async hasArtifactFile(buildId, artifactName, filePath) {
      const key = `${buildId}/${artifactName}/${filePath}`;
      return this.mockData.has(key);
    }
    async getArtifacts(buildId) {
      return this.mockData.get(`${buildId}/artifacts`) ?? [];
    }
    async getDefinitions() {
      return this.mockData.get("definitions") ?? [];
    }
    async getBuilds(definitionId) {
      return this.mockData.get(`builds/${definitionId}`) ?? [];
    }
    createDatasetLoader(buildId, artifactName) {
      return new AuthenticatedDatasetLoader(
        this,
        buildId,
        artifactName
      );
    }
  };
  if (typeof window !== "undefined") {
    window.ArtifactClient = ArtifactClient;
    window.AuthenticatedDatasetLoader = AuthenticatedDatasetLoader;
    window.MockArtifactClient = MockArtifactClient;
  }

  // ../ui/settings.ts
  var SETTINGS_KEY_PROJECT = "pr-insights-source-project";
  var SETTINGS_KEY_PIPELINE = "pr-insights-pipeline-id";
  var ARTIFACT_NAME_CSV = "csv-output";
  var BLOB_CLEANUP_TIMEOUT_MS = 1e4;
  var dataService = null;
  var projectDropdownAvailable = false;
  var projectList = [];
  var lastValidation = null;
  var statusTimerId = null;
  async function init() {
    initializeHostResizeSync(".settings-container");
    try {
      await initializeAdoSdk();
      syncHostHeight();
      dataService = await getExtensionDataService();
      const webCtx = getWebContext();
      const projectInput = document.getElementById(
        "project-id"
      );
      if (projectInput && webCtx?.project?.name) {
        projectInput.placeholder = `Current: ${webCtx.project.name}`;
      }
      await tryLoadProjectDropdown();
      await loadSettings();
      await updateStatus();
      setupEventListeners();
      syncHostHeight();
    } catch (error) {
      console.error("Settings initialization failed:", error);
      showStatus(
        "Failed to initialize settings: " + getErrorMessage(error),
        "error"
      );
      syncHostHeight();
    }
  }
  async function tryLoadProjectDropdown() {
    const dropdown = document.getElementById(
      "project-select"
    );
    const textInput = document.getElementById("project-id");
    try {
      const projects = await getOrganizationProjects();
      if (projects && projects.length > 0) {
        projectList = projects;
        projectDropdownAvailable = true;
        clearElement(dropdown);
        dropdown.appendChild(createOption("", "Current project (auto)"));
        for (const project of projects.sort(
          (a2, b2) => a2.name.localeCompare(b2.name)
        )) {
          const option = document.createElement("option");
          option.value = project.id;
          option.textContent = `${project.name} (${project.id.substring(0, 8)}...)`;
          dropdown.appendChild(option);
        }
        dropdown.style.display = "block";
        textInput.style.display = "none";
        console.log(`Loaded ${projects.length} projects for dropdown`);
      } else {
        throw new Error("No projects returned");
      }
    } catch (error) {
      console.log(
        "Project dropdown unavailable, using text input:",
        getErrorMessage(error)
      );
      projectDropdownAvailable = false;
      dropdown.style.display = "none";
      textInput.style.display = "block";
    }
  }
  async function getOrganizationProjects() {
    const collectionUri = await getCollectionUri();
    const token = await getAccessToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
    const { response: firstResponse, version: workingVersion } = await fetchWithVersionFallback(
      (v2) => `${collectionUri}_apis/projects?api-version=${v2}&$top=500`,
      (url) => fetch(url, { headers }),
      { isListEndpoint: true }
    );
    if (firstResponse.status === 401 || firstResponse.status === 403) {
      throw new Error(`Failed to list projects: ${firstResponse.status}`);
    }
    if (!firstResponse.ok) {
      throw new Error(`Failed to list projects: ${firstResponse.status}`);
    }
    const allProjects = [];
    const processPage = async (response) => {
      let data;
      try {
        data = await response.json();
      } catch {
        return null;
      }
      const raw = Array.isArray(data.value) ? data.value : [];
      const page = raw.filter(
        (p2) => p2 !== null && typeof p2 === "object" && typeof p2.name === "string" && typeof p2.id === "string"
      );
      allProjects.push(...page);
      return response.headers.get("x-ms-continuationtoken") ?? null;
    };
    let continuationToken = await processPage(firstResponse);
    while (continuationToken) {
      const url = `${collectionUri}_apis/projects?api-version=${workingVersion}&$top=500&continuationToken=${encodeURIComponent(continuationToken)}`;
      const response = await fetch(url, { headers });
      if (!response.ok) {
        throw new Error(`Failed to list projects: ${response.status}`);
      }
      continuationToken = await processPage(response);
    }
    return allProjects;
  }
  async function loadSettings() {
    if (!dataService) return;
    try {
      const savedProjectId = await dataService.getValue(
        SETTINGS_KEY_PROJECT,
        { scopeType: "User", defaultValue: "" }
      );
      const savedPipelineId = await dataService.getValue(
        SETTINGS_KEY_PIPELINE,
        { scopeType: "User", defaultValue: 0 }
      );
      if (savedProjectId) {
        if (projectDropdownAvailable) {
          const dropdown = document.getElementById(
            "project-select"
          );
          if (dropdown) dropdown.value = savedProjectId;
        } else {
          const textInput = document.getElementById(
            "project-id"
          );
          if (textInput) textInput.value = savedProjectId;
        }
      }
      const pipelineInput = document.getElementById(
        "pipeline-id"
      );
      if (pipelineInput && savedPipelineId) {
        pipelineInput.value = savedPipelineId.toString();
      }
    } catch (error) {
      console.log("No saved settings found:", error);
    }
  }
  function getSelectedProjectId() {
    if (projectDropdownAvailable) {
      const dropdown = document.getElementById(
        "project-select"
      );
      return dropdown.value || null;
    } else {
      const textInput = document.getElementById("project-id");
      const value = textInput.value.trim();
      return value || null;
    }
  }
  async function saveSettings() {
    if (!dataService) return;
    const projectId = getSelectedProjectId();
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    const pipelineValue = pipelineInput?.value?.trim();
    try {
      await dataService.setValue(SETTINGS_KEY_PROJECT, projectId, {
        scopeType: "User"
      });
      if (pipelineValue) {
        const pipelineId = parseInt(pipelineValue, 10);
        if (isNaN(pipelineId) || pipelineId <= 0) {
          showStatus("Pipeline ID must be a positive integer", "error");
          return;
        }
        await dataService.setValue(SETTINGS_KEY_PIPELINE, pipelineId, {
          scopeType: "User"
        });
      } else {
        await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
          scopeType: "User"
        });
      }
      showStatus("Settings saved successfully", "success");
      await updateStatus();
    } catch (error) {
      console.error("Failed to save settings:", error);
      showStatus("Failed to save settings: " + getErrorMessage(error), "error");
    }
  }
  async function clearSettings() {
    if (!dataService) return;
    if (projectDropdownAvailable) {
      const dropdown = document.getElementById(
        "project-select"
      );
      if (dropdown) dropdown.value = "";
    } else {
      const textInput = document.getElementById("project-id");
      if (textInput) textInput.value = "";
    }
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    if (pipelineInput) pipelineInput.value = "";
    try {
      await dataService.setValue(SETTINGS_KEY_PROJECT, null, {
        scopeType: "User"
      });
      await dataService.setValue(SETTINGS_KEY_PIPELINE, null, {
        scopeType: "User"
      });
      showStatus(
        "Settings cleared - using current project with auto-discovery",
        "success"
      );
      await updateStatus();
    } catch (error) {
      console.error("Failed to clear settings:", error);
      showStatus("Failed to clear settings: " + getErrorMessage(error), "error");
    }
  }
  async function updateStatus() {
    if (!dataService) return;
    const statusDisplay = document.getElementById("status-display");
    if (!statusDisplay) return;
    try {
      let savedProjectId = "";
      let savedPipelineId = 0;
      try {
        savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, {
          scopeType: "User",
          defaultValue: ""
        }) || "";
        savedPipelineId = await dataService.getValue(SETTINGS_KEY_PIPELINE, {
          scopeType: "User",
          defaultValue: 0
        }) || 0;
      } catch (readError) {
        console.warn("Could not read saved settings:", readError);
      }
      const webContext = getWebContext();
      const currentProjectName = webContext?.project?.name || "Unknown";
      const currentProjectId = webContext?.project?.id;
      let html = "";
      html += `<p><strong>Current Project:</strong> ${escapeHtml(currentProjectName)}</p>`;
      if (savedProjectId) {
        const projectName = getProjectNameById(savedProjectId);
        html += `<p><strong>Source Project:</strong> ${escapeHtml(projectName)} <code>${savedProjectId.substring(0, 8)}...</code></p>`;
      } else {
        html += `<p><strong>Source Project:</strong> <em>Same as current</em></p>`;
      }
      if (savedPipelineId) {
        html += `<p><strong>Pipeline Definition ID:</strong> ${savedPipelineId}`;
        lastValidation = null;
        const downloadBtn2 = document.getElementById(
          "download-raw-btn"
        );
        if (downloadBtn2) {
          downloadBtn2.disabled = true;
        }
        const targetProjectId = savedProjectId || currentProjectId;
        if (targetProjectId) {
          const validation = await validatePipeline(
            savedPipelineId,
            targetProjectId
          );
          lastValidation = {
            valid: validation.valid,
            buildId: validation.buildId
          };
          if (validation.valid) {
            html += ` <span class="status-valid">\u2713 Valid</span>`;
            html += `</p>`;
            html += `<p class="status-hint">Pipeline: "${escapeHtml(validation.name || "")}" (Build #${validation.buildId})</p>`;
          } else {
            html += ` <span class="status-invalid">\u26A0\uFE0F Invalid</span>`;
            html += `</p>`;
            html += `<p class="status-warning">\u26A0\uFE0F ${escapeHtml(validation.error || "")}</p>`;
            html += `<p class="status-hint">The dashboard will automatically clear this setting and re-discover pipelines. Consider clearing manually to configure a different pipeline.</p>`;
          }
        } else {
          lastValidation = null;
          html += `</p><p class="status-warning">\u26A0\uFE0F No project ID available for validation</p>`;
        }
      } else {
        html += `<p><strong>Mode:</strong> Auto-discovery</p>`;
        const result = await discoverPipelines(
          savedProjectId || currentProjectId
        );
        if (result.error) {
          lastValidation = null;
          html += `<p class="status-warning">\u26A0\uFE0F Discovery failed: ${escapeHtml(result.error)}</p>`;
          html += `<p class="status-hint"><a href="#" id="retry-discovery-link">Retry</a></p>`;
        } else {
          const match = result.pipelines[0];
          if (match) {
            lastValidation = { valid: true, buildId: match.buildId };
            html += `<p class="status-hint">Found pipeline "${escapeHtml(match.name)}" (Build #${match.buildId}). Download available.</p>`;
          } else {
            lastValidation = null;
            html += `<p class="status-hint">The dashboard will automatically find pipelines with an "aggregates" artifact.</p>`;
          }
          if (result.skippedCount > 0) {
            html += `<p class="status-warning">\u26A0\uFE0F Found ${result.pipelines.length} pipeline(s); ${result.skippedCount} could not be checked.</p>`;
          }
        }
      }
      const downloadBtn = document.getElementById(
        "download-raw-btn"
      );
      if (downloadBtn) {
        downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
      }
      if (projectDropdownAvailable) {
        html += `<p class="status-hint">\u2713 Project dropdown available (${projectList.length} projects)</p>`;
      } else {
        html += `<p class="status-hint">Project dropdown not available - using text input</p>`;
      }
      renderTrustedHtml(statusDisplay, html);
      const retryLink = document.getElementById("retry-discovery-link");
      if (retryLink) {
        retryLink.addEventListener("click", (e2) => {
          e2.preventDefault();
          void updateStatus();
        });
      }
    } catch (error) {
      renderTrustedHtml(
        statusDisplay,
        `<p class="status-error">Failed to load status: ${escapeHtml(getErrorMessage(error))}</p>`
      );
    }
  }
  function getProjectNameById(projectId) {
    const project = projectList.find((p2) => p2.id === projectId);
    return project?.name || projectId;
  }
  async function downloadRawData() {
    if (!lastValidation?.valid || !lastValidation?.buildId) {
      showToast("No valid pipeline configured. Save settings first.", "error");
      return;
    }
    const downloadBtn = document.getElementById(
      "download-raw-btn"
    );
    const originalText = downloadBtn?.textContent || "";
    try {
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = "Downloading...";
      }
      showToast("Preparing download...", "success");
      if (!dataService) {
        showToast("Settings service not available", "error");
        return;
      }
      let savedProjectId = "";
      try {
        savedProjectId = await dataService.getValue(SETTINGS_KEY_PROJECT, {
          scopeType: "User",
          defaultValue: ""
        }) || "";
      } catch {
        console.warn("Could not read saved project setting for download");
      }
      const webContext = getWebContext();
      const projectId = savedProjectId || webContext?.project?.id;
      if (!projectId) {
        showToast("No project ID available", "error");
        return;
      }
      if (!Number.isInteger(lastValidation.buildId) || lastValidation.buildId <= 0) {
        showToast("Invalid build ID", "error");
        return;
      }
      const collectionUri = await getCollectionUri();
      const artifactClient = new ArtifactClient(projectId);
      await artifactClient.initialize(collectionUri, getAccessToken);
      const artifact = await artifactClient.getArtifactMetadata(
        lastValidation.buildId,
        ARTIFACT_NAME_CSV
      );
      if (!artifact) {
        showToast("Raw CSV artifact not found in this pipeline run", "error");
        return;
      }
      const downloadUrl = artifact.resource?.downloadUrl;
      if (!downloadUrl) {
        showToast("Download URL not available", "error");
        return;
      }
      try {
        const parsed = new URL(downloadUrl);
        if (parsed.protocol !== "https:") {
          showToast("Invalid download URL", "error");
          return;
        }
        const collectionOrigin = new URL(collectionUri).origin;
        const isCollectionHost = parsed.origin === collectionOrigin;
        const isAzureArtifactHost = parsed.hostname.endsWith(
          ".artifacts.visualstudio.com"
        );
        if (!isCollectionHost && !isAzureArtifactHost) {
          showToast("Invalid download URL", "error");
          return;
        }
      } catch {
        showToast("Invalid download URL", "error");
        return;
      }
      const zipUrlObj = new URL(downloadUrl);
      if (!zipUrlObj.searchParams.has("format")) {
        zipUrlObj.searchParams.set("format", "zip");
      }
      const zipUrl = zipUrlObj.toString();
      const response = await artifactClient.authenticatedFetch(zipUrl);
      if (!response.ok) {
        if (response.status === 403 || response.status === 401) {
          showToast("Permission denied to download artifacts", "error");
        } else {
          showToast(`Download failed: ${response.statusText}`, "error");
        }
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const dateStr = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      link.download = `pr-insights-raw-data-${dateStr}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), BLOB_CLEANUP_TIMEOUT_MS);
      showToast("Download started", "success");
    } catch (err) {
      console.error("Failed to download raw data:", getErrorMessage(err));
      showToast("Failed to download raw data", "error");
    } finally {
      if (downloadBtn) {
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = !lastValidation?.valid || !lastValidation?.buildId;
      }
    }
  }
  async function validatePipeline(pipelineId, projectId) {
    const client = new ArtifactClient(projectId);
    try {
      const collectionUri = await getCollectionUri();
      await client.initialize(collectionUri, getAccessToken);
    } catch (e2) {
      return { valid: false, error: `Validation error: ${getErrorMessage(e2)}` };
    }
    try {
      const builds = await client.getBuilds(pipelineId);
      if (!builds || builds.length === 0) {
        return {
          valid: false,
          error: "No successful builds found (pipeline may not exist or has no completed runs)"
        };
      }
      const firstBuild = builds[0];
      if (!firstBuild) {
        return { valid: false, error: "Build unexpectedly empty" };
      }
      const pipelineName = firstBuild.definition?.name || `ID ${pipelineId}`;
      return {
        valid: true,
        name: pipelineName,
        buildId: firstBuild.id
      };
    } catch (e2) {
      return { valid: false, error: `Build check failed: ${getErrorMessage(e2)}` };
    }
  }
  async function discoverPipelines(targetProjectId) {
    const webContext = getWebContext();
    const projectId = targetProjectId || webContext?.project?.id;
    if (!projectId) {
      return { pipelines: [], skippedCount: 0, error: "No project ID available" };
    }
    const collectionUri = await getCollectionUri();
    const client = new ArtifactClient(projectId);
    try {
      await client.initialize(collectionUri, getAccessToken);
    } catch (e2) {
      return {
        pipelines: [],
        skippedCount: 0,
        error: `Failed to initialize: ${getErrorMessage(e2)}`
      };
    }
    let skippedCount = 0;
    const pipelines = [];
    let definitions;
    try {
      definitions = await client.getDefinitions();
    } catch (e2) {
      return {
        pipelines: [],
        skippedCount: 0,
        error: `Failed to list pipelines: ${getErrorMessage(e2)}`
      };
    }
    for (const def of definitions) {
      try {
        const builds = await client.getBuilds(def.id);
        if (!builds || builds.length === 0) continue;
        const latestBuild = builds[0];
        if (!latestBuild) continue;
        const artifacts = await client.getArtifacts(latestBuild.id);
        if (!artifacts.some((a2) => a2.name === "aggregates"))
          continue;
        pipelines.push({
          id: def.id,
          name: def.name,
          buildId: latestBuild.id
        });
      } catch (e2) {
        skippedCount++;
        console.debug("Skipping pipeline %s:", def.name, e2);
      }
    }
    return { pipelines, skippedCount };
  }
  async function runDiscovery() {
    const statusDisplay = document.getElementById("status-display");
    if (!statusDisplay) return;
    const originalContent = statusDisplay.innerHTML;
    renderTrustedHtml(
      statusDisplay,
      "<p>\u{1F50D} Discovering pipelines with aggregates artifact...</p>"
    );
    try {
      const result = await discoverPipelines();
      if (result.error) {
        let errorHtml = `<p class="status-warning">\u26A0\uFE0F Discovery failed: ${escapeHtml(result.error)}</p>`;
        errorHtml += `<p class="status-hint"><a href="#" id="retry-run-discovery-link">Retry</a></p>`;
        renderTrustedHtml(statusDisplay, errorHtml);
        const retryLink = document.getElementById("retry-run-discovery-link");
        if (retryLink) {
          retryLink.addEventListener("click", (e2) => {
            e2.preventDefault();
            void runDiscovery();
          });
        }
        showStatus("Discovery failed: " + result.error, "error");
        return;
      }
      if (result.pipelines.length === 0) {
        renderTrustedHtml(
          statusDisplay,
          `
                <p class="status-warning">\u26A0\uFE0F No PR Insights pipelines found in the current project.</p>
                <p class="status-hint">Create a pipeline using pr-insights-pipeline.yml and run it at least once.</p>
            `
        );
        showStatus("No pipelines found with aggregates artifact", "warning");
        return;
      }
      let html = `<p><strong>Found ${result.pipelines.length} pipeline(s):</strong></p>`;
      if (result.skippedCount > 0) {
        html += `<p class="status-warning">\u26A0\uFE0F ${result.skippedCount} pipeline(s) could not be checked.</p>`;
      }
      html += `<ul class="discovered-pipelines">`;
      for (const match of result.pipelines) {
        html += `<li>
                <strong>${escapeHtml(match.name)}</strong> (ID: ${match.id})
                <button class="btn btn-small" id="select-pipeline-${match.id}">Use This</button>
            </li>`;
      }
      html += "</ul>";
      html += '<p class="status-hint">Click "Use This" to configure, or clear settings for auto-discovery.</p>';
      renderTrustedHtml(statusDisplay, html);
      for (const match of result.pipelines) {
        document.getElementById(`select-pipeline-${match.id}`)?.addEventListener("click", () => {
          const pipelineInput = document.getElementById(
            "pipeline-id"
          );
          if (pipelineInput) pipelineInput.value = match.id.toString();
          showStatus(
            `Pipeline ${match.id} selected - click Save to confirm`,
            "info"
          );
        });
      }
      showStatus(`Found ${result.pipelines.length} pipeline(s)`, "success");
    } catch (error) {
      renderTrustedHtml(statusDisplay, originalContent);
      showStatus("Discovery failed: " + getErrorMessage(error), "error");
    }
  }
  function showStatus(message, type = "info") {
    const statusEl = document.getElementById("status-message");
    if (!statusEl) return;
    if (statusTimerId !== null) clearTimeout(statusTimerId);
    statusEl.textContent = message;
    statusEl.className = `status-message status-${type}`;
    statusTimerId = setTimeout(() => {
      statusTimerId = null;
      statusEl.textContent = "";
      statusEl.className = "status-message";
    }, 5e3);
  }
  function setupEventListeners() {
    document.getElementById("save-btn")?.addEventListener("click", () => void saveSettings());
    document.getElementById("clear-btn")?.addEventListener("click", () => void clearSettings());
    document.getElementById("discover-btn")?.addEventListener("click", () => void runDiscovery());
    document.getElementById("download-raw-btn")?.addEventListener("click", () => void downloadRawData());
    document.getElementById("pipeline-id")?.addEventListener("keypress", (e2) => {
      if (e2.key === "Enter") {
        void saveSettings();
      }
    });
    document.getElementById("project-id")?.addEventListener("keypress", (e2) => {
      if (e2.key === "Enter") {
        void saveSettings();
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
  window.selectDiscoveredPipeline = (pipelineId) => {
    const pipelineInput = document.getElementById(
      "pipeline-id"
    );
    if (pipelineInput) pipelineInput.value = pipelineId.toString();
    showStatus(`Pipeline ${pipelineId} selected - click Save to confirm`, "info");
  };
})();
// Global exports for browser runtime\nif (typeof window !== 'undefined') { Object.assign(window, PRInsightsSettings || {}); }
